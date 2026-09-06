## Purpose

Defines what a user can see and change about a connected device's lighting, and the guarantees the interface makes about the values it shows — in particular that a displayed colour is one the device confirmed, not one Silver Launcher hoped it applied.

## Requirements

### Requirement: Lighting view is offered only where supported

A device's configuration view SHALL offer lighting only when that device declares lighting support, and the controls it offers SHALL be derived from that device's lighting descriptor.

#### Scenario: Device supports lighting

- **WHEN** a connected device declares lighting support
- **THEN** its configuration view offers a lighting section

#### Scenario: Device does not support lighting

- **WHEN** a connected device does not declare lighting support
- **THEN** no lighting section or lighting control is offered for it

#### Scenario: Controls follow the declared descriptor

- **WHEN** a device's lighting descriptor declares one zone
- **THEN** the interface presents one zone and offers no zone selection for zones the device does not have

#### Scenario: Unmeasured effects are not offered

- **WHEN** a device's lighting descriptor declares a set of effects
- **THEN** only those effects are selectable
- **AND** no effect outside the declared set is presented

### Requirement: Displayed values come from the device

The lighting interface SHALL display the values it read from the device. It SHALL NOT display a value that has not been confirmed by the device as that device's current state.

#### Scenario: Opening the lighting view

- **WHEN** a user opens the lighting view for a connected, reachable device
- **THEN** the controls are populated from the device's current lighting state

#### Scenario: State cannot be read

- **WHEN** a device's lighting state cannot be verified
- **THEN** the lighting view states that the current state is unknown and gives the reason
- **AND** it does not populate the controls with a default or previously seen value

#### Scenario: Unknown state is not shown as off

- **WHEN** a device's lighting state is unknown
- **THEN** the interface does not present the device as unlit

### Requirement: Live preview

Adjusting a lighting control SHALL change the device's lighting without requiring a separate action, and SHALL do so without writing to the device's onboard memory.

#### Scenario: Adjusting colour

- **WHEN** a user changes the colour for a zone
- **THEN** the device's lighting changes to that colour
- **AND** the change is not committed to the device's onboard memory

#### Scenario: Continuous adjustment

- **WHEN** a user drags a colour or brightness control continuously
- **THEN** the device is updated at a bounded rate rather than once per input event

### Requirement: Explicit save to the device

The lighting interface SHALL offer an explicit action to persist the current lighting to the device's onboard memory, and SHALL indicate whether there are changes not yet persisted.

#### Scenario: Saving to the device

- **WHEN** a user activates the save action
- **THEN** the current lighting is written to the device's onboard memory
- **AND** the interface confirms the settings are stored on the device

#### Scenario: Unsaved changes are visible

- **WHEN** lighting has been changed but not saved
- **THEN** the interface indicates that there are unsaved changes

#### Scenario: Leaving with unsaved changes

- **WHEN** a user leaves the lighting view with unsaved changes
- **THEN** the interface states that unsaved changes will be lost when the device is unplugged

### Requirement: Failures are reported honestly

When a lighting change cannot be applied, the interface SHALL say so and SHALL NOT show the requested value as the device's state.

#### Scenario: Change cannot be applied

- **WHEN** a lighting change is requested and the device does not confirm it
- **THEN** the interface reports that the change was not applied and gives the reason
- **AND** the displayed state reverts to the last value the device confirmed

#### Scenario: Device becomes unreachable mid-edit

- **WHEN** a device stops responding while its lighting view is open
- **THEN** the interface states that the device is not currently reachable
- **AND** further edits are unavailable until it responds again

#### Scenario: Save fails

- **WHEN** the save action is activated and the device does not confirm the commit
- **THEN** the interface reports that the settings were not stored on the device
- **AND** it continues to indicate unsaved changes
