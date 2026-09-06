import { describe, expect, test } from "bun:test";
import {
  assertRegistryIsWellFormed,
  matchDescriptor,
  matchDevices,
  matchRole,
  registryProblems,
  DEVICE_REGISTRY,
  type Feature,
} from "../src/server/registry";

const descriptor = (overrides: Record<string, unknown> = {}) => ({
  vendorId: 0x3434,
  productId: 0xd028,
  path: "/dev/hidraw-m6",
  ...overrides,
});

describe("device registry", () => {
  test("matches every supported model and rejects unknown hardware", () => {
    expect(matchDescriptor(descriptor())).toMatchObject({ entry: { id: "keychron-m6" } });
    expect(matchDescriptor(descriptor({ vendorId: 0x0b05, productId: 0x1ad0 }))).toMatchObject({ entry: { id: "asus-rog-harpe-ii-ace" } });
    expect(matchDescriptor(descriptor({ vendorId: 0x0b05, productId: 0x1c69 }))).toMatchObject({ entry: { id: "asus-rog-harpe-ii-ace" } });
    expect(matchDescriptor(descriptor({ vendorId: 0x388d, productId: 0x0024 }))).toMatchObject({ entry: { id: "lofree-hyzen" } });
    expect(matchDescriptor(descriptor({ vendorId: 0x1234, productId: 0x5678 }))).toBeUndefined();
    expect(DEVICE_REGISTRY).toHaveLength(3);
  });

  test("collapses interfaces of one unit into one logical device", () => {
    const devices = matchDevices([
      descriptor({ path: "/dev/hidraw-m6", usagePage: 1, usage: 2 }),
      descriptor({ path: "/dev/hidraw-m6", usagePage: 1, usage: 6 }),
      descriptor({ path: "/dev/hidraw-m6", usagePage: 0xff00, usage: 1 }),
    ]);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.descriptors).toHaveLength(1);
  });

  test("keeps two same-model units separate when paths differ", () => {
    const devices = matchDevices([
      descriptor({ path: "/dev/hidraw-m6-a" }),
      descriptor({ path: "/dev/hidraw-m6-b" }),
    ]);
    expect(devices).toHaveLength(2);
  });
});

describe("endpoint roles", () => {
  const harpe = (overrides: Record<string, unknown> = {}) => ({
    vendorId: 0x0b05,
    productId: 0x1ad0,
    serialNumber: "2E18D14D84BA8B52",
    ...overrides,
  });

  test("keeps the vendor collections of one path as the control endpoint", () => {
    const devices = matchDevices([
      harpe({ path: "/dev/hidraw4", usagePage: 0x01, usage: 0x06 }),
      harpe({ path: "/dev/hidraw5", usagePage: 0x01, usage: 0x02 }),
      harpe({ path: "/dev/hidraw6", usagePage: 0xff02, usage: 0x01 }),
      harpe({ path: "/dev/hidraw6", usagePage: 0xff00, usage: 0x01 }),
      harpe({ path: "/dev/hidraw6", usagePage: 0xff01, usage: 0x01 }),
    ]);

    expect(devices).toHaveLength(1);
    expect(devices[0]?.endpoints.identify?.path).toBe("/dev/hidraw5");
    expect(devices[0]?.endpoints.control?.path).toBe("/dev/hidraw6");
  });

  test("resolves identify only when no control interface is present", () => {
    const devices = matchDevices([descriptor({ usagePage: 1, usage: 2 })]);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.endpoints.identify?.path).toBe("/dev/hidraw-m6");
    expect(devices[0]?.endpoints.control).toBeUndefined();
  });

  test("existing matches keep the identify role by default", () => {
    for (const entry of DEVICE_REGISTRY) {
      for (const match of entry.matches) {
        expect(matchRole(match)).toBe(match.role ?? "identify");
      }
    }
    expect(matchRole({ vendorId: 1, productId: 2, connection: "usb" })).toBe("identify");
  });
});

describe("feature descriptors", () => {
  test("the shipped registry is well formed", () => {
    expect(registryProblems()).toEqual([]);
  });

  test("rejects a model that declares lighting without a descriptor", () => {
    const entry = {
      id: "undescribed",
      displayName: "Undescribed",
      vendor: "Nobody",
      kind: "mouse" as const,
      matches: [],
      capabilities: new Set<Feature>(["lighting"]),
    };
    expect(registryProblems([entry])).toEqual(["undescribed declares lighting without a lighting descriptor"]);
    expect(() => assertRegistryIsWellFormed([entry])).toThrow(/declares lighting without a lighting descriptor/);
  });

  test("the ASUS entry declares exactly one lighting zone", () => {
    const entry = DEVICE_REGISTRY.find((candidate) => candidate.id === "asus-rog-harpe-ii-ace");
    expect(entry?.lighting?.zones).toHaveLength(1);
    expect(entry?.lighting?.brightness).toEqual({ min: 0, max: 4 });
    expect(entry?.lighting?.effects.map((effect) => effect.name)).toEqual(["Static"]);
  });
});
