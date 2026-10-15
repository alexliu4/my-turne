# Sprint 11: App launching and macros

Implementation is available for review. Sprint 11 remains pending Linux daemon tests and physical execution validation.

## Verified Connector contract

Read-only inspection of the sister Connector checkout at `9f8dcb36dc7783ff0a16e9401713b63a7dfa0140` confirmed:

- `src/server/nocturne-manager.ts` exposes `app_launch.get_status` (aliases `app.get_status`, `appLaunch.get_status`), `app_launch.launch` (aliases `app.launch`, `appLaunch.launch`), `macros.get_status` (alias `macro.get_status`), and `macros.execute` (aliases `macro.execute`, `macro.run`) through normal Connector RPC.
- `src/server/services/app-launch-service.ts` returns `{status, available, apps}`. Enabled configured applications have `id`, `name`, `target`, optional fallbacks and enabled fields. Launch accepts `{app: id}`; the Connector resolves its own configured target and rejects disabled or unknown IDs. Results carry `status`, `app`, `launched` and optional `error`.
- `src/server/services/macro-service.ts` returns `{status, available, macros}`. Enabled configured macros have `id`, `name`, `action`, and optional enabled fields. Execution accepts `{id}`; the Connector resolves its own configuration, including application targets. Results carry `status`, `action` and optional error/native result fields. Native app macros can return `launched: false`.
- Native Windows implementations in `windows/src-tauri/src/native/app_launch.rs` and `macros.rs` execute the Connector-resolved actions. URL and shortcut definitions are configured on the PC. The device does not accept or send those definitions.
- Both services bound host calls to two seconds. No action catalog push events exist; the device refreshes on screen entry, Windows session change and manual Refresh, with no polling.

No Connector files were modified. These methods use existing generic request/response envelopes and do not change generated shared contracts.

## Device behavior

Open Computer Control > Apps & Macros. Two independently validated catalogs show only enabled, uniquely identified, named actions advertised by an `ok`, available Connector response. The UI retains only IDs and display names. Missing or malformed catalogs show Unavailable; valid empty catalogs show No configured actions. One catalog failing does not hide the other. The list scrolls, and Back returns to the launching section, including after lock/unlock and disconnect.

A tap sends only `{app: id}` or `{id}` over the existing local UI WebSocket, daemon, and exact Windows Connector route. The UI verifies membership in the current session catalog and serializes execution and Refresh to prevent duplicate taps. Only an acknowledged successful launch or recognized successful macro reports completion. Failed or uncertain results clear the affected catalog and require Refresh. A timeout warns that the action may already have executed. Execution is never retried automatically.

Disconnect, fallback and Windows-to-Windows handoff immediately hide old host actions. Pending replies cannot affect another readiness generation or a remounted screen. Windows readiness reloads both catalogs automatically. Runtime configuration changes require Refresh; the Connector revalidates configuration on every execution.

The daemon gates all app launch and macro method families to scoped active Windows ownership. It rejects unknown methods and extra definition fields, allowing only one nonempty configured identifier for execution and empty status parameters. The Connector remains the authority for ID configuration and execution. Requests pin the accepted `_targetConnection` so fallback cannot receive an accepted Windows command. Generic media, Spotify and phone routing stay unchanged.

## Verification

Local results on October 15, 2026: all 618 UI tests passed across 50 files. TypeScript checking, the production UI build, changed-source Prettier checks, WebSocket rustfmt checks and `git diff --check` passed. Linux daemon tests and hardware checks have not run.

Local UI tests cover advertised catalogs, disabled/duplicate/malformed entries, IDs-only payloads, serialized taps, failed results, manual recovery, fallback, disconnect, Windows handoff, stale replies and unmount. Navigation tests cover catalog availability and Back origins through lock/unlock. Daemon routing tests cover all eleven RPC aliases under absent, Mac, Android, iOS, unscoped Windows and scoped Windows ownership, route pinning, definition rejection, and generic media/Spotify preservation.

Commands:

```sh
cd packages/ui
bun test
bun run build
cd ../..
rustfmt --edition 2021 --check crates/daemon/src/http/websocket.rs
# Linux:
cargo test -p nocturned http::websocket::tests
# Configured macOS cross environment:
cross test -p nocturned --target=aarch64-unknown-linux-gnu --features device http::websocket::tests
```

This Mac has neither cross nor Docker. Linux daemon behavioral execution and physical validation remain required; UI tests alone do not establish real Windows action reliability.

## Physical validation still required

- [ ] Configure applications and app, URL, media and shortcut macros on Windows. Verify only advertised enabled entries appear, using real configured display names.
- [ ] Launch VS Code, Discord and the configured browser from Car Thing. Execute each configured macro and verify the actual PC effect. Verify rapid taps execute only once while pending.
- [ ] Remove or disable an action on the PC after loading the catalog. Verify execution fails safely, Refresh removes the entry, and arbitrary targets cannot be supplied from Car Thing.
- [ ] Disconnect Windows while an action is pending with a Mac fallback present. Verify actions disappear, no command executes on the Mac, Back remains usable, and normal Spotify/phone controls keep working.
- [ ] Reconnect Windows, restart its Connector, interrupt Bluetooth and sleep/wake Windows. Verify fresh catalogs without UI restart or USB recovery; repeat a rapid Windows-to-Mac-to-Windows handoff.
- [ ] Exercise unsupported catalogs, host failures and lost replies. Verify independent catalogs, honest uncertain-outcome feedback and no automatic action replay.
- [ ] Check long action names and a large catalog on the 800 by 480 display. Scroll all entries, lock/unlock and verify Back returns to Computer Control or the original launching section.
