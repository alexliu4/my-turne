# Sprint 12: Reliability and recovery

Sprint 12 is in progress. Automated regression coverage and CI gates are implemented. Linux daemon execution and the final no-USB physical run remain required. No device deployment or physical result is claimed by this document.

## Invariant and recovery fixes

A Windows feature failure must not become a core Nocturne failure. All optional Windows features use the existing UI WebSocket, daemon and exact Connector route. No extra transport, connection manager, polling service or Connector implementation is introduced.

- Volume reads and mutations now carry `appReadyGeneration`, matching the other Windows screens. A request waiting for a usable local socket is cancelled if readiness changes before dispatch, including a fallback announcement whose clock sync is still pending. Checking only the eventual reply would allow an old action to execute on a later Windows session.
- Capability parsing accepts legacy status-less maps and string arrays, but explicit failed, unsupported or unavailable envelopes override their flags. Outer errors cannot be bypassed by a nested `result`. Failed authoritative Refresh clears previous availability, including handshake flags, until a successful read recovers it. Runtime capability changes are checked on manual Refresh, without polling.
- The Settings version timer is cancelled on unmount. Leaving Settings during recovery no longer leaves a state update running after the screen and its test DOM are gone.

## Automated evidence

Local verification on October 15, 2026 used Bun 1.4.2 and Cargo 1.99.0 on macOS. All 647 UI tests across 50 files passed, as did strict typechecking, Prettier and the production build. The build retains its large-chunk advisory. Native shared/codegen tests passed. `tools/test-workspace --locked` then stopped at `cross: command not found`; neither cross nor Docker is installed here, so Linux daemon/runtime tests remain unexecuted. CI uses the repository-pinned Bun 1.3.14 and still needs its own green run. `git diff --check` passed, and test exports left checked-in bindings unchanged.

The socket tests run the actual UI request multiplexer with a controlled WebSocket transport. Feature-hook tests render React against Happy DOM and mock daemon I/O. Rust tests exercise the daemon boundary separately. These layers do not establish real Bluetooth, Windows APIs or hardware responsiveness.

| Scenario                                                    | Regression coverage                                                                                                                                                                           | Execution status                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Queued commands during fallback                             | `useNocturned.test.js`: all four volume methods, media, capabilities, Discord, stats, app launch and macros reject dispatch after readiness changes, before replacement clock sync completes  | UI passed locally                                               |
| Optional RPC failures preserve core requests                | `useNocturned.test.js`: seven Windows method families fail on the same socket; subsequent Spotify and phone snapshot RPCs still complete                                                      | UI passed locally; routing/physical verification still required |
| Invalid wire data                                           | Socket test recovers after malformed JSON and malformed media payloads; feature tests reject invalid volume, stats, Discord and action results                                                | UI passed locally                                               |
| Rapid Windows to Mac to Windows                             | Socket test repeats handoffs with fresh generations and cleared media; feature tests reject stale reads/actions across handoffs                                                               | UI passed locally                                               |
| Reordered readiness and socket loss                         | Socket tests deliver clock-sync replies out of order, after offline events and after closure; new sessions recover                                                                            | UI passed locally                                               |
| Missing/disappearing capabilities and mixed response shapes | Capability tests cover legacy arrays/maps, missing/unknown flags, explicit failed envelopes, disappearing flags on Refresh and recovery after failure                                         | UI passed locally                                               |
| Media closes or disappears                                  | Windows Media tests clear stopped/closed snapshots, stale artwork and timeline; paused sessions remain visible                                                                                | UI passed locally                                               |
| Feature isolation and no repeated actions                   | Volume/media/Discord/stats/action tests cover serialized requests, unsupported results, disconnect, unmount and stale completions; uncertain launch/macro outcomes never replay automatically | UI passed locally                                               |
| Ownership and phone coexistence                             | `http::websocket::tests`: Windows priority, non-owner closes, Mac fallback, exact route pinning, phone calls/volume while Windows owns the desktop route                                      | Linux execution pending                                         |
| Core regressions                                            | Complete UI suite includes Spotify state/controls, phone calls, pairing, navigation, action mappings, Mockingbird and OTA; shared tests include fragmented and oversized frames               | UI and native shared/codegen passed; Linux runtime pending      |
| Clean reboot and redeployment                               | Requires real persisted state, systemd, Bluetooth and kiosk startup                                                                                                                           | Physical pending                                                |

CI now runs UI formatting, strict types, all behavioral tests and the production build using the manifest-pinned Bun 1.3.14. Changes to root `package.json`, `bun.lock` and generated TS contracts trigger that job. The daemon workflow adds native Linux workspace tests with `device` enabled, alongside the existing aarch64 production build. The workspace runner exports test-only generated bindings into a temporary directory. The new CI jobs have not been run from this local workspace; a green run is required before acceptance.

Local commands:

```sh
# From repository root:
(cd packages/ui && bun test)
(cd packages/ui && bun run lint-check)
(cd packages/ui && bun run build)
tools/test-workspace --locked
# On Linux, also exercise the shipping daemon feature:
tools/test-workspace --locked --features device
git diff --check
```

