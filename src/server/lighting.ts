import type { HidPort } from "./hid";
import { codecForModel, type DeviceCodec, type LightingZoneState } from "./codecs";
import { DeviceSession } from "./session";
import type { DeviceState, DiscoveryService, OpenSessionRegistry } from "./discovery";
import type { LightingDescriptor } from "./registry";

export type LightingFailureCode =
  /** The device resolved no control endpoint, so no command can be addressed. */
  | "not-configurable"
  /** The model has no codec, or the device rejected the command. */
  | "unsupported"
  /** Liveness failed: the reply cannot be vouched for. */
  | "unreachable"
  /**
   * The device refused a command its model is known to implement, which means
   * the device is not answering for itself rather than that it lacks the
   * feature.
   */
  | "rejected"
  | "access-denied"
  | "not-applied"
  | "timeout"
  | "disconnected";

export interface LightingFailure {
  code: LightingFailureCode;
  reason: string;
}

export interface LightingZoneReading {
  zoneId: number;
  name: string;
  state: LightingZoneState;
}

export type LightingReadResult =
  | { status: "ok"; descriptor: LightingDescriptor; zones: LightingZoneReading[] }
  /**
   * Explicitly not a value. A reading that failed liveness is reported here and
   * never as a zone state, so unknown stays distinguishable from a zone the
   * device genuinely holds at zero.
   */
  | ({ status: "unknown"; descriptor?: LightingDescriptor } & LightingFailure);

export type LightingWriteResult =
  | { status: "ok"; zone: LightingZoneReading }
  | ({ status: "failed" } & LightingFailure);

export type LightingCommitResult = { status: "ok" } | ({ status: "failed" } & LightingFailure);

export interface LightingServiceOptions {
  hidPort: HidPort;
  discovery: DiscoveryService;
  timeoutMs?: number;
}

interface ResolvedDevice {
  device: DeviceState;
  descriptor: LightingDescriptor;
  codec: DeviceCodec;
  controlPath: string;
}

/**
 * Reads and writes device lighting through a held-open control endpoint.
 *
 * Every read is gated on liveness, and every write is verified by reading it
 * back, because this device family acknowledges writes it discards while the
 * mouse is dozing.
 */
export class LightingService implements OpenSessionRegistry {
  private readonly hidPort: HidPort;
  private readonly discovery: DiscoveryService;
  private readonly timeoutMs: number | undefined;
  private readonly sessions = new Map<string, DeviceSession>();

  constructor(options: LightingServiceOptions) {
    this.hidPort = options.hidPort;
    this.discovery = options.discovery;
    this.timeoutMs = options.timeoutMs;
    this.discovery.useSessions(this);
  }

