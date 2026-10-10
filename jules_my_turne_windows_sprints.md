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

Support device-side access to `volume.get`, `volume.set`, `volume.adjust`, and `volume.toggleMute` using methods exposed by the Connector. Receive current state (`volumePercent`, `muted`).

- Reject execution when Mac/phone routes hold ownership.
- Restrict publishing of Windows volume events strictly to active Windows routes.
- Ignore malformed, unknown, unsupported, or stale/disconnected RPC results without creating fake state or overwriting volume/mute state.

## First UI

Start with a small Windows Volume screen or test control. Do **not** globally remap the physical rotary knob yet.

Show:
- current percentage
- decrease / increase
- mute/unmute
- unavailable/offline state

Ensure the screen is accessible from navigation with functioning back navigation.

## Behavior

When Windows is not active:
- controls disable safely
- no repeated error spam
- normal Nocturne behavior remains unaffected

When Windows becomes active again:
- state refreshes
- controls recover without restarting the UI

## Acceptance Criteria

- Windows-only RPCs reject Mac/phone ownership.
- Windows volume events never alter phone/Spotify volume state; registered iOS/Android phone volume events work while Windows is active without contaminating Windows volume.
- Only active Windows routes publish Windows volume events.
- Unknown/unsupported/malformed responses or stale, overlapping, or disconnected-session RPC results cannot overwrite current volume/mute state or create fake state.
- Windows Volume screen is accessible with functioning back navigation.
- Automated tests cover actual routing, RPC lifecycle, and UI state.
- Physical validation verifies external Windows volume changes, mute, and reconnect.

---

# Sprint 5 — Windows Media UI

## Prerequisite

The active Windows Connector must expose stable Windows system-media state/events (GSMTC).

## Goal

Create a dedicated Windows Media experience on Car Thing without replacing Spotify Now Playing.

## Requirements

- Keep Windows GSMTC media independent of Spotify/phone Now Playing.
- Display source application, title, artist, album, artwork, playback state, and progress/duration when available.
- Support available RPCs (`play/pause`, `next`, `previous`).
- Safely handle unavailable artwork and unsupported controls.

## Display & Controls

Display available media metadata and offer supported player controls only.

## Behavior

When Windows or the media source becomes unavailable/disconnected:

```text
Windows Media
PC unavailable
```

Clear stale sessions, metadata, artwork, and timeline on source loss. Do not crash or fall back to fake data.

## Acceptance Criteria

- Windows GSMTC media remains independent of Spotify/phone Now Playing with verified linked vs unlinked/skipped Spotify behavior.
- Source loss clears stale sessions, metadata, artwork, and timeline.
- Handles unavailable artwork and unsupported controls safely without crashing or fabricating data.
- Automated and physical tests verify browser media, native player media, and reconnection handling.

---

# Sprint 6 — Windows Capability State + Host Status

## Prerequisite

Connector capability metadata must be available. Note: Connector exposes `connector.capabilities`, but daemon `app.ready` normalization currently drops its `capabilities` field.

## Goal

Restore useful Host Status UI details using native Connector state without reintroducing HostBridge.

## Requirements

- Define a verified device-side capability contract, preferably querying the authoritative Connector RPC and preserving handshake metadata only if needed.
- Refresh capabilities whenever ownership or actual availability changes.
- Ensure unknown and unsupported features are never falsely advertised as available.
- Offline or fallback status must clear stale Windows capabilities.

## Display

Show connected status and individual capabilities (`Available` vs `Unavailable` / `Offline`).

```text
Windows PC
Connected

Volume        Available
Media         Available
Discord       Unavailable
System Stats  Unavailable
```

When Windows is inactive:

```text
Windows PC
Offline

Using fallback Connector
```

## Acceptance Criteria

- Device capability contract handles `app.ready` normalization by querying authoritative Connector RPC.
- Capability list refreshes on ownership/availability transitions and clears stale capabilities when offline/fallback.
- Unknown and unsupported features are never falsely advertised as available.

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

## Requirements

- Mappings are explicit and configurable with safe defaults and persistence.
- Define explicit handling for conflicting assignments.
- Preserve original physical controls unless deliberately remapped.
- Windows actions do not execute against non-Windows fallback routes.
- Do not globally change knob behavior until mappings exist.

## Acceptance Criteria

- Mappings persist across restarts with safe defaults and preserved physical controls.
- Defined handling prevents conflicting assignment errors.
- Windows actions are blocked from executing against fallback routes.
- At least one device action and one Windows action map and execute safely.

---

# Sprint 9 — Discord UI Integration

## Prerequisite

Connector Discord RPC/state must be available. Note: Connector currently reports `state_known: false`, with nullable mute/deafen.

## Goal

Add Car Thing Discord UI integration consuming Connector-provided state only.

## Display & Requirements

When state verification is unavailable (`state_known: false`), display unknown states rather than fabricating mute/deafen values:

```text
Discord
Connected

Mic: Unknown
Audio: Unknown
```

When state is known:

```text
Discord
Connected

Mic: Muted
Audio: On
```

- UI must never fabricate actual mute/deafen state.
- Toggle actions communicate unknown or unverified outcomes appropriately.
- Discord failure or restart cannot disrupt other Windows/Nocturne functions.

## Acceptance Criteria

- UI accurately reflects `state_known: false` with unknown mute/deafen displays rather than fabricated state.
- Toggle actions communicate unknown outcomes appropriately when unverified.
- Discord failure/restart remains isolated and does not affect volume, media, or route handling.

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

Validate complete My-Turne integration under realistic lifecycle changes and failure modes.

## Requirements & Test Matrix

Test matrix must include:
- Windows startup, shutdown, sleep/wake, Bluetooth interruption, Connector restart, Mac Connector restart, Mac reconnect while Windows active, Car Thing reboot, rapid handoffs (Windows → Mac → Windows).
- Disappearing media sessions, unsupported RPC returns, malformed events, disappearing active capabilities.
- Mixed Connector/daemon versions, failed RPCs, malformed events, clean reboot, and redeployment.

Core Invariant: `Windows feature failure ≠ core Nocturne failure`.

## Acceptance Criteria

- Test matrix verifies mixed versions, failed RPCs, malformed events, rapid handoffs, clean reboot, and redeployment without core regressions.
- Spotify, phone, and core Nocturne functions remain intact throughout.
- Passes final no-USB physical end-to-end regression test.

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

# General Rules & Jules Rules

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
13. Each feature sprint must verify its real cross-repository RPC/event contract and include focused tests for ownership, unavailable state, and reconnect behavior. Physical hardware validation is required where relevant.
14. Do not mark any sprint complete without verified evidence. Keep AC concise and measurable.
