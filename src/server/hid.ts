import { HID as NativeHid, devices as nativeDevices } from "node-hid";
import type { Device as NativeHidDevice } from "node-hid";

export interface HidDescriptor {
  vendorId: number;
  productId: number;
  path?: string;
  serialNumber?: string;
  manufacturer?: string;
  product?: string;
  release?: number;
  interface?: number;
  usagePage?: number;
  usage?: number;
  /** Report id enumerated for this top-level collection, when the backend reports one. */
  reportId?: number;
  /** Optional stable physical path supplied by a platform-specific backend. */
  physicalPath?: string;
}

export interface HidConnection {
  /**
   * Send one output report. The report id is prefixed to the payload, which is
   * how hidapi addresses a numbered report.
   */
  write(reportId: number, payload: readonly number[]): void | Promise<void>;
  /** Read one input report, or undefined when nothing arrives within the timeout. */
  read(timeoutMs: number): (number[] | undefined) | Promise<number[] | undefined>;
  close(): void | Promise<void>;
}

export interface HidPort {
  enumerate(): HidDescriptor[] | Promise<HidDescriptor[]>;
  open(path: string): HidConnection | Promise<HidConnection>;
  close(): void | Promise<void>;
  initialize?(): void | Promise<void>;
}

function fromNativeDescriptor(device: NativeHidDevice): HidDescriptor {
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    path: device.path,
    serialNumber: device.serialNumber || undefined,
    manufacturer: device.manufacturer,
    product: device.product,
    release: device.release,
    interface: device.interface,
    usagePage: device.usagePage,
    usage: device.usage,
  };
}

/** Production HID implementation backed by node-hid's native hidapi binding. */
export class NodeHidPort implements HidPort {
  private readonly handles = new Set<NativeHid>();

  enumerate(): HidDescriptor[] {
    return nativeDevices().map(fromNativeDescriptor);
  }

  open(path: string): HidConnection {
    const handle = new NativeHid(path);
    this.handles.add(handle);
    return {
      write: (reportId, payload) => {
        handle.write([reportId, ...payload]);
      },
      read: (timeoutMs) => {
        const reply = handle.readTimeout(timeoutMs);
        // hidapi signals a timeout with an empty read rather than an error.
        return reply && reply.length > 0 ? [...reply] : undefined;
      },
      close: () => {
        if (this.handles.delete(handle)) {
          handle.close();
        }
      },
    };
  }

  close(): void {
    for (const handle of this.handles) {
      try {
        handle.close();
      } catch {
        // Closing a device that disappeared is already the desired outcome.
      }
    }
    this.handles.clear();
  }
}

export type FakeEnumerationStep =
  | readonly HidDescriptor[]
  | Error
  | (() => readonly HidDescriptor[] | Error);

/** What a scripted endpoint does with one request. */
export type FakeReply =
  | { kind: "reply"; data: readonly number[] }
  | { kind: "timeout" }
  | { kind: "error"; error: Error };

export type FakeRequestHandler = (
  request: readonly number[],
) => FakeReply | readonly number[] | undefined;

export interface FakeWriteRecord {
  path: string;
  reportId: number;
  payload: number[];
}

export interface FakeHidPortOptions {
  openFailures?: Readonly<Record<string, Error | string>>;
  exchanges?: Readonly<Record<string, FakeRequestHandler>>;
}

/** A reply that never arrives. */
export function fakeTimeout(): FakeReply {
  return { kind: "timeout" };
}

/** A transport-level failure, as raised when a device is pulled mid-exchange. */
export function fakeError(message: string): FakeReply {
  return { kind: "error", error: new Error(message) };
}

/** Hardware-free HID port used by discovery, protocol, and API tests. */
export class FakeHidPort implements HidPort {
  private script: FakeEnumerationStep[];
  private cursor = 0;
  private lastResult: HidDescriptor[] = [];
  private readonly openFailures: Map<string, Error>;
  private readonly handlers: Map<string, FakeRequestHandler>;
  readonly openedPaths: string[] = [];
  readonly closedPaths: string[] = [];
  readonly writes: FakeWriteRecord[] = [];
  /** Paths currently held open, so tests can assert session lifetime. */
  readonly openHandles = new Map<string, number>();

  constructor(script: readonly FakeEnumerationStep[] = [[]], options: FakeHidPortOptions = {}) {
    this.script = [...script];
    this.openFailures = new Map(
      Object.entries(options.openFailures ?? {}).map(([path, error]) => [
        path,
        error instanceof Error ? error : new Error(error),
      ]),
    );
    this.handlers = new Map(Object.entries(options.exchanges ?? {}));
  }

  enumerate(): HidDescriptor[] {
    const step = this.cursor < this.script.length ? this.script[this.cursor++] ?? [] : this.lastResult;
    const result = typeof step === "function" ? step() : step;
    if (result instanceof Error) {
      throw result;
    }
    this.lastResult = result.map((descriptor) => ({ ...descriptor }));
    return this.lastResult.map((descriptor) => ({ ...descriptor }));
  }

  open(path: string): HidConnection {
    this.openedPaths.push(path);
    const failure = this.openFailures.get(path);
    if (failure) {
      throw failure;
    }

    this.openHandles.set(path, (this.openHandles.get(path) ?? 0) + 1);
    const pending: FakeReply[] = [];
    let closed = false;
    return {
      write: (reportId, payload) => {
        if (closed) throw new Error("The device handle is closed");
        const request = [reportId, ...payload];
        this.writes.push({ path, reportId, payload: [...payload] });
        const outcome = this.handlers.get(path)?.(request);
        if (outcome === undefined) return;
        pending.push(Array.isArray(outcome) ? { kind: "reply", data: outcome } : (outcome as FakeReply));
      },
      read: (_timeoutMs) => {
        if (closed) throw new Error("The device handle is closed");
        const next = pending.shift();
        if (!next || next.kind === "timeout") return undefined;
        if (next.kind === "error") throw next.error;
        return [...next.data];
      },
      close: () => {
        if (closed) return;
        closed = true;
        const remaining = (this.openHandles.get(path) ?? 1) - 1;
        if (remaining > 0) this.openHandles.set(path, remaining);
        else this.openHandles.delete(path);
        this.closedPaths.push(path);
      },
    };
  }

  close(): void {
    // Fake handles are closed by the caller; this method mirrors the port lifecycle.
  }

  setScript(script: readonly FakeEnumerationStep[]): void {
    this.script = [...script];
    this.cursor = 0;
    this.lastResult = [];
  }

  pushEnumeration(result: readonly HidDescriptor[] | Error): void {
    this.script.push(result);
  }

  deny(path: string, reason = "Permission denied"): void {
    this.openFailures.set(path, new Error(reason));
  }

  allow(path: string): void {
    this.openFailures.delete(path);
  }

  /** Script how an endpoint answers requests written to it. */
  respond(path: string, handler: FakeRequestHandler): void {
    this.handlers.set(path, handler);
  }
}