  hasOpenSession(path: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.path === path && session.isOpen) return true;
    }
    return false;
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) await session.close();
  }

  descriptorFor(deviceId: string): LightingDescriptor | undefined {
    const device = this.deviceFor(deviceId);
    return device?.lighting;
  }

  async read(deviceId: string): Promise<LightingReadResult> {
    const resolved = this.resolve(deviceId);
    if ("failure" in resolved) return { status: "unknown", ...resolved.failure, descriptor: resolved.descriptor };
    const { descriptor, codec } = resolved;

    const session = await this.sessionFor(deviceId, resolved);
    if ("failure" in session) return { status: "unknown", descriptor, ...session.failure };

    const alive = await this.checkLiveness(session.session, codec);
    if (alive) return { status: "unknown", descriptor, ...alive };

    const zones: LightingZoneReading[] = [];
    for (const zone of descriptor.zones) {
      const outcome = await session.session.exchange(
        codec.encodeLightingGet(zone.id),
        (reply) => codec.isLightingReply(reply, zone.id),
      );
      if (outcome.status !== "reply") return { status: "unknown", descriptor, ...exchangeFailure(outcome) };
      const decoded = codec.decodeLighting(outcome.reply);
      if (decoded.kind === "unsupported") return { status: "unknown", descriptor, ...rejection("read") };
      if (decoded.kind === "unrecognised") {
        return { status: "unknown", descriptor, code: "unreachable", reason: "The device answered with a frame that does not describe its lighting" };
      }
      zones.push({ zoneId: zone.id, name: zone.name, state: decoded.state });
    }
    return { status: "ok", descriptor, zones };
  }

  /** Apply to the device's working state. Nothing here reaches onboard memory. */
  async apply(deviceId: string, zoneId: number, state: LightingZoneState): Promise<LightingWriteResult> {
    const resolved = this.resolve(deviceId);
    if ("failure" in resolved) return { status: "failed", ...resolved.failure };
    const { descriptor, codec } = resolved;

    const zone = descriptor.zones.find((candidate) => candidate.id === zoneId);
    if (!zone) {
      return { status: "failed", code: "unsupported", reason: `This device has no lighting zone ${zoneId}` };
    }
    const invalid = validateState(descriptor, state);
    if (invalid) return { status: "failed", code: "unsupported", reason: invalid };

    const session = await this.sessionFor(deviceId, resolved);
    if ("failure" in session) return { status: "failed", ...session.failure };

    // Liveness first: a write issued into the dozing window is acknowledged and
    // discarded, so an unreachable device is not written to at all.
    const alive = await this.checkLiveness(session.session, codec);
    if (alive) return { status: "failed", ...alive };

    const written = await session.session.exchange(
      codec.encodeLightingSet(zone.id, state),
      (reply) => codec.isLightingReply(reply, zone.id),
    );
    if (written.status === "detached") return { status: "failed", ...exchangeFailure(written) };
    if (written.status === "reply" && codec.isErrorFrame(written.reply)) {
      return { status: "failed", ...rejection("write") };
    }

    const readBack = await session.session.exchange(
      codec.encodeLightingGet(zone.id),
      (reply) => codec.isLightingReply(reply, zone.id),
    );
    if (readBack.status !== "reply") return { status: "failed", ...exchangeFailure(readBack) };
    const decoded = codec.decodeLighting(readBack.reply);
    if (decoded.kind !== "lighting") {
      return { status: "failed", code: "not-applied", reason: "The device did not confirm the change" };
    }
    if (!statesMatch(decoded.state, state)) {
      return {
        status: "failed",
        code: "not-applied",
        reason: "The device acknowledged the change but still reports its previous lighting",
      };
    }
    return { status: "ok", zone: { zoneId: zone.id, name: zone.name, state: decoded.state } };
  }

  /** Persist the device's current lighting to its onboard memory. */
  async commit(deviceId: string): Promise<LightingCommitResult> {
    const resolved = this.resolve(deviceId);
    if ("failure" in resolved) return { status: "failed", ...resolved.failure };
    const { codec } = resolved;

    const session = await this.sessionFor(deviceId, resolved);
    if ("failure" in session) return { status: "failed", ...session.failure };

    const alive = await this.checkLiveness(session.session, codec);
    if (alive) return { status: "failed", ...alive };

    const outcome = await session.session.exchange(
      codec.encodeCommit(),
      (reply) => codec.isCommitReply(reply),
    );
    if (outcome.status !== "reply") {
      return outcome.status === "timeout"
        ? { status: "failed", code: "not-applied", reason: "The device did not confirm the save" }
        : { status: "failed", ...exchangeFailure(outcome) };
    }
    if (codec.isErrorFrame(outcome.reply)) {
      return { status: "failed", ...rejection("save") };
    }
    return { status: "ok" };
  }

  /**
   * The liveness gate. Returns a failure when the device cannot be vouched for,
   * and nothing when it can.
   */
  private async checkLiveness(session: DeviceSession, codec: DeviceCodec): Promise<LightingFailure | undefined> {
    const outcome = await session.exchange(
      codec.encodeVersionQuery(),
      (reply) => codec.isVersionReply(reply) || codec.isErrorFrame(reply),
    );
    if (outcome.status === "detached") return exchangeFailure(outcome);
    if (outcome.status === "timeout") {
      return { code: "unreachable", reason: "The device did not answer; it may be asleep or out of range" };
    }
    if (!codec.isVersionReplyAlive(outcome.reply)) {
      return { code: "unreachable", reason: "The device is not currently responding for itself; its lighting cannot be read" };
    }
    return undefined;
  }

  private deviceFor(deviceId: string): DeviceState | undefined {
    return this.discovery.getSnapshot().devices.find((device) => device.id === deviceId);
  }

  private resolve(deviceId: string): ResolvedDevice | { failure: LightingFailure; descriptor?: LightingDescriptor } {
    const device = this.deviceFor(deviceId);
    if (!device) {
      return { failure: { code: "disconnected", reason: "That device is not in the current snapshot" } };
    }
    if (device.connection !== "connected") {
      return { failure: { code: "disconnected", reason: "That device is not connected" } };
    }
    if (device.access === "denied") {
      return {
        failure: { code: "access-denied", reason: device.accessReason ?? "The operating system denied access to this device" },
      };
    }
    const descriptor = device.lighting;
    if (!descriptor || !device.capabilities.includes("lighting")) {
      return { failure: { code: "unsupported", reason: "This device does not declare lighting" } };
    }
    const controlPath = device.endpoints.control?.path;
    if (!controlPath) {
      return {
        descriptor,
        failure: {
          code: "not-configurable",
          reason: device.configurableReason ?? "No configuration interface was matched for this device",
        },
      };
    }
    const codec = codecForModel(device.model);
    if (!codec) {
      return { descriptor, failure: { code: "unsupported", reason: "No protocol is implemented for this model" } };
    }
    return { device, descriptor, codec, controlPath };
  }

  private async sessionFor(
    deviceId: string,
    resolved: ResolvedDevice,
  ): Promise<{ session: DeviceSession } | { failure: LightingFailure }> {
    const existing = this.sessions.get(deviceId);
    if (existing && existing.isOpen && existing.path === resolved.controlPath) {
      return { session: existing };
    }
    if (existing) {
      await existing.close();
      this.sessions.delete(deviceId);
    }
    const session = new DeviceSession({
      hidPort: this.hidPort,
      path: resolved.controlPath,
      codec: resolved.codec,
      timeoutMs: this.timeoutMs,
      onDetach: () => {
        // A device removed mid-session is discovery's news to deliver, not an
        // error to raise here.
        this.sessions.delete(deviceId);
        void this.discovery.refresh();
      },
    });
    const opened = await session.open();
    if (!opened.opened) {
      return { failure: { code: "access-denied", reason: opened.reason } };
    }
    this.sessions.set(deviceId, session);
    return { session };
  }
}

