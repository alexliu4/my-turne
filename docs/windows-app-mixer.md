# D2 Windows App Mixer

Implemented October 19, 2026 from device main `690eb12e` (D1 merged as PR #26). Physical acceptance remains untested. This sprint changes only the device repository and stops for review.

## Verified host contract

Connector main was read at `8d0f144bd89a4b56dd52fd3e45f8f95ce3af643f` through GitHub, including [system-media-service.ts](https://github.com/alexliu4/my-turne-connector/blob/8d0f144bd89a4b56dd52fd3e45f8f95ce3af643f/src/server/services/system-media-service.ts) and [native/media.rs](https://github.com/alexliu4/my-turne-connector/blob/8d0f144bd89a4b56dd52fd3e45f8f95ce3af643f/windows/src-tauri/src/native/media.rs). The D0 inventory remains valid for these mixer methods:

| Method                      | Request                                            | Required result                                                                                                                                            |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio.sessions.list`       | `{}` enumerates all active render endpoints        | Error-free `status: "ok"` with `sessions: [{id, endpointId, appName, processId, volumePercent, muted}]`                                                    |
| `audio.sessions.set_volume` | `{sessionId, deviceId: endpointId, volumePercent}` | Error-free `status: "ok"` with finite `confirmedVolumePercent` in 0 to 100, within two percentage points of the requested value, matching native tolerance |
| `audio.sessions.set_mute`   | `{sessionId, deviceId: endpointId, muted}`         | Error-free `status: "ok"` and exact `confirmedMuted`                                                                                                       |
| `audio.outputs.list`        | `{}`                                               | D1 validated active endpoint IDs and friendly names for session output labels                                                                              |

IDs are opaque native endpoint/session-instance identifiers. App labels and process IDs never identify mutation targets. The service can return `superseded` for a replaced pending host request, which confirms nothing. There is no session-change event or dedicated mixer capability Boolean in the audited contract. Successful session discovery is the feature probe; master-volume capability does not establish mixer support. Existing D0 daemon guards reject these methods on Mac, phone, unknown or unscoped routes and pin accepted requests to the exact Windows connection.

The host service supplies defaults for some missing native fields, including volume and mute. The UI validates the device-facing response strictly but cannot detect values already defaulted by that service. This existing compatibility limitation requires physical verification and is not fixed by fabricating a version threshold.

## Interaction and lifecycle

Computer Control includes App Mixer. Selecting a row only selects the session. Buttons 1/2 or Previous app/Next app change selection, the dial changes that session by two percentage points per step, and dial press or Mute app/Unmute app explicitly changes mute. Escape and onscreen Back preserve the Computer Control origin. Windows master volume and Spotify/phone volume are separate controls.

The screen displays confirmed percentages and mute state alongside output names. Missing output labels read "Output name unavailable". Requested percentages are explicitly pending, never rendered as confirmed volume. Loading labels existing values potentially stale; unsupported, empty, offline, unknown and failure states have distinct messages.

Dial input has a 150 ms settle timer, one bounded latest-value slot clamped to 0 to 100, and one serialized request sequence. Further dial input replaces the pending target. Every mutation first rediscovers the exact session/endpoint pair, checks selection again, writes, then reads a fresh session snapshot even on failed, superseded or uncertain writes. Only both native confirmation and matching fresh readback establish the requested state. Failure cancels queued intent and never retries the uncertain mutation automatically. A request already dispatched to Windows cannot be undone by a handoff or screen exit.

All RPCs have four-second deadlines and carry the current readiness generation. Generation changes and unmount invalidate results and timers; selection changes and overlay protection discard unsent dial work. Late rejected writes cannot clear new-generation input. Active-screen snapshots run five seconds after completion while idle, plus entry, reconnect and manual Refresh. They refresh session membership and endpoint names after app exits, session restarts and output changes. There are no overlapping polls, background polls after exit, direct LAN requests or new transport paths.

The session parser accepts at most 256 unique bounded IDs and labels, explicit Boolean mute state, finite percentages and valid process IDs. Output parsing reuses D1's 128-endpoint bound. Lists scroll within the device viewport. Custom hardware mappings are suspended inside the mixer; screen capture listeners are removed on exit. Interactive targets retain native Enter/Escape behavior, repeats do not duplicate actions, vertical scrolling remains native, and protected overlays retain hardware input.

## Automated validation

Tests use synthetic contract fixtures, not captured hardware results. They cover payload validation and bounds, two distinct sessions/endpoints, exact mutation IDs, unchanged other-session values, volume coalescing/clamping, mute serialization/readback, invalid session/device, unsupported, failed, superseded, timeout, missing/invalid confirmations, readback disagreement, endpoint changes, session exit, polling, handoff/reconnect at preflight/mutation/readback, unmount, overlay cancellation, native control keys, input capture cleanup and Computer Control navigation/offline/Back origins.

Local validation with Bun 1.4.2:

- `cd packages/ui && bun test`: 725 passed, 0 failed across 52 files, including existing D0 socket and D1 regressions.
- `cd packages/ui && bun run lint-check`: passed strict TypeScript and Prettier checks.
- `cd packages/ui && bun run build`: passed. Existing mixed static/dynamic import and large-chunk advisories remain.
- `git diff --check`: passed.

No daemon or generated binding changes are required. No hardware run was performed. Linux daemon runtime tests and physical Bluetooth behavior are not newly verified by this UI-only change.

## Physical verification checklist

All rows are **untested**. Record operator/date, device image/daemon/UI revisions, Windows and Mac OS/Connector revisions, result, recovery time and relevant logs. Do not mark passing from synthetic tests or CI.

| Scenario                                                                     | Required observation                                                                                                        | Outcome  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| Play two Windows applications concurrently                                   | Both real sessions and correct output labels appear; duplicate app names remain separately selectable                       | Untested |
| Select Spotify, rotate quickly, stop                                         | Final requested session volume settles, Discord and Windows master volume remain unchanged; no frozen controls or RPC flood | Untested |
| Mute/unmute Spotify and Discord independently                                | Only selected session changes, Windows and fresh UI agree                                                                   | Untested |
| Switch speakers/headphones through D1 while apps play                        | Reopening D2 discovers the current endpoints; stale pairs never mutate a different session                                  | Untested |
| Close/restart selected app or unplug output, including during dial/write     | Session disappears or refreshes safely; explicit failure/unknown state, no automatic uncertain mutation retry               | Untested |
| Windows disconnect, Mac fallback, Windows returns during list/write/readback | State and unsent input clear, no mixer action reaches Mac; returning Windows requires fresh discovery and selection         | Untested |
| Unsupported/older Connector, native failure, response timeout                | Accurate unavailable/unknown state; UI remains responsive and Refresh recovers                                              | Untested |
| Enter/exit mixer using knob, preset buttons, Back and touch                  | 1/2 select, dial adjusts selected session, press mutes, Back restores navigation and normal mappings                        | Untested |
| Open call, power or other critical overlay during queued dial input          | Overlay owns input; unsent mixer work is discarded                                                                          | Untested |
| Exit to Spotify and phone playback on Windows and Mac fallback               | Normal media and volume input works; no leftover mixer capture or polls                                                     | Untested |
| Final mixed Windows/Mac run without USB data                                 | Bluetooth ownership and normal controls recover without manual daemon/kiosk restart                                         | Untested |
