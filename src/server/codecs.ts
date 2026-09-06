/**
 * Per-vendor protocol codecs. A codec turns a device operation into the bytes
 * one model's firmware expects, and turns a reply back into a value — or into
 * an explicit statement that the reply is not one.
 *
 * Every codec here is earned from measurement on the hardware it names. Nothing
 * in one codec generalises to another vendor.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface LightingZoneState {
  /** Opaque effect byte. Only the effects the registry declares are offered. */
  mode: number;
  brightness: number;
  color: RgbColor;
}

export type DecodedLighting =
  | { kind: "lighting"; zoneId: number; state: LightingZoneState }
  /** The device answered with its protocol's explicit rejection. */
  | { kind: "unsupported" }
  /** A well-formed frame that does not answer the request that was asked. */
  | { kind: "unrecognised" };

export interface DeviceCodec {
  readonly id: string;
  /** The report id that addresses the device itself on its control endpoint. */
  readonly reportId: number;
  readonly packetSize: number;
  encodeVersionQuery(): number[];
  isVersionReply(reply: readonly number[]): boolean;
  isVersionReplyAlive(reply: readonly number[]): boolean;
  encodeLightingGet(zoneId: number): number[];
  encodeLightingSet(zoneId: number, state: LightingZoneState): number[];
  encodeCommit(): number[];
  /** Whether a frame answers a lighting request, including a rejection of one. */
  isLightingReply(reply: readonly number[], zoneId: number): boolean;
  /** Whether a frame answers a commit, including a rejection of one. */
  isCommitReply(reply: readonly number[]): boolean;
  decodeLighting(reply: readonly number[]): DecodedLighting;
  isErrorFrame(reply: readonly number[]): boolean;
}

// Response layout, identical in field offsets to the request:
//
//   REQUEST   [rpt] 51 28 <led> <pad> <mode> <bright> <r> <g> <b>
//   RESPONSE  [rpt] 12 03 <led> <pad> <mode> <bright> <r> <g> <b>
//   index       0    1  2    3     4     5      6      7   8   9
const COMMAND = 1;
const SUBCOMMAND = 2;
const ZONE = 3;
const MODE = 5;
const BRIGHTNESS = 6;
const RED = 7;
const GREEN = 8;
const BLUE = 9;

const GET_LIGHTING = [0x12, 0x03] as const;
const SET_LIGHTING = [0x51, 0x28] as const;
const COMMIT = [0x50, 0x03] as const;
const VERSION = [0x12, 0x00] as const;
const ERROR_FRAME = [0xff, 0xaa] as const;

/** The payload the version query answers with is 63 bytes after the report id. */
const ASUS_PACKET_SIZE = 64;

function byte(value: number): number {
  return Math.max(0, Math.min(255, Math.trunc(value)));
}

class AsusRogCodec implements DeviceCodec {
  readonly id = "asus-rog";
  // Report id 3 reaches the mouse. Report id 2 addresses the receiver and
  // answers every led index with identical data; report id 1 answers only the
  // version query.
  readonly reportId = 3;
  readonly packetSize = ASUS_PACKET_SIZE;

  private frame(bytes: readonly number[]): number[] {
    const payload = new Array<number>(this.packetSize - 1).fill(0);
    bytes.forEach((value, index) => {
      payload[index] = byte(value);
    });
    return payload;
  }

  encodeVersionQuery(): number[] {
    return this.frame([...VERSION]);
  }

  isVersionReply(reply: readonly number[]): boolean {
    return reply[COMMAND] === VERSION[0] && reply[SUBCOMMAND] === VERSION[1];
  }

  /**
   * Observed on an ASUS ROG Harpe II ACE behind a ROG SPEEDNOVA receiver: while
   * the mouse is dozing the receiver answers on its behalf with well-formed
   * frames. The lighting query still returns plausible values in that window,
   * but the version query's long payload collapses to all zeros first. That
   * asymmetry is the liveness oracle; a device that behaves differently is a
   * change to this function alone.
   */
  isVersionReplyAlive(reply: readonly number[]): boolean {
    if (this.isErrorFrame(reply)) return false;
    if (!this.isVersionReply(reply)) return false;
    return reply.slice(SUBCOMMAND + 1).some((value) => value !== 0);
  }

  encodeLightingGet(zoneId: number): number[] {
    return this.frame([...GET_LIGHTING, zoneId]);
  }

  encodeLightingSet(zoneId: number, state: LightingZoneState): number[] {
    return this.frame([
      ...SET_LIGHTING,
      zoneId,
      0,
      state.mode,
      state.brightness,
      state.color.r,
      state.color.g,
      state.color.b,
    ]);
  }

  /** Persisting to onboard memory is a command of its own, never implied. */
  encodeCommit(): number[] {
    return this.frame([...COMMIT]);
  }

  isErrorFrame(reply: readonly number[]): boolean {
    return reply[COMMAND] === ERROR_FRAME[0] && reply[SUBCOMMAND] === ERROR_FRAME[1];
  }

  isLightingReply(reply: readonly number[], zoneId: number): boolean {
    if (this.isErrorFrame(reply)) return true;
    if (reply[COMMAND] !== GET_LIGHTING[0] || reply[SUBCOMMAND] !== GET_LIGHTING[1]) return false;
    // Report id 3 echoes led index 0 for every query, so a reply that names a
    // different zone than the one asked for is still this request's answer only
    // when the device echoed the index back.
    return reply[ZONE] === zoneId || reply[ZONE] === 0;
  }

  /**
   * The commit reply's shape is unmeasured: the command was deliberately never
   * sent during probing, since flash has finite write cycles. Any frame that is
   * not another command's answer is therefore taken as the commit's.
   */
  isCommitReply(reply: readonly number[]): boolean {
    if (this.isErrorFrame(reply)) return true;
    return !this.isVersionReply(reply);
  }

  decodeLighting(reply: readonly number[]): DecodedLighting {
    if (this.isErrorFrame(reply)) return { kind: "unsupported" };
    if (reply[COMMAND] !== GET_LIGHTING[0] || reply[SUBCOMMAND] !== GET_LIGHTING[1]) {
      return { kind: "unrecognised" };
    }
    if (reply.length <= BLUE) return { kind: "unrecognised" };
    return {
      kind: "lighting",
      zoneId: reply[ZONE] ?? 0,
      state: {
        mode: reply[MODE] ?? 0,
        brightness: reply[BRIGHTNESS] ?? 0,
        color: { r: reply[RED] ?? 0, g: reply[GREEN] ?? 0, b: reply[BLUE] ?? 0 },
      },
    };
  }
}

export const asusRogCodec: DeviceCodec = new AsusRogCodec();

const CODECS_BY_MODEL: Readonly<Record<string, DeviceCodec>> = {
  "asus-rog-harpe-ii-ace": asusRogCodec,
};

export function codecForModel(model: string): DeviceCodec | undefined {
  return CODECS_BY_MODEL[model];
}
