# Device Phase 2 D4: Windows session and power awareness

October 20, 2026. Implemented for review. Physical integration is untested.

## Contract audit

Device baseline: merged main `ad82130250ebd6a7b4231d5bbeb166c896346b32` (D3, PR #28). Connector merged main was fetched into a temporary bare audit repository and verified at `8d0f144bd89a4b56dd52fd3e45f8f95ce3af643f`. That revision **does include Sprint 13**. Earlier device roadmap records that classified D4 as blocked are superseded by this source audit. A separate local Connector development branch was not used as evidence of merged availability. No Connector files were changed.

Authoritative sources at that exact revision:

- [Dispatcher and broadcasts](https://github.com/alexliu4/my-turne-connector/blob/8d0f144bd89a4b56dd52fd3e45f8f95ce3af643f/src/server/nocturne-manager.ts): `windows.session.get_status`, aliases `session.get_status` and `windows_session.get_status`, and `windows.session.changed`.
- [Session service](https://github.com/alexliu4/my-turne-connector/blob/8d0f144bd89a4b56dd52fd3e45f8f95ce3af643f/src/server/services/windows-session-service.ts): two-second native read deadline, independent monitoring availability, instance/sequence ordering, and failure clearing.
- [Native observer](https://github.com/alexliu4/my-turne-connector/blob/8d0f144bd89a4b56dd52fd3e45f8f95ce3af643f/windows/src-tauri/src/native/session.rs) and [host tests](https://github.com/alexliu4/my-turne-connector/blob/8d0f144bd89a4b56dd52fd3e45f8f95ce3af643f/src/server/services/windows-session-service.test.ts).

`windows.session.get_status({})` returns `{status: "ok", sessionState}` or `{status: "unsupported", sessionState: ...}`. The UI consumes the existing unwrapped result body. `windows.session.changed` carries the state directly:

```json
{
  "session": "locked",
  "activeSession": "active",
  "displayPower": "off",
  "systemPower": "awake",
  "observerId": "example-observer",
  "sequence": 4,
  "observedAt": 123456,
  "sessionMonitoring": true,
  "displayPowerMonitoring": true,
  "systemPowerMonitoring": true
}
```

This is a synthetic shape fixture, not captured hardware data. Session accepts locked/unlocked/unknown; activity active/inactive/unknown; display on/off/dimmed/unknown; system power awake/suspending/resuming/unknown. Each source must have literal monitoring availability `true` before its fields can be known. Missing or invalid fields remain Unknown. Ordering requires a string observer ID of at most 64 characters and a nonnegative safe integer sequence. The empty observer ID remains compatible with the host service's unknown/legacy snapshot. No version cutoff, capability flag, host clock accuracy or successful Windows query is inferred.

The Connector includes `windowsSession` in its Windows handshake, but the device uses an explicit snapshot to establish current state. No schema or generated bindings change is necessary for the existing dynamic gateway RPC/event path.

## Presentation, routing and freshness

Computer Control > Host Status includes separate Session lock, Session activity, Windows display and System power rows. Its existing header describes the ready Connector route independently. A locked Windows session can remain active; display off does not imply route loss. The section says Last reported state, rather than claiming a continuously sampled OS query. Refresh state is explicit; loading, offline, unsupported, invalid and failed responses clear readings to Unknown. Remote error text and observer identifiers are never displayed.

The daemon guards the canonical Windows session namespace and both existing aliases with scoped active Windows ownership. Accepted RPCs retain the exact `_targetConnection` through fallback. Session events require an exact registered active Windows route; Mac, phone, unscoped, inactive and removed routes cannot publish them. Generic media, Spotify, ownership selection and transport are unchanged.

`useWindowsSession` reads once on entry and every readiness change with a three-second deadline and `appReadyGeneration`. It serializes manual refreshes and does not poll. Readiness callbacks immediately invalidate the old epoch, including disconnects without a changed generation. Entry/reconnect ignores events until its snapshot establishes authority. Events with the same observer require a strictly higher sequence; duplicates, lower sequences and conflicting equal sequences are ignored. A newer event supersedes an older in-flight snapshot or failed read within the established observer. A different observer event cannot establish authority: it triggers a single-flight snapshot, limited to one event-driven attempt per three seconds. Only a current RPC can adopt a new observer. If an unfamiliar observer arrives while an older read is pending, one bounded follow-up revalidates it after that read finishes, unless the read already confirmed it. Unmount removes subscriptions and invalidates continuations. Offline views do not attach a socket event listener.

The optional automatic dim/blank setting is deliberately omitted. D4 issues no display, brightness, lock, suspend, wake or route-switch commands. Existing manual display sleep/wake and backlight restoration remain under their existing owners. No persisted power preference or new hardware mapping was introduced.

## Automated verification

Local checks use Bun 1.4.2 and Cargo 1.99.0:

- `bun test src/hooks/useWindowsSession.test.tsx src/hooks/useWindowsCapabilities.test.tsx src/pages/home/AppsSection.test.tsx`: 100 passed, 0 failed.
- `bun test` from `packages/ui`: 760 passed, 0 failed across 53 files.
- `bun run lint-check`: strict TypeScript and Prettier passed.
- `bun run build`: strict TypeScript and production Vite build passed; existing mixed static/dynamic import and large-chunk advisories remain.
- `tools/test-workspace --locked`: native shared/codegen tests passed, then exited 127 because `cross` is not installed. Linux daemon regressions and the aarch64 build require CI; they were not executed locally.
- `rustfmt --check --edition 2021 crates/daemon/src/http/websocket.rs` and `git diff --check`: passed.

UI tests cover monitoring and enum validation, bounded ordering, reconnect authority, stale replies/listeners, fallback, observer changes, event storms, duplicate notifications, failed reads, unsupported hosts, manual retry, unmount and sanitized rendered state. Existing Host Status/navigation tests exercise the integrated section with daemon I/O mocked. Daemon regressions cover all RPC aliases, exact target pinning and event source ownership.

## Physical verification checklist

All rows are **untested**. Record operator/date, image/daemon/UI and Windows/Mac Connector revisions, observed state and elapsed recovery time. Automated tests do not prove Bluetooth delivery or hardware behavior.

| Scenario | Required observation | Outcome |
| --- | --- | --- |
| Windows connected, open Host Status | Session/power rows match actual Windows state or explicitly say Unknown; route remains independent | Untested |
| Win+L, reconnect while locked, then unlock | Snapshot shows current lock; unlock event advances state; no forced fallback or playback change | Untested |
| Windows display off, dim, on | Only reported Windows display state changes; Car Thing stays manually usable | Untested |
| Suspend/resume with and without RFCOMM loss | Reported suspending/resuming/awake or Unknown; actual route loss clears rows and reconnect obtains fresh snapshot | Untested |
| Windows to Mac to Windows, including pending read | Windows readings clear on fallback; no stale event restores them; return waits for fresh snapshot | Untested |
| Native observer or Connector restart | New observer is accepted only through current snapshot; old events do not restore old readings | Untested |
| Old Connector, unavailable monitoring, malformed response or timeout | Unsupported/error/Unknown shown; Refresh state recovers when supported | Untested |
| Kiosk 800 by 480, touch, dial, Back, Spotify and phone | Scroll and existing controls remain usable; header route remains accurate | Untested |
| Existing manual Car Thing sleep/wake | Touch/physical wake and saved backlight restoration still work independently of Windows lock/power | Untested |
| Power-only run without USB data | State and route recovery work without manual kiosk/daemon reset | Untested |

Stop for D4 review. D5 is outside this change.