Run UI commands inside `packages/ui`: the icon fixture test uses paths relative to that directory. On macOS, the workspace runner first tests shared/codegen natively, then requires `cross` plus a configured container runtime for Linux runtime crates.

## Physical matrix and evidence record

Every row below is **Not run**. Before starting, record the test date, operator, device/image version, daemon build/commit, UI build/commit, Windows OS and Connector version/commit, Mac OS and Connector version/commit, and phone platform/app version. Record actual observations, timings, logs and pass/fail for each row. A failed or skipped required row keeps Sprint 12 open.

Use a power-only supply for the final run. Keep USB data disconnected throughout. Use existing network deployment and SSH access for deployment/logs; record whether any manual kiosk, daemon or Bluetooth restart was needed. Recovery rows should recover without those interventions.

For every lifecycle row, verify Host Status owner and capabilities, volume/mute, Windows Media, Discord, PC Stats and Apps & Macros. Verify stale host state clears, controls cannot reach Mac/phone fallback, Back stays usable and fresh Windows state returns. Also exercise canonical Spotify playback/pause/next and volume, native phone media, phone calls and phone volume using their normal paths. Run Spotify linked and skipped/unlinked configurations separately.

| ID  | Change or failure to induce                                                                                    | Required observation                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Start Mac first, then start Windows and its Connector                                                          | Mac works first; Windows becomes preferred without restarting Car Thing                                                          |
| L2  | Shut Windows down while Mac remains connected; boot Windows again                                              | Mac takes ownership; Windows returns and refreshes every feature                                                                 |
| L3  | Sleep/wake Windows both idle and during a pending command                                                      | No stuck pending screen or replayed mutation; fallback and return recover                                                        |
| L4  | Interrupt Windows Bluetooth during media and a pending read/action; restore it                                 | Stale state clears; replacement session rejects old replies and reloads state                                                    |
| L5  | Restart/force-close Windows Connector, including during an RPC                                                 | Core UI stays usable; Windows features recover on fresh readiness                                                                |
| L6  | Restart/reconnect Mac while Windows stays healthy, then remove Windows                                         | Mac never steals healthy Windows ownership; surviving Mac becomes usable fallback                                                |
| L7  | Repeat Windows to Mac to Windows handoffs at least ten times, including overlapping reconnects                 | No stale route, growing RPC backlog, duplicate macro or old artwork/metrics                                                      |
| L8  | Close browser/native media session; open another player                                                        | No media playing clears old presentation; new media and supported controls return                                                |
| L9  | Stop/restart Discord; remove/disable configured apps/macros; change capability availability                    | Refresh clears disappeared features/catalogs; unknown Discord state stays unknown; other features still work                     |
| L10 | Use a controlled Connector fixture to return unsupported/errors, malformed events and delayed/lost RPC replies | No invented state, crash or repeated mutation; only the affected feature becomes unavailable; core calls still work              |
| V1  | Current daemon/UI with the oldest supported Windows Connector and a current Mac fallback                       | Missing optional methods remain unavailable; legacy response shapes work; fallback preserves core playback                       |
| V2  | Current Connector with the oldest supported daemon/UI pair, then upgrade UI before daemon                      | Record exact supported versions; absent methods fail safely, advertised Windows identity remains explicit and core controls work |
| V3  | Current versions of all components after the mixed-version runs                                                | All features recover without leftover cached catalogs, capabilities or media                                                     |
| R1  | Reboot Car Thing with both Connectors running; repeat with Windows absent                                      | Kiosk/daemon start cleanly, correct owner is selected, no stale Windows presentation or manual restart                           |
| R2  | Build and redeploy UI, reload kiosk; redeploy daemon through the normal image workflow                         | Fresh bundles and daemon versions are verified on device; reconnection and core playback recover                                 |
| R3  | Reboot again after deployment, then rerun L1, L4, L6 and L7 without USB data                                   | Complete end-to-end run passes on the deployed versions without manual recovery                                                  |

For L10, use controlled test fixtures or a dedicated Connector build. Do not send malformed data into production services without an isolated setup. For V1/V2, select actual supported release pairs and record them before testing; synthetic response fixtures alone are not mixed-binary validation.

Suggested deployment and evidence commands (operator-run on the configured device network):

```sh
just ui-build
just -f image/Justfile push-webapp ../packages/ui/dist ui
ssh root@nocturne.local 'systemctl restart chromium-kiosk.service'
just daemon-copy
ssh root@nocturne.local 'systemctl status nocturned.service chromium-kiosk.service --no-pager'
ssh root@nocturne.local 'journalctl -b -u nocturned.service -u chromium-kiosk.service --no-pager'
```

Capture version information from the device and Host Status before and after deployment, rather than assuming a local successful build is installed. Use the UI Restart action for a staged image update. Keep the existing explicit OTA activation policy.

## Acceptance

Sprint 12 is complete only after the Linux runtime tests and CI build pass, all required physical rows have recorded successful results, and the final deployed no-USB run verifies Spotify, phone and core Nocturne throughout. Earlier feature-specific physical checklists in [Discord](windows-discord.md), [PC Stats](windows-stats.md) and [Apps & Macros](windows-actions.md) remain applicable.
