import { useEffect, useState } from "react";

export interface UiDevice {
  id: string;
  model: string;
  displayName: string;
  vendor: string;
  kind: "keyboard" | "mouse";
  capabilities: string[];
  connection: "connected" | "disconnected";
  connectionPath: "usb" | "dongle" | null;
  path?: string;
  serialNumber?: string;
  vendorId: number;
  productId: number;
  access: "granted" | "denied";
  accessReason?: string;
  profileName: string | null;
}

export interface UiDeviceSnapshot {
  discovery: "available" | "unavailable";
  discoveryReason?: string;
  devices: UiDevice[];
}

export type ServiceConnectionStatus = "connecting" | "connected" | "stale";

export interface DeviceStateResult {
  snapshot: UiDeviceSnapshot | null;
  devices: UiDevice[];
  discovery: "available" | "unavailable" | "unknown";
  discoveryReason?: string;
  connectionStatus: ServiceConnectionStatus;
  isLoading: boolean;
  isStale: boolean;
}

export function useDeviceState(streamUrl = "/api/devices/stream"): DeviceStateResult {
  const [snapshot, setSnapshot] = useState<UiDeviceSnapshot | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ServiceConnectionStatus>("connecting");

  useEffect(() => {
    const source = new EventSource(streamUrl);
    source.onopen = () => setConnectionStatus("connected");
    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as UiDeviceSnapshot;
        if (!next || !Array.isArray(next.devices)) return;
        setSnapshot(next);
        setConnectionStatus("connected");
      } catch {
        setConnectionStatus("stale");
      }
    };
    source.onerror = () => setConnectionStatus("stale");
    return () => source.close();
  }, [streamUrl]);

  return {
    snapshot,
    devices: snapshot?.devices ?? [],
    discovery: snapshot?.discovery ?? "unknown",
    discoveryReason: snapshot?.discoveryReason,
    connectionStatus,
    isLoading: snapshot === null,
    isStale: connectionStatus === "stale",
  };
}
