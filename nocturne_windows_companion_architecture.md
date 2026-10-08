# Nocturne + Windows Companion Architecture

## Goal

Enhance Nocturne on Spotify Car Thing so it stays a strong, Spotify-first standalone device while also gaining DeskThing-like computer integrations.

The Car Thing should **not depend on the Windows PC for core functionality**. Windows-specific features should appear when the PC is available and gracefully become unavailable when it is not.

---

## Core Design Decision

### Keep Nocturne running through the always-on Mac mini

The Mac mini remains the reliable always-on machine that supports Nocturne connectivity.
It also runs a separate raw TCP proxy for Windows HostBridge traffic.

This avoids tying the Car Thing's basic operation to the Windows PC, which may be sleeping, rebooting, gaming, or turned off.

### Add a separate lightweight Windows companion

The Windows PC runs a small background host agent that exposes Windows-specific capabilities to the Car Thing over the local network.

The Windows machine is a **capability provider**, not the primary brain of the Car Thing.

---

## Target Architecture

```text
                  INTERNET
                     |
             +-------v--------+
             |    Mac mini    |
             |                |
             | Nocturne       |
             | Connector      |
             | TCP proxy      |
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
                     | WebSocket over LAN to Mac TCP proxy
                     |
             +-------v--------+
             | TCP proxy on   |
             | same Mac mini  |
             +-------+--------+
                     |
                     | raw TCP over LAN
                     |
             +-------v--------+
             |  Windows PC    |
             |                |
             | Companion Host |
             |                |
             | Discord        |
             | PC media       |
             | Volume         |
             | Macros         |
             | PC stats       |
             | Gaming info    |
             +----------------+
```

---

## Device-Native vs Host-Dependent Features

### Device-native features

These should continue working when the Windows PC is unavailable.

- Spotify / Nocturne music experience
- Weather
- Clock
- Timer / Pomodoro
- Device settings
- Local apps
- Button mappings that only affect the Car Thing
- Other internet-backed apps that do not require the PC

### Windows-dependent features

These require the Windows companion to be connected.

- Discord mute / deaf / call information
- Windows system volume
- Current Windows media
- Play / pause / next / previous for Windows media
- PC CPU / GPU / RAM stats
- Game information
- App launching
- Keyboard shortcuts
- Macros
- Windows notifications
- OBS or other desktop integrations

---

## Graceful Degradation

When Windows is online:

```text
Spotify       available
Weather       available
Clock         available
Discord       available
Windows Media available
PC Stats      available
Macros        available
```

When Windows is offline:

```text
Spotify       available
Weather       available
Clock         available
Discord       offline
Windows Media offline
PC Stats      offline
Macros        offline
```

Windows-dependent apps should remain visible if useful, but clearly show an **Offline / PC unavailable** state instead of breaking the overall UI.

---

## Windows Companion Philosophy

The companion should initially be small and lightweight.

Avoid recreating the full DeskThing desktop platform at the start.

Initial model:

```text
Car Thing -> Mac TCP proxy -> Windows companion
```

The proxy forwards TCP bytes without handling WebSocket messages. The Windows
companion still owns the HostBridge protocol, authentication, and capabilities.

Possible structure:

```text
host/windows/
├── websocket/
├── media/
├── discord/
├── system/
├── stats/
├── macros/
└── games/
```

The companion can run silently in the background and optionally expose a small system tray UI.

Example tray state:

```text
Nocturne Companion
------------------
Car Thing connected

Start with Windows   On
Discord integration  On
Media integration    On
System controls      On
```

---

## Capability-Based Connection

The Windows companion should tell the Car Thing what it currently supports.

Example:

```json
{
  "type": "host.capabilities",
  "capabilities": [
    "media",
    "discord",
    "volume",
    "macros",
    "systemStats"
  ]
}
```

The Car Thing can enable or disable apps dynamically based on those capabilities.

Example Apps screen:

```text
APPS

Spotify        Weather
Timer          Clock

------ Windows ------

Discord        Media
PC Stats       Macros
```

If Windows disconnects:

```text
------ Windows ------

Discord        Offline
Media          Offline
PC Stats       Offline
Macros         Offline
```

---

## Shared Message Protocol

The Car Thing and Windows companion should share common message types.

Example:

```ts
type HostMessage =
  | {
      type: "discord.state"
      muted: boolean
      deafened: boolean
    }
  | {
      type: "system.volume"
      value: number
    }
  | {
      type: "media.state"
      title: string
      artist?: string
      playing: boolean
    }
  | {
      type: "system.stats"
      cpu: number
      gpu?: number
      memory: number
    }
```

Example action request:

```json
{
  "type": "action",
  "action": "discord.toggleMute"
}
```

Possible response:

```json
{
  "type": "actionResult",
  "action": "discord.toggleMute",
  "success": true,
  "muted": true
}
```

---

## Configurable Hardware Mappings

Mappings should be split into two categories.

### Device mappings

Handled entirely on the Car Thing.

Examples:

```text
Button 1      -> Spotify
Button 2      -> Apps
Button 3      -> Pomodoro
Button 4      -> Weather

Double knob   -> Like song
Hold button 3 -> Open timer
```

### Host mappings

Forwarded to Windows over the network.

Examples:

```text
Button 1 -> Discord mute
Button 2 -> Launch VS Code
Button 3 -> Open media controls
Button 4 -> Macro panel
```

This means configurable mappings do **not** inherently require a USB data wire.

---

## Networking Decision

Use the Mac mini as the Windows transport path:

```text
Car Thing -> Mac TCP proxy -> Windows Companion
```

The Mac mini continues running Nocturne Connector. Its separate proxy forwards
the existing WebSocket TCP connection to Windows Companion without changing
HostBridge messages or handling the shared token. Car Thing must be able to
route to the Mac listener, and the Mac must be able to reach Windows over the
LAN. No USB data cable is required for normal operation.

---

## Development Workflow

The machine used for development does not need to be the same machine that provides Nocturne connectivity.

Recommended workflow:

```text
Windows PC
├── VS Code / Cursor / Codex
├── Nocturne fork
├── Car Thing UI development
└── Windows companion development
```

The Mac mini can continue running Nocturne in the background as the stable always-on environment.

---

## Repository Direction

Prefer keeping the Windows companion in the same repository at first so shared protocol types are easy to maintain.

Example:

```text
nocturne-fork/
├── packages/
│   ├── ui/
│   └── shared/
│       └── protocol/
│
├── host/
│   └── windows/
│       ├── websocket/
│       ├── media/
│       ├── discord/
│       ├── system/
│       ├── stats/
│       ├── macros/
│       └── games/
│
└── existing-nocturne-code/
```

A separate repository can always be created later if the companion becomes large enough to justify it.

---

## Initial MVP

Do not begin with an app store, plugin SDK, or full DeskThing clone.

First prove the Windows connection with three integrations:

1. **Windows volume**
2. **Current Windows media**
3. **Discord mute state + toggle**

If those three work wirelessly, the core host architecture is validated.

After that, add:

- PC stats
- macros
- app launching
- gaming information
- notifications
- richer Discord controls
- OBS integration
- configurable action mappings

---

## Product Direction

The target is not:

> A tiny Windows terminal that happens to run Spotify.

The target is:

> A Spotify-first smart desktop companion that works independently, but gains richer computer controls whenever the Windows PC is available.

This preserves Nocturne's strongest characteristic while adding the parts of DeskThing that are most useful.
