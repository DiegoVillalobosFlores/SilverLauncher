## Context

The repository is empty of application code (`index.ts` is a hello-world), so this change establishes the process shape, the frontend build path, the HID access mechanism, and the on-disk layout all at once. See `proposal.md` — Why for motivation, and the four spec deltas for the behavior being committed to.

Constraints that shape the approach, from `PRODUCT.md`:

- Bun end to end; `Bun.serve()` with HTML imports; no Vite, no separate bundler step.
- HID lives in the Bun process; the browser never touches hardware (WebHID was considered and rejected).
- Offline, account-free, no telemetry.
- Three devices in scope, each with a different vendor protocol; what is configurable varies per model and must be discovered per model.
- The on-disk profile format and the desktop packaging toolchain are explicitly undecided in the product brief.

The development machine already has the relevant hardware and udev rules present, which grounds the vendor/product ids used below: Keychron `0x3434`, ASUS `0x0b05`, Lofree `0x388d`.

## Goals / Non-Goals

**Goals:**

- One `bun` process that serves the UI and owns HID, with a swappable HID backend behind a narrow internal port.
- A device model that is uniform across vendors at the API boundary — the UI reads one device shape regardless of brand — while keeping per-model capability declarations honest.
- Presence that stays correct across plug, unplug, and replug for the whole session, pushed to the browser.
- A profile envelope stable enough to store, import, export, and mirror, without pre-deciding the per-device payload that later changes will fill in.

**Non-Goals:**

- Speaking any vendor's configuration protocol. This change identifies and opens devices; it does not read or write device settings, and does not touch onboard memory.
- The device configuration screens. The device route renders a placeholder that names the device and its declared capabilities.
- Desktop packaging. The app is started with a Bun script; packaging stays unchosen.
- Windows/macOS verification. The design is cross-platform by construction but only Linux is exercised here.

## Decisions

### D1. HID access via `node-hid` behind an internal `HidPort` interface

`node-hid` is an N-API native addon with prebuilt binaries; Bun's N-API support loads it, and it gives cross-platform enumeration (`devices()`) plus per-device open/read/write that later protocol work will need.

Alternatives considered:

- **`bun:ffi` over `libhidapi`** — no addon, but requires the shared library to be present and correctly named per platform, and pushes struct marshalling into our code. Rejected as the default; it remains the natural second implementation of `HidPort` if the addon proves unreliable under Bun.
- **Reading `/sys/class/hidraw` and opening `/dev/hidraw*` directly** — zero dependencies and perfectly adequate for Linux enumeration, but Linux-only. Rejected as the primary path, and a reasonable fallback if `node-hid` fails to load.
- **WebHID in the browser** — already rejected by the product brief.

All discovery and access goes through a single `HidPort` interface (`enumerate()`, `open(path)`, `close()`) so the choice above is one file, and so tests can run against a fake port with no hardware attached.

### D2. Presence by polled enumeration, diffed into events

`node-hid` exposes no attach/detach notification. The discovery service re-enumerates on a fixed interval (target ~1s), diffs the result against the previous set, and emits `attached` / `detached` / `unchanged` transitions. Enumeration is cheap (it reads descriptors, it does not open devices), and a 1s interval comfortably satisfies the specs' "within a few seconds".

Alternatives: `udev` monitoring on Linux (fast and event-driven, but platform-specific and adds a second code path), or `usb`'s hotplug callbacks (another native addon, and libusb detaches kernel drivers in ways that are hostile to HID). Polling is chosen for being uniform across platforms and trivially correct; the diffing layer is written so an event source can replace the timer later without changing consumers.

### D3. Device identity

A unit's stable id is `vendorId:productId:serialNumber` when the descriptor carries a serial, and `vendorId:productId:#<ordinal>` otherwise, where the ordinal is assigned in enumeration order among units of that model. The OS-provided `path` is deliberately *not* the identity: it changes across replug on Linux and across reboots on Windows.

Consequence, accepted: two units of the same model with no serial numbers may swap ordinals across a replug. This is only observable when a user owns two of the same model, and the failure mode is a profile associated with the wrong twin — not data loss. It is noted in Risks.

### D4. Registry as declarative data, capabilities as an explicit set

Each supported model is a plain record: display name, vendor, kind, `matches: [{vendorId, productId, usagePage?, usage?}]`, `connection: 'usb' | 'dongle'` per match, and `capabilities: Set<Feature>` drawn from a closed union (`dpi-stages`, `polling-rate`, `key-remap`, `macros`, `lighting`, `onboard-slots`). A feature absent from the set means unsupported, full stop — the UI derives what it offers from this set rather than from brand knowledge, which is what makes Principle 3 ("Honest about hardware") enforceable rather than aspirational.

Because the three devices' protocols have not been reverse-engineered yet, the initial capability sets are conservative: only what can be asserted from vendor documentation and the hardware's advertised feature list, with anything unverified left out. An unverified feature left out shows the user nothing; an unverified feature left in shows a control that does not work.

Multiple HID interfaces per physical device is the norm (a mouse exposes a boot-mouse interface and a vendor interface). Matching therefore includes optional `usagePage`/`usage` so a unit collapses to one logical device rather than three cards.

