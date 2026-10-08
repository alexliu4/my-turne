# Jules Implementation Plan: Native Windows Nocturne Connector Integration

## Project Goal

Extend Nocturne on Spotify Car Thing so it keeps its standalone strengths while gaining native Windows computer integrations via the native Nocturne Connector architecture.

The key requirement is:

> Car Thing must remain useful without a USB data cable and without the Windows PC.

---

# Architectural Principles

## 1. Preserve Nocturne as the foundation

Keep Nocturne's existing:

- Spotify functionality
- phone / Bluetooth behavior
- Wi-Fi / connector behavior
- device-side UI
- daemon architecture

Avoid modifying core Spotify behavior unless strictly required for integration.

## 2. Retired Direct-LAN Transport vs Selected Native Architecture

### Retired Architecture (Failed Physical Testing)

Direct Car Thing <-> LAN / WebSocket <-> Windows Companion is **retired**.

Physical testing on the Car Thing revealed:
- `uncm0: 10.42.1.218/29` with `route: 10.42.1.216/29 dev uncm0`.
- No default route exists to the home LAN.
- Both `busybox nc 192.168.1.175 8893` (Windows) and `busybox nc 192.168.1.188 8893` (Mac mini) failed physically with `Network is unreachable`.
- A Mac TCP proxy was functional at `192.168.1.188:8893`, but the Car Thing could not reach the Mac LAN IP due to the missing route.

Raw TCP/WebSocket proxying (such as PR #8) is **not** a supported architecture.

### Selected Architecture

```text
Car Thing → Nocturne daemon → Bluetooth/RFCOMM → preferred Windows Connector → Windows APIs
```

With fallback to the Mac Connector when Windows is unavailable:

```text
Windows Available:
Car Thing → Bluetooth/RFCOMM → Windows Nocturne Connector → Windows APIs

Windows Unavailable:
Car Thing → Bluetooth/RFCOMM → Mac Connector
```

## 3. Location of Windows Connector Code

All future Windows connector implementation belongs in a separate fork of `usenocturne/nocturne-connector`. Do **not** vendor or copy that repo into `my-turne`.

Future Windows UI requests travel through the local Nocturne WebSocket / daemon RPC path, not a direct network socket.

---

# Next Steps & Revised Sprints

## Transport & Fallback Validation (Must precede feature sprints)

Before resuming feature sprints (volume, media, Discord, etc.), transport/fallback validation must happen in the `nocturne-connector` fork:

1. Validate Car Thing → Bluetooth/RFCOMM connection to native Windows Connector.
2. Validate automatic preferred routing when Windows Connector is healthy.
3. Validate automatic fallback to Mac Connector when Windows disconnects.
4. Validate automatic re-promotion when Windows reconnects.

## Feature Sprints (Deferred until transport validation succeeds)

- **Sprint 4 — Windows Volume Control**: Routed via Nocturne daemon RPC to preferred Windows Connector.
- **Sprint 5 — Windows Media Integration**: Windows media session state and controls via Connector RPC.
- **Sprint 6 — Apps Screen**: UI integration for optional features.
- **Sprint 7 — Action Mapping**: Physical knob/button mapping to device or Windows actions.
- **Sprint 8 — Discord Integration**: Voice/mute/deafen integration via Windows Connector.
- **Sprint 9 — System Stats**: CPU/GPU/RAM monitoring via Windows Connector.
- **Sprint 10 — App Launching & Macros**: Configured actions executed on Windows.
