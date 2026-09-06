import { describe, expect, test } from "bun:test";
import { FakeHidPort, fakeError, fakeTimeout } from "../src/server/hid";

describe("HID transport", () => {
  test("writes a report id with its payload and reads the scripted reply", async () => {
    const port = new FakeHidPort([[]], {
      exchanges: {
        "/dev/control": (request) => [request[0]!, 0x12, 0x03, request[3] ?? 0],
      },
    });
    const handle = await port.open("/dev/control");

    await handle.write(3, [0x12, 0x03, 0x00]);
    expect(await handle.read(50)).toEqual([3, 0x12, 0x03, 0x00]);
    expect(port.writes).toEqual([{ path: "/dev/control", reportId: 3, payload: [0x12, 0x03, 0x00] }]);

    await handle.close();
  });

  test("reports a timeout as no reply rather than as an error", async () => {
    const port = new FakeHidPort([[]], { exchanges: { "/dev/control": () => fakeTimeout() } });
    const handle = await port.open("/dev/control");

    await handle.write(3, [0x12, 0x00]);
    expect(await handle.read(5)).toBeUndefined();

    await handle.close();
  });

  test("passes an error frame through as data and a transport failure as a throw", async () => {
    const port = new FakeHidPort([[]], {
      exchanges: {
        "/dev/error-frame": () => [3, 0xff, 0xaa],
        "/dev/detached": () => fakeError("device disconnected"),
      },
    });

    const frame = await port.open("/dev/error-frame");
    await frame.write(3, [0x12, 0x02]);
    expect(await frame.read(50)).toEqual([3, 0xff, 0xaa]);
    await frame.close();

    const detached = await port.open("/dev/detached");
    await detached.write(3, [0x12, 0x03, 0x00]);
    expect(() => detached.read(50)).toThrow("device disconnected");
    await detached.close();
  });

  test("tracks open handles for the lifetime of a session", async () => {
    const port = new FakeHidPort();
    const handle = await port.open("/dev/control");
    expect(port.openHandles.has("/dev/control")).toBe(true);
    await handle.close();
    expect(port.openHandles.has("/dev/control")).toBe(false);
  });
});
