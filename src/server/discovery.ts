import type { HidPort } from "./hid";
import { matchDevices, capabilitiesFor, candidatePath, type ConnectionPath, type DeviceEndpoints, type DeviceKind, type Feature, type LightingDescriptor, type LogicalDeviceCandidate, type RegistryEntry } from "./registry";
import { KnownDeviceStore, type KnownDeviceRecord } from "./persistence";
import { ProfileStore } from "./profiles";
import { DEVICE_REGISTRY } from "./registry";

export type DeviceConnectionState = "connected" | "disconnected";
export type DeviceAccessState = "granted" | "denied";
export type DiscoveryAvailability = "available" | "unavailable";

export interface DeviceState {
  id: string;
  model: string;
  displayName: string;
  vendor: string;
  kind: DeviceKind;
  capabilities: Feature[];
  connection: DeviceConnectionState;
  connectionPath: ConnectionPath | null;
  /** The interfaces this unit was matched on, addressed by role. */
  endpoints: DeviceEndpoints;
  /** False when no control endpoint resolved, so no command can be sent. */
  configurable: boolean;
  configurableReason?: string;
  lighting?: LightingDescriptor;
  serialNumber?: string;
  vendorId: number;
  productId: number;
  access: DeviceAccessState;
  accessReason?: string;
  profileName: string | null;
}

/** What discovery needs to know about configuration sessions holding a device open. */
export interface OpenSessionRegistry {
  hasOpenSession(path: string): boolean;
}

export interface DiscoverySnapshot {
  discovery: DiscoveryAvailability;
  discoveryReason?: string;
  devices: DeviceState[];
}

export interface DiscoveryTransition {
  type: "attached" | "detached" | "unchanged";
  device: DeviceState;
}

export type DiscoveryListener = (
  snapshot: DiscoverySnapshot,
  transitions: readonly DiscoveryTransition[],
) => void;

export interface DiscoveryServiceOptions {
  hidPort: HidPort;
  knownDevices?: KnownDeviceStore;
  profileStore?: ProfileStore;
  registry?: readonly RegistryEntry[];
  intervalMs?: number;
  now?: () => Date;
  sessions?: OpenSessionRegistry;
}

export class DiscoveryService {
  readonly hidPort: HidPort;
  readonly knownDevices: KnownDeviceStore;
  readonly profileStore?: ProfileStore;
  readonly registry: readonly RegistryEntry[];
  readonly intervalMs: number;
  private readonly now: () => Date;
  private sessions: OpenSessionRegistry | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshInFlight: Promise<DiscoverySnapshot> | undefined;
  private started = false;
  private listeners = new Set<DiscoveryListener>();
  private transitionListeners = new Set<(transition: DiscoveryTransition) => void>();
  private snapshot: DiscoverySnapshot = { discovery: "available", devices: [] };

  constructor(options: DiscoveryServiceOptions) {
    this.hidPort = options.hidPort;
    this.knownDevices = options.knownDevices ?? new KnownDeviceStore();
    this.profileStore = options.profileStore;
    this.registry = options.registry ?? DEVICE_REGISTRY;
    this.intervalMs = options.intervalMs ?? 1_000;
    this.now = options.now ?? (() => new Date());
    this.sessions = options.sessions;
  }

  /** Sessions are created after discovery, so the registry is attached later. */
  useSessions(sessions: OpenSessionRegistry): void {
    this.sessions = sessions;
  }

  getSnapshot(): DiscoverySnapshot {
    return cloneSnapshot(this.snapshot);
  }

  subscribe(listener: DiscoveryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onTransition(listener: (transition: DiscoveryTransition) => void): () => void {
    this.transitionListeners.add(listener);
    return () => this.transitionListeners.delete(listener);
  }

  async start(): Promise<DiscoverySnapshot> {
    if (this.started) return this.getSnapshot();
    this.started = true;
    await this.knownDevices.load();
    if (this.profileStore && !this.profileStore.isLoaded()) {
      await this.profileStore.load();
    }
    let initializationFailed = false;
    try {
      await this.hidPort.initialize?.();
    } catch (error) {
      initializationFailed = true;
      this.setUnavailable(error);
    }
    if (!initializationFailed) await this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.intervalMs);
    return this.getSnapshot();
  }

