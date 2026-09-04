## Purpose

Defines the home page: the first screen a user sees, giving one honest overview of every peripheral Silver Launcher knows about on this machine and the way into configuring any one of them.

## Requirements

### Requirement: Device overview

The home page SHALL present every known device as its own card. Each card SHALL show the device's display name, vendor, device kind, connection state, and connection path, and SHALL identify the device's active profile.

#### Scenario: Connected devices are listed

- **WHEN** the home page is opened with supported devices attached
- **THEN** each attached device appears as a card showing its name, vendor, kind, and a connected indication

#### Scenario: Known but unplugged devices are listed

- **WHEN** a previously seen device is not currently attached
- **THEN** its card is still shown, marked as disconnected, and visually distinguished from connected devices

#### Scenario: Connection path is shown

- **WHEN** a device is connected through a vendor wireless receiver rather than directly over USB
- **THEN** its card states that it is connected through the vendor dongle

#### Scenario: Devices are grouped by kind

- **WHEN** the home page shows both keyboards and mice
- **THEN** cards are grouped so that keyboards and mice are visually separated

### Requirement: Live reaction to plug and unplug

The home page SHALL update itself when a device is attached or removed, without the user reloading or taking any action.

#### Scenario: Device is plugged in while the home page is open

- **WHEN** a supported device is attached while the home page is displayed
- **THEN** its card appears (or its existing card changes to connected) within a few seconds

#### Scenario: Device is unplugged while the home page is open

- **WHEN** a connected device is removed while the home page is displayed
- **THEN** its card changes to the disconnected state in place
- **AND** no error dialog, toast, or warning styling is shown for the removal

### Requirement: Entry into device configuration

Each connected device's card SHALL offer a way to open that device's configuration view. A disconnected device SHALL NOT offer that entry.

#### Scenario: Opening a connected device

- **WHEN** a user activates the configure action on a connected device's card
- **THEN** the application navigates to that device's configuration route

#### Scenario: Disconnected device cannot be configured

- **WHEN** a device's card is in the disconnected state
- **THEN** its configure action is unavailable and the card states that the device must be connected

### Requirement: Only supported controls are surfaced

The home page SHALL derive every per-device action it offers from that device's declared capability set, and SHALL NOT present an action the device's protocol cannot back.

#### Scenario: Device without onboard profile slots

- **WHEN** a device's capability set declares no onboard profile storage
- **THEN** its card presents no onboard-slot control or indicator

#### Scenario: Device without macro support

- **WHEN** a device's capability set does not include macros
- **THEN** no macro-related action is offered for that device

### Requirement: Empty state

The home page SHALL show a purposeful empty state when it knows of no devices, naming the models Silver Launcher supports.

#### Scenario: No devices known or attached

- **WHEN** the home page is opened and no device is known or attached
- **THEN** an empty state explains that no supported device was found
- **AND** it names the supported models

#### Scenario: Empty state resolves on connection

- **WHEN** a supported device is attached while the empty state is displayed
- **THEN** the empty state is replaced by that device's card

### Requirement: Inaccessible and unavailable devices are explained

The home page SHALL distinguish a device it cannot access from a device that is absent, and SHALL tell the user what is wrong and what would fix it.

#### Scenario: Device detected but access is denied

- **WHEN** a device is reported as detected but inaccessible for permission reasons
- **THEN** its card states that Silver Launcher cannot access the device and gives the reason
- **AND** the card is not shown as a plain disconnected device

#### Scenario: Discovery is unavailable

- **WHEN** device discovery reports itself unavailable
- **THEN** the home page states that device detection is not working and gives the reported reason
- **AND** the page still renders its frame and any remembered devices

### Requirement: Home page loading state

The home page SHALL show a loading state until the first device snapshot arrives, and SHALL NOT present the empty state before it is known that there are no devices.

#### Scenario: First snapshot has not arrived

- **WHEN** the home page is opened and the first device snapshot has not yet been received
- **THEN** a loading state is shown instead of the empty state or a device list
