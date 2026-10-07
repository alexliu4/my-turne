# Jules Implementation Plan: Nocturne + Optional Wireless Windows Companion

## Project Goal

Extend the existing Nocturne fork so Spotify Car Thing keeps Nocturne's current strengths while gaining optional Windows-computer integrations.

The key requirement is:

> Car Thing must remain useful without a USB data cable and without the Windows PC.

The Windows PC is an optional capability provider over the local network, not the primary runtime for the Car Thing.

Do **not** turn the project into a DeskThing clone or thin client.

---

# Architectural Rules

These rules are non-negotiable.

## 1. Preserve Nocturne as the foundation

Keep Nocturne's existing:

- Spotify functionality
- phone / Bluetooth behavior
- Wi-Fi / connector behavior
- device-side UI
- daemon architecture
- no-data-USB operation

Avoid modifying core Spotify behavior unless required for integration.

## 2. No required USB data cable

All new host integrations must work over the local network.

Target connection:

```text
Car Thing <-> LAN / Wi-Fi <-> Windows Companion
```

USB may still be used for development, flashing, debugging, or recovery, but it must not be required for normal operation.

## 3. Windows host is optional

If Windows is offline, the Car Thing must continue to support:

- Spotify
- device navigation
- local settings
- clock / timer
- local apps
- internet-backed apps that do not depend on Windows

Windows-specific apps should gracefully show an offline state.

## 4. Keep Mac mini and Windows responsibilities separate

The Mac mini can continue running Nocturne Connector because it is always on.

Do not route Windows integrations through the Mac mini unless technically necessary.

Preferred:

```text
Car Thing <-> Windows PC
```

Not:

```text
Car Thing -> Mac mini -> Windows PC
```

## 5. Do not build an app marketplace or plugin SDK yet

Initial apps should be compiled into the Nocturne fork.

Do not build:

- app store
- plugin sandbox
- dependency manager
- third-party app installer
- app package format
- marketplace backend

Those may come later after the core architecture is stable.

---

# Target Architecture

```text
                     INTERNET
                        |
                +-------v--------+
                |    Mac mini    |
                |                |
                | Nocturne       |
                | Connector      |
                | Always on      |
                +-------+--------+
                        |
                     network
                        |
                +-------v--------+
                |   Car Thing    |
                |                |
                | Spotify        |
                | Weather        |
                | Clock / Timer  |
                | Apps           |
                +-------+--------+
                        |
                        | LAN / WebSocket
                        |
                +-------v--------+
                |  Windows PC    |
                |                |
                | Companion Host |
                |                |
                | Discord        |
                | PC media       |
                | Volume         |
                | PC stats       |
                | Macros         |
                | Gaming info    |
                +----------------+
```

---

# Repository Direction

Prefer keeping everything in the existing Nocturne fork initially.

Suggested structure:

```text
nocturne/
├── packages/
│   ├── ui/
│   └── shared/
│       └── protocol/
│
├── host/
│   └── windows/
│       ├── transport/
│       ├── media/
│       ├── volume/
│       ├── discord/
│       ├── stats/
│       ├── macros/
│       └── app/
│
└── existing Nocturne code
```

If the current repo conventions suggest a better location, follow the existing conventions instead of forcing this exact structure.

---

# Sprint 0 — Repository Reconnaissance

## Goal

Understand the Nocturne codebase before making architectural changes.

## Tasks

1. Identify:
   - current UI entrypoint
   - navigation / screen state system
   - daemon entrypoint
   - current WebSocket or IPC layer
   - current message types
   - input handling for buttons and knob
   - where device settings are stored
   - how Nocturne determines network state
   - how Connector interacts with the device

2. Document which existing abstractions should be reused.

3. Identify the smallest safe extension points for:
   - new Apps screen
   - host connection state
   - host message handling

## Output

Create:

```text
docs/windows-companion-code-map.md
```

Include:

- relevant file paths
- responsibilities
- proposed extension points
- risks
- files that should remain untouched

## Acceptance Criteria

No functional changes yet.

