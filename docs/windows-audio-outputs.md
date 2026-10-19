# Device Phase 2 D1: Windows Audio Outputs

October 19, 2026. Device-only implementation in [PR #26](https://github.com/alexliu4/my-turne/pull/26), ready for review. Physical integration is untested. D2 has not started.

## Contract and baseline

Started from device main `81cab3724ab0930fc4d47a037984d99228fd5ed1`, after D0 [PR #25](https://github.com/alexliu4/my-turne/pull/25) merged. Rechecked Connector main on October 19 at `a19404d8ba72175bcfac01cffd34e17d0d3c95c4`. Read the actual dispatcher, audio service and Windows native implementation at that revision. No Connector files changed. D0 physical acceptance remains untested; this task's request to work on the next sprint authorizes preparing D1 for review, without claiming that gate passed.

Authoritative sources:

- [Dispatcher](https://github.com/alexliu4/my-turne-connector/blob/a19404d8ba72175bcfac01cffd34e17d0d3c95c4/src/server/nocturne-manager.ts): `audio.outputs.list({})` and `audio.outputs.select({deviceId, roles})`.
- [Audio service](https://github.com/alexliu4/my-turne-connector/blob/a19404d8ba72175bcfac01cffd34e17d0d3c95c4/src/server/services/system-media-service.ts): normalized results and three-second native deadlines.
- [Native endpoints](https://github.com/alexliu4/my-turne-connector/blob/a19404d8ba72175bcfac01cffd34e17d0d3c95c4/windows/src-tauri/src/native/media.rs): active render enumeration, role defaults and per-role readback after selection.
- [D0 inventory](phase2-device-contracts.md): wire examples, daemon route guard and physical prerequisites.

The list returns `status`, optional `selectedDeviceId` (console default) and `devices` with `id`, `name`, `state`, `isDefault` (console) and Boolean `defaultRoles.console/multimedia/communications`. Selection requires `status: "ok"`, `confirmed: true` and the matching `deviceId`. The screen additionally reads a fresh list and verifies every requested role on that ID before reporting success.

There is no output capability flag or output-change event in audited main. The existing master-volume flag does not establish output support. The list is the feature probe; unsupported/unknown method, malformed data and transport errors leave controls unavailable with Refresh. Connector normalization can supply missing names/state/false role flags and maps native exceptions to unsupported. Device validation cannot recover that lost distinction. No release-version cutoff or hardware support claim is invented.

## Interaction and lifecycle

Computer Control includes Audio Outputs after Windows Control. Playback switches console and multimedia, Calls switches communications, and All roles switches all three. Each endpoint displays its independently reported defaults. Touch requests selection; horizontal dial rotation moves focus without sending RPCs, and Enter requests the focused output. Escape or onscreen Back returns to the launching section. The screen remains visible as unavailable on fallback and clears all endpoints; Windows return refreshes discovery.

App suspends custom hardware mappings while this screen owns the dial, and disables screen input beneath overlays. Enter and Escape targeting interactive controls or their descendants retain native keyboard behavior. Untargeted document/body/window key events use the existing dial/Back path, consuming down, repeats and release while acting only once on the initial keydown. Overlay input disabling leaves those events for the overlay. Handlers are removed on exit. Normal Spotify, phone, Mac and other screens keep their existing mappings. Lists are scrollable and capped at 128 validated endpoints; strings are bounded, duplicate IDs and contradictory role defaults reject the snapshot. Only active endpoints can be selected.

There is one serialized operation per screen/session. Reads and selections carry a four-second RPC timeout plus `appReadyGeneration`. Entry, manual Refresh and Windows reconnection refresh the list; there is no polling or speculative event listener. Before selection, a fresh list revalidates the exact discovered ID. Removal prevents dispatch, and a later Refresh discovers replugged outputs. An unplug race after dispatch still relies on Windows native validation.

Selections always re-read defaults, including after rejection or timeout, because a multi-role write can partially change Windows before failure. A readback never upgrades a rejected or uncertain mutation to success. Failed readback clears defaults; an uncertain command is never retried automatically. Previously displayed defaults are labeled potentially stale while busy. Generation/token checks discard late preflight, mutation and readback replies after fallback, a new Windows session or unmount. The D0 daemon guard blocks fallback routing; a command already dispatched to Windows may still finish there.

## Verification

Automated UI tests exercise real hooks/components with only daemon I/O mocked. Test endpoints are synthetic fixtures derived from the audited contract, not captured hardware data. Coverage includes exact payloads and role choices, endpoint removal/replug, malformed/oversized/contradictory results, missing confirmations, partial failure, denied changes, timeout without mutation retry, stale replies at every await boundary, Mac/phone/disconnect fallback, Windows return, knob focus/press, targeted Refresh/Back/role/output keyboard activation, repeat/release consumption without duplicate switches, overlay input gating, key/wheel cleanup and Computer Control navigation/lock origins.

Local macOS validation with Bun 1.4.2:

- `cd packages/ui && bun test`: 696 passed, 0 failed across 51 files, including 43 output tests and navigation regressions.
- `cd packages/ui && bun run lint-check`: passed strict TypeScript and full UI Prettier checks.
- `cd packages/ui && bun run build`: passed. Existing mixed static/dynamic import and large-chunk advisories remain.
- `git diff --check`: passed.

UI CI uses pinned Bun 1.3.14 and will run the same tests, formatting, types and production build on the review PR. No daemon/shared/generated source changes are required; Rust runtime validation is covered by merged D0 evidence and is not newly claimed here.

## Physical checklist

Every row is **untested**. These checks require a Car Thing, Windows Connector and Mac fallback. Record operator/date, image/daemon/UI and both Connector commits, Windows/Mac versions and observed results. CI and rendered DOM tests do not establish Bluetooth or audio behavior.

| Scenario | Required observation | Outcome |
| --- | --- | --- |
| Open on Windows with speakers and headphones | Real friendly names and console/multimedia/call defaults match Windows settings. | Untested |
| Playback speakers to headphones and back | Knob focus sends nothing; explicit press switches both playback roles; fresh snapshot confirms audible output and Windows settings. | Untested |
| Calls and All roles | Only requested defaults change; readback and Windows settings agree. | Untested |
| Remove/replug output while open | Refresh removes/re-adds it; selection preflight blocks a removed ID; no fabricated endpoint. | Untested |
| Denial, unsupported/old Connector, timeout or partial change | Clear feedback; no optimistic success or automatic retry; Refresh recovers. | Untested |
| Windows to Mac to Windows during every request phase | Endpoints clear, fallback receives no audio output action, Windows return reads a new snapshot. | Untested |
| Exit by Back, lock/unlock and overlays | Dial handler restores; overlays suppress selection; normal Spotify volume, phone controls and navigation work. | Untested |
| Power-only device, Connector restart and Bluetooth interruption | Recovery works without USB data or manual device restart; D0/G0 physical matrix also completed. | Untested |

Stop at D1 review. Do not merge or start D2 in this task.
