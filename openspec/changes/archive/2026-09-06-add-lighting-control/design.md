## Context

See proposal.md — Why. This section records what was measured on real hardware, because the design is a consequence of it rather than of assumption. Every claim below was observed on an ASUS ROG Harpe II ACE connected through a ROG SPEEDNOVA 8K receiver (`0b05:1ad0`, serial `2E18D14D84BA8B52`) on Linux, via `node-hid`.

### The device exposes four interfaces, and only one is bidirectional

```
if=0  /dev/hidraw4   usage 0x0001/0x0006   keyboard               in
if=1  /dev/hidraw5   usage 0x0001/0x0002   mouse input            in
if=2  /dev/hidraw6   usage 0xff02/0x0001   vendor, report id 1    in + OUT
      /dev/hidraw6   usage 0xff00/0x0001   vendor, report id 2    in + OUT
      /dev/hidraw6   usage 0xff01/0x0001   vendor, report id 3    in + OUT
if=3  /dev/hidraw7   0x000c + 0xffc0/c1/c2 consumer + status      in only
```

Decoded from the raw report descriptor, each vendor collection on `hidraw6` declares an Input **and** an Output report of 63 bytes (`95 3f`, `81 02` / `91 02`), giving 64-byte packets once the report id is prefixed. `hidraw7`'s vendor collections declare Input only.

A four-second passive listen confirmed the split in behaviour: `hidraw6` emitted nothing unsolicited, while `hidraw7` streamed 20-byte status frames under report id `0x05` (`05 12 01 00 00 02 …`, cycling) while the mouse was active. `hidraw6` is a request/response channel; `hidraw7` is a notification channel.

### `node-hid` enumerates one entry per top-level collection

All three `hidraw6` collections appear as separate enumeration entries sharing one path, differing only by usage page (`0xff02`, `0xff00`, `0xff01`). This is what the current matcher trips over.

### The report id selects a target, not a message format

| report id | `12 00` (version) | `12 03 00` (get lighting) |
|---|---|---|
| 1 | short reply | no reply |
| 2 | short reply | replies, echoes the requested led index | 
| 3 | long reply (`… 00 05 07 00 04 ff ff 17 …`) | replies, always echoes led index `0` |

Report id 3 reaches the mouse. Report id 2 appears to address the receiver itself. Report id 1 answers only the version query.

### Lighting is readable, and reads reflect writes

Request and response share one field layout, at identical byte offsets:

```
REQUEST   [rpt] 51 28 <led> <pad> <mode> <bright> <r> <g> <b>
RESPONSE  [rpt] 12 03 <led> <pad> <mode> <bright> <r> <g> <b>
index       0    1  2    3     4     5      6      7   8   9
```

Measured round-trips, each read back exactly as written and each visibly confirmed on the hardware:

```
set  51 28 00 00 | 00 04 ff 00 00   →  get returns mode=0 bright=4 rgb=ff0000
set  51 28 00 00 | 00 04 00 00 ff   →  get returns mode=0 bright=4 rgb=0000ff
set  51 28 00 00 | 00 00 00 ff 00   →  get returns mode=0 bright=0 rgb=00ff00
```

Replies correlate to their request by content, not by arrival order: querying led indices ascending and then descending returned the same answer per index in both directions. The device's factory-fresh state on this unit was `mode=0 bright=0 rgb=00ff00`.

Only led index 0 is real. Indices 1 and 2 return a constant `mode=2 bright=50 rgb=000000`, and index 3 returns `mode=255 bright=240` — out-of-range values, not a fourth zone.

### A sleeping mouse refuses, and its refusal is not a statement about firmware

Measured during implementation, on the same unit, by reading every 15 seconds
while the mouse was left untouched:

```
  0s - 90s   ok       bright=4 rgb=0000ff     awake
105s - 195s  ff aa    refused                 asleep (LED off)
210s +       ok       bright=4 rgb=0000ff     woken by movement
```

Two things follow. The mouse sleeps after roughly 90 seconds of idleness on
this unit. And through that whole window the **version query kept answering
with a live payload** while the lighting query was refused — so the liveness
gate below does not catch a sleeping mouse, only a dozing one.

The `ff aa` refusal is therefore ambiguous on its own: it means "this model
does not implement this command" for an unimplemented command, and "the device
is not answering for itself" for a command the model does implement. The
registry is what separates those two, since it already states which features a
model has. A refusal of a declared feature is reported as a refusal — distinct
from a timeout, from a value, and from an unsupported feature — and never as
the model lacking lighting.

### The protocol has an explicit error frame

`12 02` — a command this model does not implement — returns `ff aa` in the reply's command position. Unsupported is therefore distinguishable from unanswered.

### A sleeping mouse produces well-formed false data

This is the most consequential finding. The identical query returned three different things depending on the mouse's power state:

```
mouse awake     12 03 00 | 00 00 00 ff 00      true state
mouse dozing    12 03 00 | 00 00 00 00 00      well-formed zeros; writes accepted and discarded
mouse asleep    ff aa                          explicit NAK
```

The middle case is correctly framed, plausible, and wrong. It is indistinguishable from a legitimately unlit zone. Writes issued in that window were acknowledged and had no effect.

The version query degrades first and more visibly: its long payload collapses to all zeros while the LED query is still returning plausible values. That asymmetry is the available liveness oracle.

## Goals / Non-Goals

**Goals:**

- A transport that can carry any vendor's request/response protocol, with the ASUS codec as its first implementation and its proof.
- A device session that never reports a value it cannot vouch for.
- Endpoint addressing that survives a device exposing several collections on one path.
- A lighting UI whose displayed values come from the device.

**Non-Goals:**

