## Purpose

Defines how Silver Launcher talks to a device rather than merely detecting one: which endpoint carries commands, how a reply is matched to its request, when a reply may be trusted, and how failure is reported instead of guessed at.

## Requirements

### Requirement: Control endpoint addressing

A supported device SHALL resolve to a control endpoint distinct from the endpoint used to identify it. Commands SHALL be sent only to the control endpoint. When no control endpoint resolves for a device, Silver Launcher SHALL report the device as not configurable and SHALL NOT fall back to another endpoint.

#### Scenario: Device exposes several interfaces

- **WHEN** a supported device presents both an input interface and a vendor interface
- **THEN** the vendor interface is retained as the device's control endpoint
- **AND** it is not discarded in favour of the more specifically matched input interface

#### Scenario: Multiple collections share one path

- **WHEN** the HID backend reports several top-level collections that share a single device path
- **THEN** they are treated as endpoints of the same physical device rather than as separate devices

#### Scenario: No control endpoint is present

- **WHEN** a device is identified but exposes no endpoint declared as its control endpoint
- **THEN** the device is reported as detected and not configurable, with the reason stated
- **AND** no command is sent to any other endpoint of that device

### Requirement: Request and response exchange

The protocol layer SHALL exchange messages with a device as request/response pairs, matching each reply to its request by content rather than by arrival order, and SHALL apply a timeout to every exchange.

#### Scenario: Replies are matched by content

- **WHEN** several queries are issued to a device in succession
- **THEN** each reply is attributed to the request it answers
- **AND** attribution does not depend on the order in which requests were issued

#### Scenario: A device does not reply

- **WHEN** a request is sent and no reply arrives within the timeout
- **THEN** the exchange is reported as failed with a timeout reason
- **AND** no value is reported for the requested setting

### Requirement: Explicit protocol errors are distinguished from silence

The protocol layer SHALL recognise a device's explicit rejection of a command and SHALL report it distinctly from a timeout and from a successful reply. A rejection alone does not say whether the model lacks the feature or the device is not currently answering for itself; what the registry declares for that model SHALL decide which of the two is reported.

#### Scenario: Device rejects a command its model does not declare

- **WHEN** a device replies with its protocol's error frame to a command for a feature its model does not declare
- **THEN** the command is reported as unsupported by that device
- **AND** the reply is not decoded as a settings value

#### Scenario: Device rejects a command its model declares

- **WHEN** a device replies with its protocol's error frame to a command for a feature its model does declare
- **THEN** the rejection is reported as a refusal by a device that is not answering for itself
- **AND** it is reported distinctly from a timeout, from a value, and from a feature the model lacks
- **AND** the reply is not decoded as a settings value
- **AND** the setting it asked about is reported as unknown

### Requirement: Liveness gating of reported values

Silver Launcher SHALL verify that a device is reachable before reporting any value read from it. A value obtained while liveness cannot be established SHALL be reported as unknown. Silver Launcher SHALL NOT present an unverified reading as a device setting, and SHALL NOT substitute a default in its place.

#### Scenario: Device is reachable

- **WHEN** a liveness check succeeds before a read
- **THEN** the value read is reported as the device's current setting

#### Scenario: Wireless device is asleep or absent

- **WHEN** a device behind a wireless receiver is not reachable and the receiver replies on its behalf with well-formed data
- **THEN** the liveness check fails
- **AND** the device's settings are reported as unknown rather than as the returned values

#### Scenario: Reported state distinguishes unknown from off

- **WHEN** a device's setting cannot be verified
- **THEN** the reported state is distinguishable from a setting the device genuinely holds at a zero or disabled value

### Requirement: Writes are verified, not assumed

A write to a device SHALL be confirmed by reading the value back. A write whose read-back does not reflect the requested value SHALL be reported as failed.

#### Scenario: Write is accepted and applied

- **WHEN** a setting is written and the subsequent read returns the written value
- **THEN** the write is reported as succeeded

#### Scenario: Write is acknowledged but not applied

- **WHEN** a device acknowledges a write but the subsequent read does not reflect it
- **THEN** the write is reported as failed
- **AND** the interface does not show the requested value as the device's state

#### Scenario: Write is attempted while the device is unreachable

- **WHEN** a write is requested and the liveness check fails
- **THEN** the write is not sent and is reported as failed with an unreachable reason

### Requirement: Volatile changes are separate from onboard commits

The protocol layer SHALL expose applying a setting to a device's working state and committing settings to the device's onboard memory as separate operations. A commit SHALL occur only on explicit request.

#### Scenario: Setting is applied without committing

- **WHEN** a setting is applied as a volatile change
- **THEN** the device reflects it immediately
- **AND** nothing is written to the device's onboard memory

#### Scenario: Repeated adjustment does not reach onboard memory

- **WHEN** a user makes many rapid adjustments to a setting
- **THEN** no onboard commit is performed for those adjustments

#### Scenario: Volatile changes are discarded on reconnect

- **WHEN** a device carrying uncommitted volatile changes is disconnected and reattached
- **THEN** the device reports the settings held in its onboard memory

### Requirement: Sessions do not interfere with discovery

Holding a device open for configuration SHALL NOT cause discovery to report that device as inaccessible or disconnected.

#### Scenario: Discovery runs during a configuration session

- **WHEN** a device is held open for configuration and a discovery refresh occurs
- **THEN** the device continues to be reported as connected with its existing access state
- **AND** no access-denied state is reported as a result of the refresh

#### Scenario: Device is removed during a session

- **WHEN** a device is unplugged while held open for configuration
- **THEN** the session ends and the device is reported as disconnected
- **AND** no error dialog, toast, or warning styling is shown for the removal
