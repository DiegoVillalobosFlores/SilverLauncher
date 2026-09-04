## Purpose

Defines Silver Launcher's local profile store and the home-level profile actions over it: keeping each device's configuration as a file on the user's machine, and letting the user import a profile, export one, and mirror one device's profile onto other devices that can accept it.

## Requirements

### Requirement: Profiles are stored as local files

The system SHALL store profiles as files under the user's own configuration directory on the local machine. It SHALL NOT transmit profiles anywhere.

#### Scenario: A profile is saved

- **WHEN** a profile is created or changed
- **THEN** it is written to a file under the user's configuration directory
- **AND** no network request is made

#### Scenario: Profiles survive a restart

- **WHEN** the application is closed and started again
- **THEN** every previously stored profile is available, associated with the same device model

#### Scenario: Storage directory does not exist

- **WHEN** the application starts and its profile directory is missing
- **THEN** the directory is created and the profile library is reported as empty

#### Scenario: A stored profile file is unreadable or malformed

- **WHEN** a file in the profile directory cannot be read or does not match the expected format
- **THEN** that profile is reported as invalid with its filename and reason
- **AND** the remaining profiles still load

### Requirement: Profile identity and active profile

Each profile SHALL carry a user-visible name and the device model it belongs to. Each known device SHALL have exactly one active profile at a time.

#### Scenario: A device has no profile yet

- **WHEN** a device becomes known and no profile exists for its model
- **THEN** a default profile is created for it and set as active

#### Scenario: Active profile is reported

- **WHEN** device state is requested
- **THEN** each device carries the name of its active profile

### Requirement: Export a profile

The home page SHALL let the user export a device's profile as a single file they choose the destination for.

#### Scenario: Exporting a profile

- **WHEN** a user exports a device's profile
- **THEN** a single file containing that profile is produced
- **AND** the file records the device model the profile belongs to and the profile's name

#### Scenario: Export of a device with no profile

- **WHEN** a user attempts to export a profile for a device that has none
- **THEN** the export action is unavailable for that device

### Requirement: Import a profile

The home page SHALL let the user import a profile file, validating it before it is added to the library.

#### Scenario: Importing a valid profile

- **WHEN** a user imports a file containing a valid profile for a known device model
- **THEN** the profile is added to the library for that model and the user is told it was imported

#### Scenario: Importing a profile for an unsupported model

- **WHEN** an imported profile names a device model Silver Launcher does not support
- **THEN** the import is rejected with a message naming the model
- **AND** the library is unchanged

#### Scenario: Importing a malformed file

- **WHEN** an imported file is not a valid profile
- **THEN** the import is rejected with a message explaining why
- **AND** the library is unchanged

#### Scenario: Imported profile name collides with an existing one

- **WHEN** an imported profile's name already exists for that model
- **THEN** the user is asked whether to replace the existing profile or keep both
- **AND** neither profile is silently overwritten

### Requirement: Mirror a profile across devices

The home page SHALL let the user copy one device's profile onto other devices, applying only the parts the destination device's capability set supports.

#### Scenario: Choosing mirror targets

- **WHEN** a user starts a mirror from a source device
- **THEN** the user is offered the other known devices as possible targets

#### Scenario: Target supports only part of the source profile

- **WHEN** a mirror target's capability set does not include every feature present in the source profile
- **THEN** only the supported parts are applied
- **AND** the user is told, before confirming, which parts will not be carried over

#### Scenario: Target shares no features with the source

- **WHEN** a candidate target's capability set shares no configurable feature with the source profile
- **THEN** that device is not offered as a mirror target, and the reason is stated

#### Scenario: Mirror overwrites a target's active profile

- **WHEN** a mirror would replace the contents of a target device's active profile
- **THEN** the user is asked to confirm before anything is written

#### Scenario: Mirroring to a disconnected device

- **WHEN** a mirror target is a known device that is not currently connected
- **THEN** the profile is stored for that device
- **AND** the user is told the change will reach the hardware when the device next connects
