# Jules Implementation Plan: My-Turne Windows Integration

## Scope

This sprint document is **only for `alexliu4/my-turne`**.

Do not implement or modify `my-turne-connector` from these sprints. The sister Connector repository has its own sprint plan and is developed independently.

`my-turne` owns:

- Car Thing UI
- `nocturned` daemon
- Connector route selection
- device-side RPC calls
- device-side Windows feature state
- Apps / settings UI
- hardware action mapping
- graceful fallback behavior

`my-turne-connector` is only an external dependency. When a sprint requires a Connector feature, assume that feature is available before starting the dependent My-Turne sprint.

---

# Architecture

Selected runtime:

```text
Windows available:

Car Thing UI
    ↓ local WebSocket
nocturned
    ↓ Bluetooth / RFCOMM
Windows Nocturne Connector
    ↓
Windows APIs
```

Fallback:

```text
Windows unavailable:

Car Thing UI
    ↓
nocturned
    ↓ Bluetooth / RFCOMM
Mac Nocturne Connector
```

Do not recreate the retired architecture:

```text
Car Thing → LAN/WebSocket → Windows Companion
```

Do not reintroduce:

- `crates/windows-companion`
- `useHostBridge`
- direct Car Thing → Windows LAN sockets
- Mac TCP proxying
- custom HostBridge heartbeat/auth/reconnect
- the old `HostMessage` / `HostCapability` transport protocol

All Windows requests must use the existing local UI → daemon → Connector RPC path.

---

# Completed Foundation

## Architecture Cleanup — Complete

PR #9 removed the retired direct-LAN Windows Companion implementation.

The repo is now ready for native Connector integration.

## Available Connector Identity

The Windows Connector can advertise:

```json
{
  "platform": "web",
  "connectorPlatform": "windows"
}
```

`platform: "web"` must remain compatible with existing Nocturne behavior.

My-Turne should identify Windows only through:

```text
connectorPlatform == "windows"
```

Never infer Windows from hostname, route name, Bluetooth name, or peer address.

---

# Sprint 1 — Prefer Windows Connector with Mac Fallback

## Goal

Make the Windows Connector the active desktop Connector whenever it is healthy.

Current `AppReadyRegistry` behavior is essentially:

```text
latest app.ready wins
```

Change it to:

```text
if a Windows Connector route exists:
    newest Windows route wins
else:
    preserve existing newest-ready route behavior
```

## Primary Area

```text
crates/daemon/src/http/websocket.rs
```

Keep the change localized around `AppReadyRegistry`.

## Required Behavior

### Mac connects first

```text
Mac ready
→ Mac active
```

### Windows connects

```text
Mac active
Windows ready
→ Windows active
```

### Mac reconnects while Windows is healthy

```text
Windows active
Mac sends newer app.ready
→ Windows remains active
```

### Windows disconnects

```text
Windows active
Windows route removed
→ best surviving legacy/Mac route becomes active
```

### Windows returns

```text
Mac active
Windows ready
→ Windows active again
```

### Multiple Windows routes

Use the newest healthy Windows route.

### Legacy behavior

When no Windows route exists, preserve today's newest-ready selection behavior.

## Do Not Change

- Bluetooth transport
- RFCOMM behavior
- RPC framing
- phone routing
- iOS/Android behavior
- `app.ready.platform`
- unrelated daemon behavior

## Tests

Add focused tests for:

1. Mac → Windows = Windows active.
2. Windows → Mac reconnect = Windows stays active.
3. Windows removal = Mac promoted.
4. Windows reconnect = Windows active again.
5. Legacy routes preserve newest-ready behavior.
6. Multiple Windows routes choose newest Windows.
7. Removing a non-owner route does not disturb the active route.
8. Existing phone route behavior still passes.

## Acceptance Criteria

Windows always wins while healthy, and the existing fallback behavior resumes when Windows is absent.

---

# Sprint 2 — Route/Fallback Integration Validation

## Goal

Validate Sprint 1 on real hardware before building Windows feature UI.

This sprint should contain **no new architecture** unless physical testing exposes a concrete bug.

## Test

With both Connectors available:

1. Start Mac Connector.
2. Confirm normal Nocturne works.
3. Start Windows Connector.
4. Confirm Windows becomes active.
5. Confirm Spotify / normal Nocturne still works.
6. Stop Windows Connector.
7. Confirm Mac becomes active automatically.
8. Restart Windows Connector.
9. Confirm Windows becomes preferred again.
10. Restart/reconnect Mac while Windows remains healthy.
11. Confirm Mac does not steal ownership.
12. Test Windows sleep/wake or temporary Bluetooth loss.
13. Confirm stale routes do not remain active.

