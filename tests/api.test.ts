import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiscoveryService } from "../src/server/discovery";
import { FakeHidPort } from "../src/server/hid";
import { createApiHandler } from "../src/server/http";
import { KnownDeviceStore } from "../src/server/persistence";
import { ProfileStore } from "../src/server/profiles";

const roots: string[] = [];
const descriptors = [
  { vendorId: 0x3434, productId: 0xd028, path: "/dev/m6", serialNumber: "m6" },
  { vendorId: 0x0b05, productId: 0x1ad0, path: "/dev/harpe", serialNumber: "harpe" },
];

async function setup(script: ConstructorParameters<typeof FakeHidPort>[0] = [descriptors]) {
  const root = await mkdtemp(join(tmpdir(), "silver-launcher-api-"));
  roots.push(root);
  const port = new FakeHidPort(script);
  const known = new KnownDeviceStore(root);
  const profiles = new ProfileStore({ rootDir: root });
  await profiles.load();
  const discovery = new DiscoveryService({ hidPort: port, knownDevices: known, profileStore: profiles, intervalMs: 60_000 });
  await discovery.start();
  return { port, profiles, discovery, api: createApiHandler({ discovery, profiles }) };
}

async function jsonResponse(response: Response) {
  return await response.json() as Record<string, any>;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("device API", () => {
  test("returns the full snapshot and streams updates to subscribers", async () => {
    const { api, port, discovery } = await setup();
    const snapshot = await api(new Request("http://localhost/api/devices"));
    const value = await jsonResponse(snapshot!);
    expect(value.devices).toHaveLength(2);
    expect(value.devices[0]).toHaveProperty("connectionPath");
    expect(value.devices[0]).toHaveProperty("capabilities");
    expect(value.devices[0]).toHaveProperty("profileName");

    const stream = await api(new Request("http://localhost/api/devices/stream"));
    const reader = stream!.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('"devices"');
    port.pushEnumeration([]);
    await discovery.refresh();
    const second = new TextDecoder().decode((await reader.read()).value);
    expect(second).toContain('"connection":"disconnected"');
    await reader.cancel();

    const resubscribe = await api(new Request("http://localhost/api/devices/stream"));
    const resubscribeFirst = new TextDecoder().decode((await resubscribe!.body!.getReader().read()).value);
    expect(resubscribeFirst).toContain('"devices"');
  });

  test("imports, exports, previews a mirror, and writes a confirmed mirror", async () => {
    const { api, profiles, discovery } = await setup();
    const devices = discovery.getSnapshot().devices;
    const source = devices.find((device) => device.model === "keychron-m6")!;
    const target = devices.find((device) => device.model === "asus-rog-harpe-ii-ace")!;
    const sourceProfile = profiles.get(source.model, source.profileName!)!;
    const imported = {
      ...sourceProfile,
      name: "Gaming",
      settings: { "dpi-stages": { stages: [400, 800] }, "key-remap": { button4: "copy" } },
    };
    const importResponse = await api(new Request("http://localhost/api/profiles/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(imported),
    }));
    expect(importResponse?.status).toBe(201);
    await profiles.save({ ...sourceProfile, settings: imported.settings }, "replace");

    const exportResponse = await api(new Request(`http://localhost/api/profiles/export/${encodeURIComponent(source.id)}`));
    expect(exportResponse?.headers.get("content-disposition")).toContain("attachment");

    const preview = await api(new Request("http://localhost/api/profiles/mirror", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: source.id, targetIds: [target.id] }),
    }));
    expect((await jsonResponse(preview!)).requiresConfirmation).toBe(true);
    const confirmed = await api(new Request("http://localhost/api/profiles/mirror", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: source.id, targetIds: [target.id], confirm: true }),
    }));
    expect((await jsonResponse(confirmed!)).confirmed).toBe(true);
  });

  test("rejects malformed and unsupported imports without changing the library", async () => {
    const { api, profiles } = await setup();
    const before = profiles.list().length;
    const malformed = await api(new Request("http://localhost/api/profiles/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    }));
    expect(malformed?.status).toBe(400);
    const unsupported = await api(new Request("http://localhost/api/profiles/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ formatVersion: 1, model: "unlisted-device", name: "Nope", createdAt: "now", updatedAt: "now", settings: {} }),
    }));
    expect(unsupported?.status).toBe(400);
    expect((await jsonResponse(unsupported!)).error).toContain("unlisted-device");
    expect(profiles.list().length).toBe(before);
  });

  test("reports collisions, partial mirrors, and stores a mirror for a disconnected target", async () => {
    const { api, profiles, discovery, port } = await setup([
      [descriptors[0]!, { vendorId: 0x388d, productId: 0x0024, path: "/dev/hyzen", serialNumber: "hyzen" }],
      [],
    ]);
    await discovery.refresh();
    const devices = discovery.getSnapshot().devices;
    const source = devices.find((device) => device.model === "keychron-m6")!;
    const target = devices.find((device) => device.model === "lofree-hyzen")!;
    const sourceProfile = profiles.get(source.model, source.profileName!)!;
    const sourceSettings = {
      "dpi-stages": { stages: [400, 800] },
      "key-remap": { escape: "caps-lock" },
    };
    await profiles.save({ ...sourceProfile, settings: sourceSettings }, "replace");

    const collision = await api(new Request("http://localhost/api/profiles/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sourceProfile),
    }));
    expect(collision?.status).toBe(409);
    const kept = await api(new Request("http://localhost/api/profiles/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: sourceProfile, collision: "keep-both" }),
    }));
    expect(kept?.status).toBe(201);

    const preview = await api(new Request("http://localhost/api/profiles/mirror", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: source.id, targetIds: [target.id] }),
    }));
    const previewReport = await jsonResponse(preview!);
    expect(previewReport.targets[0]).toMatchObject({ included: true, connected: false, dropped: ["dpi-stages"] });
    const confirmed = await api(new Request("http://localhost/api/profiles/mirror", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: source.id, targetIds: [target.id], confirm: true }),
    }));
    expect(confirmed?.status).toBe(200);
    expect(profiles.get(target.model, target.profileName!)?.settings).toEqual({ "key-remap": sourceSettings["key-remap"] });

    port.pushEnumeration([descriptors[0]!, { vendorId: 0x388d, productId: 0x0024, path: "/dev/hyzen", serialNumber: "hyzen" }]);
    await discovery.refresh();
    const sourceOnlyDpi = profiles.get(source.model, source.profileName!)!;
    await profiles.save({ ...sourceOnlyDpi, settings: { "dpi-stages": { stages: [1600] } } }, "replace");
    const noOverlap = await api(new Request("http://localhost/api/profiles/mirror", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: source.id, targetIds: [target.id] }),
    }));
    expect((await jsonResponse(noOverlap!)).targets[0]).toMatchObject({ included: false, reason: "No shared configurable features" });
  });
});
