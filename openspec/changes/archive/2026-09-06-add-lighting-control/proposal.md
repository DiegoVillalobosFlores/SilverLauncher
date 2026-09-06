## Why

Silver Launcher discovers devices but has never sent a byte to one: `HidConnection` exposes only `close()`. Lighting is the first feature that requires talking to hardware, so it is the change that invents the device protocol layer every later feature (DPI, polling, remapping, macros) will ride on.

Probing the ASUS ROG Harpe II ACE on this machine established that the work is viable and that two current behaviours block it. The device answers queries about its own lighting state, so the UI can show what the hardware actually holds rather than what we last sent it — the strongest available form of Principle 3 ("honest about hardware"). But discovery currently addresses the wrong HID endpoint, and over the wireless dongle a sleeping mouse returns well-formed data that is silently false.

## What Changes

- Extend the HID port so a device can be written to and read from, not just opened and closed. `HidConnection` gains write and timed-read operations; `HidPort` entries carry a report id.
- Introduce a device session layer that owns a held-open handle to a device's control endpoint and performs correlated request/response exchanges with timeouts.
- Introduce a per-vendor protocol codec. The ASUS ROG codec encodes and decodes the lighting get/set commands and recognises the protocol's explicit error frame.
- Add a liveness gate. A read whose result cannot be vouched for is reported as unknown rather than surfaced as device state.
- **BREAKING (internal)**: a matched device is no longer a single HID path. It becomes a set of endpoints with roles — one used to identify the device, one used to control it. `DeviceState.path` is replaced by role-addressed endpoints.
- Access checking moves to the control endpoint. Today it opens the mouse input interface and reports `access: "granted"` on that basis, which says nothing about whether the device is configurable.
- Add a lighting capability descriptor per model: zone count and names, supported effects, brightness range. The flat `lighting` feature flag says a screen exists; it cannot say what belongs on it.
- Add an HTTP surface for reading and writing a device's lighting.
- Add the frontend lighting editor on the device detail route: zone selection, colour, effect, brightness, with live preview and an explicit commit.
- Separate volatile preview writes from committing to the device's onboard memory, so dragging a colour picker does not write to flash on every frame.

Explicitly out of scope: lighting for the Keychron M6 and Lofree Hyzen (their protocols are unprobed), DPI, polling rate, remapping, macros, and profile storage of lighting values.

## Capabilities

### New Capabilities

- `device-protocol`: how Silver Launcher addresses a device's control endpoint, exchanges request/response messages with it, decides whether a reply can be trusted, and reports failure.
- `device-lighting`: what a user can see and change about a device's lighting, and the guarantees the interface makes about the values it shows.

### Modified Capabilities

- `device-discovery`: a matched device resolves to role-addressed endpoints rather than one path, and access is judged against the control endpoint.

## Impact

- `src/server/hid.ts` — `HidPort` / `HidConnection` gain read and write; `FakeHidPort` gains a scriptable request/response model so the protocol layer is testable without hardware.
- `src/server/registry.ts` — matches carry an endpoint role; `matchDevices` stops discarding vendor collections; models gain a lighting descriptor.
- `src/server/discovery.ts` — `DeviceState` carries endpoints; `checkAccess` targets the control endpoint.
- `src/server/http.ts` — new lighting routes.
- New: a device session module and a per-vendor codec module.
- `src/ui/app.tsx` — the device detail route gains the lighting editor.
- No new dependencies. `node-hid` already provides everything required.