---

# Sprint 1 — Shared Host Protocol

## Goal

Define a stable protocol before implementing features.

## Requirements

Create shared types for:

```ts
type HostCapability =
  | "media"
  | "volume"
  | "discord"
  | "systemStats"
  | "macros"
  | "appLaunch"
```

Create message types such as:

```ts
type HostHello = {
  type: "host.hello"
  protocolVersion: 1
  hostName: string
  capabilities: HostCapability[]
}
```

```ts
type HostStatus = {
  type: "host.status"
  connected: boolean
}
```

```ts
type HostAction = {
  type: "host.action"
  requestId: string
  action: string
  payload?: unknown
}
```

```ts
type HostActionResult = {
  type: "host.actionResult"
  requestId: string
  success: boolean
  payload?: unknown
  error?: string
}
```

## Important

Keep protocol versioned from the beginning.

Do not couple transport logic directly to UI components.

## Acceptance Criteria

- shared message definitions exist
- UI and Windows host can both import or generate from the same definitions
- malformed messages fail safely
- unknown message types do not crash either side

---

# Sprint 2 - Minimal Windows Companion + Wireless Connection

## Goal

Prove Car Thing can connect to Windows over LAN without USB.

## Windows Companion

Create a lightweight background process.

For now, it may be a simple console application.

Requirements:

- [x] starts a WebSocket server on the Windows PC
- [x] sends `host.hello`
- [x] exposes connection status
- [x] logs connect/disconnect events
- [x] validates protocol version 1 and closes mismatches
- [x] uses a configurable port
- [x] defaults to loopback and requires a token for any non-loopback bind

## Car Thing / Nocturne side

Add:

- [x] HostBridge service
- [x] connection state
- [x] reconnect with backoff
- [x] capability state
- [x] heartbeat / timeout
- [x] offline handling

## Security

Do not expose an unauthenticated control endpoint broadly.

For the MVP, use at minimum:

- [x] explicit LAN interface binding with authentication
- [x] explicit configured host address
- [x] shared pairing token or equivalent lightweight authentication

Avoid designing a full account system.

## Acceptance Criteria

Without USB data:

1. [ ] Car Thing connects to Windows over LAN
2. [ ] Windows companion reports capabilities
3. [ ] Car Thing detects Windows online/offline state
4. [ ] Disconnecting Windows does not break Spotify or Nocturne
5. [ ] Reconnecting Windows restores host availability automatically

These acceptance criteria still require a Car Thing to Windows smoke test without USB data.
The companion advertises an empty capability list until a host feature is implemented.

For a LAN test, bind the companion to the Windows PC's LAN address with
`NOCTURNE_HOST=<windows-lan-ip>` and `NOCTURNE_AUTH_TOKEN=<shared-token>`.
Build the Car Thing UI with `VITE_WINDOWS_HOST_URL=ws://<windows-lan-ip>:8893`
and `VITE_WINDOWS_TOKEN=<same-token>`. Without a configured URL, HostBridge
stays inactive. The token is included in the device UI bundle and should be
used only on a trusted LAN for this MVP.

---

# Sprint 3 — Host Status UI

## Goal

Make host state visible without adding real host features yet.

## UI

Add a small internal host state model:

```ts
{
  connected: boolean
  hostName?: string
  capabilities: HostCapability[]
}
```

Create a basic host status screen or settings panel.

Display:

```text
Windows PC
Connected

Capabilities
Media       Available
Volume      Available
Discord     Available
```

Offline:

```text
Windows PC
Offline
```

## Acceptance Criteria

UI updates in real time when Windows connects/disconnects.

No host-dependent app should crash while offline.

---

# Sprint 4 — Windows Volume Control

## Goal

Implement the first real host feature.

## Windows side

Add:

- get current master volume
- set master volume
- adjust volume up/down
- mute/unmute
- report volume changes back to Car Thing

Use native Windows APIs where practical.

## Nocturne side

Add host actions:

```text
volume.get
volume.set
volume.adjust
volume.toggleMute
```