  async refresh(): Promise<DiscoverySnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.performRefresh().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.started = false;
    await this.hidPort.close();
  }

  private async performRefresh(): Promise<DiscoverySnapshot> {
    let descriptors;
    try {
      descriptors = await this.hidPort.enumerate();
    } catch (error) {
      this.setUnavailable(error);
      return this.getSnapshot();
    }

    const candidates = matchDevices(descriptors, this.registry);
    const currentDevices = await this.buildConnectedDevices(candidates);
    const connectedIds = new Set(currentDevices.map((device) => device.id));
    for (const known of this.knownDevices.all()) {
      if (!connectedIds.has(known.id)) {
        currentDevices.push(disconnectedState(known));
      }
    }

    currentDevices.sort((left, right) => {
      const kindOrder = left.kind.localeCompare(right.kind);
      if (kindOrder !== 0) return kindOrder;
      return left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
    });
    const next: DiscoverySnapshot = { discovery: "available", devices: currentDevices };
    const transitions = diffTransitions(this.snapshot.devices, next.devices);
    this.snapshot = next;
    this.notify(next, transitions);
    return this.getSnapshot();
  }

  private async buildConnectedDevices(candidates: readonly LogicalDeviceCandidate[]): Promise<DeviceState[]> {
    const ordinalByModel = new Map<string, number>();
    const ordered = [...candidates].sort((left, right) => {
      const modelOrder = left.entry.id.localeCompare(right.entry.id);
      if (modelOrder !== 0) return modelOrder;
      return (candidatePath(left) ?? "").localeCompare(candidatePath(right) ?? "");
    });
    const devices: DeviceState[] = [];
    const recordsToSave: KnownDeviceRecord[] = [];

    for (const candidate of ordered) {
      const ordinal = candidate.serialNumber
        ? 0
        : (ordinalByModel.set(candidate.entry.id, (ordinalByModel.get(candidate.entry.id) ?? 0) + 1), ordinalByModel.get(candidate.entry.id)!);
      const id = deviceIdentity(candidate, ordinal);
      const existing = this.knownDevices.get(id);
      const access = await this.checkAccess(candidate);
      const profile = this.profileStore ? await this.profileStore.ensureDefault(candidate.entry.id) : undefined;
      const activeProfile = chooseActiveProfile(existing?.activeProfile, profile?.name, this.profileStore, candidate.entry.id);
      const timestamp = this.now().toISOString();
      const record: KnownDeviceRecord = {
        id,
        model: candidate.entry.id,
        displayName: candidate.entry.displayName,
        vendor: candidate.entry.vendor,
        kind: candidate.entry.kind,
        capabilities: capabilitiesFor(candidate.entry),
        connectionPath: candidate.match.connection,
        vendorId: candidate.vendorId,
        productId: candidate.productId,
        serialNumber: candidate.serialNumber,
        activeProfile,
        firstSeenAt: existing?.firstSeenAt ?? timestamp,
        lastSeenAt: timestamp,
      };
      recordsToSave.push(record);
      devices.push({
        id,
        model: candidate.entry.id,
        displayName: candidate.entry.displayName,
        vendor: candidate.entry.vendor,
        kind: candidate.entry.kind,
        capabilities: capabilitiesFor(candidate.entry),
        connection: "connected",
        connectionPath: candidate.match.connection,
        endpoints: cloneEndpoints(candidate.endpoints),
        configurable: Boolean(candidate.endpoints.control),
        configurableReason: candidate.endpoints.control
          ? undefined
          : "No configuration interface was matched for this device",
        lighting: candidate.entry.lighting,
        serialNumber: candidate.serialNumber,
        vendorId: candidate.vendorId,
        productId: candidate.productId,
        access: access.granted ? "granted" : "denied",
        accessReason: access.granted ? undefined : access.reason,
        profileName: activeProfile ?? null,
      });
    }
    for (const record of recordsToSave) {
      await this.knownDevices.upsert(record);
    }
    return devices;
  }

  /**
   * Access is judged on the endpoint the device is configured through, so that
   * "granted" means configurable rather than merely visible. A device with no
   * control endpoint is judged on the endpoint that identifies it, and is
   * reported as not configurable separately.
   */
  private async checkAccess(candidate: LogicalDeviceCandidate): Promise<{ granted: true } | { granted: false; reason: string }> {
    const target = candidate.endpoints.control ?? candidate.endpoints.identify;
    if (!target) return { granted: false, reason: "The HID backend did not report an access path" };
    // A held-open configuration session already proves the endpoint is
    // accessible. Probing it again would collide with that session and, on
    // platforms with exclusive HID access, flip the device to denied once a
    // second for no user-visible cause.
    if (this.sessions?.hasOpenSession(target.path)) return { granted: true };
    try {
      const handle = await this.hidPort.open(target.path);
      await handle.close();
      return { granted: true };
    } catch (error) {
      return { granted: false, reason: `Permission denied: ${errorMessage(error)}` };
    }
  }

  private setUnavailable(error: unknown): void {
    const reason = errorMessage(error);
    const next: DiscoverySnapshot = {
      discovery: "unavailable",
      discoveryReason: reason,
      devices: this.knownDevices.all().map(disconnectedState),
    };
    const transitions = diffTransitions(this.snapshot.devices, next.devices);
    this.snapshot = next;
    this.notify(next, transitions);
  }

  private notify(snapshot: DiscoverySnapshot, transitions: readonly DiscoveryTransition[]): void {
    for (const listener of this.listeners) listener(cloneSnapshot(snapshot), transitions);
    for (const transition of transitions) {
      for (const listener of this.transitionListeners) listener({ ...transition, device: cloneDevice(transition.device) });
    }
  }
}

