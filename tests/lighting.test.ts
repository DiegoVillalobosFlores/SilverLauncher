import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiscoveryService } from "../src/server/discovery";
import { FakeHidPort, fakeError, fakeTimeout, type FakeReply } from "../src/server/hid";
import { KnownDeviceStore } from "../src/server/persistence";
import { ProfileStore } from "../src/server/profiles";
import { LightingService } from "../src/server/lighting";
import { asusRogCodec, type LightingZoneState } from "../src/server/codecs";

const roots: string[] = [];
const CONTROL = "/dev/hidraw6";
const harpeInterfaces = [
  { vendorId: 0x0b05, productId: 0x1ad0, serialNumber: "harpe-1", path: "/dev/hidraw5", usagePage: 0x01, usage: 0x02 },
  { vendorId: 0x0b05, productId: 0x1ad0, serialNumber: "harpe-1", path: CONTROL, usagePage: 0xff02, usage: 0x01 },
];

const VERSION_REPLY = [3, 0x12, 0x00, 0x00, 0x05, 0x07, 0x00, 0x04, 0xff, 0xff, 0x17];
const DOZING_VERSION_REPLY = [3, 0x12, 0x00, ...new Array<number>(60).fill(0)];

function lightingReply(state: LightingZoneState, zoneId = 0): number[] {
  return [3, 0x12, 0x03, zoneId, 0x00, state.mode, state.brightness, state.color.r, state.color.g, state.color.b];
}

/**
 * A mouse that answers the version query as given and holds one zone whose
 * state follows the sets it accepts.
 */
function harpeFirmware(options: {
  version?: () => FakeReply | number[];
  initial?: LightingZoneState;
  acceptSets?: boolean;
  onCommit?: () => void;
  commitReply?: () => FakeReply | number[] | undefined;
} = {}) {
  const state: LightingZoneState = options.initial ?? { mode: 0, brightness: 0, color: { r: 0, g: 0xff, b: 0 } };
  const commits: number[] = [];
  const handler = (request: readonly number[]): FakeReply | readonly number[] | undefined => {
    const [, command, subcommand] = request;
    if (command === 0x12 && subcommand === 0x00) {
      return options.version ? options.version() : VERSION_REPLY;
    }
    if (command === 0x12 && subcommand === 0x03) return lightingReply(state, request[3] ?? 0);
    if (command === 0x51 && subcommand === 0x28) {
      if (options.acceptSets !== false) {
        state.mode = request[5] ?? 0;
        state.brightness = request[6] ?? 0;
        state.color = { r: request[7] ?? 0, g: request[8] ?? 0, b: request[9] ?? 0 };
      }
      // The device acknowledges the write either way; only the read-back tells
      // the truth about whether it was applied.
      return lightingReply(state, request[3] ?? 0);
    }
    if (command === 0x50 && subcommand === 0x03) {
      commits.push(Date.now());
      options.onCommit?.();
      return options.commitReply ? options.commitReply() : [3, 0x50, 0x03, 0x00];
    }
    return [3, 0xff, 0xaa];
  };
  return { handler, commits, state };
}