Expected lifecycle:

```text
Mac
 ↓
Windows
 ↓
Mac
 ↓
Windows
```

## Acceptance Criteria

No USB data cable or manual Car Thing recovery is required.

Do not proceed to Windows feature UI until this works reliably.

---

# Sprint 3 — Native Windows Connection State

## Goal

Give the Car Thing a reusable daemon/UI representation of the currently active Windows Connector.

This replaces the old HostBridge connection state without recreating HostBridge.

## Requirements

Expose enough state for UI consumers to know:

```text
Windows active
Windows unavailable
fallback Connector active
```

Prefer deriving this from the existing active `app.ready` registry data.

Do not create another connection manager.

## Device State

A small state shape is sufficient, for example conceptually:

```text
activeConnectorPlatform
isWindowsActive
```

Use existing naming conventions in the repo rather than forcing these exact names.

## UI

No full Host Status screen yet.

Add only the reusable state/hook/helper needed by later Windows feature screens.

## Acceptance Criteria

UI code can reliably distinguish:

- active Windows Connector
- non-Windows fallback Connector
- no active Connector

without opening a new socket.

---

# Sprint 4 — Windows Volume UI/RPC Integration

## Prerequisite

The sister Connector repo must already provide stable native Windows volume/mute RPC.

Do not implement Windows audio APIs in `my-turne`.

## Goal

Control Windows volume from the Car Thing through the existing daemon RPC path.

## Requirements

Support device-side access to:

```text
volume.get
volume.set
volume.adjust
volume.toggleMute
```

using the methods actually exposed by the Connector.

Receive current state:

```text
volumePercent
muted
```

## First UI

Start with a small Windows Volume screen or test control.

Do **not** globally remap the physical rotary knob yet.

Show:

- current percentage
- decrease
- increase
- mute/unmute
- unavailable/offline state

## Behavior

When Windows is not active:

- controls disable safely
- no repeated error spam
- normal Nocturne behavior remains unaffected

When Windows becomes active again:

- state refreshes
- controls recover without restarting the UI

## Acceptance Criteria

From Car Thing:

- read Windows volume
- change Windows volume
- mute/unmute
- receive external Windows volume changes
- recover cleanly across Windows disconnect/reconnect

---

# Sprint 5 — Windows Media UI

## Prerequisite

The active Windows Connector must expose stable Windows system-media state/events.

## Goal

Create a dedicated Windows Media experience on Car Thing.

Do not replace Spotify Now Playing.

## Display

Use available data such as:

- source application
- title
- artist
- album
- artwork
- playback state
- progress/duration

## Controls

Use available RPC for:

- play/pause
- next
- previous

Only add controls supported reliably by the Connector.

## Behavior

When Windows becomes unavailable:

```text
Windows Media
PC unavailable
```

Do not crash or fall back to fake data.

## Acceptance Criteria

Works with at least:

- browser media
- a Windows media player
- supported Spotify desktop/system-media behavior

---

# Sprint 6 — Windows Capability State + Host Status

## Prerequisite

Connector capability metadata must be available.

## Goal

Restore the useful parts of the old Host Status UI using native Connector state.

Do not restore HostBridge.

## Display

Example:

```text
Windows PC
Connected

Volume        Available
Media         Available
Discord       Unavailable
System Stats  Unavailable
Macros        Unavailable
App Launch    Unavailable
```

When Windows is not active:

```text
Windows PC
Offline

Using fallback Connector
```

## Requirements

- consume existing daemon/Connector metadata
- no direct network connection
- no fake capabilities
- only mark capabilities available when advertised

## Acceptance Criteria

Status updates correctly as Windows connects, disconnects, or gains additional supported features.

---

# Sprint 7 — Apps Screen

## Goal

Create a clean home for optional features.

Initial apps may include:

```text
Windows Media
Windows Controls
Host Status
Timer
Weather
```

Later Windows-dependent apps can appear as their Connector support becomes available.

## Requirements

Device-native apps must continue working when Windows is offline.

Windows-dependent apps should remain safe and clearly indicate unavailable state.

Do not build:

- plugin marketplace
- downloadable app system
- package manager
- plugin sandbox

## Acceptance Criteria

App navigation does not disrupt existing Spotify/Nocturne navigation.