Add state event:

```text
volume.state
```

## Hardware mapping

Do not globally replace Nocturne's existing knob behavior yet.

Add a test path from a UI control first.

## Acceptance Criteria

From Car Thing over LAN:

- display Windows volume
- increase/decrease volume
- toggle mute
- receive updated state

No USB data cable required.

---

# Sprint 5 — Windows Media Integration

## Goal

Expose current Windows media session.

## Windows side

Use Windows media session APIs to retrieve:

- source app
- title
- artist
- album
- playback state
- artwork if available
- progress if available

Support actions:

- play/pause
- next
- previous

## Car Thing UI

Create a built-in app:

```text
Windows Media
```

This is separate from Nocturne Spotify.

Do not replace or modify Spotify Now Playing.

## Offline State

```text
Windows Media

PC unavailable
```

## Acceptance Criteria

Works with at least:

- browser media
- a Windows music player
- Spotify desktop if exposed through Windows media session APIs

---

# Sprint 6 — Apps Screen

## Goal

Introduce a clean home for optional features.

## Requirements

Add a built-in Apps screen.

Initial app registry can be static.

Example:

```ts
type BuiltInApp = {
  id: string
  name: string
  icon?: string
  requiredCapabilities?: HostCapability[]
  component: ComponentType
}
```

Initial apps:

- Windows Media
- Windows Volume / System
- Host Status

Future placeholders may include:

- Discord
- PC Stats
- Weather
- Pomodoro

## Behavior

Apps with unmet capabilities remain visible but show:

```text
PC Offline
```

or:

```text
Feature unavailable
```

Do not hide core apps unpredictably.

## Acceptance Criteria

App navigation works without disrupting Nocturne's existing Spotify UI.

---

# Sprint 7 — Configurable Action Mapping Foundation

## Goal

Create a generic action system before adding more host integrations.

## Requirements

Create action definitions:

```ts
type ActionDefinition = {
  id: string
  label: string
  scope: "device" | "host"
  requiredCapability?: HostCapability
}
```

Example actions:

```text
device.openSpotify
device.openApps
device.openTimer

host.volume.toggleMute
host.media.playPause
host.media.next
```

Create a mapping layer between:

- top buttons
- knob press
- knob double press
- knob hold if supported
- back button
- other existing hardware inputs

## Important

Preserve Nocturne defaults.

Mappings should be opt-in or configurable.

## Acceptance Criteria

A user can map one physical input to one device action and one host action.

Host actions fail gracefully when Windows is offline.

---

# Sprint 8 — Discord Integration

## Goal

Add Discord as the first richer Windows-specific integration.

## Initial Scope

Start small.

Support:

- connected / not connected
- muted state
- deafened state
- toggle mute
- toggle deafen

If reliable and available through supported interfaces, later add:

- current voice channel
- participant names
- leave call

Do not begin by scraping Discord UI.

Prefer documented / stable APIs or IPC mechanisms.

## Car Thing UI

Create a Discord app showing:

```text
Discord

Voice connected

Mic: Muted
Audio: On
```

Controls:

- Toggle Mute
- Toggle Deafen

## Acceptance Criteria

Works wirelessly.

Discord failure does not affect other host capabilities.

---

# Sprint 9 — PC Stats

## Goal

Expose lightweight Windows system monitoring.

## Windows side

Collect:

- CPU usage
- RAM usage
- GPU usage if straightforward
- GPU temperature only if reliable and available
- current foreground app
- optional game process detection

Do not add heavy monitoring dependencies unless necessary.

## Car Thing UI

Create:

```text
PC Stats

CPU   32%
RAM   61%
GPU   74%
```

Update at a reasonable interval.

Avoid excessive polling.

## Acceptance Criteria

Companion remains lightweight and low-overhead.

---

# Sprint 10 — Macros and App Launching

## Goal

Allow Car Thing to trigger Windows actions.

## Initial Actions

- launch configured application
- run configured command
- send configured keyboard shortcut

## Security

Do not allow arbitrary remote shell execution from the Car Thing by default.

