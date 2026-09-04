import { describe, expect, test } from "bun:test";
import { matchDescriptor, matchDevices, DEVICE_REGISTRY } from "../src/server/registry";

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