/**
 * A rejection of a command the registry says this model implements.
 *
 * Measured on an ASUS ROG Harpe II ACE behind its receiver: once the mouse has
 * been idle for around 90 seconds it sleeps, and the receiver then answers the
 * lighting query with the protocol's `ff aa` rejection while still answering
 * the version query with a live payload. So the liveness gate alone does not
 * catch a sleeping mouse, and a rejection here is evidence about the device's
 * power state, not about its firmware's feature set. Whether a model implements
 * lighting at all is the registry's statement to make, not this reply's.
 */
function rejection(operation: "read" | "write" | "save"): LightingFailure {
  const subject = operation === "read" ? "the lighting query" : operation === "write" ? "the lighting command" : "the save command";
  return {
    code: "rejected",
    reason: `The device refused ${subject}; it is most likely asleep`,
  };
}

function validateState(descriptor: LightingDescriptor, state: LightingZoneState): string | undefined {
  if (!descriptor.effects.some((effect) => effect.id === state.mode)) {
    return `This device does not declare the effect ${state.mode}`;
  }
  const { min, max } = descriptor.brightness;
  if (state.brightness < min || state.brightness > max) {
    return `Brightness must be between ${min} and ${max}`;
  }
  for (const channel of [state.color.r, state.color.g, state.color.b]) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      return "Each colour channel must be a whole number between 0 and 255";
    }
  }
  return undefined;
}

function statesMatch(left: LightingZoneState, right: LightingZoneState): boolean {
  return (
    left.mode === right.mode &&
    left.brightness === right.brightness &&
    left.color.r === right.color.r &&
    left.color.g === right.color.g &&
    left.color.b === right.color.b
  );
}

function exchangeFailure(outcome: { status: "timeout" } | { status: "detached"; reason: string }): LightingFailure {
  return outcome.status === "timeout"
    ? { code: "timeout", reason: "The device did not answer in time" }
    : { code: "disconnected", reason: outcome.reason };
}