Prefer a whitelist:

```json
{
  "id": "open-vscode",
  "type": "launch",
  "target": "C:\\Path\\To\\Code.exe"
}
```

or:

```json
{
  "id": "discord-mute",
  "type": "hotkey",
  "keys": ["CTRL", "SHIFT", "M"]
}
```

## Acceptance Criteria

Only explicitly configured macros are executable.

---

# Sprint 11 — Weather + Device-Native App Validation

## Goal

Prove the app system supports features that do not depend on Windows.

## Requirements

Add a Weather app that runs independently of Windows.

Preferred architecture:

```text
Weather UI
   |
Nocturne daemon
   |
Weather API
```

Avoid routing weather through Windows.

This sprint validates that the Apps screen is not just a Windows launcher.

## Acceptance Criteria

Weather works when:

- Windows PC is off
- Mac mini / Nocturne connectivity remains available
- no USB data cable is connected

---

# Sprint 12 — Pomodoro / Timer

## Goal

Add a fully local utility app.

Requirements:

- start
- pause
- reset
- preset durations
- survive navigation between screens if practical

No Windows dependency.

## Acceptance Criteria

Timer remains functional while Windows is disconnected.

---

# Sprint 13 — Polish Host Lifecycle

## Goal

Make the Windows companion production-friendly.

## Windows companion improvements

Add:

- system tray app
- Start with Windows
- connection status
- pairing status
- simple enable/disable toggles for integrations
- logs
- restart companion
- local settings storage

Example:

```text
Nocturne Companion

Car Thing      Connected
Media          On
Discord        On
PC Stats       On

Start with Windows   On
```

## Acceptance Criteria

User does not need to keep a terminal open.

---

# Sprint 14 — Reliability and Recovery

## Goal

Make host behavior resilient.

Test:

- Windows sleep
- Windows shutdown
- Windows reboot
- Wi-Fi disconnect
- IP address change
- Car Thing reboot
- Nocturne restart
- companion restart
- protocol mismatch
- malformed message
- temporary Discord failure
- media source disappearing

## Acceptance Criteria

No host failure breaks Nocturne Spotify.

Connections recover automatically where reasonable.

---

# Sprint 15 — Optional Gaming Features

## Goal

Add gaming-oriented integrations after the host layer is stable.

Potential features:

- detect foreground game
- show game name
- system stats
- Discord mute state
- audio level
- optional OBS state
- user-defined game macros

Do not build game-specific integrations unless there is a clear use case.

---

# Future Work — Not Yet

Explicitly defer:

- app marketplace
- downloadable third-party apps
- plugin SDK
- app sandbox
- automatic dependency installation
- cloud accounts
- remote internet control
- Mac host parity
- Linux host parity
- multi-host orchestration

These should only be considered after the Windows companion architecture is stable.

---

# First Three Implementation Milestones

Jules should prioritize these before anything else:

## Milestone 1

```text
Car Thing <-> WebSocket <-> Windows companion
```

Wireless connection and capability negotiation.

## Milestone 2

Windows volume control.

This proves commands and state updates work.

## Milestone 3

Windows media.

This proves a richer real-time integration.

Only after those three succeed should Jules build Discord, mappings, stats, macros, or more apps.

---

# Implementation Guidance for Jules

For each sprint:

1. Inspect the existing Nocturne architecture first.
2. Reuse existing patterns when possible.
3. Keep changes small and localized.
4. Avoid rewriting unrelated Nocturne code.
5. Preserve Spotify behavior.
6. Preserve wireless/no-data-USB operation.
7. Add tests where the codebase already has test infrastructure.
8. Update documentation for new protocol or architecture changes.
9. Prefer incremental PR-sized changes.
10. Do not begin the next sprint until the current acceptance criteria are satisfied.

When uncertain between:

```text
modify existing Nocturne behavior
```

and:

```text
add a separate extension layer
```

prefer the separate extension layer.

The project should remain a Nocturne-based device with optional computer capabilities, not become a PC-dependent Car Thing frontend.