- A general protocol description language. Codecs are hand-written TypeScript per vendor; there are three devices, not thirty.
- Decoding effect modes beyond what has been measured. `mode` is carried through as an opaque byte until a sweep establishes its range.
- Modelling the receiver (report id 2) as a configurable device of its own.
- Persisting lighting into profile files. That belongs with the profile format decision, still open in PRODUCT.md.

## Decisions

### A matched device resolves to role-addressed endpoints, not one path

Today `matchDevices` scores matches by specificity and `preferredPairs` drops every zero-score descriptor once a higher-scoring one exists for the same vendor/product pair. For the Harpe II ACE that keeps `hidraw5` (the mouse input collection) and discards all three `hidraw6` vendor collections. `DeviceState.path` is therefore the movement interface, and lighting commands sent there cannot work.

Registry matches gain an explicit `role: "identify" | "control"`, and a logical device carries an endpoint per role. Scoring continues to choose the best match *within* a role rather than across all of them.

*Alternative considered:* probe collections at session-open time to find one that answers a handshake. Rejected as the primary mechanism — it means writing to unidentified endpoints on unknown hardware to find out what they are, which is exactly the operation that should require the most certainty. The registry already knows the answer; it should state it.

### The control endpoint is addressed by usage page, with report id carried separately

Selecting `hidraw6` means matching usage page `0xff02` (the first top-level collection, and the usage `node-hid` reports for the path). Choosing *which* subsystem to talk to is then the report id — 3 for the mouse — carried as protocol data in the codec, not as part of endpoint identity. Conflating them would make the registry describe message routing, which is the codec's job.

*Risk noted:* which top-level collection `node-hid` reports for a multi-collection path is a hidapi behaviour, not a guarantee. See Risks.

### Every read is gated on liveness, and unverified reads are `unknown`, not zero

The session issues the version query and treats a collapsed payload as "device not reachable". Only when liveness passes does a lighting read become a reported value. A failed gate produces an explicit unknown state that the API and UI must render as unknown — never as a plausible default.

*Alternative considered:* trust the `ff aa` NAK alone. Insufficient — the dangerous state does not NAK. NAK is a genuine but partial signal, and the dozing case is precisely the one it misses.

*Alternative considered:* use the `hidraw7` status stream as the awake signal. Attractive, and worth revisiting, but it requires holding a second endpoint open and interpreting an as-yet-undecoded frame. The version query is one round-trip on an endpoint already open.

### Volatile set and onboard commit are two separate operations

The set command takes effect immediately and does not persist; a replug restores the previous state. Persisting is a distinct command (`50 03` in this protocol family, deliberately never sent during probing). The session exposes them as separate operations, and the UI binds live editing to the volatile one and an explicit commit to the other. Colour-picker drags must never reach flash.

*Alternative considered:* debounce and commit automatically. Rejected for this change — flash has finite write cycles and the failure is silent and permanent. An explicit commit can be softened later; a worn-out mouse cannot.

### Access is judged on the control endpoint

`checkAccess` currently opens the identify endpoint. That answers a question nobody asked. It moves to the control endpoint, so `access: "granted"` means the device is actually configurable. Access and liveness stay separate facts: a device can be openable and asleep.

### Discovery must not fight an open session

`performRefresh` runs every second and opens then closes the device to check access. A held-open lighting session would collide with that, and on platforms with exclusive HID access the loser surfaces as the device flipping to `access: "denied"` once per second for no user-visible cause. Discovery asks the session layer for an existing handle when one is open, and only opens its own when none is.

*Alternative considered:* cache the access result and stop re-probing. Simpler, but it would stop noticing a permission change (the udev rule being installed while the app runs), which the README treats as a supported recovery path.

### The lighting descriptor is separate from the capability flag

`capabilities: Set<Feature>` keeps answering "is there a lighting screen". A separate per-model lighting descriptor answers "what is on it": zone count and names, brightness range, and the effect list. Measured facts go in it — for the Harpe II ACE, exactly one zone.

*Alternative considered:* make capabilities structured objects. More honest in the abstract, but it rewrites the discovery and persistence surface for one feature's benefit before the other two devices' protocols are known.

## Risks / Trade-offs

- **hidapi may report a different top-level collection for a multi-collection path on another platform or version** → Match the control endpoint by any of the device's known vendor usage pages rather than exactly one, and fail with a named error when no control endpoint resolves, rather than silently falling back to the identify endpoint.
- **The liveness oracle is empirical, not documented** → A version payload that collapses to zeros is a strong signal here, but it is one unit on one firmware. Keep the gate in one function with the observed evidence recorded next to it, so a device that behaves differently is a change in one place.
- **Writes during the dozing window are accepted and lost** → After a volatile write, read back and compare. A write that does not read back is reported as failed rather than assumed applied. This costs one round-trip per write and is why preview writes are throttled rather than sent per frame.
- **The `mode` byte's range is unmeasured** → Carry it as an opaque value and expose only the modes the descriptor declares. Do not offer an effect picker whose values have never been observed to do anything.
- **Only one unit of one model was probed** → Nothing here generalises to the Keychron M6 or Lofree Hyzen, and this change does not claim it does. The transport is shared; every codec is earned separately.
- **Held-open handles change the unplug story** → A device removed mid-session invalidates an open handle. The session must treat a read/write error as a possible detach and hand back to discovery rather than surfacing an error dialog, since PRODUCT.md treats unplugging as ordinary.

## Open Questions

- Does the receiver (report id 2) have a controllable LED of its own, or is its lighting reply a stub? It answered every led index with identical data, which suggests a stub. Answering this does not change the transport, the specs, or the task breakdown — it would only add a zone.
- What the `hidraw7` status frames encode. Useful later as a cheaper liveness signal or a battery indicator; not needed for this change.
