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
  /** Optional stable physical path supplied by a platform-specific backend. */
  physicalPath?: string;
}

export interface HidConnection {
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

export interface FakeHidPortOptions {
  openFailures?: Readonly<Record<string, Error | string>>;
}

/** Hardware-free HID port used by discovery and API tests. */
export class FakeHidPort implements HidPort {
  private script: FakeEnumerationStep[];
  private cursor = 0;
  private lastResult: HidDescriptor[] = [];
  private readonly openFailures: Map<string, Error>;
  readonly openedPaths: string[] = [];
  readonly closedPaths: string[] = [];

  constructor(script: readonly FakeEnumerationStep[] = [[]], options: FakeHidPortOptions = {}) {
    this.script = [...script];
    this.openFailures = new Map(
      Object.entries(options.openFailures ?? {}).map(([path, error]) => [
        path,
        error instanceof Error ? error : new Error(error),
      ]),
    );
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

    let closed = false;
    return {
      close: () => {
        if (!closed) {
          closed = true;
          this.closedPaths.push(path);
        }
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
}
