import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiscoveryService } from "../src/server/discovery";
import { FakeHidPort, fakeTimeout, type FakeReply } from "../src/server/hid";
import { createApiHandler } from "../src/server/http";
import { KnownDeviceStore } from "../src/server/persistence";
import { ProfileStore } from "../src/server/profiles";
import { LightingService } from "../src/server/lighting";
import type { LightingZoneState } from "../src/server/codecs";

const roots: string[] = [];
const CONTROL = "/dev/hidraw6";
const harpeInterfaces = [
  { vendorId: 0x0b05, productId: 0x1ad0, serialNumber: "harpe-1", path: "/dev/hidraw5", usagePage: 0x01, usage: 0x02 },
  { vendorId: 0x0b05, productId: 0x1ad0, serialNumber: "harpe-1", path: CONTROL, usagePage: 0xff02, usage: 0x01 },
];
const m6 = { vendorId: 0x3434, productId: 0xd028, path: "/dev/m6", serialNumber: "m6" };

const VERSION_REPLY = [3, 0x12, 0x00, 0x00, 0x05, 0x07, 0x00, 0x04, 0xff];
const DOZING_VERSION_REPLY = [3, 0x12, 0x00, ...new Array<number>(60).fill(0)];

function firmware(options: { version?: () => FakeReply | number[]; acceptSets?: boolean } = {}) {
  const state: LightingZoneState = { mode: 0, brightness: 2, color: { r: 0x10, g: 0x20, b: 0x30 } };
  const commits: number[] = [];
  const reply = (zoneId: number) => [3, 0x12, 0x03, zoneId, 0, state.mode, state.brightness, state.color.r, state.color.g, state.color.b];
  const handler = (request: readonly number[]): FakeReply | readonly number[] | undefined => {
    const [, command, subcommand] = request;
    if (command === 0x12 && subcommand === 0x00) return options.version ? options.version() : VERSION_REPLY;
    if (command === 0x12 && subcommand === 0x03) return reply(request[3] ?? 0);
    if (command === 0x51 && subcommand === 0x28) {
      if (options.acceptSets !== false) {
        state.mode = request[5] ?? 0;
        state.brightness = request[6] ?? 0;
        state.color = { r: request[7] ?? 0, g: request[8] ?? 0, b: request[9] ?? 0 };
      }
      return reply(request[3] ?? 0);
    }
    if (command === 0x50 && subcommand === 0x03) {
      commits.push(1);
      return [3, 0x50, 0x03];
    }
    return [3, 0xff, 0xaa];
  };
  return { handler, commits, state };
}

async function setup(options: {
  descriptors?: readonly Record<string, unknown>[];
  handler?: (request: readonly number[]) => FakeReply | readonly number[] | undefined;
  openFailures?: Record<string, string>;
  withLighting?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "silver-launcher-lighting-api-"));
  roots.push(root);
  const port = new FakeHidPort([(options.descriptors ?? harpeInterfaces) as never], {
    exchanges: options.handler ? { [CONTROL]: options.handler } : {},
    openFailures: options.openFailures,
  });
  const known = new KnownDeviceStore(root);
  const profiles = new ProfileStore({ rootDir: root });
  await profiles.load();
  const discovery = new DiscoveryService({ hidPort: port, knownDevices: known, profileStore: profiles, intervalMs: 60_000 });
  await discovery.start();
  const lighting = options.withLighting === false ? undefined : new LightingService({ hidPort: port, discovery, timeoutMs: 20 });
  const api = createApiHandler({ discovery, profiles, lighting });
  const deviceId = discovery.getSnapshot().devices[0]!.id;
  return { port, discovery, lighting, api, deviceId };
}

