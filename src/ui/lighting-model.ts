/**
 * The lighting view's state, kept as a pure reducer so the guarantees the
 * interface makes — unknown is never drawn as a value, a failed apply reverts
 * to what the device last confirmed — are decided in one place.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface LightingZoneState {
  mode: number;
  brightness: number;
  color: RgbColor;
}

export interface LightingZoneReading {
  zoneId: number;
  name: string;
  state: LightingZoneState;
}

export interface LightingDescriptor {
  zones: { id: number; name: string }[];
  brightness: { min: number; max: number };
  effects: { id: number; name: string }[];
}

export type LightingFailureCode =
  | "not-configurable"
  | "unsupported"
  | "unreachable"
  | "rejected"
  | "access-denied"
  | "not-applied"
  | "timeout"
  | "disconnected";

export interface LightingFailure {
  code: LightingFailureCode;
  reason: string;
}

export type LightingReadResponse =
  | { status: "ok"; descriptor: LightingDescriptor; zones: LightingZoneReading[] }
  | ({ status: "unknown"; descriptor?: LightingDescriptor } & LightingFailure);

export type LightingStatus = "loading" | "ready" | "unknown";

export interface LightingModel {
  status: LightingStatus;
  descriptor: LightingDescriptor | null;
  /** The last values the device confirmed. Empty while the state is unknown. */
  confirmed: Record<number, LightingZoneState>;
  /** What the controls show. Equal to confirmed except mid-edit. */
  draft: Record<number, LightingZoneState>;
  selectedZone: number | null;
  unsavedChanges: boolean;
  /** False when the device is not answering; editing is unavailable. */
  editable: boolean;
  reason: string | null;
  notice: string | null;
}

export type LightingAction =
  | { type: "read"; response: LightingReadResponse }
  | { type: "edit"; zoneId: number; state: LightingZoneState }
  | { type: "select-zone"; zoneId: number }
  | { type: "applied"; zone: LightingZoneReading }
  | { type: "apply-failed"; failure: LightingFailure }
  | { type: "committed" }
  | { type: "commit-failed"; failure: LightingFailure };

export const initialLightingModel: LightingModel = {
  status: "loading",
  descriptor: null,
  confirmed: {},
  draft: {},
  selectedZone: null,
  unsavedChanges: false,
  editable: false,
  reason: null,
  notice: null,
};

/** A device that stopped answering is not a device to keep editing. */
function isUnreachable(failure: LightingFailure): boolean {
  return (
    failure.code === "unreachable" ||
    failure.code === "rejected" ||
    failure.code === "timeout" ||
    failure.code === "disconnected"
  );
}

export function lightingReducer(model: LightingModel, action: LightingAction): LightingModel {
  switch (action.type) {
    case "read": {
      if (action.response.status === "ok") {
        const confirmed = Object.fromEntries(
          action.response.zones.map((zone) => [zone.zoneId, zone.state] as const),
        );
        return {
          ...model,
          status: "ready",
          descriptor: action.response.descriptor,
          confirmed,
          draft: confirmed,
          selectedZone: model.selectedZone ?? action.response.zones[0]?.zoneId ?? null,
          editable: true,
          reason: null,
        };
      }
      // No value survives an unknown read: the controls are not populated with
      // a default or with what the device said last.
      return {
        ...model,
        status: "unknown",
        descriptor: action.response.descriptor ?? model.descriptor,
        confirmed: {},
        draft: {},
        editable: false,
        reason: action.response.reason,
      };
    }
    case "select-zone":
      return { ...model, selectedZone: action.zoneId };
    case "edit":
      if (!model.editable) return model;
      return { ...model, draft: { ...model.draft, [action.zoneId]: action.state }, notice: null };
    case "applied":
      return {
        ...model,
        status: "ready",
        editable: true,
        confirmed: { ...model.confirmed, [action.zone.zoneId]: action.zone.state },
        draft: { ...model.draft, [action.zone.zoneId]: action.zone.state },
        unsavedChanges: true,
        reason: null,
        notice: null,
      };
    case "apply-failed":
      return {
        ...model,
        status: isUnreachable(action.failure) ? "unknown" : model.status,
        // The requested value is not shown as the device's state.
        draft: isUnreachable(action.failure) ? {} : { ...model.confirmed },
        confirmed: isUnreachable(action.failure) ? {} : model.confirmed,
        editable: !isUnreachable(action.failure),
        reason: isUnreachable(action.failure) ? action.failure.reason : model.reason,
        notice: `The change was not applied. ${action.failure.reason}`,
      };
    case "committed":
      return { ...model, unsavedChanges: false, notice: "These settings are now stored on the device." };
    case "commit-failed":
      return {
        ...model,
        status: isUnreachable(action.failure) ? "unknown" : model.status,
        editable: model.editable && !isUnreachable(action.failure),
        // Still unsaved: nothing reached onboard memory.
        unsavedChanges: true,
        notice: `The settings were not stored on the device. ${action.failure.reason}`,
      };
  }
}

/** A single-zone device has nothing to choose between. */
export function showsZoneSelector(descriptor: LightingDescriptor | null): boolean {
  return (descriptor?.zones.length ?? 0) > 1;
}

export function zoneState(model: LightingModel, zoneId: number | null): LightingZoneState | null {
  if (zoneId === null) return null;
  return model.draft[zoneId] ?? null;
}

export function toHex(color: RgbColor): string {
  return `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function fromHex(value: string): RgbColor {
  const hex = value.replace("#", "");
  return {
    r: Number.parseInt(hex.slice(0, 2), 16) || 0,
    g: Number.parseInt(hex.slice(2, 4), 16) || 0,
    b: Number.parseInt(hex.slice(4, 6), 16) || 0,
  };
}