async function setup(handler?: (request: readonly number[]) => FakeReply | readonly number[] | undefined) {
  const root = await mkdtemp(join(tmpdir(), "silver-launcher-lighting-"));
  roots.push(root);
  const port = new FakeHidPort([harpeInterfaces], handler ? { exchanges: { [CONTROL]: handler } } : {});
  const known = new KnownDeviceStore(root);
  const profiles = new ProfileStore({ rootDir: root });
  await profiles.load();
  const discovery = new DiscoveryService({ hidPort: port, knownDevices: known, profileStore: profiles, intervalMs: 60_000 });
  await discovery.start();
  const lighting = new LightingService({ hidPort: port, discovery, timeoutMs: 20 });
  const deviceId = discovery.getSnapshot().devices[0]!.id;
  return { port, discovery, lighting, deviceId };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("lighting sessions", () => {
  test("reads the device's lighting when liveness passes", async () => {
    const firmware = harpeFirmware({ initial: { mode: 0, brightness: 4, color: { r: 0xff, g: 0, b: 0 } } });
    const { lighting, deviceId } = await setup(firmware.handler);

    const result = await lighting.read(deviceId);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.zones).toEqual([
      { zoneId: 0, name: "Logo", state: { mode: 0, brightness: 4, color: { r: 0xff, g: 0, b: 0 } } },
    ]);
    await lighting.closeAll();
  });

  test("reports unknown, not zeros, when the version payload collapses", async () => {
    // The dozing mouse: the lighting query still answers with a well-formed
    // frame, and that frame is a lie.
    const firmware = harpeFirmware({
      version: () => DOZING_VERSION_REPLY,
      initial: { mode: 0, brightness: 0, color: { r: 0, g: 0, b: 0 } },
    });
    const { lighting, deviceId } = await setup(firmware.handler);

    const result = await lighting.read(deviceId);
    expect(result.status).toBe("unknown");
    if (result.status !== "unknown") return;
    expect(result.code).toBe("unreachable");
    expect(result.reason).toBeTruthy();
    expect(result).not.toHaveProperty("zones");
    await lighting.closeAll();
  });

  test("an unlit zone reads as a value, so unknown stays distinct from off", async () => {
    const firmware = harpeFirmware({ initial: { mode: 0, brightness: 0, color: { r: 0, g: 0, b: 0 } } });
    const { lighting, deviceId } = await setup(firmware.handler);

    const result = await lighting.read(deviceId);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.zones[0]?.state).toEqual({ mode: 0, brightness: 0, color: { r: 0, g: 0, b: 0 } });
    await lighting.closeAll();
  });

  test("reports a refused command as a refusal, not as a missing feature", async () => {
    // The sleeping mouse: the receiver answers the version query with a live
    // payload and refuses the lighting query. The model does declare lighting,
    // so the refusal describes the device's power state, not its firmware.
    const { lighting, deviceId } = await setup((request) =>
      request[1] === 0x12 && request[2] === 0x00 ? VERSION_REPLY : [3, 0xff, 0xaa],
    );

    const result = await lighting.read(deviceId);
    expect(result.status).toBe("unknown");
    if (result.status !== "unknown") return;
    expect(result.code).toBe("rejected");
    expect(result.reason).toContain("asleep");
    await lighting.closeAll();
  });

  test("reports a refused write as a refusal", async () => {
    const { lighting, deviceId } = await setup((request) =>
      request[1] === 0x12 && request[2] === 0x00 ? VERSION_REPLY : [3, 0xff, 0xaa],
    );

    const applied = await lighting.apply(deviceId, 0, { mode: 0, brightness: 4, color: { r: 1, g: 2, b: 3 } });
    expect(applied.status).toBe("failed");
    if (applied.status !== "failed") return;
    expect(applied.code).toBe("rejected");
    await lighting.closeAll();
  });

  test("reports a silent device as a timeout", async () => {
    const { lighting, deviceId } = await setup(() => fakeTimeout());
    const result = await lighting.read(deviceId);
    expect(result.status).toBe("unknown");
    if (result.status !== "unknown") return;
    expect(result.code).toBe("unreachable");
    await lighting.closeAll();
  });

  test("applies a volatile change and confirms it by reading it back", async () => {
    const firmware = harpeFirmware();
    const { port, lighting, deviceId } = await setup(firmware.handler);

    const applied = await lighting.apply(deviceId, 0, { mode: 0, brightness: 4, color: { r: 0, g: 0, b: 0xff } });
    expect(applied.status).toBe("ok");
    if (applied.status !== "ok") return;
    expect(applied.zone.state).toEqual({ mode: 0, brightness: 4, color: { r: 0, g: 0, b: 0xff } });
    expect(firmware.commits).toHaveLength(0);
    expect(port.writes.some((write) => write.payload[0] === 0x50)).toBe(false);
    await lighting.closeAll();
  });

  test("reports a write the device acknowledged but did not apply as failed", async () => {
    const firmware = harpeFirmware({ acceptSets: false, initial: { mode: 0, brightness: 1, color: { r: 1, g: 1, b: 1 } } });
    const { lighting, deviceId } = await setup(firmware.handler);

    const applied = await lighting.apply(deviceId, 0, { mode: 0, brightness: 4, color: { r: 0xff, g: 0, b: 0 } });
    expect(applied.status).toBe("failed");
    if (applied.status !== "failed") return;
    expect(applied.code).toBe("not-applied");
    await lighting.closeAll();
  });

  test("does not send a write while the device is unreachable", async () => {
    const firmware = harpeFirmware({ version: () => DOZING_VERSION_REPLY });
    const { port, lighting, deviceId } = await setup(firmware.handler);

    const applied = await lighting.apply(deviceId, 0, { mode: 0, brightness: 4, color: { r: 0xff, g: 0, b: 0 } });
    expect(applied.status).toBe("failed");
    if (applied.status !== "failed") return;
    expect(applied.code).toBe("unreachable");
    expect(port.writes.some((write) => write.payload[0] === 0x51)).toBe(false);
    await lighting.closeAll();
  });

  test("refuses an effect the descriptor does not declare", async () => {
    const firmware = harpeFirmware();
    const { port, lighting, deviceId } = await setup(firmware.handler);

    const applied = await lighting.apply(deviceId, 0, { mode: 9, brightness: 4, color: { r: 0, g: 0, b: 0 } });
    expect(applied.status).toBe("failed");
    if (applied.status !== "failed") return;
    expect(applied.code).toBe("unsupported");
    expect(port.writes).toHaveLength(0);
    await lighting.closeAll();
  });

  test("commits only on explicit request", async () => {
    const firmware = harpeFirmware();
    const { lighting, deviceId } = await setup(firmware.handler);

    await lighting.apply(deviceId, 0, { mode: 0, brightness: 2, color: { r: 1, g: 2, b: 3 } });
    expect(firmware.commits).toHaveLength(0);
    expect(await lighting.commit(deviceId)).toEqual({ status: "ok" });
    expect(firmware.commits).toHaveLength(1);
    await lighting.closeAll();
  });

  test("ends the session on a transport failure and hands back to discovery", async () => {
    const { port, lighting, discovery, deviceId } = await setup(() => fakeError("device disconnected"));

    const result = await lighting.read(deviceId);
    expect(result.status).toBe("unknown");
    if (result.status !== "unknown") return;
    expect(result.code).toBe("disconnected");
    expect(lighting.hasOpenSession(CONTROL)).toBe(false);
    expect(port.openHandles.has(CONTROL)).toBe(false);
    expect(discovery.getSnapshot().discovery).toBe("available");
    await lighting.closeAll();
  });

  test("holds the control endpoint open across exchanges", async () => {
    const firmware = harpeFirmware();
    const { port, lighting, deviceId } = await setup(firmware.handler);

    await lighting.read(deviceId);
    expect(lighting.hasOpenSession(CONTROL)).toBe(true);
    const opensAfterFirstRead = port.openedPaths.filter((path) => path === CONTROL).length;
    await lighting.read(deviceId);
    expect(port.openedPaths.filter((path) => path === CONTROL)).toHaveLength(opensAfterFirstRead);
    await lighting.closeAll();
    expect(lighting.hasOpenSession(CONTROL)).toBe(false);
  });

  test("attributes replies to the request that asked for them", async () => {
    // The endpoint answers the version query with a lighting frame first, so a
    // session correlating by arrival order would read the wrong answer.
    let pending: number[][] = [];
    const firmware = harpeFirmware();
    const { lighting, deviceId } = await setup((request) => {
      if (request[1] === 0x12 && request[2] === 0x00) {
        pending = [lightingReply({ mode: 0, brightness: 9, color: { r: 9, g: 9, b: 9 } })];
        return VERSION_REPLY;
      }
      const answer = firmware.handler(request);
      const queued = pending.shift();
      return queued && !Array.isArray(answer) ? queued : answer;
    });

    const result = await lighting.read(deviceId);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.zones[0]?.state.brightness).not.toBe(9);
    await lighting.closeAll();
  });

  test("reports access denied without inventing a value", async () => {
    const { port, lighting, deviceId } = await setup(harpeFirmware().handler);
    port.deny(CONTROL, "Permission denied");
    await lighting.closeAll();

    const result = await lighting.read(deviceId);
    expect(result.status).toBe("unknown");
    if (result.status !== "unknown") return;
    expect(["access-denied", "disconnected"]).toContain(result.code);
  });

  test("addresses only the control endpoint", async () => {
    const firmware = harpeFirmware();
    const { port, lighting, deviceId } = await setup(firmware.handler);
    await lighting.read(deviceId);
    expect(port.writes.every((write) => write.path === CONTROL)).toBe(true);
    expect(port.writes.every((write) => write.reportId === asusRogCodec.reportId)).toBe(true);
    await lighting.closeAll();
  });
});
