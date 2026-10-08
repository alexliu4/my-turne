# ADR: Native Windows Nocturne Connector Architecture for My-Turne

**Status:** Accepted  
**Date:** October 2026 (Updated)

## Context

My-Turne is extending Nocturne on Car Thing with optional Windows-specific functionality (volume control, media metadata/controls, Discord, system stats, app launching).

### Previous Design & Physical Test Results

The previous design introduced a direct LAN WebSocket transport (`useHostBridge` / `windows-companion`). A proposed alternative tested a Mac mini TCP proxy.

Physical testing on the Car Thing proved both direct LAN and Mac LAN proxy approaches invalid:

- `uncm0: 10.42.1.218/29` with route `10.42.1.216/29 dev uncm0`.
- No default IP route exists on the Car Thing to the home LAN.
- Direct network connection attempts (`busybox nc 192.168.1.175 8893` to Windows and `busybox nc 192.168.1.188 8893` to Mac mini) failed with `Network is unreachable`.
- Although the Mac TCP proxy code itself was functional, the required Car Thing IP route did not exist to reach it.

Therefore, direct Car Thing LAN/WebSocket transport and LAN TCP proxies (such as PR #8) are retired and not supported.

---

## Selected Architecture — Native Windows Nocturne Connector

```text
Windows Available:
Car Thing → Nocturne daemon → Bluetooth/RFCOMM → preferred Windows Connector → Windows APIs

Windows Unavailable:
Car Thing → Nocturne daemon → Bluetooth/RFCOMM → Mac Connector
```

### Key Decisions

1. **Native Transport**: Windows integration uses the native `usenocturne/nocturne-connector` implementation over the existing Bluetooth/RFCOMM RPC daemon path.
2. **Repository Isolation**: Windows-specific connector code lives in a separate fork of `usenocturne/nocturne-connector`. It is **not** vendored into `my-turne`.
3. **Route Priority & Fallback**: Routing logic will prefer a healthy Windows Connector when available and automatically fall back to the Mac Connector when Windows is offline.
4. **Daemon RPC Path**: UI requests travel through the local Nocturne daemon WebSocket / daemon RPC path rather than a separate direct network socket.
5. **Transport Validation Gate**: Transport and fallback validation must be completed and verified before resuming Windows feature sprints.
