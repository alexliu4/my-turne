# Nocturne + Native Windows Connector Architecture

## Goal

Enhance Nocturne on Spotify Car Thing so it stays a strong, Spotify-first standalone device while gaining Windows computer integrations over native Nocturne transports.

The Car Thing must **not depend on the Windows PC for core functionality**. Windows-specific capabilities appear when the PC is connected and gracefully become unavailable when it is not.

---

## Why the Architecture Changed (Physical Testing Findings)

The previous architecture assumed direct LAN communication or a Mac TCP proxy over WebSocket between the Car Thing and a Windows Companion (`Car Thing <-> LAN/WebSocket <-> Windows Companion`).

Physical testing on the Car Thing proved this assumption invalid for normal cable-free operation.

### Observed on the Car Thing

```text
uncm0: 10.42.1.218/29

route:
10.42.1.216/29 dev uncm0
```

No default route exists to the home LAN (e.g. `192.168.x.x`).

### Test Results

Both direct and proxied LAN socket attempts failed:

```bash
busybox nc 192.168.1.175 8893   # Direct Windows LAN IP
busybox nc 192.168.1.188 8893   # Mac mini LAN IP
```

Both returned:

```text
Network is unreachable
```

A Mac TCP proxy successfully listened on `192.168.1.188:8893` and targeted Windows at `192.168.1.175:8893`, proving the proxy code itself was functional. However, because the required Car Thing IP route did not exist, the Car Thing could not reach the Mac LAN address either.

Therefore, direct Car Thing LAN/WebSocket transport and raw LAN proxies (such as PR #8) are invalid for normal cable-free operation and are **not** supported architectures.

---

## Native Architecture

Normal Nocturne operates wirelessly using Bluetooth RFCOMM RPC:

```text
Car Thing UI
  → local Nocturne daemon
  → Bluetooth / RFCOMM RPC
  → Nocturne Connector
```

Future Windows integration uses native Windows support in a fork of `usenocturne/nocturne-connector`.

### Runtime Routing Model

```text
Windows available:
Car Thing → Nocturne daemon → Bluetooth/RFCOMM → preferred Windows Connector → Windows APIs

Windows unavailable:
Car Thing → Nocturne daemon → Bluetooth/RFCOMM → Mac Connector
```

Routing will prefer a healthy Windows Connector and fall back to the Mac Connector when Windows is offline or unavailable.

### Responsibility Split across Repositories

- `my-turne-connector` (fork of `usenocturne/nocturne-connector`): Exposes reliable Windows Connector identity and Windows-native functionality.
- `my-turne`: Implements and selects Windows-over-Mac route priority and fallback in the `nocturned` daemon.

Windows-specific connector code belongs in a fork of `usenocturne/nocturne-connector` (do not vendor or copy into `my-turne`), while daemon routing selection is implemented in `my-turne`.

Future Windows UI requests will travel through the existing local Nocturne WebSocket / daemon RPC path, rather than a separate direct network socket.

---

## Device-Native vs Host-Dependent Features

### Device-native features

Work regardless of Windows availability:

- Spotify / Nocturne music experience
- Weather
- Clock / Timer
- Device settings
- Local apps
- Native phone calls and notifications (via companion app)

### Windows-dependent features

Require an active Windows Nocturne Connector route:

- Windows system volume
- Current Windows media session and playback controls
- Discord mute / deafen / call information
- PC CPU / GPU / RAM stats
- App launching and macros

---

## Transport Validation Requirement

Before resuming feature sprints (volume, media, Discord, etc.), transport and fallback validation is a cross-repo integration checkpoint to confirm:

1. Car Thing connects reliably to the native Windows Nocturne Connector over Bluetooth/RFCOMM.
2. `my-turne` daemon automatic route priority favors the Windows Connector when online.
3. Failover cleanly redirects traffic to the Mac Connector when Windows disconnects.
4. Windows → Mac → Windows failover and re-promotion operate reliably across both repositories.
