# Sprint 10: PC Stats validation

Implementation is available for review. Sprint 10 remains pending Linux daemon tests and physical validation.

## Verified Connector contract

Read-only inspection of the sister Connector checkout at `9f8dcb36dc7783ff0a16e9401713b63a7dfa0140` confirmed:

- `src/server/nocturne-manager.ts` dispatches `system_stats.get`, `systemStats.get`, `stats.get`, and `system.get_stats` with empty parameters over existing Connector RPC.
- `src/server/services/system-stats-service.ts` returns `status`, `available`, nullable `cpu_percent`, `memory_percent`, `gpu_percent`, and nullable memory byte counts. It caches for one second, deduplicates in-flight work, and limits host RPC to two seconds. Failed or unsupported calls return unavailable metrics.
- `windows/src-tauri/src/native/system_stats.rs` owns native sampling, rate-limited to once per second. CPU uses GetSystemTimes deltas and can be null on the first sample; RAM uses GlobalMemoryStatusEx. GPU currently returns null.
- There are no system stats push events. My-Turne reads the existing sampled result only while the PC Stats screen is mounted. It starts one read on Windows readiness, then waits two seconds after a valid reply or five seconds after failure/unavailable before the next read. It has no global or daemon polling loop and never queues overlapping reads within a session.

No Connector files were changed. No shared wire schema change is required: this uses the existing generic request/response envelope.

## Device behavior

Open Computer Control > PC Stats. CPU and RAM show rounded Connector percentages. Missing or invalid percentages show Unavailable, and GPU appears only when the Connector supplies a valid percentage. Zero is valid; strings, nonfinite values, and values outside 0 through 100 are rejected. Memory byte counts are not used to invent a percentage.

Only an `ok`, available response can supply metrics. Unsupported, unknown, malformed, failed, or timed-out reads clear the old snapshot. Windows disconnect/fallback immediately hides readings; a new Windows readiness generation starts a fresh read. Old-session and unmounted-screen replies cannot update the screen or schedule more work. Back returns to the launching section, including after lock/unlock.

The daemon requires a scoped active Windows owner for all four existing stats method aliases and pins requests to that exact route. Mac, phone, absent and unscoped ownership reject stats requests. Generic Spotify and phone/media commands retain their existing routing.

## Automated checks

Local results on October 14, 2026: all 607 UI tests passed across 49 files; TypeScript checking and the production UI build passed. Changed UI source files passed Prettier checks, the changed daemon WebSocket file passed rustfmt, and `git diff --check` passed. Daemon behavioral tests and physical checks have not run.

Focused tests cover real Connector response shapes, optional/missing/invalid metrics, unavailable entry, Back, slow reads without overlap, failure backoff/recovery, Windows handoff, fallback, disconnect, stale replies, unmount cancellation, catalog navigation and lock/Back origins. Daemon tests cover all four aliases under absent, Mac, Android, iOS, unscoped Windows and scoped Windows ownership, exact-route forwarding after fallback promotion, and generic media/Spotify routing.

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

This Mac has neither cross nor Docker, so daemon behavioral tests cannot run here. Passing UI tests does not establish on-device RPC responsiveness.

## Physical validation still required

- [ ] Open Computer Control > PC Stats on Car Thing with Windows active. Compare CPU/RAM against Windows Task Manager under idle and load, allowing sampling differences. Verify updates remain responsive. Current Connector should omit GPU; check supplied GPU when supported.
- [ ] Keep stats open while playing media. Use the physical media/volume controls and other RPCs; verify responsiveness and normal Spotify/phone behavior under load. Confirm request cadence has no burst or growing backlog.
- [ ] Disconnect Windows with Mac present. Verify cleared metrics and PC unavailable while fallback media still works. Restart Windows and verify fresh telemetry without UI restart or USB recovery.
- [ ] Repeat with Bluetooth interruption, Windows sleep/wake, Connector restart, and a handoff during a pending read. Old replies must never restore old metrics.
- [ ] Exercise unavailable/unsupported sampling and missing CPU/RAM. Confirm old values clear and automatic recovery works without fabricated zero readings.
- [ ] Leave PC Stats and lock/unlock. Confirm stats reads stop while unmounted and Back returns to the launching section.
