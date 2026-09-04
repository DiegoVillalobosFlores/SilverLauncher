import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileCollisionError, ProfileStore, validateProfile } from "../src/server/profiles";

const roots: string[] = [];
async function profileStore() {
  const root = await mkdtemp(join(tmpdir(), "silver-launcher-profiles-"));
  roots.push(root);
  const store = new ProfileStore({ rootDir: root });
  await store.load();
  return { root, store };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("profile library", () => {
  test("creates a missing profile directory and reports an empty library", async () => {
    const { root, store } = await profileStore();
    expect(store.list()).toEqual([]);
    expect(await readdir(join(root, "profiles"))).toEqual([]);
  });

  test("round-trips a profile and creates a default profile", async () => {
    const { root, store } = await profileStore();
    const profile = await store.ensureDefault("keychron-m6");
    const saved = await store.save({ ...profile, settings: { "dpi-stages": { stages: [400, 800] } }, updatedAt: new Date().toISOString() }, "replace");
    const loaded = new ProfileStore({ rootDir: root });
    const result = await loaded.load();
    expect(result.invalid).toEqual([]);
    expect(loaded.get("keychron-m6", "Default")).toEqual(saved.profile);
  });

  test("reports malformed files without losing valid profiles", async () => {
    const { store } = await profileStore();
    const valid = await store.ensureDefault("keychron-m6");
    await store.save({ ...valid, name: "Valid copy" }, "reject");
    await Bun.write(store.profilePath(valid), "{not json\n");
    const loaded = new ProfileStore({ rootDir: store.rootDir });
    const result = await loaded.load();
    expect(result.profiles).toHaveLength(1);
    expect(result.invalid[0]?.filename).toBe("default.json");
    expect(result.invalid[0]?.reason).toContain("JSON");
  });

  test("never silently overwrites a colliding imported name", async () => {
    const { store } = await profileStore();
    const profile = await store.ensureDefault("keychron-m6");
    await expect(store.save(profile)).rejects.toBeInstanceOf(ProfileCollisionError);
    const kept = await store.save(profile, "keep-both");
    expect(kept.renamed).toBe(true);
    expect(store.list("keychron-m6").map((item) => item.name)).toEqual(["Default", "Default (2)"]);
  });

  test("keeps distinct names with the same filename slug separate", async () => {
    const { store } = await profileStore();
    const profile = await store.ensureDefault("keychron-m6");
    await store.save({ ...profile, name: "Desk / Work" });
    await store.save({ ...profile, name: "Desk Work" });
    expect(store.list("keychron-m6").map((item) => item.name)).toEqual(["Default", "Desk / Work", "Desk Work"]);
  });

  test("validates the envelope and feature keys", () => {
    expect(validateProfile({ formatVersion: 1, model: "keychron-m6", name: "A", createdAt: "now", updatedAt: "now", settings: {} }).valid).toBe(true);
    expect(validateProfile({ formatVersion: 2 }).valid).toBe(false);
    expect(validateProfile({ formatVersion: 1, model: "keychron-m6", name: "A", createdAt: "now", updatedAt: "now", settings: { unknown: true } }).valid).toBe(false);
  });
});
