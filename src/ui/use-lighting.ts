import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  initialLightingModel,
  lightingReducer,
  type LightingFailure,
  type LightingModel,
  type LightingReadResponse,
  type LightingZoneState,
} from "./lighting-model";

/**
 * Preview writes are bounded rather than sent per input event: each one costs a
 * write plus the read-back that verifies it.
 */
const PREVIEW_INTERVAL_MS = 120;

interface WriteResponse {
  status: "ok" | "failed";
  zone?: { zoneId: number; name: string; state: LightingZoneState };
  code?: LightingFailure["code"];
  reason?: string;
}

function failureFrom(body: WriteResponse | undefined, fallback: string): LightingFailure {
  return { code: body?.code ?? "not-applied", reason: body?.reason ?? fallback };
}

export interface LightingController {
  model: LightingModel;
  refresh: () => Promise<void>;
  preview: (zoneId: number, state: LightingZoneState) => void;
  selectZone: (zoneId: number) => void;
  save: () => Promise<void>;
}

export function useLighting(deviceId: string, enabled: boolean): LightingController {
  const [model, dispatch] = useReducer(lightingReducer, initialLightingModel);
  const base = useMemo(() => `/api/devices/${encodeURIComponent(deviceId)}/lighting`, [deviceId]);
  const pending = useRef<{ zoneId: number; state: LightingZoneState } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(base);
      const body = await response.json() as LightingReadResponse;
      dispatch({ type: "read", response: body });
    } catch (error) {
      dispatch({
        type: "read",
        response: {
          status: "unknown",
          code: "disconnected",
          reason: error instanceof Error ? error.message : "The local service did not answer",
        },
      });
    }
  }, [base]);

  const send = useCallback(async (zoneId: number, state: LightingZoneState) => {
    inFlight.current = true;
    try {
      const response = await fetch(base, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zoneId, ...state }),
      });
      const body = await response.json() as WriteResponse;
      if (response.ok && body.status === "ok" && body.zone) {
        dispatch({ type: "applied", zone: body.zone });
      } else {
        dispatch({ type: "apply-failed", failure: failureFrom(body, "The device did not confirm the change") });
      }
    } catch (error) {
      dispatch({
        type: "apply-failed",
        failure: { code: "disconnected", reason: error instanceof Error ? error.message : "The local service did not answer" },
      });
    } finally {
      inFlight.current = false;
    }
  }, [base]);

  const flush = useCallback(() => {
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) void send(next.zoneId, next.state);
  }, [send]);

  const preview = useCallback((zoneId: number, state: LightingZoneState) => {
    dispatch({ type: "edit", zoneId, state });
    pending.current = { zoneId, state };
    if (timer.current !== null) return;
    timer.current = setTimeout(flush, PREVIEW_INTERVAL_MS);
  }, [flush]);

  const save = useCallback(async () => {
    try {
      const response = await fetch(`${base}/commit`, { method: "POST" });
      const body = await response.json() as WriteResponse;
      if (response.ok && body.status === "ok") dispatch({ type: "committed" });
      else dispatch({ type: "commit-failed", failure: failureFrom(body, "The device did not confirm the save") });
    } catch (error) {
      dispatch({
        type: "commit-failed",
        failure: { code: "disconnected", reason: error instanceof Error ? error.message : "The local service did not answer" },
      });
    }
  }, [base]);

  const selectZone = useCallback((zoneId: number) => dispatch({ type: "select-zone", zoneId }), []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  return { model, refresh, preview, selectZone, save };
}