export function deviceIdentity(candidate: Pick<LogicalDeviceCandidate, "vendorId" | "productId" | "serialNumber">, ordinal: number): string {
  const serial = candidate.serialNumber?.trim();
  return `${candidate.vendorId}:${candidate.productId}:${serial || `#${ordinal}`}`;
}

function chooseActiveProfile(
  saved: string | undefined,
  fallback: string | undefined,
  store: ProfileStore | undefined,
  model: string,
): string | undefined {
  if (saved && (!store || store.get(model, saved))) return saved;
  return fallback;
}

function disconnectedState(record: KnownDeviceRecord): DeviceState {
  return {
    id: record.id,
    model: record.model,
    displayName: record.displayName,
    vendor: record.vendor,
    kind: record.kind,
    capabilities: [...record.capabilities],
    connection: "disconnected",
    connectionPath: record.connectionPath,
    endpoints: {},
    configurable: false,
    configurableReason: "The device is not connected",
    serialNumber: record.serialNumber,
    vendorId: record.vendorId,
    productId: record.productId,
    access: "granted",
    profileName: record.activeProfile ?? null,
  };
}

function diffTransitions(previous: readonly DeviceState[], next: readonly DeviceState[]): DiscoveryTransition[] {
  const previousById = new Map(previous.map((device) => [device.id, device]));
  const nextById = new Map(next.map((device) => [device.id, device]));
  const transitions: DiscoveryTransition[] = [];
  for (const device of next) {
    const prior = previousById.get(device.id);
    const type = !prior || (prior.connection === "disconnected" && device.connection === "connected")
      ? "attached"
      : prior.connection === "connected" && device.connection === "disconnected"
        ? "detached"
        : "unchanged";
    transitions.push({ type, device: cloneDevice(device) });
  }
  for (const prior of previous) {
    if (!nextById.has(prior.id) && prior.connection === "connected") {
      transitions.push({ type: "detached", device: { ...cloneDevice(prior), connection: "disconnected" } });
    }
  }
  return transitions;
}

function cloneEndpoints(endpoints: DeviceEndpoints): DeviceEndpoints {
  const clone: DeviceEndpoints = {};
  if (endpoints.identify) clone.identify = { ...endpoints.identify };
  if (endpoints.control) clone.control = { ...endpoints.control };
  return clone;
}

function cloneDevice(device: DeviceState): DeviceState {
  return { ...device, capabilities: [...device.capabilities], endpoints: cloneEndpoints(device.endpoints) };
}

function cloneSnapshot(snapshot: DiscoverySnapshot): DiscoverySnapshot {
  return { ...snapshot, devices: snapshot.devices.map(cloneDevice) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
