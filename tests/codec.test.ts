import { describe, expect, test } from "bun:test";
import { asusRogCodec } from "../src/server/codecs";

const framed = (bytes: readonly number[]) => {
  const payload = new Array<number>(63).fill(0);
  bytes.forEach((value, index) => {
    payload[index] = value;
  });
  return payload;
};

/** A reply as it arrives from hidraw: the report id, then the frame. */
const reply = (bytes: readonly number[]) => [3, ...framed(bytes).slice(0, bytes.length)];

describe("ASUS ROG codec", () => {
  test("addresses the mouse on report id 3", () => {
    expect(asusRogCodec.reportId).toBe(3);
  });

  test("encodes the lighting get and the volatile set", () => {
    expect(asusRogCodec.encodeLightingGet(0)).toEqual(framed([0x12, 0x03, 0x00]));
    expect(
      asusRogCodec.encodeLightingSet(0, { mode: 0, brightness: 4, color: { r: 0xff, g: 0, b: 0 } }),
    ).toEqual(framed([0x51, 0x28, 0x00, 0x00, 0x00, 0x04, 0xff, 0x00, 0x00]));
  });

  test("decodes the measured round-trips by response layout", () => {
    // Fixtures measured on the hardware; see design.md.
    const fixtures = [
      { bytes: [0x12, 0x03, 0x00, 0x00, 0x00, 0x04, 0xff, 0x00, 0x00], mode: 0, brightness: 4, color: { r: 0xff, g: 0, b: 0 } },
      { bytes: [0x12, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0xff], mode: 0, brightness: 4, color: { r: 0, g: 0, b: 0xff } },
      { bytes: [0x12, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00], mode: 0, brightness: 0, color: { r: 0, g: 0xff, b: 0 } },
    ];
    for (const fixture of fixtures) {
      expect(asusRogCodec.decodeLighting(reply(fixture.bytes))).toEqual({
        kind: "lighting",
        zoneId: 0,
        state: { mode: fixture.mode, brightness: fixture.brightness, color: fixture.color },
      });
    }
  });

  test("round-trips a set through the response layout rather than the request buffer", () => {
    const state = { mode: 0, brightness: 3, color: { r: 0x11, g: 0x22, b: 0x33 } };
    const request = asusRogCodec.encodeLightingSet(0, state);
    // The reply carries the read command in the command position, with the
    // value fields at the same offsets as the request.
    const answer = [3, 0x12, 0x03, ...request.slice(2, 9)];
    expect(asusRogCodec.decodeLighting(answer)).toEqual({ kind: "lighting", zoneId: 0, state });
  });

  test("reads the error frame as an unsupported command, not as a value", () => {
    const frame = reply([0xff, 0xaa]);
    expect(asusRogCodec.isErrorFrame(frame)).toBe(true);
    expect(asusRogCodec.decodeLighting(frame)).toEqual({ kind: "unsupported" });
    expect(asusRogCodec.isLightingReply(frame, 0)).toBe(true);
  });

  test("treats a collapsed version payload as not alive", () => {
    expect(asusRogCodec.isVersionReplyAlive(reply([0x12, 0x00, 0x00, 0x05, 0x07, 0x00, 0x04, 0xff]))).toBe(true);
    expect(asusRogCodec.isVersionReplyAlive([3, 0x12, 0x00, ...new Array(60).fill(0)])).toBe(false);
    expect(asusRogCodec.isVersionReplyAlive(reply([0xff, 0xaa]))).toBe(false);
  });

  test("keeps the commit a command of its own", () => {
    const commit = asusRogCodec.encodeCommit();
    expect(commit.slice(0, 2)).toEqual([0x50, 0x03]);
    const set = asusRogCodec.encodeLightingSet(0, { mode: 0, brightness: 1, color: { r: 1, g: 2, b: 3 } });
    expect(set.slice(0, 2)).not.toEqual([0x50, 0x03]);
  });

  test("does not decode a frame that answers another command", () => {
    expect(asusRogCodec.decodeLighting(reply([0x12, 0x00, 0x01, 0x02]))).toEqual({ kind: "unrecognised" });
    expect(asusRogCodec.isLightingReply(reply([0x12, 0x00]), 0)).toBe(false);
  });
});
