## 1. HID transport

- [x] 1.1 Extend `HidConnection` with a write operation taking a report id and payload, and a timed read returning the reply or nothing on timeout
- [x] 1.2 Carry the enumerated report id / usage page through `HidDescriptor` so a control endpoint can be addressed
- [x] 1.3 Implement both on `NodeHidPort` over `node-hid`'s `write` and `readTimeout`
- [x] 1.4 Extend `FakeHidPort` with a scriptable request/response model: match on request bytes, return a scripted reply, and support scripting a timeout, an error frame, and a stale/zeroed reply
- [x] 1.5 Tests: write/read round-trip, timeout, and error-frame handling against `FakeHidPort`

## 2. Endpoint roles in the registry

- [x] 2.1 Add `role: "identify" | "control"` to `RegistryMatch`, defaulting existing matches to `identify`
- [x] 2.2 Add the ASUS ROG Harpe II ACE control matches (vendor usage pages `0xff02` / `0xff00` / `0xff01`, both the USB and dongle product ids)
- [x] 2.3 Rework `matchDevices` so specificity scoring and the `preferredPairs` filter apply within a role, not across roles, and a control endpoint is never discarded because a better identify match exists
- [x] 2.4 Replace `LogicalDeviceCandidate.path` with role-addressed endpoints, keeping the existing physical-grouping behaviour
- [x] 2.5 Tests: a device presenting an input interface plus three vendor collections on one path resolves to one device with both roles populated; a device with no control endpoint resolves with `identify` only

## 3. Lighting descriptor

- [x] 3.1 Define a lighting descriptor type: zones (id and display name), brightness range, and supported effects
- [x] 3.2 Attach the descriptor to the ASUS ROG Harpe II ACE entry — exactly one zone, since led indices 1-3 return out-of-range values (see design.md)
- [x] 3.3 Expose the descriptor through the device snapshot so the interface can derive controls from it
- [x] 3.4 Tests: a model declaring `lighting` without a descriptor is rejected; the descriptor reaches the snapshot

## 4. Device session

- [x] 4.1 Implement a session that opens and holds a device's control endpoint, exchanges request/response pairs with a timeout, and correlates replies by content
- [x] 4.2 Implement the liveness gate as a single named function with the observed evidence recorded beside it: a version query whose payload collapses to zeros means unreachable
- [x] 4.3 Return an explicit unknown result — distinct from any value — when liveness fails
- [x] 4.4 Implement read-back verification for writes, reporting a write that does not read back as failed
- [x] 4.5 Treat a read/write error as a possible detach: end the session and hand back to discovery without raising a user-facing error
- [x] 4.6 Tests: liveness pass and fail, unknown-vs-off distinction, acknowledged-but-unapplied write reported as failed, unreachable write not sent

## 5. ASUS ROG codec

- [x] 5.1 Encode the lighting get (`12 03 <led>`) and volatile set (`51 28 <led> <pad> <mode> <bright> <r> <g> <b>`) commands on report id 3
- [x] 5.2 Decode replies using the response layout — identical field offsets to the request (see design.md); do not decode by diffing against the request buffer
- [x] 5.3 Recognise the `ff aa` error frame and surface it as unsupported-command
- [x] 5.4 Encode the onboard commit as a separate operation, issued only on explicit request
- [x] 5.5 Carry `mode` as an opaque byte; expose only the effects the descriptor declares
- [x] 5.6 Tests: encode/decode round-trip for the measured fixtures in design.md, error-frame decoding, and that no commit is emitted by a volatile set

## 6. Discovery integration

- [x] 6.1 Move `checkAccess` onto the control endpoint, keeping the existing detected-but-inaccessible reporting
- [x] 6.2 Have discovery reuse an open session's handle instead of opening its own, so a configuration session cannot cause a spurious access-denied flip
- [x] 6.3 Keep re-probing access so a permission fix during a run is still noticed
- [x] 6.4 Tests: access denied on the control endpoint but granted on the identify endpoint reports inaccessible; a refresh during an open session does not change access state

## 7. HTTP surface

- [x] 7.1 `GET /api/devices/:id/lighting` — descriptor plus current per-zone state, or an explicit unknown with a reason
- [x] 7.2 `PUT /api/devices/:id/lighting` — volatile apply, responding with the verified read-back
- [x] 7.3 `POST /api/devices/:id/lighting/commit` — onboard commit
- [x] 7.4 Map failures to distinct responses: unsupported, unreachable, access denied, not applied
- [x] 7.5 Tests: each route and each failure mode against `FakeHidPort`

## 8. Lighting interface

- [x] 8.1 Build the lighting section on the device detail route, rendered only when the device declares lighting and gated on its descriptor
- [x] 8.2 Populate controls from the device read; render the unknown state as unknown with its reason, never as unlit or as a default
- [x] 8.3 Zone selector (omitted when the descriptor declares one zone), colour control, brightness control, effect selector limited to declared effects
- [x] 8.4 Throttle live preview writes to a bounded rate rather than one per input event
- [x] 8.5 Explicit save action with an unsaved-changes indicator, and a statement that unsaved changes are lost on unplug
- [x] 8.6 On a failed apply, report it and revert the display to the last device-confirmed value
- [x] 8.7 Handle the device becoming unreachable mid-edit: state it and disable editing until it responds
- [x] 8.8 Tests: controls derive from the descriptor, unknown state renders distinctly from off, failed apply reverts

## 9. Verification on hardware

- [x] 9.1 Verify against the ASUS ROG Harpe II ACE over the dongle: read, live preview, commit, replug, confirm persistence
- [x] 9.2 Verify the dozing-mouse path: let the mouse sleep and confirm the interface reports unknown rather than showing zeros
- [x] 9.3 Confirm no onboard commit is issued by preview alone
- [x] 9.4 Update `README.md` if the udev guidance needs to name the vendor interface
