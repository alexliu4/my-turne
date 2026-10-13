# Sprint 8 PR #19 re-review

Reviewed the existing `jules-sprint-8-action-mapping-24958094213104335` branch after `d1c4aab`. Changes stay in the device UI and remove the three unrelated generated-binding formatting diffs. No Connector repository or future sprint changes were made.

## Findings and fixes

1. Windows dispatch reads the live app-ready state, ignoring both stale true and stale false context flags. The preset callback includes `isWindowsActive` in its dependencies. All Windows RPCs retain the app-ready generation guard, and Windows media RPCs retain `windows_only: true`. Existing daemon routing independently rejects Windows media and volume controls on fallback routes. Route tests use the real UI WebSocket readiness and queued-send implementation with a simulated socket, including Windows to Mac to Windows transitions and a queued send cancelled by the Mac handoff.
2. Mockingbird supports mapped Home and Now Playing through its shelf and npv methods. It explicitly rejects every app launch destination with `executed: false`, `unsupported_destination`, and no native fallback. The regression renders the production view-layer component after real ViewStore navigation with fixture leaf content, verifying that destination content mounts and the other destination does not. This is a simulated renderer test, not a full device screenshot test.
3. Windows and device media actions require an object containing `status: "ok"` without an error field. Empty objects, null, arrays, scalar replies, invalid statuses, unsupported replies and error objects fail with `executed: false`. Failed device actions do not refresh playback. The response matrix covers all five Windows actions and all three device media actions.
4. Mockingbird handlers share protected-state checks for setup, OTA, onboarding, calls and overlays. The actual shell system/loading screen is included independently of legacy setup stubs. Protected presets cannot play or overwrite stored content, and native onboarding actions do not fall through into the hidden player. Main mappings also defer to setup, OTA, onboarding, calls, Settings, lock, sleeping display, voice and critical overlays. Main dial/back mappings now have a dispatch path that consumes only mapped controls; default events and short Enter with a long-press-only mapping are preserved.
5. Short Settings press cannot be remapped, including through a legacy stored mapping. It preserves native recovery access. Mockingbird exposes its own Settings > Options > Action mapping touch configuration page and Reset All Controls to Default. A DOM test saves an assignment and clicks reset, checking persisted defaults. Unsupported app launches are omitted from this skin's choices. Settings recovery remains available during setup and respects OTA and critical call/modal protection.
6. The three `crates/shared/bindings/` files match PR base `39b6ac369fd18ded1c47436ab8566d0278ac0312` byte for byte. Per-component agent guides describe the resulting behavior. No generated contracts were regenerated or changed semantically.

## Final validation

Commands ran in `packages/ui` with installed Bun `1.4.2` on macOS. The repository declares Bun `1.3.14`; the local results below do not claim validation with that pinned CI runtime.

| Command | Result |
| --- | --- |
| `bun run typecheck` | Exit 0, no TypeScript diagnostics |
| `bun test` | Exit 0, 563 passed, 0 failed, 2360 assertions across 46 files, 4.43 seconds |
| `bun run build` | Exit 0, TypeScript check and Vite production build succeeded, Vite build 2.63 seconds |
| `git diff --check` | Exit 0 |

The production build reports the existing warning about a chunk exceeding 500 kB after minification. It does not fail the build.

The added tests simulate WebSocket I/O, DOM hardware events, native handler callbacks and rendered view layers. No physical Car Thing, Windows PC, Mac fallback host, Bluetooth transport, or actual hardware controls were exercised. Real-device route handoffs and physical control behavior remain unverified on hardware; no hardware success is claimed.

The final diff was reviewed against the PR base and the reviewed commit. The user's pre-existing uncommitted change to `jules_my_turne_windows_sprints.md` is excluded from this fix commit.

## Targeted hardware-event refinement

Only `useMappedHardwareControls`, its regression tests and the hooks guide changed in this refinement. Native short Enter is preserved with a long-only mapping; dual mappings dispatch only the classified action. A short-only mapping replays an unmapped long action as a held native key and suppresses duplicate releases, so the existing native long-press parser emits long rather than short. The fallback starts its native hold after the hook's one-second classification threshold; timer-based native handlers therefore run after their own additional one-second threshold. Native release can remain pending during that replay interval. This does not claim unchanged native callback timing.

Rotary capture uses unmodified horizontal-only `deltaX`. Vertical/diagonal scrolling, modified wheel gestures, form-control interactions and unmapped directions pass through. Rotary RPCs are single-flight with a 50 ms minimum interval between starts and at most eight pending steps. Excess steps beyond that buffer are discarded. Intentional buffered volume adjustments preserve direction and order. Queue entries are checked against route generation, device scope and mapping identity, and are cancelled on protected-state entry or unmount. Non-RPC navigation is not throttled.

Validation with Bun 1.4.2 on macOS:

- `bun run typecheck`: exit 0, no diagnostics.
- Targeted `bun test` for `useMappedHardwareControls`, `useActionMapping`, `actionMapping`, `actionMappingRoute`, Mockingbird `actionMapping` and `interactionContracts`: exit 0, 58 passed, 0 failed, 499 assertions across six files, 5.49 seconds.
- `bun run build`: exit 0, Vite production build 2.50 seconds; existing chunk-size warning remains.
- `git diff --check`: exit 0.

These are simulated DOM, RPC and native hardware-parser tests, not physical hardware tests. Mapping persistence, route authorization and Mockingbird production code remain unchanged. The existing uncommitted sprint document is again excluded.