const lightingUrl = (id: string) => `http://localhost/api/devices/${encodeURIComponent(id)}/lighting`;

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("lighting API", () => {
  test("GET returns the descriptor with the device's current state", async () => {
    const device = firmware();
    const { api, deviceId, lighting } = await setup({ handler: device.handler });

    const response = await api(new Request(lightingUrl(deviceId)));
    expect(response!.status).toBe(200);
    const body = await response!.json() as Record<string, any>;
    expect(body.status).toBe("ok");
    expect(body.descriptor.zones).toEqual([{ id: 0, name: "Logo" }]);
    expect(body.zones).toEqual([
      { zoneId: 0, name: "Logo", state: { mode: 0, brightness: 2, color: { r: 0x10, g: 0x20, b: 0x30 } } },
    ]);
    await lighting?.closeAll();
  });

  test("GET reports an unknown state with its reason rather than a value", async () => {
    const device = firmware({ version: () => DOZING_VERSION_REPLY });
    const { api, deviceId, lighting } = await setup({ handler: device.handler });

    const response = await api(new Request(lightingUrl(deviceId)));
    expect(response!.status).toBe(503);
    const body = await response!.json() as Record<string, any>;
    expect(body.status).toBe("unknown");
    expect(body.code).toBe("unreachable");
    expect(body.reason).toBeTruthy();
    expect(body.zones).toBeUndefined();
    expect(body.descriptor).toBeTruthy();
    await lighting?.closeAll();
  });

  test("PUT applies a volatile change and answers with the verified read-back", async () => {
    const device = firmware();
    const { api, deviceId, lighting, port } = await setup({ handler: device.handler });

    const response = await api(new Request(lightingUrl(deviceId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zoneId: 0, mode: 0, brightness: 4, color: { r: 255, g: 0, b: 0 } }),
    }));
    expect(response!.status).toBe(200);
    const body = await response!.json() as Record<string, any>;
    expect(body.status).toBe("ok");
    expect(body.zone.state).toEqual({ mode: 0, brightness: 4, color: { r: 255, g: 0, b: 0 } });
    expect(device.commits).toHaveLength(0);
    expect(port.writes.some((write) => write.payload[0] === 0x50)).toBe(false);
    await lighting?.closeAll();
  });

  test("PUT rejects a malformed request before touching the device", async () => {
    const device = firmware();
    const { api, deviceId, lighting, port } = await setup({ handler: device.handler });

    const response = await api(new Request(lightingUrl(deviceId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zoneId: 0, brightness: 4 }),
    }));
    expect(response!.status).toBe(400);
    expect(port.writes).toHaveLength(0);
    await lighting?.closeAll();
  });

  test("POST commit persists to onboard memory", async () => {
    const device = firmware();
    const { api, deviceId, lighting } = await setup({ handler: device.handler });

    const response = await api(new Request(`${lightingUrl(deviceId)}/commit`, { method: "POST" }));
    expect(response!.status).toBe(200);
    expect(await response!.json()).toEqual({ status: "ok" });
    expect(device.commits).toHaveLength(1);
    await lighting?.closeAll();
  });

  test("maps an unapplied write to its own status", async () => {
    const device = firmware({ acceptSets: false });
    const { api, deviceId, lighting } = await setup({ handler: device.handler });

    const response = await api(new Request(lightingUrl(deviceId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zoneId: 0, mode: 0, brightness: 4, color: { r: 255, g: 0, b: 0 } }),
    }));
    expect(response!.status).toBe(502);
    const body = await response!.json() as Record<string, any>;
    expect(body.code).toBe("not-applied");
    await lighting?.closeAll();
  });

  test("maps a refused command to its own status", async () => {
    const { api, deviceId, lighting } = await setup({
      handler: (request) => (request[1] === 0x12 && request[2] === 0x00 ? VERSION_REPLY : [3, 0xff, 0xaa]),
    });

    const response = await api(new Request(lightingUrl(deviceId)));
    expect(response!.status).toBe(503);
    expect((await response!.json() as Record<string, any>).code).toBe("rejected");
    await lighting?.closeAll();
  });

  test("maps a silent device to its own status", async () => {
    const { api, deviceId, lighting } = await setup({ handler: () => fakeTimeout() });
    const response = await api(new Request(lightingUrl(deviceId)));
    expect(response!.status).toBe(503);
    expect((await response!.json() as Record<string, any>).code).toBe("unreachable");
    await lighting?.closeAll();
  });

  test("maps a denied control endpoint to its own status", async () => {
    const { api, deviceId, lighting } = await setup({
      handler: firmware().handler,
      openFailures: { [CONTROL]: "Permission denied" },
    });
    const response = await api(new Request(lightingUrl(deviceId)));
    expect(response!.status).toBe(403);
    expect((await response!.json() as Record<string, any>).code).toBe("access-denied");
    await lighting?.closeAll();
  });

  test("reports a device with no lighting as unsupported", async () => {
    const { api, discovery, lighting } = await setup({ descriptors: [m6], handler: firmware().handler });
    const deviceId = discovery.getSnapshot().devices[0]!.id;
    const response = await api(new Request(lightingUrl(deviceId)));
    expect(response!.status).toBe(501);
    expect((await response!.json() as Record<string, any>).code).toBe("unsupported");
    await lighting?.closeAll();
  });

  test("answers 404 for a device that is not in the snapshot", async () => {
    const { api, lighting } = await setup({ handler: firmware().handler });
    const response = await api(new Request(lightingUrl("no-such-device")));
    expect(response!.status).toBe(404);
    await lighting?.closeAll();
  });
});
