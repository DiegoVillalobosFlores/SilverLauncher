import { describe, expect, test } from "bun:test";
import {
  fromHex,
  initialLightingModel,
  lightingReducer,
  showsZoneSelector,
  toHex,
  zoneState,
  type LightingDescriptor,
  type LightingModel,
} from "../src/ui/lighting-model";

const descriptor: LightingDescriptor = {
  zones: [{ id: 0, name: "Logo" }],
  brightness: { min: 0, max: 4 },
  effects: [{ id: 0, name: "Static" }],
};

const lit = { mode: 0, brightness: 4, color: { r: 0xff, g: 0, b: 0 } };
const unlit = { mode: 0, brightness: 0, color: { r: 0, g: 0, b: 0 } };

function read(model: LightingModel, state = lit): LightingModel {
  return lightingReducer(model, {
    type: "read",
    response: { status: "ok", descriptor, zones: [{ zoneId: 0, name: "Logo", state }] },
  });
}

describe("lighting view model", () => {
  test("derives its controls from the descriptor", () => {
    expect(showsZoneSelector(descriptor)).toBe(false);
    expect(showsZoneSelector({ ...descriptor, zones: [{ id: 0, name: "Logo" }, { id: 1, name: "Wheel" }] })).toBe(true);
    const model = read(initialLightingModel);
    expect(model.descriptor?.effects).toEqual([{ id: 0, name: "Static" }]);
    expect(model.selectedZone).toBe(0);
  });

  test("populates the controls from the device read", () => {
    const model = read(initialLightingModel);
    expect(model.status).toBe("ready");
    expect(zoneState(model, 0)).toEqual(lit);
    expect(model.editable).toBe(true);
  });

  test("renders an unknown state distinctly from an unlit one", () => {
    const off = read(initialLightingModel, unlit);
    expect(off.status).toBe("ready");
    expect(zoneState(off, 0)).toEqual(unlit);

    const unknown = lightingReducer(off, {
      type: "read",
      response: { status: "unknown", code: "unreachable", reason: "The device is asleep", descriptor },
    });
    expect(unknown.status).toBe("unknown");
    expect(unknown.reason).toBe("The device is asleep");
    // Neither the previous reading nor a default stands in for the unknown one.
    expect(zoneState(unknown, 0)).toBeNull();
    expect(unknown.confirmed).toEqual({});
    expect(unknown.editable).toBe(false);
  });

  test("reverts the display to the last confirmed value when an apply fails", () => {
    const model = read(initialLightingModel);
    const edited = lightingReducer(model, { type: "edit", zoneId: 0, state: { ...lit, color: { r: 0, g: 0, b: 0xff } } });
    expect(zoneState(edited, 0)?.color).toEqual({ r: 0, g: 0, b: 0xff });

    const failed = lightingReducer(edited, {
      type: "apply-failed",
      failure: { code: "not-applied", reason: "The device still reports its previous lighting" },
    });
    expect(zoneState(failed, 0)).toEqual(lit);
    expect(failed.notice).toContain("not applied");
    expect(failed.editable).toBe(true);
  });

  test("stops editing when the device becomes unreachable mid-edit", () => {
    const model = read(initialLightingModel);
    const failed = lightingReducer(model, {
      type: "apply-failed",
      failure: { code: "unreachable", reason: "The device is not responding" },
    });
    expect(failed.status).toBe("unknown");
    expect(failed.editable).toBe(false);
    expect(zoneState(failed, 0)).toBeNull();
    expect(lightingReducer(failed, { type: "edit", zoneId: 0, state: lit })).toBe(failed);
  });

  test("stops editing when the device refuses a command it declares", () => {
    const model = read(initialLightingModel);
    const refused = lightingReducer(model, {
      type: "apply-failed",
      failure: { code: "rejected", reason: "The device refused the lighting command; it is most likely asleep" },
    });
    expect(refused.status).toBe("unknown");
    expect(refused.editable).toBe(false);
    expect(zoneState(refused, 0)).toBeNull();
  });

  test("tracks unsaved changes until a commit is confirmed", () => {
    const model = read(initialLightingModel);
    expect(model.unsavedChanges).toBe(false);
    const applied = lightingReducer(model, {
      type: "applied",
      zone: { zoneId: 0, name: "Logo", state: { ...lit, brightness: 2 } },
    });
    expect(applied.unsavedChanges).toBe(true);
    expect(zoneState(applied, 0)?.brightness).toBe(2);

    const failedSave = lightingReducer(applied, {
      type: "commit-failed",
      failure: { code: "not-applied", reason: "The device did not confirm the save" },
    });
    expect(failedSave.unsavedChanges).toBe(true);
    expect(failedSave.notice).toContain("not stored on the device");

    const saved = lightingReducer(failedSave, { type: "committed" });
    expect(saved.unsavedChanges).toBe(false);
    expect(saved.notice).toContain("stored on the device");
  });

  test("round-trips a colour through the hex the colour input uses", () => {
    expect(toHex({ r: 0xff, g: 0x00, b: 0x1a })).toBe("#ff001a");
    expect(fromHex("#ff001a")).toEqual({ r: 0xff, g: 0, b: 0x1a });
  });
});
