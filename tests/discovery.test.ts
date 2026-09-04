import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiscoveryService } from "../src/server/discovery";
import { FakeHidPort } from "../src/server/hid";
import { KnownDeviceStore } from "../src/server/persistence";
import { ProfileStore } from "../src/server/profiles";

const roots: string[] = [];
const m6 = (path = "/dev/m6", serialNumber?: string) => ({
  vendorId: 0x3434,
  productId: 0xd028,
  path,
  ...(serialNumber ? { serialNumber } : {}),
});

async function setup(script: ConstructorParameters<typeof FakeHidPort>[0], options: ConstructorParameters<typeof FakeHidPort>[1] = {}) {
  const root = await mkdtemp(join(tmpdir(), "silver-launcher-discovery-"));
  roots.push(root);
  const port = new FakeHidPort(script, options);
  const known = new KnownDeviceStore(root);
  const profiles = new ProfileStore({ rootDir: root });
  await profiles.load();
  const service = new DiscoveryService({ hidPort: port, knownDevices: known, profileStore: profiles, intervalMs: 60_000 });
  await service.start();
  return { root, port, known, profiles, service };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("device discovery", () => {
  test("reports attach, detach, and reattach with a stable identity", async () => {
    const { port, service } = await setup([[], [m6("/dev/m6", "unit-1")], []]);
    const transitions: string[] = [];
    service.onTransition((transition) => transitions.push(`${transition.type}:${transition.device.id}`));

    const attached = await service.refresh();
    const id = attached.devices[0]?.id;
    expect(id).toBe("13364:53288:unit-1");
    expect(attached.devices[0]?.connection).toBe("connected");
    expect(attached.devices[0]?.profileName).toBe("Default");

    const detached = await service.refresh();
    expect(detached.devices[0]?.connection).toBe("disconnected");
    port.pushEnumeration([m6("/dev/m6-new", "unit-1")]);
    const reattached = await service.refresh();
    expect(reattached.devices[0]?.id).toBe(id);
    expect(reattached.devices[0]?.connection).toBe("connected");
    expect(transitions).toEqual([`attached:${id}`, `detached:${id}`, `attached:${id}`]);
  });

  test("assigns separate ordinals to same-model units without serials", async () => {
    const { service } = await setup([[m6("/dev/m6-a"), m6("/dev/m6-b")]]);
    const devices = service.getSnapshot().devices;
    expect(devices.map((device) => device.id)).toEqual([
      "13364:53288:#1",
      "13364:53288:#2",
    ]);
  });

  test("keeps a denied device visible and reports an unavailable backend", async () => {
    const denied = await setup([[m6("/dev/denied")]], { openFailures: { "/dev/denied": "EACCES" } });
    expect(denied.service.getSnapshot().devices[0]).toMatchObject({
      connection: "connected",
      access: "denied",
    });
    expect(denied.service.getSnapshot().devices[0]?.accessReason).toContain("Permission denied");

    const unavailable = await setup([new Error("hid backend unavailable")]);
    expect(unavailable.service.getSnapshot()).toMatchObject({
      discovery: "unavailable",
      discoveryReason: "hid backend unavailable",
      devices: [],
    });
  });

  test("keeps an empty first run as a valid empty snapshot", async () => {
    const { service, known } = await setup([[]]);
    expect(service.getSnapshot()).toEqual({ discovery: "available", devices: [] });
    expect(known.all()).toHaveLength(0);
  });

  test("remembers a device as disconnected across a restart", async () => {
    const first = await setup([[m6("/dev/m6", "persistent")]]);
    const id = first.service.getSnapshot().devices[0]?.id;
    await first.service.stop();

    const secondPort = new FakeHidPort([[]]);
    const secondKnown = new KnownDeviceStore(first.root);
    const secondProfiles = new ProfileStore({ rootDir: first.root });
    await secondProfiles.load();
    const second = new DiscoveryService({ hidPort: secondPort, knownDevices: secondKnown, profileStore: secondProfiles, intervalMs: 60_000 });
    await second.start();
    expect(second.getSnapshot().devices).toMatchObject([{ id, connection: "disconnected", profileName: "Default" }]);
  });
});
