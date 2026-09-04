## Why

Silver Launcher is currently an empty Bun project: `index.ts` prints "Hello via Bun!" and there is no server, no UI, and no device layer. Nothing about the product — replacing per-vendor configuration apps with one local cross-vendor app — is testable until a user can launch the app and see their own keyboard and mouse appear. The home page is the first surface that proves the premise, so it has to be built together with the shell that serves it and the discovery layer that gives it something true to show.

## What Changes

- Replace the placeholder `index.ts` with a `Bun.serve()` application that serves an HTML-import React frontend (Tailwind via Bun's bundler) and a local JSON/SSE API on `127.0.0.1`. **BREAKING** for anyone running `bun run index.ts` expecting the hello-world output.
- Add a server-side HID discovery layer that enumerates USB HID devices, matches them against a per-model registry for the three supported devices (Keychron M6, ASUS ROG Harpe II ACE, Lofree Hyzen), and tracks arrival and removal continuously while the app runs.
- Publish device presence to the browser over a live stream so plugging and unplugging is reflected on screen without a reload and without polling by the user.
- Add a home page that lists every known supported device as a card carrying its connected/disconnected state, connection path (wired or vendor dongle), active profile, and a route into that device's configuration.
- Add home-level profile actions: import a profile file, export a profile file, and mirror one device's profile onto other devices that can accept it.
- Add a local, file-backed profile library so the home page's profile actions have real storage, with a documented on-disk layout under the user's config directory.
- Declare capability honestly per device: a device model's registry entry states what its protocol supports, and the home page never offers an action the connected device cannot back.

Explicitly out of scope: the per-device configuration screens themselves (key remapping, DPI/polling editors, macro recorder, lighting), writing to device onboard memory, and the desktop packaging toolchain. This change delivers discovery, the shell, and the home surface; the device detail route is a placeholder that the next change fills in.

## Capabilities

### New Capabilities
- `app-shell`: The Bun HTTP server, HTML-import React frontend, client routing, application layout, and the local-only binding and lifecycle rules the whole UI depends on.
- `device-discovery`: Server-side HID enumeration, the supported-device registry keyed by vendor/product id, live presence tracking across connect and disconnect, and the API that exposes device state to the frontend.
- `device-home`: The home page itself — the device overview, per-device state presentation, empty and error states, and navigation into device configuration.
- `profile-library`: Local file-backed storage of profiles plus the home-level import, export, and mirror actions over that store.

### Modified Capabilities

(none — this is the first change in the repository, so no existing specs change.)

## Impact

- **Code**: `index.ts` becomes the server entry point; new `src/server/` (HTTP routes, HID discovery, device registry, profile store) and `src/ui/` (HTML entry, React components, Tailwind) trees.
- **Dependencies**: adds React and React DOM, Tailwind, and a HID access mechanism (a native HID binding or Bun FFI over `hidapi`) — the choice is resolved in `design.md`. No cloud SDKs, no auth libraries.
- **Platform**: on Linux, HID access requires udev rules granting the user access to `hidraw` for vendor ids `3434` (Keychron), `0b05` (ASUS), and `388d` (Lofree); the app must detect and report permission failures rather than showing the device as absent.
- **Docs**: `README.md` run instructions change from `bun run index.ts` to the app's start script.
- **Undecided items carried forward**: the profile file format is decided here only as far as the home page needs it (an envelope with device identity, name, and an opaque device-defined payload); the desktop packaging toolchain remains unchosen and is not touched.