### D5. Transport: snapshot over `GET`, changes over SSE

`GET /api/devices` returns the full snapshot; `GET /api/devices/stream` is a Server-Sent Events stream whose first message is a full snapshot and whose subsequent messages are state updates. SSE over WebSocket because the traffic is one-directional, `EventSource` reconnects on its own, and the "re-subscribe yields a fresh snapshot" requirement then falls out of the design rather than being hand-built. Commands (import, export, mirror) are ordinary `POST` routes.

### D6. Frontend: HTML import, React, Tailwind v4, `react-router-dom`

`Bun.serve({ routes: { "/*": index } })` with `import index from "./index.html"` gives bundling and HMR with no separate build step. Tailwind v4 through `bun-plugin-tailwind`. `react-router-dom` for the three routes (`/`, `/device/:id`, not-found) — a hand-rolled `popstate` router would be ~40 lines, but the back/forward and not-found behavior the shell spec requires is exactly what a router already gets right.

Device state reaches components through one `useDeviceState()` hook wrapping the `EventSource`, which owns connection status too — that single source is what lets the shell distinguish "server unreachable, data is stale" from "devices are disconnected", a distinction the specs require and that is easy to get wrong if each card fetches for itself.

### D7. Profile envelope, with an opaque payload

```
{ formatVersion: 1, model: "<registry model id>", name: "<user-visible>",
  createdAt, updatedAt, settings: { <feature>: <payload> } }
```

One JSON file per profile at `$XDG_CONFIG_HOME/silver-launcher/profiles/<model>/<slug>.json` (platform equivalents elsewhere), plus `devices.json` recording known units and their active profile.

The keys of `settings` are registry feature names; the value under each key is defined by the later per-device work and is opaque to everything in this change. That is deliberate: it settles enough of the "undecided" format question to store, validate, import, export, and mirror profiles, while leaving the per-feature schemas to the changes that actually implement those features. Mirroring is then a well-defined operation — copy the `settings` keys that appear in the target model's capability set, drop the rest, and report what was dropped.

JSON over a binary format because these files are the user's, on their disk, in a project with no cloud sync to optimize for; a user reading or hand-editing one is a feature.

### D8. Import and export through the browser's own file affordances

Export builds the profile JSON client-side from a `GET` and hands it over as a download; import uses `<input type="file">` and `POST`s the parsed contents for server-side validation. Validation is server-side because the server owns the registry and the library, and client-side checks would be a second copy of that truth. No native file dialog is involved, which keeps this working identically once the app is wrapped for the desktop.

### D9. Access failures are a device state, not an exception

`enumerate()` can see a device that `open()` cannot access (the udev/permission case on Linux, and the equivalent elsewhere). Such a unit enters the device set with `access: 'denied'` and a reason string, rather than being filtered out — the discovery spec requires it, and it is the difference between a user fixing a udev rule in a minute and concluding the app does not support their mouse. Likewise, a `HidPort` that fails to initialize sets a process-level `discovery: unavailable` state; the server still starts and still serves the UI.

## Risks / Trade-offs

- **`node-hid` may not load cleanly under Bun's N-API** → the `HidPort` interface exists precisely for this; the Linux `hidraw` implementation is the fallback, and this is verified as the first implementation task before anything is built on top.
- **1s enumeration polling costs a little CPU forever** → enumeration does not open devices and is on the order of milliseconds; if it proves costly on a machine with many HID devices, the interval backs off while the window is not focused. Revisit only with a measurement.
- **Same-model units without serial numbers can swap identity across a replug** (D3) → accepted; affects only multi-unit owners of one model, and the worst case is a profile attached to the wrong twin. If it matters later, identity can incorporate the USB topology path as a tiebreaker.
- **Conservative initial capability sets will understate what the hardware can do** → intended. Principle 3 makes a missing control cheap to add and a dead control expensive to explain. Each capability is turned on by the change that implements it.
- **A device may expose several HID interfaces and appear as duplicate cards** → mitigated by usage-page matching in the registry (D4); the acceptance check is that each attached unit produces exactly one card on the development machine.
- **Wireless devices reachable through a dongle report the dongle's product id, so a powered-off device can look "connected"** → this change reports connection path honestly (dongle vs. direct USB) but cannot distinguish "dongle present, device asleep" without speaking the vendor protocol. The card says the device is reachable through the receiver; distinguishing device liveness is deferred to the protocol work.
- **Storing profiles before per-device settings exist means the first profiles are near-empty** → `formatVersion` is in the envelope from the start, and the payloads are opaque, so filling them in later is additive rather than a migration.

## Migration Plan

There is nothing deployed and no data to migrate. `index.ts` changes from a hello-world to the server entry point, which breaks the documented `bun run index.ts` invocation; `README.md` is updated in the same change. Rollback is `git revert`.

## Open Questions

- `node-hid@3.4.0` loads and enumerates successfully under Bun 1.4.0 on the development machine, including the target HID interfaces. The Linux `hidraw` fallback is therefore not needed for this change; the `HidPort` boundary remains available if another platform exposes a native-addon issue.
- Whether known-device memory should have a user-visible "forget this device" action. Not required by any spec here; if wanted, it is an additive requirement on `device-home`.
