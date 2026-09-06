## MODIFIED Requirements

### Requirement: Supported-device registry

The system SHALL maintain a registry of supported device models. Each entry SHALL declare the model's display name, vendor, device kind (keyboard or mouse), the USB vendor and product identifiers that identify it, the connection paths it can appear over (direct USB or a vendor dongle), the set of configurable features its protocol supports, and — for each declared feature that requires it — a descriptor stating what that feature actually offers on that model.

Each way a model can be matched SHALL declare the role the matched interface serves: identifying the device, or carrying configuration commands to it.

#### Scenario: Registry covers the supported devices

- **WHEN** the registry is loaded
- **THEN** it contains entries for the Keychron M6 mouse, the ASUS ROG Harpe II ACE mouse, and the Lofree Hyzen keyboard
- **AND** no other model is reported as supported

#### Scenario: Capability set is declared per model, not assumed

- **WHEN** a device model's registry entry is read
- **THEN** each configurable feature (for example DPI stages, polling rate, key remapping, macros, lighting, onboard profile slots) is either declared as supported by that model or absent from its capability set
- **AND** a feature not declared for a model is treated as unsupported by that model

#### Scenario: A declared feature states its shape

- **WHEN** a model declares lighting support
- **THEN** its entry also declares the lighting zones that model has, the brightness range it accepts, and the effects it supports
- **AND** the interface derives the controls it offers from that declaration rather than from the feature flag alone

#### Scenario: Interface roles are declared

- **WHEN** a model's registry entry is read
- **THEN** each of its match rules states whether the interface it matches identifies the device or carries configuration commands

### Requirement: Discovery of attached devices

The system SHALL enumerate the machine's USB HID devices and match each against the registry by vendor and product identifier, producing the set of supported devices currently attached. A device that presents more than one interface SHALL be reported as a single device carrying an endpoint for each declared role, and matching SHALL NOT discard an interface of one role because a better match exists for another.

#### Scenario: A supported device is attached

- **WHEN** enumeration finds a HID device whose vendor and product identifiers match a registry entry
- **THEN** that device is reported as connected
- **AND** its reported state carries the model's display name, kind, capability set, and a stable identifier for the attached unit

#### Scenario: A device presents several interfaces

- **WHEN** a supported device presents both an interface used to identify it and a vendor interface used to configure it
- **THEN** both are retained on the reported device, each addressable by its role
- **AND** neither is discarded in favour of the other

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

### Requirement: Permission and access failures are reported, not hidden

When the operating system prevents the application from opening or enumerating a device it can otherwise identify, the system SHALL report that device as present but inaccessible, with the reason, rather than reporting it as absent. Access SHALL be judged against the endpoint used to configure the device, so that a device reported as accessible is one the application can actually configure.

#### Scenario: HID access is denied by the operating system

- **WHEN** a supported device is attached but the application cannot open its HID interface because access is denied
- **THEN** the device is reported as detected but inaccessible
- **AND** the reported state carries a reason identifying it as a permission problem

#### Scenario: Configuration interface is inaccessible while the input interface is not

- **WHEN** a supported device's identifying interface can be opened but its configuration interface cannot
- **THEN** the device is reported as detected but inaccessible, with the reason
- **AND** it is not reported as accessible on the strength of the identifying interface alone

#### Scenario: Access is regained without restarting

- **WHEN** the permission problem preventing access to a device is resolved while the application is running
- **THEN** the device is reported as accessible without requiring a restart

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

#### Scenario: Snapshots do not carry raw interface paths as device identity

- **WHEN** a device's state is exposed to the interface
- **THEN** the device is identified by its stable identifier rather than by the path of any one of its interfaces
