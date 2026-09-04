## Purpose

Defines how Silver Launcher finds the peripherals attached to the machine, decides which of them it supports, tracks their coming and going while the app is open, and reports each model's real capabilities to the rest of the application.

## ADDED Requirements

### Requirement: Supported-device registry

The system SHALL maintain a registry of supported device models. Each entry SHALL declare the model's display name, vendor, device kind (keyboard or mouse), the USB vendor and product identifiers that identify it, the connection paths it can appear over (direct USB or a vendor dongle), and the set of configurable features its protocol supports.

#### Scenario: Registry covers the supported devices

- **WHEN** the registry is loaded
- **THEN** it contains entries for the Keychron M6 mouse, the ASUS ROG Harpe II ACE mouse, and the Lofree Hyzen keyboard
- **AND** no other model is reported as supported

#### Scenario: Capability set is declared per model, not assumed

- **WHEN** a device model's registry entry is read
- **THEN** each configurable feature (for example DPI stages, polling rate, key remapping, macros, lighting, onboard profile slots) is either declared as supported by that model or absent from its capability set
- **AND** a feature not declared for a model is treated as unsupported by that model

### Requirement: Discovery of attached devices

The system SHALL enumerate the machine's USB HID devices and match each against the registry by vendor and product identifier, producing the set of supported devices currently attached.

#### Scenario: A supported device is attached

- **WHEN** enumeration finds a HID device whose vendor and product identifiers match a registry entry
- **THEN** that device is reported as connected
- **AND** its reported state carries the model's display name, kind, capability set, and a stable identifier for the attached unit

#### Scenario: An unsupported device is attached

- **WHEN** enumeration finds a HID device that matches no registry entry
- **THEN** that device is not reported to the interface as a Silver Launcher device

#### Scenario: A device is reachable over a vendor dongle

- **WHEN** a supported device is matched through its vendor's wireless receiver rather than a direct USB connection
- **THEN** the device is reported as connected
- **AND** its reported state names the connection path as the vendor dongle

#### Scenario: Two units of the same model are attached

- **WHEN** two devices matching the same registry entry are attached at once
- **THEN** each is reported as a separate connected device with its own stable identifier

### Requirement: Live presence tracking

The system SHALL keep device presence current for as long as the application is running, detecting attachment and removal without requiring the user to refresh or restart.

#### Scenario: Device is plugged in while the app is open

- **WHEN** a supported device is attached after the application has started
- **THEN** the device is reported as connected within a few seconds
- **AND** the interface reflects the new device without a page reload

#### Scenario: Device is unplugged while the app is open

- **WHEN** a connected device is removed
- **THEN** the device is reported as disconnected
- **AND** the removal is treated as an ordinary state, not an error

#### Scenario: Device is reconnected

- **WHEN** a device that was removed is attached again
- **THEN** it is reported as connected and is recognized as the same known device rather than as an additional one

### Requirement: Known devices persist across sessions

The system SHALL remember supported devices it has previously seen on this machine, so a device the user owns remains visible while unplugged.

#### Scenario: Previously seen device is not attached at startup

- **WHEN** the application starts and a previously seen supported device is not attached
- **THEN** the device is reported as known and disconnected

#### Scenario: First run with no devices attached

- **WHEN** the application starts on a machine with no supported device attached and no remembered devices
- **THEN** the reported device set is empty and this is not an error

### Requirement: Permission and access failures are reported, not hidden

When the operating system prevents the application from opening or enumerating a device it can otherwise identify, the system SHALL report that device as present but inaccessible, with the reason, rather than reporting it as absent.

#### Scenario: HID access is denied by the operating system

- **WHEN** a supported device is attached but the application cannot open its HID interface because access is denied
- **THEN** the device is reported as detected but inaccessible
- **AND** the reported state carries a reason identifying it as a permission problem

#### Scenario: Discovery backend is unavailable

- **WHEN** the underlying HID access mechanism cannot be initialized at all
- **THEN** the system reports a discovery-unavailable condition with the reason
- **AND** the application continues to run and serve the interface

### Requirement: Device state is exposed to the interface

The system SHALL expose current device state to the interface both as a full snapshot on request and as a live stream of subsequent changes.

#### Scenario: Interface requests the current snapshot

- **WHEN** the interface requests device state
- **THEN** it receives every known device with its connection state, model information, capability set, connection path, and active profile

#### Scenario: Interface subscribes to changes

- **WHEN** the interface holds an open subscription and a device's connection state changes
- **THEN** an update describing the change is delivered over that subscription

#### Scenario: Subscription is interrupted

- **WHEN** an open subscription is dropped
- **THEN** the interface can re-subscribe and receive a fresh full snapshot as its first update
