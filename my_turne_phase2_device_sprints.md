# My-Turne — Phase 2 Device Implementation Roadmap

**Repository:** [`alexliu4/my-turne`](https://github.com/alexliu4/my-turne)  
**Companion repository:** [`alexliu4/my-turne-connector`](https://github.com/alexliu4/my-turne-connector)  
**Existing device roadmap:** `jules_my_turne_windows_sprints.md` (original Device Sprints 1–12)  
**Connector roadmap:** `my_turne_connector_phase2_enhancement_roadmap (1).md` (Connector Sprints 9–17)  
**Created:** 2026-10-14  
**Status:** D0 merged in PR #25. D1 Audio Output Selector implemented for review; physical integration remains untested. D2 has not started.

## 1. Purpose and architectural rules

Add Car Thing-side screens, button/knob behavior, and reliable device RPC integration for the **new capabilities in Connector Phase 2**. This document supplements rather than rewrites the original device roadmap. Number **Device Phase 2 Sprints D1–D8** separately to avoid collisions with original Device Sprints 1–12 and Connector Sprints 9–17.

**Selected transport architecture:**

```text
Windows available:
Car Thing UI -> local nocturned daemon -> Bluetooth/RFCOMM -> preferred Windows Connector -> Windows APIs

Windows unavailable:
Car Thing UI -> local nocturned daemon -> Bluetooth/RFCOMM -> Mac Connector -> normal Nocturne/Spotify

Proposed, conditional Home Assistant path:
Car Thing UI -> nocturned daemon -> explicitly targeted Mac Connector (or trusted Mac-host service)
             -> allowlisted HA adapter -> HA server (possibly on Mac mini)
```

- Do not revive direct Car Thing-to-LAN WebSockets, Mac TCP proxies, legacy Windows Companion, or an unauthenticated LAN server. Prior physical tests found no usable direct home-LAN route from Car Thing.
- `my-turne-connector` owns Windows APIs, endpoint/session discovery, settings, local diagnostics, and trusted Windows-host actions. `my-turne` owns device UI, knob/buttons, RPC lifecycle, route selection, stale-state handling, fallback, and backlight behavior.
- **Do not assume both Connectors can be independently addressed while Windows is preferred.** Windows-to-Mac fallback proves priority handoff, not parallel, feature-targeted RPC. Verify before implementing Mac-owned HA.
- Preserve original Spotify, phone/iOS/Android interactions, daemon WebSocket/RPC, normal Mac Connector behavior, Windows priority, and fallback. Never send Windows-only actions to a Mac route accidentally.
- Never modify both repositories in one PR. Do not fabricate Connector availability, authenticated responses, hardware testing, or unimplemented RPC methods.
- The Connector roadmap is a feature plan, not proof all related PRs are merged or hardware-validated; inspect live main and current contracts before each sprint.

## 2. Connector-to-device dependency matrix

| Connector Phase 2 | Host responsibility | Device counterpart | Decision |
|---|---|---|---|
| G0 — Physical integration checkpoint | Demonstrate installation, Bluetooth/RFCOMM, Windows→Mac→Windows handoff | **D0** baseline and cross-repo RPC inventory | Mandatory gate |
| Sprint 9 — Audio output discovery/switching | List outputs; switch confirmed default | **D1** audio output selector | Required for user-facing feature |
| Sprint 10 — Local config editor/diagnostics | Local Windows app/macro editor; HTTP diagnostics/export | **D3** limited Host Status improvements *if RPC accessible* | **No new device screen required**; do not fetch localhost-only desktop APIs from Car Thing |
| Sprint 11 — Per-application mixer | Enumerate and control endpoint-scoped sessions | **D2** app mixer with knob | Required for user-facing feature |
| Sprint 12 — Maintenance/recovery | Logs, restart/readiness and local diagnostic export | **D3** non-invasive availability/recovery UX | Recommended; no log export over Bluetooth |
| Sprint 13 — Session/lock/sleep/wake | Publish supported OS state and snapshots | **D4** host-state and optional display-power behavior | Recommended; only after contract exists |
| Sprint 14 — Home Assistant | **Conditional host ownership decision** | **D5a** route feasibility, **D5b** HA scene UI | Conditional; favor always-on Mac-host HA rather than Windows-only |
| Sprint 15 — Calendar | Authorized agenda source/contract, if chosen | **D6** agenda/meeting view | Conditional |
| Sprint 16 — Media/artwork fidelity | Targeted GSMTC fixes only if deficient | **D7** Windows Media polish | Optional / evidence-driven |
| Sprint 17 — OBS | Authenticated allowlisted OBS actions, if needed | **D8** OBS controls | Optional / skip by default |

**Minimum functional Phase 2 device delivery:** D0 + D1 + D2. D3/D4 are recommended reliability/user experience improvements. D5–D8 are gated separately and **are not required for Windows audio Phase 2 completion**.

## 3. Universal implementation workflow

For **every** device sprint:
1. Inspect latest `main`, original `jules_my_turne_windows_sprints.md`, current daemon/UI code, Connector RPC documentation and live Connector code. Confirm method names, event signatures, parameters, response semantics, and availability. Roadmap examples are not authoritative APIs.
2. Create **one focused `alexliu4/my-turne` PR** from current main; no Connector edits or cross-repo changes in that PR.
3. Reuse the existing daemon RPC path, active-route ownership, `useWindowsConnector`/capability hooks and Computer Control navigation patterns. No new direct LAN transport or generic proxy.
4. Show `offline`, `unsupported`, `loading`, `empty`, `unknown`, `error`, and `stale` accurately. On route/session change, invalidate stale requests, timers, sessions and rendered values. No fabricated success.
5. Guard any host action by current connector capability **and route ownership**; keep existing physical controls unchanged outside the feature UI and restore knob mappings on exit.
6. Bound refresh/polling, knob RPC frequency, queued actions, session lists, artwork and UI state. Handle restart, disconnect, Mac fallback, Windows return, and mixed Connector versions.
7. Add focused unit/integration tests for route correctness, RPC payloads, stale response races, unsupported/malformed responses, timeouts, knob controls, and reconnect. Run repo checks and build; record exact command results.
8. State manual *physical Car Thing + Windows + Mac* verification steps separately; mark outcomes **passed / failed / blocked / untested**. CI alone does not prove Bluetooth/hardware operation.
9. Stop for review. Do not auto-merge or start the next sprint.

### Reusable Jules kickoff prompt

```text
Repository: alexliu4/my-turne
Roadmap: my_turne_phase2_device_sprints.md
Task: Implement ONLY Device Phase 2 Sprint D<N> — <TITLE>.

Read this roadmap, the existing jules_my_turne_windows_sprints.md,
and current main. Inspect the actual Connector implementation and RPC contract
for the corresponding Connector Phase 2 sprint. Preserve existing Bluetooth/
RFCOMM daemon transport, Windows preference, Mac fallback, Spotify/phone
controls, and UI navigation. Use one focused PR in my-turne only.

Implement the specified screen/interaction and explicit offline/unsupported
states, route/session guards, stale-response cancellation, tests, and a manual
physical verification checklist. No fake Connector data, new LAN socket,
generic remote command surface, or changes in my-turne-connector.

If a required host RPC/event does not exist or the routing architecture is
unproven, document the blocker and stop rather than inventing a contract.
Do not merge or begin another sprint. Stop for code review.
```

---

## D0 — Cross-repository Phase 2 integration gate and contract inventory

**Priority:** Mandatory prerequisite; validation-first, code only for a reproduced gap.  
**Depends on:** Original Device Sprints 1–12, Connector G0 and availability of merged host features.  
**Goal:** Know exactly which host RPCs reach Car Thing before building device UI.

### Scope

- Audit real `my-turne` daemon routing, UI RPC dispatch, Windows preference, Mac fallback and capability metadata. Identify whether **non-preferred connectors remain connected and separately addressable**; do not infer this from automatic failover.
- Inventory authoritative Connector 9–13 RPC names, request/response schemas, feature support indicators, timeout behavior and event vs snapshot behavior. Record example wire payloads from code/tests.
- Verify Windows→Mac→Windows handoff with normal Spotify/phone controls and no USB data dependency; note physical testing gaps explicitly.
- Ensure new device features fail closed on wrong route, unknown versions, unsupported method and disconnect.
- Document a cross-repo compatibility matrix and test fixtures for subsequent device sprints.

### Acceptance

- [x] Verified contract table with method names and per-feature route ownership.
- [x] No Windows-specific method can execute via a fallback Mac route. D0 audio methods and aliases are covered by the passing Linux routing regression.
- [x] Actual physical Windows and Mac takeover evidence, or an explicit **blocked/untested** record.
- [x] Concurrent Mac targetability explicitly marked *verified / unavailable / not yet tested*.
- [x] No transport rewrite and no speculative feature implementation.

**Implementation record (October 19, 2026):** See [D0 contract inventory, compatibility matrix and physical gate](docs/phase2-device-contracts.md). Merged Connector main was inspected at `a19404d8ba72175bcfac01cffd34e17d0d3c95c4`. The audit found and guarded fallback routing for output/mixer methods and their aliases. Review [PR #25](https://github.com/alexliu4/my-turne/pull/25); Linux workspace tests, the aarch64 build and UI CI passed. Physical acceptance remains untested. Windows session/power support is absent from that merged revision, so D4 remains blocked. D1 is implemented separately; see the D1 record below.

**Stop and review:** Contract/test PR only if code changes are needed; otherwise commit a documentation/test matrix PR.

---

## D1 — Windows Audio Output Selector

**Priority:** Required. **Host dependency:** Connector Sprint 9.  
**Goal:** Switch PC playback from speakers to headphones or another enumerated output from Car Thing.

### Scope

- Add **Audio Outputs** entry in Computer Control / Windows Control, following existing Car Thing navigation and layout conventions.
- Fetch authoritative active endpoint list through the existing daemon→preferred Windows Connector RPC. Confirm `audio.outputs.list` and `audio.outputs.select` names/field shapes from implementation.
- Display friendly name, selected/default indicator, loading/empty/unsupported/disconnected states; no invented devices. Handle output removal while the list is open.
- Use knob rotation to move focus and an explicit button/press to request switching; disable repeated switches while a request is in-flight. Confirm the actual new system default via a fresh snapshot, not optimistic label updates.
- Respect roles (console/multimedia/communications) as supported; display a useful error for failed, denied, or unverified changes.
- Refresh upon entry, manual action, Windows reconnection, or explicit device change; do not aggressively poll.
- Preserve default knob mappings and Spotify volume when exiting the selector.

### Acceptance

- [x] Lists validated active endpoints and displays explicit role defaults in automated tests; physical accuracy remains untested.
- [x] Selection revalidates endpoint membership, requests explicit roles and requires fresh readback; stale IDs are blocked in tests. Physical switching remains untested.
- [x] Readiness generation and the merged D0 daemon guard block Mac/phone requests; automated fallback coverage passes.
- [x] Disconnect, unplug/replug, in-flight result after handoff, and mixed Connector versions are covered in tests.
- [ ] Physical Windows speakers↔headphones switch and Windows→Mac→Windows handoff validated or marked untested.

**Implementation record (October 19, 2026):** See [D1 contract, interaction, validation and physical checklist](docs/windows-audio-outputs.md). Implemented on current device main with Connector main reverified at `a19404d8ba72175bcfac01cffd34e17d0d3c95c4`. Review [PR #26](https://github.com/alexliu4/my-turne/pull/26). Physical acceptance remains untested. D2 has not started.

**Stop and review:** D1 device-only PR.

---

## D2 — Per-Application Windows Volume Mixer

**Priority:** Required. **Host dependency:** Connector Sprint 11, D1 route/endpoint model.  
**Goal:** Select Spotify, Discord, Chrome, games etc. and adjust **only that Windows audio session**.

### Scope

- Add **App Mixer** to Computer Control, either as a dedicated screen or a well-defined Windows Control subsection; avoid duplicating the existing master-volume screen.
- Discover real active sessions using the canonical `audio.sessions.list({deviceId?})` API. Show app label, associated output, current percent, mute state and session-scoped ID as an internal key. Display empty state when no sessions are active.
- Distinguish per-app session volume from **Windows master volume** and from Spotify/phone volume. Do not change master volume when selecting a session.
- Knob rotates the selected session volume while mixer is focused; buttons navigate/select session and explicitly mute/unmute. Preserve or deliberately remap the current physical input contract and restore it on exit.
- Send `audio.sessions.set_volume`/`audio.sessions.set_mute` with the **exact discovered session ID**, and endpoint ID if required by the live contract. Never construct IDs from app names/process IDs.
- Coalesce/limit dial-driven traffic; recognize `superseded` responses without treating them as failures or confirmations. Read back confirmed values and avoid stale UI if calls arrive out of order.
- Clear closed/stale sessions and refresh on reconnect/output switch; treat `invalid_session`, `invalid_device`, `unsupported`, `failed`, timeout and route loss explicitly.

### Acceptance

- [ ] At least two real concurrent sessions listed when available, including correct output endpoint.
- [ ] Adjust/mute one selected app; another app and master volume remain unchanged.
- [ ] Fast dial changes settle to final value without request flood, freezes or optimistic false confirmation.
- [ ] Endpoint switch, session restart, app exit, malformed response and Windows→Mac→Windows are safe.
- [ ] Normal Spotify/phone input remains intact outside mixer; physical Windows test documented.

**Stop and review:** D2 device-only PR; never alter Windows Core Audio code here.

---

## D3 — Host Status and Recovery UX Refinement

**Priority:** Recommended, small. **Host dependencies:** Connector Sprints 10 and 12.  
**Goal:** Make existing Host Status useful during reconnection without exposing local-only host diagnostics.

### Scope

- Audit the current Host Status/capability screen first and add **only status fields actually available via existing daemon RPC or handshake**.
- Distinguish Windows currently active, Mac fallback active, no Connector, known vs unknown capabilities, pending reconnect and failed host RPC. Clear stale readings after route changes.
- Provide a user-facing Refresh and concise non-sensitive troubleshooting guidance, e.g. check Windows tray/Connector and Bluetooth pairing; optionally display version/platform only when returned from verified device-safe RPC.
- **Do not call** the Connector's `localhost` HTTP config/diagnostics/export URLs directly from Car Thing; they are host-local security surfaces and not automatically exposed over RFCOMM.
- Do not stream logs, tokens, pairing secrets, device identifiers or raw diagnostics over Bluetooth.
- If new host health data is desired but no existing safe RPC exposes it, write a *separate Connector follow-up proposal* and keep the device PR to existing information.

### Acceptance

- [ ] Offline/unsupported/stale vs connected states are accurate; never label an unknown service as ready.
- [ ] Connection changes do not leave prior host diagnostics visible.
- [ ] Native/sidecar/Bluetooth indicators appear only if authoritative distinct signals exist.
- [ ] Core UI remains responsive after Connector crash/restart.

**Stop and review:** Small device-only PR; no new diagnostic server.

---

## D4 — Windows Lock, Sleep and Wake Display Awareness

**Priority:** Recommended after host contract is proven. **Host dependency:** Connector Sprint 13.  
**Goal:** Show accurate Windows session/power status and optionally adapt Car Thing screen behavior.

### Scope

- Validate the actual Connector Sprint 13 event and snapshot RPC contract before implementation. Prefer event updates plus snapshot refresh on reconnect; no aggressive polling.
- Maintain distinct states for **host session locked/unlocked/unknown**, **display on/off/unknown**, **suspend/resume/unknown**, and **Bluetooth route online/offline**. Locked is *not* disconnected.
- Optional user setting: dim/blank Car Thing when Windows locks or sleeps. Make it opt-in, reversible, with safe manual wake and fallback behavior. Avoid falsely blanking because of an unsupported/unknown state.
- Preserve Mac fallback and Spotify; don't couple Windows lock to forced route switching unless connection actually changes.
- Debounce duplicate notifications and guard against stale/out-of-order events across session generations.

### Acceptance

- [ ] Accurate or explicitly unknown host state; current snapshot wins after reconnect.
- [ ] No stale event drives dimming after Windows→Mac fallback.
- [ ] Manual controls, wake and backlight restoration work.
- [ ] Physical lock/unlock, sleep/wake, Windows→Mac→Windows scenarios tested or marked untested.

**Stop and review:** Device-only state/UI PR; never send direct power writes from Connector.

---

## D5a — Home Assistant Ownership and Feature-Targeted Route Feasibility

**Priority:** Conditional **architecture gate**; do **before** a Home Assistant UI.  
**Related Connector sprint:** Sprint 14 (conditional).  
**Recommended ownership:** A trusted always-on **Mac mini** service rather than the Windows Connector, if practical.

### Important setup fact

Neither the Mac mini nor Windows PC currently runs Home Assistant. A working HA scene integration first needs a **running HA server** (e.g. Mac mini VM/container or separate hub), paired devices/integrations, and defined scenes/scripts. No scene UI should pretend those exist.

### Scope

- Prove whether current `nocturned` can keep Windows and Mac RFCOMM connections available concurrently and address the non-preferred Mac without changing default Windows priority. Current tested fallback alone **does not prove** this.
- If feasible, design a constrained route selector for **a named allowlisted capability** (e.g. `homeassistant.scenes`) rather than a generic user-supplied device/host selector or arbitrary proxy.
- Keep Windows media/volume/Discord/app launch routed to active preferred Windows; route HA through a designated trusted Mac target, even when Windows is present. When Mac/HA unavailable, HA should fail closed without switching away from Windows.
- If parallel addressing is unsupported, document minimum safe daemon enhancement and choose between implementing it in a *separate follow-up PR* or deferring HA. Do **not** repeatedly force Windows↔Mac priority handoffs to run HA commands.
- Decide who hosts HA, whether Mac connector itself or a distinct local Mac agent owns HA credentials, and how the Car Thing obtains a sanitized capability manifest. Secrets stay on trusted host, never on device.
- Define RPC lifecycle, authorization, per-action allowlist, timeouts, failures, confirmation and audit requirements. No direct Car Thing-to-HA LAN call.

### Acceptance

- [ ] HA server/location choice recorded; installation/scene availability verified or explicitly blocked.
- [ ] Simultaneous Windows-preferred + Mac-targeted command feasibility supported by evidence (or marked infeasible).
- [ ] Windows controls remain functional during a Mac-targeted request and Mac failure.
- [ ] No arbitrary endpoint/action proxy or leaked HA tokens.
- [ ] Explicit go/no-go decision and reviewed host-side contract dependency before D5b.

**Stop and review:** Feasibility ADR/test PR. Do not implement the scene UI until the host integration exists.

---

## D5b — Home Assistant Scenes and Actions UI

**Priority:** Conditional. **Depends on:** D5a go decision, functioning HA server, trusted host-side allowlisted scene RPC.  
**Goal:** Use Car Thing buttons/knob to run safe, configured home scenes without disrupting Windows features.

### Scope

- Add **Home** or **Scenes** under Apps/Computer Control as appropriate; show only host-authorized, allowlisted scenes/scripts, with friendly titles and availability. Do not infer names from arbitrary HA entities.
- Explicit selection/confirmation for impactful actions; no arbitrary HA REST URL, JSON service-call editor, raw entity ID entry, or secret storage on Car Thing.
- Dispatch via verified targeted Mac route; preserve Windows media controls. Show success only when the trusted host reports a verified outcome; separate `sent`, `accepted`, `confirmed`, `unavailable`, and `failed` if supported by the contract.
- No optimistic light-state claims without authoritative state. Scene availability and completion refresh on route change; cache strictly bounded and invalidate on disconnect.

### Acceptance

- [ ] Allowlisted scene succeeds on real HA; unconfigured scene cannot be triggered.
- [ ] Windows volume/media continue working with Windows preferred.
- [ ] Mac disconnected/HA offline/expired token fail safely; no automatic connector role takeover.
- [ ] Device UI is usable via knob and buttons without affecting global mappings; physical validation recorded.

**Stop and review:** Device UI PR only; never add HA credentials to my-turne.

---

## D6 — Calendar and Meeting Context

**Priority:** Conditional. **Host dependency:** Connector Sprint 15 or a deliberately chosen independent/Mac adapter.  
**Decision first:** Specify data source, permissions, ownership, privacy, and verified agenda RPC.

### Scope

- Build an optional Agenda/Next Meeting view with local-time start/end, meeting-end countdown and all-day indicators; explicitly define source timezone and DST behavior.
- Respect privacy modes (hide event titles, don't show body/private URL). Never request calendar credentials on Car Thing.
- Cache only a bounded day/lookahead period; refresh on entry, event updates, route changes and authorized manual action.
- Distinguish no scheduled events from unavailable source; handle cancelled, moved, overlapping and all-day events, clock changes and offline state.
- No forced meeting join, no invasive full-screen takeover or automatic calendar write.

### Acceptance

- [ ] Accurate agenda/next meeting including DST and overlapping tests.
- [ ] Source revoked/unavailable vs empty state are distinct and non-sensitive.
- [ ] No event content persists beyond intended cache; Windows/Mac handoff doesn't show another host's stale agenda.
- [ ] Physical interface test recorded or marked untested.

**Stop and review:** Skip if no authorized, working host agenda source.

---

## D7 — Windows Media Metadata and Artwork Refinements

**Priority:** Optional, deficiency-driven. **Host dependency:** Connector Sprint 16 if needed.  
**Goal:** Improve an observed user-facing gap in existing Windows Media, not rewrite playback UI.

### Scope

- Before coding, test actual browser video, Spotify desktop, native player artwork, source names, progress and stopped/no-session transitions against current existing Windows Media UI.
- Record concrete reproducer/screenshot or trace; only implement the evidenced gap after validating whether host data already supplies a usable field.
- Bound artwork resolution/cache and Bluetooth transfer, clear stale artwork and timeline across route/media-session changes, and keep Spotify canonical state separate from GSMTC.
- If the issue is in Connector metadata generation, open a **separate Connector PR** first, then modify my-turne in its own PR.

### Acceptance

- [ ] Clear before/after reproduction for a real deficiency, or explicit **skipped—current behavior satisfactory**.
- [ ] No wrong/stale artwork, excessive payloads or Spotify/phone routing regression.

**Stop and review:** Do not implement absent a reproducible defect.

---

## D8 — OBS Creator Control Screen

**Priority:** Optional / skip by default. **Host dependency:** Connector Sprint 17 and verified OBS permission model.

### Scope

- Add opt-in OBS status/control screen only if there's an actual streaming/recording use case and a trusted authenticated host RPC.
- Display scene/recording status only when confirmed, distinguish disconnected/unavailable from stopped, and expose only allowlisted scene selection and explicitly confirmed start/stop actions.
- Avoid arbitrary websocket/URL entry, untrusted command proxy, credential prompts or storage on Car Thing; route via existing trusted Connector channel.
- Preserve Spotify/Windows controls when OBS is down or stops.

### Acceptance

- [ ] Approved actions work on test OBS with permission, unconfigured actions are blocked.
- [ ] Malformed/unknown/offline response cannot falsely show recording or invoke commands.
- [ ] Physical controls and route handoff validated or recorded untested.

**Stop and review:** Skip until a concrete OBS requirement exists.

---

## 4. Sequencing, sign-off and scope control

**Recommended sequence:** D0 → D1 → D2 → D3 → D4 (after Connector 13), then conditional D5a → host HA service/contract → D5b; D6/D7/D8 only if their prerequisites and use cases exist.

**Independent host development:** Connector Sprints 10 and 12 do not block D1/D2 unless a regression or missing capability contract is discovered. D4 depends on Connector 13; Mac-owned D5 does **not** require implementing HA in the Windows Connector.

| Device work | Initial status | Host dependency / prerequisite | Evidence / PR | Reviewer sign-off |
|---|---|---|---|---|
| D0: Cross-repo gate | Merged PR #25; CI passed; physical pending | Original device work, Connector G0 | [Contract evidence](docs/phase2-device-contracts.md) | PR merged; physical pending |
| D1: Output selector | Implemented for review; physical untested | Connector 9, D0 daemon guard | [Implementation and checks](docs/windows-audio-outputs.md) | Pending |
| D2 — App mixer | Not started | Connector 11 | — | — |
| D3 — Recovery UX | Not started | Existing RPC, Connector 10/12 where available | — | — |
| D4 — Lock/sleep UI | Blocked on host | Connector 13 | — | — |
| D5a — HA route feasibility | Conditional / not started | Mac-target feasibility; HA architecture | — | — |
| D5b — HA scene UI | Blocked on D5a + HA | Working HA server and trusted adapter | — | — |
| D6 — Agenda | Conditional / deferred | Authorized calendar adapter | — | — |
| D7 — Media polish | Optional / evidence needed | Observed reproduction | — | — |
| D8 — OBS | Optional / deferred | Actual OBS use case and trusted adapter | — | — |

**Definition of completion:** Phase 2 core device work is complete when the physical Car Thing reliably discovers and switches Windows outputs, controls individual audio sessions through the existing trusted route, and retains working Spotify/phone controls plus Windows→Mac→Windows fallback. D3/D4 add resilience; D5–D8 are independent opt-in enhancements, not release blockers.
