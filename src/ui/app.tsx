import { useMemo, useState } from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useDeviceState, type UiDevice, type DeviceStateResult } from "./use-device-state";
import { useLighting } from "./use-lighting";
import {
  fromHex,
  showsZoneSelector,
  toHex,
  zoneState,
  type LightingDescriptor,
  type LightingZoneState,
} from "./lighting-model";

const supportedModels = ["Keychron M6", "ASUS ROG Harpe II ACE", "Lofree Hyzen"];
const featureLabels: Record<string, string> = {
  "dpi-stages": "DPI stages",
  "polling-rate": "Polling rate",
  "key-remap": "Button and key remapping",
  macros: "Macros",
  lighting: "Lighting",
  "onboard-slots": "Onboard profile slots",
};

interface MirrorTargetReport {
  id: string;
  deviceName?: string;
  included: boolean;
  connected: boolean;
  supported: string[];
  dropped: string[];
  reason?: string;
}

interface MirrorReport {
  sourceId: string;
  sourceProfile: string;
  requiresConfirmation: boolean;
  confirmed: boolean;
  targets: MirrorTargetReport[];
}

export function App() {
  return (
    <BrowserRouter>
      <ApplicationFrame />
    </BrowserRouter>
  );
}

function ApplicationFrame() {
  const state = useDeviceState();
  return (
    <div className="min-h-screen bg-[#101315] text-[#e7ece8]">
      <header className="border-b border-white/10 bg-[#101315]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" className="group flex items-center gap-3" aria-label="Silver Launcher home">
            <span className="brand-mark" aria-hidden="true"><span /></span>
            <span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.28em] text-[#a9b4ad]">Local control plane</span>
              <span className="block text-lg font-semibold tracking-tight text-white group-hover:text-[#bbf7d0]">Silver Launcher</span>
            </span>
          </Link>
          <div className="flex items-center gap-3 text-xs text-[#a9b4ad]">
            <span className={`status-dot ${state.isStale ? "status-dot-stale" : "status-dot-live"}`} />
            <span>{state.isStale ? "Service unreachable" : state.isLoading ? "Connecting" : "Local service"}</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
        <Routes>
          <Route path="/" element={<HomePage state={state} />} />
          <Route path="/device/:id" element={<DeviceDetail devices={state.devices} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function HomePage({ state }: { state: DeviceStateResult }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [mirrorSource, setMirrorSource] = useState<UiDevice | null>(null);
  const [importInputKey, setImportInputKey] = useState(0);

  const handleImport = async (file: File) => {
    try {
      const profile = JSON.parse(await file.text()) as unknown;
      let response = await fetch("/api/profiles/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      if (response.status === 409) {
        const collision = await response.json() as { error?: string };
        const action = window.confirm(`${collision.error ?? "This profile already exists."}\n\nReplace it? Cancel keeps both.`)
          ? "replace"
          : "keep-both";
        response = await fetch("/api/profiles/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile, collision: action }),
        });
      }
      const result = await response.json() as { error?: string; imported?: { name?: string }; renamed?: boolean };
      if (!response.ok) throw new Error(result.error ?? "The profile could not be imported");
      setNotice(`Imported ${result.imported?.name ?? "profile"}${result.renamed ? " as a second copy" : ""}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The profile could not be imported");
    } finally {
      setImportInputKey((value) => value + 1);
    }
  };

  return (
    <div className="space-y-10">
      <section className="hero-panel relative overflow-hidden rounded-3xl border border-white/10 px-6 py-8 sm:px-10 sm:py-10">
        <div className="hero-glow" aria-hidden="true" />
        <div className="relative max-w-3xl">
          <p className="eyebrow">Your desk, one surface</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-6xl">Hardware should feel like home.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[#a9b4ad] sm:text-lg">See every supported keyboard and mouse at a glance. No accounts, no background services, no guessing what your hardware can do.</p>
        </div>
        <div className="relative mt-8 flex flex-wrap items-center gap-3">
          <label className="button-primary cursor-pointer">
            Import profile
            <input
              key={importInputKey}
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImport(file);
              }}
            />
          </label>
          <span className="text-xs text-[#7f8b83]">Everything stays on this machine.</span>
        </div>
      </section>

      {state.isStale && (
        <div className="notice notice-warning" role="status">
          <span className="notice-icon">!</span>
          <div>
            <p className="font-semibold text-[#f4f0df]">Lost contact with the local service</p>
            <p className="mt-1 text-sm text-[#bdb9a5]">Showing the last known device state. Silver Launcher will reconnect and refresh automatically.</p>
          </div>
        </div>
      )}
      {state.discovery === "unavailable" && (
        <div className="notice notice-danger" role="alert">
          <span className="notice-icon">x</span>
          <div>
            <p className="font-semibold text-[#ffe6e2]">Device detection is unavailable</p>
            <p className="mt-1 text-sm text-[#d7aaa3]">{state.discoveryReason ?? "The HID backend could not be initialized."} Remembered devices remain below.</p>
          </div>
        </div>
      )}
      {notice && (
        <div className="notice notice-success" role="status">
          <span className="notice-icon">ok</span>
          <p className="text-sm text-[#c5f4d3]">{notice}</p>
          <button className="ml-auto text-xs text-[#9dc7a9] hover:text-white" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {state.isLoading ? (
        <LoadingState />
      ) : state.devices.length === 0 ? (
        <EmptyState />
      ) : (
        <DeviceGroups
          devices={state.devices}
          stale={state.isStale}
          onMirror={setMirrorSource}
          onNotice={setNotice}
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-white/10 pt-6">
        <div>
          <p className="eyebrow">Supported today</p>
          <p className="mt-2 text-sm text-[#8f9b93]">{supportedModels.join("  /  ")}</p>
        </div>
        {!state.isLoading && state.devices.length > 0 && (
          <p className="text-xs text-[#66736b]">{state.devices.length} known {state.devices.length === 1 ? "device" : "devices"}</p>
        )}
      </div>

      {mirrorSource && (
        <MirrorDialog
          source={mirrorSource}
          devices={state.devices}
          onClose={() => setMirrorSource(null)}
          onNotice={setNotice}
        />
      )}
    </div>
  );
}

function DeviceGroups({
  devices,
  stale,
  onMirror,
  onNotice,
}: {
  devices: UiDevice[];
  stale: boolean;
  onMirror: (device: UiDevice) => void;
  onNotice: (message: string) => void;
}) {
  const groups = [
    { kind: "keyboard" as const, label: "Keyboards", descriptor: "Typing surfaces" },
    { kind: "mouse" as const, label: "Mice", descriptor: "Pointing surfaces" },
  ];
  return (
    <div className="space-y-10">
      {groups.map((group) => {
        const grouped = devices.filter((device) => device.kind === group.kind);
        if (grouped.length === 0) return null;
        return (
          <section key={group.kind} aria-labelledby={`${group.kind}-heading`}>
            <div className="mb-4 flex items-baseline gap-3">
              <h2 id={`${group.kind}-heading`} className="text-xl font-semibold tracking-tight text-white">{group.label}</h2>
              <span className="text-xs uppercase tracking-[0.18em] text-[#657269]">{group.descriptor}</span>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {grouped.map((device) => (
                <DeviceCard key={device.id} device={device} stale={stale} onMirror={onMirror} onNotice={onNotice} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DeviceCard({
  device,
  stale,
  onMirror,
  onNotice,
}: {
  device: UiDevice;
  stale: boolean;
  onMirror: (device: UiDevice) => void;
  onNotice: (message: string) => void;
}) {
  const navigate = useNavigate();
  const accessible = device.connection === "connected" && device.access === "granted";
  const status = stale ? "Stale" : device.access === "denied" ? "Access denied" : device.connection === "connected" ? "Connected" : "Disconnected";
  const statusClass = device.access === "denied" ? "card-denied" : device.connection === "connected" ? "card-connected" : "card-disconnected";
  return (
    <article className={`device-card ${statusClass} ${stale ? "card-stale" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className={`device-glyph ${device.kind === "keyboard" ? "device-glyph-keyboard" : "device-glyph-mouse"}`} aria-hidden="true">
            {device.kind === "keyboard" ? "K" : "M"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-white">{device.displayName}</p>
            <p className="mt-1 text-sm text-[#91a097]">{device.vendor} <span className="mx-1 text-[#46534b]">/</span> {device.kind}</p>
          </div>
        </div>
        <span className={`state-pill ${stale ? "state-pill-stale" : device.access === "denied" ? "state-pill-denied" : device.connection === "connected" ? "state-pill-connected" : "state-pill-disconnected"}`}>
          <span className="status-dot" /> {status}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 border-y border-white/8 py-4 text-sm">
        <div>
          <p className="field-label">Connection</p>
          <p className="mt-1 text-[#d5ded8]">{device.connectionPath === "dongle" ? "Vendor dongle" : device.connectionPath === "usb" ? "Direct USB" : "Not connected"}</p>
        </div>
        <div>
          <p className="field-label">Active profile</p>
          <p className="mt-1 truncate text-[#d5ded8]">{device.profileName ?? "None"}</p>
        </div>
      </div>

      {device.access === "denied" && (
        <div className="mt-4 rounded-xl border border-[#7b4c49]/50 bg-[#321f20]/60 px-3 py-2.5 text-sm text-[#f0bab2]">
          Silver Launcher detected this device but cannot access it. {device.accessReason ?? "Check the device permission or udev rule."}
        </div>
      )}
      {device.connection === "disconnected" && device.access !== "denied" && (
        <p className="mt-4 text-sm text-[#aaafa9]">Connect this device to configure it. Your profile remains stored locally.</p>
      )}
      {stale && device.access !== "denied" && (
        <p className="mt-4 text-xs text-[#9a9b89]">Last known state while the local service is unavailable.</p>
      )}

      <div className="mt-5">
        <p className="field-label">Declared capabilities</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {device.capabilities.length > 0 ? device.capabilities.map((capability) => (
            <span key={capability} className="capability-tag">{featureLabels[capability] ?? capability}</span>
          )) : <span className="text-sm text-[#748078]">No configurable features declared</span>}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          className="button-primary button-small"
          disabled={!accessible}
          onClick={() => navigate(`/device/${encodeURIComponent(device.id)}`)}
          title={!accessible ? (device.access === "denied" ? "Access to this device is denied" : "Connect the device first") : undefined}
        >
          Configure
        </button>
        <button
          className="button-secondary button-small"
          disabled={!device.profileName}
          onClick={() => void downloadProfile(device.id, onNotice)}
          title={!device.profileName ? "No profile is available to export" : undefined}
        >
          Export
        </button>
        <button
          className="button-secondary button-small"
          disabled={!device.profileName}
          onClick={() => onMirror(device)}
          title={!device.profileName ? "No profile is available to mirror" : undefined}
        >
          Mirror
        </button>
      </div>
    </article>
  );
}

function LoadingState() {
  return (
    <section className="state-panel" aria-live="polite">
      <div className="loading-orbit" aria-hidden="true" />
      <p className="eyebrow">Scanning local hardware</p>
      <h2 className="mt-3 text-2xl font-semibold text-white">Finding your devices...</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[#8e9991]">The first snapshot is on its way. The empty state will only appear once discovery has answered.</p>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="state-panel">
      <div className="empty-orbit" aria-hidden="true"><span /></div>
      <p className="eyebrow">A quiet desk</p>
      <h2 className="mt-3 text-2xl font-semibold text-white">No supported device found</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-[#8e9991]">Plug in one of the devices below, or connect its vendor receiver. Silver Launcher will add it here without a reload.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {supportedModels.map((model) => <span key={model} className="model-chip">{model}</span>)}
      </div>
    </section>
  );
}

function DeviceDetail({ devices }: { devices: UiDevice[] }) {
  const { id } = useParams();
  const decodedId = id ? decodeURIComponent(id) : "";
  const device = devices.find((candidate) => candidate.id === decodedId);
  if (!device) return <NotFound message="That device is not in the current snapshot." />;
  return (
    <section className="mx-auto max-w-4xl space-y-8">
      <Link to="/" className="back-link">&lt;- Back to home</Link>
      <div>
        <p className="eyebrow">Device configuration</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white">{device.displayName}</h1>
        <p className="mt-3 text-[#9aa69d]">{device.vendor} <span className="mx-1 text-[#46534b]">/</span> {device.kind}</p>
      </div>
      {device.capabilities.includes("lighting") && device.lighting && (
        <LightingSection device={device} descriptor={device.lighting} />
      )}
      <div className="state-panel text-left">
        <p className="eyebrow">Configuration workspace</p>
        <h2 className="mt-3 text-2xl font-semibold text-white">More controls are coming next.</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#8e9991]">This route is ready for device-specific settings. For now, the registry is the source of truth for what this device declares.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {device.capabilities.map((capability) => <span key={capability} className="capability-tag">{featureLabels[capability] ?? capability}</span>)}
        </div>
      </div>
    </section>
  );
}

function LightingSection({ device, descriptor }: { device: UiDevice; descriptor: LightingDescriptor }) {
  const connected = device.connection === "connected" && device.access === "granted" && device.configurable;
  const lighting = useLighting(device.id, connected);
  const { model } = lighting;
  const selectedZone = model.selectedZone ?? descriptor.zones[0]?.id ?? 0;
  const current = zoneState(model, selectedZone);
  const editable = model.editable && connected && current !== null;

  const change = (patch: Partial<LightingZoneState>) => {
    if (!current) return;
    lighting.preview(selectedZone, { ...current, ...patch });
  };

  return (
    <section className="state-panel text-left" aria-labelledby="lighting-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Lighting</p>
          <h2 id="lighting-heading" className="mt-3 text-2xl font-semibold text-white">Lighting</h2>
        </div>
        {model.unsavedChanges && (
          <span className="state-pill state-pill-stale"><span className="status-dot" /> Unsaved changes</span>
        )}
      </div>

      {!connected && (
        <p className="mt-4 text-sm text-[#d7aaa3]">
          {device.configurable
            ? "This device is not available for configuration right now."
            : device.configurableReason ?? "No configuration interface was matched for this device."}
        </p>
      )}

      {connected && model.status === "loading" && (
        <p className="mt-4 text-sm text-[#8e9991]" role="status">Reading the current lighting from the device...</p>
      )}

      {connected && model.status === "unknown" && (
        <div className="mt-4 rounded-xl border border-[#7b6c49]/50 bg-[#2a2620]/60 px-3 py-2.5 text-sm text-[#f0dcb2]" role="status">
          <p className="font-semibold">The current lighting is unknown.</p>
          <p className="mt-1">{model.reason ?? "The device did not confirm its state."} Editing is unavailable until it responds.</p>
          <button className="button-secondary button-small mt-3" onClick={() => void lighting.refresh()}>Try again</button>
        </div>
      )}

      {connected && model.status === "ready" && current && (
        <div className="mt-6 space-y-5">
          {showsZoneSelector(descriptor) && (
            <div>
              <label className="field-label" htmlFor="lighting-zone">Zone</label>
              <select
                id="lighting-zone"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-[#e4ebe5]"
                value={selectedZone}
                onChange={(event) => lighting.selectZone(Number(event.target.value))}
              >
                {descriptor.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="lighting-colour">Colour</label>
            <div className="mt-2 flex items-center gap-3">
              <input
                id="lighting-colour"
                type="color"
                className="h-10 w-16 cursor-pointer rounded-lg border border-white/10 bg-black/20"
                value={toHex(current.color)}
                disabled={!editable}
                onChange={(event) => change({ color: fromHex(event.target.value) })}
              />
              <span className="text-sm text-[#9aa69d]">{toHex(current.color)}</span>
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="lighting-brightness">
              Brightness <span className="text-[#9aa69d]">({current.brightness})</span>
            </label>
            <input
              id="lighting-brightness"
              type="range"
              className="mt-2 w-full"
              min={descriptor.brightness.min}
              max={descriptor.brightness.max}
              step={1}
              value={current.brightness}
              disabled={!editable}
              onChange={(event) => change({ brightness: Number(event.target.value) })}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="lighting-effect">Effect</label>
            <select
              id="lighting-effect"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-[#e4ebe5]"
              value={current.mode}
              disabled={!editable}
              onChange={(event) => change({ mode: Number(event.target.value) })}
            >
              {descriptor.effects.map((effect) => <option key={effect.id} value={effect.id}>{effect.name}</option>)}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-white/8 pt-5">
            <button className="button-primary button-small" disabled={!editable} onClick={() => void lighting.save()}>
              Save to device
            </button>
            <p className="text-xs text-[#8e9991]">
              Changes apply immediately. Unsaved changes are lost when the device is unplugged.
            </p>
          </div>
        </div>
      )}

      {model.notice && <p className="mt-4 text-sm text-[#f0bab2]" role="status">{model.notice}</p>}
    </section>
  );
}

function MirrorDialog({
  source,
  devices,
  onClose,
  onNotice,
}: {
  source: UiDevice;
  devices: UiDevice[];
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const candidates = useMemo(() => devices.filter((device) => device.id !== source.id), [devices, source.id]);
  const [selected, setSelected] = useState<string[]>([]);
  const [report, setReport] = useState<MirrorReport | null>(null);
  const [busy, setBusy] = useState(false);
  const included = report?.targets.filter((target) => target.included) ?? [];

  const preview = async (confirm: boolean) => {
    setBusy(true);
    try {
      const response = await fetch("/api/profiles/mirror", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, targetIds: selected, confirm }),
      });
      const result = await response.json() as MirrorReport & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The mirror could not be prepared");
      setReport(result);
      if (confirm) {
        onNotice(included.length === 1 ? "Profile mirrored to 1 device." : `Profile mirrored to ${included.length} devices.`);
        onClose();
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The mirror could not be prepared");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="mirror-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Profile action</p>
            <h2 id="mirror-title" className="mt-2 text-2xl font-semibold text-white">Mirror from {source.displayName}</h2>
            <p className="mt-2 text-sm text-[#8e9991]">Choose known devices. Disconnected targets are stored locally and applied when they reconnect.</p>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close mirror dialog">x</button>
        </div>
        <div className="mt-6 max-h-64 space-y-2 overflow-y-auto pr-1">
          {candidates.length === 0 ? <p className="text-sm text-[#8e9991]">There are no other known devices.</p> : candidates.map((device) => (
            <label key={device.id} className={`target-row ${selected.includes(device.id) ? "target-row-selected" : ""}`}>
              <input
                type="checkbox"
                checked={selected.includes(device.id)}
                onChange={() => setSelected((current) => current.includes(device.id) ? current.filter((id) => id !== device.id) : [...current, device.id])}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[#e4ebe5]">{device.displayName}</span>
                <span className="block text-xs text-[#7e8a81]">{device.connection === "connected" ? "Connected" : "Disconnected"}</span>
              </span>
            </label>
          ))}
        </div>
        {report && (
          <div className="mt-5 space-y-2 rounded-2xl border border-white/10 bg-black/15 p-4">
            <p className="field-label">Before you confirm</p>
            {report.targets.map((target) => (
              <div key={target.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className={target.included ? "text-[#ccefd5]" : "text-[#8d9990]"}>{target.deviceName ?? target.id}</span>
                <span className="text-right text-xs text-[#9a9b89]">
                  {target.included ? `${target.supported.map((item) => featureLabels[item] ?? item).join(", ") || "No settings"}${target.dropped.length ? `  /  drops ${target.dropped.map((item) => featureLabels[item] ?? item).join(", ")}` : ""}` : target.reason}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button className="button-secondary button-small" onClick={onClose}>Cancel</button>
          {report && included.length > 0 ? (
            <button className="button-primary button-small" disabled={busy} onClick={() => void preview(true)}>{busy ? "Applying..." : "Confirm mirror"}</button>
          ) : (
            <button className="button-primary button-small" disabled={busy || selected.length === 0} onClick={() => void preview(false)}>{busy ? "Preparing..." : "Preview mirror"}</button>
          )}
        </div>
      </section>
    </div>
  );
}

function NotFound({ message = "The page you requested does not exist." }: { message?: string }) {
  return (
    <section className="state-panel mx-auto max-w-2xl">
      <p className="eyebrow">404 / Lost signal</p>
      <h1 className="mt-3 text-3xl font-semibold text-white">Nothing lives here.</h1>
      <p className="mt-3 text-sm leading-6 text-[#8e9991]">{message}</p>
      <Link to="/" className="button-primary button-small mt-6 inline-flex">Return home</Link>
    </section>
  );
}

async function downloadProfile(id: string, onNotice: (message: string) => void): Promise<void> {
  try {
    const response = await fetch(`/api/profiles/export/${encodeURIComponent(id)}`);
    if (!response.ok) {
      const result = await response.json() as { error?: string };
      throw new Error(result.error ?? "The profile could not be exported");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "profile.json";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onNotice("Profile exported.");
  } catch (error) {
    onNotice(error instanceof Error ? error.message : "The profile could not be exported");
  }
}
