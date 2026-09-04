## 1. HID access spike (do this first)

- [x] 1.1 Add `node-hid` and confirm it loads and enumerates under Bun on this machine; if it does not, implement the Linux `hidraw` fallback instead and record the outcome in `design.md` under Open Questions
- [x] 1.2 Define the `HidPort` interface (`enumerate()`, `open(path)`, `close()`) plus the descriptor shape it returns, and implement it over the mechanism chosen in 1.1
- [x] 1.3 Add a fake `HidPort` for tests that replays scripted enumeration results, so every later test runs with no hardware attached

## 2. Project skeleton

- [x] 2.1 Add React, React DOM, `react-router-dom`, Tailwind v4 and `bun-plugin-tailwind` to `package.json`; add a `dev` script (`bun --hot`) and a `start` script
- [x] 2.2 Create the `src/server/` and `src/ui/` trees and point `index.ts` at the server entry
- [x] 2.3 Stand up `Bun.serve()` binding to loopback only, serving `src/ui/index.html` via HTML import, falling back to another free port when the preferred one is taken and logging the address served
- [x] 2.4 Render a React root with Tailwind styles applied, to prove the HTML-import + Tailwind bundling path end to end

## 3. Device registry

- [x] 3.1 Define the `Feature` union (`dpi-stages`, `polling-rate`, `key-remap`, `macros`, `lighting`, `onboard-slots`) and the registry entry type (display name, vendor, kind, matches with vendor/product id and optional usage page/usage, connection path per match, capability set)
- [x] 3.2 Write registry entries for Keychron M6 (`0x3434`), ASUS ROG Harpe II ACE (`0x0b05`, direct and SpeedNova receiver), and Lofree Hyzen (`0x388d`), with conservative capability sets covering only what is documented
- [x] 3.3 Implement matching from a HID descriptor to a registry entry, collapsing a unit's multiple HID interfaces into one logical device
- [x] 3.4 Test: each supported model matches; an unknown vendor/product id matches nothing; a multi-interface unit yields exactly one logical device

## 4. Discovery service

- [x] 4.1 Implement device identity: `vendorId:productId:serialNumber`, falling back to a per-model ordinal when no serial is present
- [x] 4.2 Implement polled enumeration (~1s) that diffs against the previous set and emits attach/detach transitions
- [x] 4.3 Implement known-device persistence in `devices.json` so previously seen units are reported as known-and-disconnected when absent, and are recognized as the same unit on reconnect
- [x] 4.4 Represent access failures as device state (`access: 'denied'` plus reason) rather than filtering the device out, and set a process-level discovery-unavailable state when `HidPort` cannot initialize at all
- [x] 4.5 Test against the fake port: attach, detach, reattach, two units of one model, permission-denied device, unavailable backend, empty first run

## 5. Device API

- [x] 5.1 Implement `GET /api/devices` returning the full snapshot (connection state, model info, capability set, connection path, active profile name)
- [x] 5.2 Implement `GET /api/devices/stream` as SSE, sending a full snapshot as its first message and change updates thereafter
- [x] 5.3 Handle subscriber lifecycle: multiple concurrent subscribers, cleanup on disconnect, and a fresh snapshot on re-subscribe
- [x] 5.4 Test: snapshot shape matches the spec; a scripted attach on the fake port reaches an open stream; re-subscribing yields a snapshot first

## 6. Profile library

- [x] 6.1 Implement the profile envelope (`formatVersion`, `model`, `name`, `createdAt`, `updatedAt`, `settings`) and its validator
- [x] 6.2 Implement the file store under the user's config directory (`profiles/<model>/<slug>.json`), creating the directory when missing and reporting an empty library
- [x] 6.3 Load profiles on startup, reporting unreadable or malformed files individually by filename and reason while the rest still load
- [x] 6.4 Create a default profile for a device model that has none and mark it active; record active profile per known device in `devices.json`
- [x] 6.5 Test: round-trip save and load, missing directory, malformed file alongside valid ones, default creation

## 7. Profile actions

- [x] 7.1 Implement export: a route returning a single device's profile as a downloadable file recording its model and name
- [x] 7.2 Implement import: a route validating an uploaded profile, rejecting unsupported models and malformed files with a stated reason and leaving the library unchanged
- [x] 7.3 Implement name-collision handling on import (replace or keep both), never silently overwriting
- [x] 7.4 Implement mirror: given a source device and targets, copy only the `settings` keys in each target's capability set, report the dropped keys, exclude targets sharing no features, and store for disconnected targets
- [x] 7.5 Test: export/import round trip, unsupported-model rejection, malformed rejection, collision paths, partial mirror reporting, zero-overlap target exclusion, mirror to a disconnected device

## 8. Application shell (frontend)

- [x] 8.1 Add routes `/`, `/device/:id`, and a not-found view with a way back to home
- [x] 8.2 Build the persistent app frame (header with the Silver Launcher name, content region) around routed content
- [x] 8.3 Implement `useDeviceState()` over `EventSource`, exposing devices, discovery availability, and connection status from one source
- [x] 8.4 Implement the stale/offline notice: on lost server contact show devices as stale rather than disconnected; on reconnect refresh and clear the notice automatically
- [x] 8.5 Render the `/device/:id` placeholder naming the device and listing its declared capabilities

## 9. Home page

- [x] 9.1 Build the device card: name, vendor, kind, connection state, connection path (direct USB vs. vendor dongle), active profile
- [x] 9.2 Group cards by device kind, with keyboards and mice visually separated
- [x] 9.3 Style the disconnected state as distinct from connected; disable the configure action on disconnected cards with a stated reason
- [x] 9.4 Derive every per-device action from the capability set, so no control appears that the model does not declare
- [x] 9.5 Build the loading state shown until the first snapshot arrives, and the empty state naming the supported models
- [x] 9.6 Build the access-denied card variant with its reason, and the discovery-unavailable banner that still renders the frame and remembered devices
- [x] 9.7 Wire the import, export, and mirror actions into the home page, including the mirror target picker with its pre-confirmation report of what will not carry over

## 10. Verification and docs

- [x] 10.1 Manual pass with real hardware: each of the three devices appears as exactly one card with the right kind, vendor, and connection path
- [x] 10.2 Manual pass on plug/unplug/replug while the home page is open — card updates in place, no error styling, identity preserved on reconnect
- [x] 10.3 Manual pass on the failure paths: kill the server and confirm the stale notice and automatic recovery; revoke device permission and confirm the access-denied card
- [x] 10.4 Update `README.md` run instructions and document the required Linux udev rules for vendor ids `3434`, `0b05`, and `388d`
- [x] 10.5 Run `openspec validate add-device-home-page --strict` and `bun test`