---

# Sprint 8 — Action Mapping Foundation

## Goal

Allow physical Car Thing controls to trigger typed device or Windows actions.

## Example Device Actions

```text
device.openSpotify
device.openApps
device.openTimer
```

## Example Windows Actions

```text
windows.volume.toggleMute
windows.media.playPause
windows.media.next
```

## Requirements

- preserve existing Nocturne defaults
- mappings are explicit/configurable
- unavailable Windows actions fail gracefully
- no arbitrary remote shell commands
- do not globally change knob behavior until mappings exist

## Acceptance Criteria

At least one device action and one Windows action can be mapped safely.

---

# Sprint 9 — Discord UI Integration

## Prerequisite

Connector Discord RPC/state must already be stable.

## Goal

Add the Car Thing side of Discord integration.

Initial display:

```text
Discord
Connected

Mic: Muted
Audio: On
```

Initial controls:

- toggle mute
- toggle deafen if supported

## Requirements

- consume Connector-provided state only
- Discord unavailable must not affect other Windows features
- reconnect cleanly when Discord restarts

## Acceptance Criteria

Discord controls work without affecting Spotify, media, volume, or Connector routing.

---

# Sprint 10 — PC Stats UI

## Prerequisite

Connector system-stat RPC/events must already exist.

## Goal

Display lightweight Windows telemetry.

Initial UI:

```text
CPU   32%
RAM   61%
GPU   74%
```

GPU should be optional.

## Requirements

- use Connector-provided sampling
- do not add a second high-frequency polling system
- UI update rate should be reasonable
- missing metrics should degrade cleanly

## Acceptance Criteria

Stats remain responsive without affecting media/RPC responsiveness.

---

# Sprint 11 — App Launching + Macro UI

## Prerequisite

Connector must expose safe configured actions.

## Goal

Allow Car Thing to trigger configured Windows actions.

Examples:

```text
Launch VS Code
Launch Discord
Open browser
Run configured shortcut
```

## Requirements

- display only configured/advertised actions
- no arbitrary shell command input from Car Thing
- invalid/unavailable actions fail safely
- Windows disconnect clears or disables host actions appropriately

## Acceptance Criteria

Configured actions execute reliably through the normal daemon → Connector RPC path.

---

# Sprint 12 — Reliability and Recovery

## Goal

Validate the complete My-Turne side under realistic lifecycle changes.

Test:

- Windows startup
- Windows shutdown
- Windows sleep/wake
- Windows Bluetooth interruption
- Windows Connector restart
- Mac Connector restart
- Mac reconnect while Windows active
- Car Thing reboot
- rapid Windows → Mac → Windows transitions
- Windows media session disappearing
- Windows feature RPC returning unsupported
- malformed responses/events
- active capability disappearing

## Core Invariant

```text
Windows feature failure
≠
core Nocturne failure
```

Spotify and device-native functionality must remain usable whenever an appropriate fallback Connector exists.

---

# Sequential Order

Work through these in order:

```text
DONE
Architecture cleanup / PR #9

NEXT
Sprint 1 — Windows-preferred route selection

THEN
Sprint 2 — physical route/fallback validation

THEN
Sprint 3 — reusable native Windows connection state

THEN
Sprint 4 — Windows Volume UI/RPC

THEN
Sprint 5 — Windows Media UI

THEN
Sprint 6 — Capability state + Host Status

THEN
Sprint 7 — Apps Screen

THEN
Sprint 8 — Action Mapping

THEN
Sprint 9 — Discord UI

THEN
Sprint 10 — PC Stats UI

THEN
Sprint 11 — App Launching / Macros UI

FINALLY
Sprint 12 — Reliability / recovery
```

Do not skip ahead when a later sprint depends on device-side state or RPC introduced by an earlier sprint.

---

# Jules Rules

For every My-Turne sprint:

1. Work only in `alexliu4/my-turne`.
2. Do not modify `my-turne-connector`.
3. Inspect current code before adding abstractions.
4. Reuse existing daemon RPC and local WebSocket patterns.
5. Never recreate direct LAN HostBridge transport.
6. Preserve normal Spotify and Nocturne behavior.
7. Preserve phone/iOS/Android routing.
8. Keep PRs limited to one sprint.
9. Add focused tests only for changed behavior.
10. If a required Connector RPC does not exist yet, stop that sprint rather than implementing it in this repo.
11. Do not create placeholder/fake Windows data.
12. Keep each PR easy to review and merge independently.
