## Purpose

Defines how Silver Launcher runs as a local application: a single process that serves the user interface and the device API on the user's own machine, with no account layer, no outbound network calls, and a predictable startup and shutdown story.

## ADDED Requirements

### Requirement: Single local process serves UI and API

Silver Launcher SHALL run as one local process that serves both the user interface and the device API. The process SHALL bind only to a loopback address and SHALL NOT accept connections from other machines.

#### Scenario: Launching the application

- **WHEN** the application is started
- **THEN** a local HTTP server is listening on a loopback address
- **AND** requesting the root path returns the Silver Launcher user interface

#### Scenario: Remote access is refused

- **WHEN** a request arrives at the server from a non-loopback network interface
- **THEN** the connection is not served

#### Scenario: The chosen port is already in use

- **WHEN** the application starts and its preferred port is occupied
- **THEN** the application selects another free loopback port and reports the address it is serving on
- **AND** startup does not fail

### Requirement: No accounts, no telemetry, no outbound calls

The application SHALL operate entirely offline. It SHALL NOT prompt for a sign-in, transmit usage data, or require an outbound network connection for any feature.

#### Scenario: Running with no internet connection

- **WHEN** the machine has no network route to the internet
- **THEN** every feature of the application behaves identically to running with a connection

#### Scenario: No sign-in surface exists

- **WHEN** a user opens any screen of the application
- **THEN** no sign-in, registration, or account prompt is presented

### Requirement: Application layout and navigation

The interface SHALL present a persistent application frame around routed content, and SHALL provide addressable routes for the home page and for an individual device.

#### Scenario: Home is the default route

- **WHEN** a user opens the application's root address
- **THEN** the home page is displayed

#### Scenario: Navigating to a device and back

- **WHEN** a user opens a device from the home page and then navigates back
- **THEN** the home page is displayed again with current device state
- **AND** the browser's back and forward controls move between the two views

#### Scenario: Unknown route

- **WHEN** a user opens a route that does not correspond to a known view
- **THEN** the application displays a not-found view with a way back to the home page
- **AND** the application does not crash or show a blank screen

### Requirement: Interface remains usable while the server is unreachable

The interface SHALL detect loss of contact with the local server, tell the user what is wrong, and recover without a manual reload once contact is restored.

#### Scenario: Server becomes unreachable

- **WHEN** the interface loses its connection to the local server
- **THEN** a visible notice states that the application has lost contact with its local service
- **AND** device state is shown as stale rather than as devices being disconnected

#### Scenario: Server contact is restored

- **WHEN** the local server becomes reachable again
- **THEN** the interface reconnects on its own and refreshes device state
- **AND** the notice is removed
