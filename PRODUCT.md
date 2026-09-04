# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Bun runtime end to end. `Bun.serve()` with HTML imports serves a React frontend (Tailwind available through Bun's bundler); no Vite, no separate bundler step. The same Bun process owns HID communication with the devices, so the browser is a pure UI client talking to a local server. That server ships wrapped in an installable desktop application rather than being started by hand; the packaging toolchain is not yet chosen.

## Users

Owners of peripherals from several different vendors — the same person has a Keychron keyboard, an ASUS mouse, and a Lofree board on one desk. Today that means installing and running one heavyweight vendor application per device, each with its own account prompts, updaters, and background services. They come to Silver Launcher to remap keys and buttons, tune DPI and polling, record macros, and manage profiles for every device they own from one place.

## Product Purpose

Replace per-vendor configuration software with a single local web app that configures every supported keyboard and mouse. Success is a user uninstalling the vendor apps and losing nothing they actually used.

## Positioning

Vendor tools are single-brand by construction; each one only ever sees its own hardware. Silver Launcher is cross-vendor by construction: one device model per protocol, one UI over all of them, so a mouse from one brand and a keyboard from another are configured with the same controls and the same profile concepts. It runs entirely on the user's machine with no account layer that vendor suites attach to their software.

## Operating Context

Silver Launcher is installed and launched like any other desktop application: opening it starts the local server and brings up the UI, so a non-technical user never touches a terminal. Devices are plugged in over USB (or a vendor dongle) and are discovered by the server, which speaks HID to them directly. Devices come and go while the app is open — unplugging a mouse mid-session is normal, not an error state. Users typically configure one device at a time but own several, and often want the same binding scheme mirrored across devices.

## Capabilities and Constraints

- Device communication is server-side: the Bun backend talks HID over USB; the browser never touches the hardware. Browser-side WebHID was considered and not chosen.
- Supported devices today: Keychron M6 (mouse), ASUS ROG Harpe II ACE (mouse), Lofree Hyzen (keyboard). The architecture should generalize to more devices, but only these three are in scope.
- Offline-first: no cloud service, no accounts, no telemetry.
- Profiles are stored as files on the local machine and written to the device's onboard memory where the device supports it, so a configured device carries its settings to a machine that is not running Silver Launcher. Devices differ in how many onboard slots they expose, and some may expose none.
- Macro recording and editing is in scope, on any device whose protocol supports macros.
- Each supported device exposes a different vendor HID protocol; what is configurable (DPI stages, polling rate, per-key remapping, macros, lighting, onboard slots) varies by device and must be discovered per model rather than assumed uniform.
- Undecided: the on-disk profile file format and naming scheme, and the toolchain used to package the desktop application.

## Brand Commitments

- Name: **Silver Launcher**.
- Open source under the repository's existing LICENSE; that stays binding.
- No logo, wordmark, or existing brand assets yet.

## Evidence on Hand

- `README.md` — product one-liner and the current supported-device list.
- `LICENSE` — the open-source commitment.
- No screenshots, users, testimonials, benchmarks, press, or usage data exist. Nothing in these categories may be fabricated in any surface.

## Product Principles

1. **One app, many vendors.** A device from any supported brand is configured with the same controls and vocabulary; brand-specific quirks are the app's problem, not the user's.
2. **Local and account-free.** Nothing leaves the machine, and nothing asks the user to sign in.
3. **Honest about hardware.** Only expose what the connected device actually supports; never show a control the protocol cannot back.
4. **Plug and unplug is normal.** Device presence is fluid — connection, disconnection, and reconnection are ordinary states the interface handles gracefully.
5. **Replace, don't supplement.** Anything a user relied on in a vendor app is either supported here or explicitly named as not yet supported.
