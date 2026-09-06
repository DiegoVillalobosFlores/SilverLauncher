import type { HidConnection, HidPort } from "./hid";
import type { DeviceCodec } from "./codecs";

export type ExchangeOutcome =
  | { status: "reply"; reply: number[] }
  /** Nothing answered the request within the timeout. */
  | { status: "timeout" }
  /**
   * The handle failed. A device pulled mid-session lands here; it is not an
   * error to show a user, it is a return to discovery.
   */
  | { status: "detached"; reason: string };

export interface DeviceSessionOptions {
  hidPort: HidPort;
  /** The control endpoint's path. Commands are sent nowhere else. */
  path: string;
  codec: DeviceCodec;
  timeoutMs?: number;
  /** Called once when the handle fails, so discovery can be told to re-look. */
  onDetach?: (reason: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 250;
const READ_SLICE_MS = 25;

/**
 * A held-open handle to one device's control endpoint, exchanging
 * request/response pairs. Replies are attributed by content: the caller says
 * which frames answer its request, and frames that do not are discarded rather
 * than mistaken for the answer to whatever was asked last.
 */
export class DeviceSession {
  readonly path: string;
  readonly codec: DeviceCodec;
  readonly timeoutMs: number;
  private readonly hidPort: HidPort;
  private readonly onDetach: ((reason: string) => void) | undefined;
  private readonly now: () => number;
  private handle: HidConnection | undefined;
  private detached = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: DeviceSessionOptions) {
    this.hidPort = options.hidPort;
    this.path = options.path;
    this.codec = options.codec;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onDetach = options.onDetach;
    this.now = options.now ?? (() => Date.now());
  }

  get isOpen(): boolean {
    return this.handle !== undefined;
  }

  async open(): Promise<{ opened: true } | { opened: false; reason: string }> {
    if (this.handle) return { opened: true };
    try {
      this.handle = await this.hidPort.open(this.path);
      this.detached = false;
      return { opened: true };
    } catch (error) {
      return { opened: false, reason: errorMessage(error) };
    }
  }

  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = undefined;
    if (!handle) return;
    try {
      await handle.close();
    } catch {
      // A handle that cannot be closed has already gone away.
    }
  }

  /**
   * Send one request and wait for the frame that answers it. Exchanges are
   * serialised so two callers cannot interleave on one handle.
   */
  async exchange(
    request: readonly number[],
    answers: (reply: readonly number[]) => boolean,
    timeoutMs = this.timeoutMs,
  ): Promise<ExchangeOutcome> {
    const run = this.queue.then(() => this.performExchange(request, answers, timeoutMs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async performExchange(
    request: readonly number[],
    answers: (reply: readonly number[]) => boolean,
    timeoutMs: number,
  ): Promise<ExchangeOutcome> {
    const handle = this.handle;
    if (!handle) return { status: "detached", reason: "The device session is not open" };

    try {
      // Frames left over from an earlier command would otherwise be read as the
      // answer to this one.
      await this.drain(handle);
      await handle.write(this.codec.reportId, request);
    } catch (error) {
      return this.detach(errorMessage(error));
    }

    const deadline = this.now() + timeoutMs;
    // A backend whose timed read returns immediately would otherwise spin here
    // until the deadline, so the slices are counted as well as timed.
    const slices = Math.ceil(timeoutMs / READ_SLICE_MS) + 1;
    for (let slice = 0; slice < slices; slice += 1) {
      let reply: number[] | undefined;
      try {
        reply = await handle.read(Math.max(1, Math.min(READ_SLICE_MS, deadline - this.now())));
      } catch (error) {
        return this.detach(errorMessage(error));
      }
      if (reply && answers(reply)) return { status: "reply", reply };
      if (!reply && this.now() >= deadline) break;
    }

    return { status: "timeout" };
  }

  private async drain(handle: HidConnection): Promise<void> {
    for (let index = 0; index < 16; index += 1) {
      const stale = await handle.read(1);
      if (!stale) return;
    }
  }

  private detach(reason: string): ExchangeOutcome {
    void this.close();
    if (!this.detached) {
      this.detached = true;
      this.onDetach?.(reason);
    }
    return { status: "detached", reason };
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
