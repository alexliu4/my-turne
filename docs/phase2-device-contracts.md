# Device Phase 2 D0: contract inventory and integration gate

October 19, 2026. Prepared for review; physical acceptance is untested. D1 has not started.

## Evidence boundary

Device baseline: main `f0214ab4` (includes original Sprint 12). Connector merged main: `a19404d8ba72175bcfac01cffd34e17d0d3c95c4`, verified against the remote main ref on the audit date. Only committed Connector main was audited, using a temporary read-only source snapshot. The Connector working checkout contains newer development and uncommitted changes, which are not evidence of merged availability. No Connector files were changed.

Authoritative Connector sources at that revision:

- [Device RPC dispatcher](https://github.com/alexliu4/my-turne-connector/blob/a19404d8ba72175bcfac01cffd34e17d0d3c95c4/src/server/nocturne-manager.ts): `onCall`, `getCapabilities`, `refreshHostStatus`, `getHostStatus`.
- [Audio service and response types](https://github.com/alexliu4/my-turne-connector/blob/a19404d8ba72175bcfac01cffd34e17d0d3c95c4/src/server/services/system-media-service.ts): role validation, three-second native deadlines, session command coalescing and response normalization.
- [Native audio implementation](https://github.com/alexliu4/my-turne-connector/blob/a19404d8ba72175bcfac01cffd34e17d0d3c95c4/windows/src-tauri/src/native/media.rs): endpoint enumeration, default readback, endpoint-scoped opaque session IDs and mutation confirmation.
- [Audio service tests](https://github.com/alexliu4/my-turne-connector/blob/a19404d8ba72175bcfac01cffd34e17d0d3c95c4/src/server/services/system-media-service.test.ts) and [native bridge](https://github.com/alexliu4/my-turne-connector/blob/a19404d8ba72175bcfac01cffd34e17d0d3c95c4/src/server/platform/host-bridge.ts).

The following table describes RPC result bodies, after the Connector's `{result: ...}` envelope. Optional response fields must not become invented device state.

## Verified contract table

| Host sprint / device consumer | Device-facing method and parameters | Result and failure semantics | Route, support and freshness |
| --- | --- | --- | --- |
| 9 / D1 | `audio.outputs.list({})` | `{status, selectedDeviceId?: string \| null, devices: [{id, name, state, isDefault, defaultRoles: {console, multimedia, communications}}]}`. Empty successful list differs from unsupported. | Active Windows only. Snapshot; no dedicated output-change event found. Three-second native call deadline. |
| 9 / D1 | `audio.outputs.select({deviceId, roles?: ["console", "multimedia", "communications", "all"]})` | `{status, deviceId?, confirmed?}`. Default roles are console and multimedia. Singular `role` is accepted; plural takes precedence after both are validated. Invalid role/device, missing device, access denial, failed confirmation and unsupported are distinct native outcomes, although the service drops native error codes. Partial multi-role changes can precede failure; always re-read. | Active Windows only. Success requires `status: "ok"`, `confirmed: true`, matching ID and fresh list readback. No automatic mutation retry after timeout. |
| 11 / D2 | `audio.sessions.list({deviceId?})` | `{status, sessions: [{id, endpointId, appName, processId, volumePercent, muted}]}`. Omitted endpoint enumerates active render endpoints; explicit endpoint filters. IDs are opaque and endpoint-scoped, not process IDs. | Active Windows only. Snapshot; no dedicated session-change event found. Three-second native call deadline. |
| 11 / D2 | `audio.sessions.set_volume({sessionId, volumePercent, deviceId?})` | `{status, confirmedVolumePercent?}`. Missing/closed session and invalid endpoint/volume are failures. Service coalesces overlapping values per session; replaced pending requests receive `superseded`, which confirms nothing. | Active Windows only. Native readback confirms volume; device still needs serialized/coalesced input and session guards. |
| 11 / D2 | `audio.sessions.set_mute({sessionId, muted, deviceId?})` | `{status, confirmedMuted?}`. Native failures include invalid session/device, failed and unsupported. Do not flip a local Boolean on receipt of an unverified result. | Active Windows only. Three-second native call deadline. |
| Existing capabilities / D0-D3 | `connector.capabilities({})` | `{capabilities: {volume, media, discord, systemStats, macros, appLaunch}}`, Boolean flags. No output, mixer or OS-session flags exist in this merged revision. | Daemon requires active Windows. Cached feature observations, not a new probe or proof of output/mixer availability. Probe the feature snapshot in D1/D2; unknown method/unsupported keeps it unavailable. |
| 10 and 12 / D3 | `host.get_status({})`; aliases `host.status`, `connector.get_status`, `connector.status` | `{status: "ok", hostStatus: {platform, connectorPlatform, version, connected, deviceConnected, hostBridgeConnected, capabilities, services}}`. Services include volume/media/Discord/stats/app/macro summaries. Bridge connectivity is nullable off Windows and does not prove each feature works. | Currently generic active-owner routing; not used by a device Windows feature. Any D3 consumer must add Windows ownership guards and validate platform before presenting Windows status. Refresh uses bounded individual probes (volume two seconds); no aggregate device-safe completion deadline is promised. |
| 10 and 12 / desktop only | `/api/diagnostics/status`, `/api/diagnostics/export`, configuration editor | Same-origin localhost HTTP surfaces, not Bluetooth RPC. | Unavailable directly from Car Thing. No log/config export or loopback fetch should be added here. |
| 13 / D4 | No merged `windows.session.get_status`, `windows.session.changed` or OS-state handshake contract found. | Unknown method follows dispatcher error path. Local development documentation is not a merged contract. | Blocked on host merge and a new audit. No display-power behavior implemented. |

Canonical audio methods and all dispatcher aliases are guarded by this D0 fix. Output aliases: `media.get_audio_outputs`, `audio.get_outputs`, `media.set_audio_output`, `audio.select_output`. Session aliases: `media.get_audio_sessions`, `audio.get_sessions`, `media.set_audio_session_volume`, `audio.set_session_volume`, `media.set_audio_session_mute`, `audio.set_session_mute`. Unknown methods within `audio.outputs.*` and `audio.sessions.*` also fail closed on fallback. Windows forwards unknown methods to the existing Connector error path; the daemon does not invent support.

## Routing and lifecycle audit

`crates/daemon/src/http/websocket.rs::AppReadyRegistry` retains readiness by exact connection route. The newest Windows entry wins; without Windows, the newest surviving ready route wins. Closing a non-owner removes only that route. Closing the owner promotes and replays the surviving snapshot; losing the final route broadcasts `ready: false`.

The WebSocket boundary selects `active()` and supplies internal `_targetConnection`. `crates/daemon/src/bluetooth/mod.rs::should_route_message` matches an exact connection before considering peer fallback. Accepted audio requests stay pinned to that connection if ownership subsequently changes; they are not rerouted to Mac. This cannot undo an operation already dispatched to Windows. New audio requests after fallback are rejected before enqueueing. Generic Spotify and phone-media methods retain their existing routing; native phone calls still use `phone_request_route`.

The reproduced code gap was the missing Windows guard on all new audio methods and aliases. The added daemon regression invokes the real incoming-request handler with Mac, unknown, Android, iOS, unscoped Windows and exact Windows readiness. It checks rejection before forwarding, unchanged method/parameters, route pinning after handoff and generic Spotify/media routing. Linux CI executed and passed this regression at `1574597f`; see the CI evidence below.

`app/msgpack.rs::normalize_app_ready_event` already preserves `capabilities` and canonical/legacy Connector platform identity. The older roadmap statement that capabilities are dropped is stale. `hostStatus` is not preserved by that normalizer, so D3 must use the explicit RPC rather than assume handshake health survives. No shared schema or generated bindings changed in D0.

`packages/ui/src/hooks/useNocturned.ts` owns one local WebSocket and UUID request multiplexer. Passing `appReadyGeneration` cancels queued sends after any readiness change, including fallback while time sync is pending. Its default request timeout is 30 seconds. Callers must also discard already-dispatched replies after readiness/unmount changes, as existing Windows feature hooks do. D1/D2 must choose bounded screen deadlines, clear stale state and never replay uncertain mutations automatically. A timeout does not prove an operation never ran.

Concurrent Mac targetability: **unavailable through the current UI RPC API; physical concurrent connectivity not yet tested**. The registry and exact transport filter support retaining multiple routes in code, but public UI requests can only select the preferred owner. User-supplied `_targetConnection` parameters do not select a route. This is not proof of a safe, authorized Mac-targeted HA path. D5a still requires its separate allowlisted design and physical evidence; no priority switching or new connection manager is added.

## Compatibility matrix

| Device / host combination | Expected behavior | Evidence status |
| --- | --- | --- |
| D0 daemon + audited Connector main on Windows | Audio canonical methods/aliases target exact preferred Windows; feature snapshots determine runtime availability. | Source audit and passing Linux routing regression; physical untested. |
| D0 daemon + Mac or registered iOS/Android fallback | Output/mixer methods reject; existing Spotify and phone paths continue. | Source audit and passing Linux routing regression; physical untested. |
| D0 daemon + old Windows Connector without audio methods | Unknown-method error/unsupported; no fabricated devices or sessions. | Dispatcher contract; mixed-binary physical test untested. |
| Older daemon + current Connector | Audio methods can pass to fallback because guard is absent. | Source gap; require D0 daemon before deploying D1/D2 UI. |
| D0 daemon + missing/unknown Connector identity or unscoped Windows readiness | Audio requests reject. | Passing Linux routing regression; physical untested. |
| Current merged Connector + D4 concept | No verified OS-state contract. | Blocked, not feature-ready. |

Host service normalization supplies defaults for some missing audio fields, including session volume and mute. A valid-looking service result therefore does not prove every native field was sampled. D1/D2 must strictly validate result shapes and confirmations, avoid optimistic state, and record this compatibility limitation during physical validation. No version cutoff or supported release pair has been invented.

## Wire examples and regression fixtures

These are synthetic test vectors derived from the audited dispatcher/native implementation, not captured hardware traffic or production device data. IDs deliberately have no real host identity. Local UI requests include `type`, UUID `id`, `method`, `params`; daemon transport adds internal routing, and Connector RPC replies preserve the correlation ID.

```json
{
  "outputs": {
    "request": {"method": "audio.outputs.list", "params": {}},
    "result": {"status": "ok", "selectedDeviceId": "endpoint-a", "devices": [{"id": "endpoint-a", "name": "Speakers", "state": "active", "isDefault": true, "defaultRoles": {"console": true, "multimedia": true, "communications": false}}]}
  },
  "select": {
    "request": {"method": "audio.outputs.select", "params": {"deviceId": "endpoint-a", "roles": ["console", "multimedia"]}},
    "result": {"status": "ok", "deviceId": "endpoint-a", "confirmed": true}
  },
  "sessions": {
    "request": {"method": "audio.sessions.list", "params": {"deviceId": "endpoint-a"}},
    "result": {"status": "ok", "sessions": [{"id": "opaque-session-a", "endpointId": "endpoint-a", "appName": "Player", "processId": 123, "volumePercent": 42, "muted": false}]}
  },
  "volume": {
    "request": {"method": "audio.sessions.set_volume", "params": {"sessionId": "opaque-session-a", "deviceId": "endpoint-a", "volumePercent": 50}},
    "result": {"status": "ok", "confirmedVolumePercent": 50}
  },
  "mute": {
    "request": {"method": "audio.sessions.set_mute", "params": {"sessionId": "opaque-session-a", "deviceId": "endpoint-a", "muted": true}},
    "result": {"status": "ok", "confirmedMuted": true}
  }
}
```

Subsequent feature tests should use these as shape references alongside `{status: "ok", devices: []}`, `{status: "ok", sessions: []}`, `{status: "unsupported"}`, `{status: "superseded"}`, `{status: "invalid_session"}`, `{status: "invalid_device"}`, `{status: "device_missing"}`, `{status: "access_denied"}`, `{status: "failed", confirmed: false}` and RPC unknown-method errors. Reject malformed numeric/Boolean fields, absent confirmations, oversized lists and old-generation results. These parser/UI tests belong to D1/D2; no parser or screen is invented in D0.

## Physical gate and sign-off

All rows are **untested**, not passed. Record operator/date, device image/daemon/UI commits, Windows/Mac OS and Connector commits, phone/app version, elapsed recovery time, logs and observed results. No physical run was performed in this task and no physical result is claimed. Original Sprint 12 and Connector G0 physical acceptance remain prerequisites.

| Scenario | Required observation | Outcome |
| --- | --- | --- |
| Mac first, Windows starts, Windows stops, Windows returns | Correct Mac to Windows to Mac to Windows owner; no manual device restart. | Untested |
| Mac reconnects while Windows stays healthy | Windows keeps ownership; losing a non-owner does not interrupt playback. | Untested |
| Windows sleep/wake, Bluetooth interruption, Connector restart | Stale feature state clears, fresh readiness recovers, no queued mutation reaches fallback. | Untested |
| Spotify linked and skipped; phone playback/calls/volume during handoffs | Core functions remain usable on their intended routes. | Untested |
| Output/session read RPCs on actual Windows | Record real IDs, roles, runtime unsupported states and timeout behavior without mutating outputs in D0. | Untested |
| Simultaneous Mac and Windows route retention | Capture both exact routes and preferred owner. Does not authorize targeted HA commands. | Untested |
| Power-only final run, no USB data | Handoff and core controls recover without USB or manual daemon/kiosk/Bluetooth recovery. | Untested |

D0 review may assess the documented code contracts and routing fix. D0 physical acceptance, reviewer sign-off and progression to D1 remain pending. No transport rewrite, display behavior, feature screen or Connector modification is part of this change.

## Local validation

macOS local evidence with Bun 1.4.2 and Cargo 1.99.0:

- `bun test src/hooks/useNocturned.test.js`: 71 passed, 0 failed, including five new audio queued-dispatch cases.
- `bun test`: 652 passed, 0 failed across 50 files.
- `bun run lint-check`: strict types and Prettier passed.
- `bun run build`: passed; existing mixed static/dynamic import and large-chunk advisories remain.
- `tools/test-workspace --locked`: native shared/codegen tests passed, then exited 127 at `cross: command not found`. Linux daemon/runtime tests, including the new routing test, are unexecuted locally. Docker is also absent. Subsequent Linux CI executed the workspace and aarch64 build successfully; see below.
- `rustfmt --check --edition 2021 crates/daemon/src/http/websocket.rs` and `git diff --check`: passed. Workspace-wide `cargo fmt --all --check` also reports pre-existing formatting in `tools/codegen/src/dispatch/kotlin.rs`; that unrelated file was left unchanged.
- Generated bindings remain unchanged. Physical tests and reviewer sign-off remain pending.

Linux runtime tests require Linux or `cross` with a container runtime on macOS.

```sh
cd packages/ui
bun test src/hooks/useNocturned.test.js
bun run lint-check
bun run build
# From repository root:
tools/test-workspace --locked
rustfmt --check --edition 2021 crates/daemon/src/http/websocket.rs
git diff --check
```

## Published review and CI evidence

[PR #25](https://github.com/alexliu4/my-turne/pull/25) is ready for review. CI at implementation commit `1574597f662a06f457911d8c2d143828a4f68fa0` passed on October 19, 2026:

- [Linux workspace tests with device features](https://github.com/alexliu4/my-turne/actions/runs/39209588489/job/117919783202): passed, including `http::websocket::tests::phase2_audio_rpcs_require_windows_and_pin_the_accepted_route`. The daemon test binary reports 285 passed, 0 failed, 3 ignored; separate hardware/doc tests remain ignored as reported by CI.
- [Production aarch64 build](https://github.com/alexliu4/my-turne/actions/runs/39209588489/job/117919783626): passed.
- [UI checks and build](https://github.com/alexliu4/my-turne/actions/runs/39209588223/job/117919782318): passed.

This closes the Linux execution gap for the D0 code change. It does not establish physical acceptance of D0, Connector G0 or original Sprint 12. Reviewer sign-off and the physical matrix remain pending; D1 remains unstarted.
