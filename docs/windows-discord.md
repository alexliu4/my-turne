# Sprint 9: Discord integration validation

Implementation is available for review. Sprint 9 remains pending Linux daemon test execution and physical validation.

## Verified Connector contract

Read-only inspection of the sister Connector checkout at `9f8dcb36dc7783ff0a16e9401713b63a7dfa0140` confirmed these existing interfaces:

- `src/server/nocturne-manager.ts` dispatches `discord.get_status`, `discord.toggle_mute`, and `discord.toggle_deafen` with empty parameters over the existing Connector RPC path.
- `src/server/services/discord-service.ts` returns `status`, `available`, `running`, `state_known`, nullable `muted` and `deafened`, and optional `action` and `message`.
- `windows/src-tauri/src/native/discord.rs` detects Discord processes and sends keyboard shortcuts. Successful shortcut delivery does not verify mute or deafen. The current service reports `state_known: false` and null state even after successful toggles.
- Status requests actively reprobe Discord. Capability metadata uses cached availability and there are no Discord state events. This screen queries on entry and active Windows session changes, with manual Refresh for Discord start/restart. It does not gate recovery on cached capabilities or poll.

My-Turne consumes this contract without changing the Connector. Future verified boolean snapshots display actual state only when `status: "ok"`, `available`, `running`, and `state_known` are all true. Unverified or failed snapshots clear both displayed values. Toggle success with unverified state says the command was sent and instructs the user to check Discord. Timeout or unknown outcomes explicitly say the command may have executed; no automatic toggle retry occurs.

## Device behavior

Open Computer Control, then Discord. Back returns to the launching section. The card requires an active Windows Connector. If Windows becomes inactive while the screen is mounted, controls disable and old state clears. The daemon blocks all `discord.*` calls without a scoped Windows owner and pins accepted requests to that exact route, so a later fallback cannot receive the command.

A Discord error clears only Discord presentation. Refresh remains available with Windows active. Responses from an old session or unmounted screen are ignored. Volume, media, Spotify, and phone state retain their existing independent paths.

## Automated checks

Local results on October 14, 2026: all 597 UI tests passed across 48 files; the TypeScript check and production UI build passed; the changed daemon WebSocket file passed its direct Rust format check. Daemon behavioral tests and hardware checks have not run.

The focused Discord hook and rendered-screen tests cover unknown and verified snapshots, malformed responses, unsupported/failed/unknown actions, timeout outcomes, duplicate actions, same-session Discord recovery, fallback and offline ownership, Windows-to-Windows handoffs, stale replies, and unmounts. Computer Control navigation tests cover selection, offline restrictions, Back origins, and lock transitions. Daemon tests exercise rejection under Mac, phone and unscoped ownership and exact-route forwarding across fallback promotion, alongside generic media/Spotify routing.

Commands:

```sh
cd packages/ui
bun test
bun run build
cd ../..
rustfmt --edition 2021 --check crates/daemon/src/http/websocket.rs
# On Linux:
cargo test -p nocturned http::websocket::tests
# Or on a configured macOS cross environment:
cross test -p nocturned --target=aarch64-unknown-linux-gnu --features device http::websocket::tests
```

The current macOS environment has neither `cross` nor Docker, so daemon execution is pending. Workspace `cargo fmt --all --check` reports pre-existing formatting differences in `tools/codegen/src/dispatch/kotlin.rs`; the changed WebSocket file passes its direct format check.

## Physical validation still required

- [ ] With Windows connected and Discord running, open Computer Control > Discord. Confirm Connected, Mic: Unknown and Audio: Unknown with the current Connector.
- [ ] Focus Discord on the PC. Tap Toggle Mic and Toggle Audio separately. Verify the actual PC behavior and the unverified command notice on Car Thing. Confirm the UI never claims a mute/deafen value from shortcut success.
- [ ] Close Discord, then Refresh. Confirm Discord unavailable and disabled toggles. Restart Discord, then Refresh. Confirm controls recover in the same Connector session.
- [ ] Stop the Windows Connector with Mac connected. Confirm Mac fallback works, Discord controls cannot reach Mac, and stale Discord replies never restore state. Restart Windows and confirm a fresh status read.
- [ ] Interrupt Bluetooth or restart the Connector while a Discord request is pending. Confirm state clears and recovers cleanly; check Discord before retrying a toggle with an unknown outcome.
- [ ] Verify Windows volume, Windows Media, canonical Spotify and phone playback/call routing before, during and after Discord failure/restart. No USB recovery should be required.
- [ ] Verify touch Back returns from Discord to Computer Control, including after lock/unlock.
