import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import type { ConnectionPath, DeviceKind, Feature } from "./registry";

export interface KnownDeviceRecord {
  id: string;
  model: string;
  displayName: string;
  vendor: string;
  kind: DeviceKind;
  capabilities: Feature[];
  connectionPath: ConnectionPath;
  vendorId: number;
  productId: number;
  serialNumber?: string;
  activeProfile?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface DevicesFile {
  formatVersion: 1;
  devices: KnownDeviceRecord[];
}

export function applicationConfigDirectory(explicit?: string): string {
  if (explicit) return explicit;

  const home = homedir();
  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, "silver-launcher");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Silver Launcher");
  }
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "Silver Launcher");
  }
  return join(home, ".config", "silver-launcher");
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const text = await Bun.file(path).text();
  return JSON.parse(text) as T;
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureDirectory(dirname(path));
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

export class KnownDeviceStore {
  readonly rootDir: string;
  readonly filePath: string;
  private readonly devices = new Map<string, KnownDeviceRecord>();
  private loaded = false;

  constructor(rootDir = applicationConfigDirectory()) {
    this.rootDir = rootDir;
    this.filePath = join(rootDir, "devices.json");
  }

  async load(): Promise<readonly KnownDeviceRecord[]> {
    await ensureDirectory(this.rootDir);
    this.devices.clear();
    if (await Bun.file(this.filePath).exists()) {
      try {
        const parsed = await readJsonFile<Partial<DevicesFile>>(this.filePath);
        if (Array.isArray(parsed.devices)) {
          for (const device of parsed.devices) {
            if (isKnownDeviceRecord(device)) {
              this.devices.set(device.id, { ...device, capabilities: [...device.capabilities] });
            }
          }
        }
      } catch {
        // A broken memory file must not prevent the application from starting.
        this.devices.clear();
      }
    }
    this.loaded = true;
    return this.all();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  all(): KnownDeviceRecord[] {
    return [...this.devices.values()].map((device) => ({
      ...device,
      capabilities: [...device.capabilities],
    }));
  }

  get(id: string): KnownDeviceRecord | undefined {
    const device = this.devices.get(id);
    return device ? { ...device, capabilities: [...device.capabilities] } : undefined;
  }

  async upsert(device: KnownDeviceRecord): Promise<void> {
    this.devices.set(device.id, { ...device, capabilities: [...device.capabilities] });
    await this.save();
  }

  async save(): Promise<void> {
    await ensureDirectory(this.rootDir);
    const value: DevicesFile = {
      formatVersion: 1,
      devices: this.all(),
    };
    await writeJsonFile(this.filePath, value);
  }
}

function isKnownDeviceRecord(value: unknown): value is KnownDeviceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<KnownDeviceRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.model === "string" &&
    typeof record.displayName === "string" &&
    typeof record.vendor === "string" &&
    (record.kind === "keyboard" || record.kind === "mouse") &&
    Array.isArray(record.capabilities) &&
    (record.connectionPath === "usb" || record.connectionPath === "dongle") &&
    typeof record.vendorId === "number" &&
    typeof record.productId === "number" &&
    typeof record.firstSeenAt === "string" &&
    typeof record.lastSeenAt === "string"
  );
}
