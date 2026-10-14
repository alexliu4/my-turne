# Computer Control validation

The modern sidebar lists Now Playing, Recents, Library, Computer Control, Apps, Artists, Radio, Podcasts, Settings. Computer Control contains Windows Media, Windows Control (the unchanged `windowsVolume` route), and Host Status. Apps contains Timer and Weather. General Settings no longer duplicates computer launch actions.

Both sections share the established Swiper card presentation. Host Status is selectable offline and under Mac fallback. Windows actions still require the selected Windows Connector and send `windows_only: true`; the daemon removes that UI guard before forwarding the unchanged RPC to the exact Windows route. No daemon, firmware recipes, Connector sources, or physical action mappings changed.

## Pairing investigation

`BluetoothDevices` already acquired a shared discovery lease on mount. The daemon already sets Pairable and Discoverable together and rolls Pairable back if enabling Discoverable fails. A paired Mac does not exclude a new Windows pairing window.

The device-side coordinator had two reproducible acknowledgement defects:

- A transition completing after a socket reset could overwrite the reset applied state and suppress reapplication on the new connection. Applied state now belongs to a socket epoch, and reconnect always invalidates it.
- A failed enable left the previously confirmed closed state cached. If the adapter changed before its acknowledgement failed, the final release could skip closing. Any failed transition now invalidates applied state, so release attempts to close it.

Activation errors previously returned `false` from the hook and were ignored by Settings. Settings now displays the coordinator's error, including reconnect failures, and offers Retry pairing. Device-list fetching proceeds independently. Disconnect pauses reconciliation; reconnect reapplies current owners. Hook unmount also releases its owner, and overlapping owners retain the window.

These are verified device-side defects, not a confirmed reproduction of the reported physical failure. The reported `Powered=true`, `Discoverable=false`, `Pairable=false` alone cannot establish which failed activation or lifecycle sequence occurred. Physical validation remains required.

## Media investigation

Next and Previous dispatch the correct methods and Windows-only guard. Existing daemon routing tests cover rejection of Mac and phone ownership and pin accepted requests to the original Windows route. No device-side method alias or routing error was found.

The native Connector does call `TrySkipNextAsync` and `TrySkipPreviousAsync`, but it conflates no session, WinRT errors, and a false operation result into `status: unsupported`. It publishes no per-session skip availability. See [the separate Connector follow-up](windows-connector-skip-follow-up.md).

The UI now starts control support at unknown, confirms only acknowledged successful operations, surfaces failed/malformed responses, and keeps ambiguous unsupported responses retryable. An error containing the word unsupported no longer implies unsupported capability. Existing readiness and media identity guards reject stale replies, and session changes/reconnect clear availability. This does not establish that physical skipping works.

## Physical Car Thing checklist

- At 800 by 480, scroll the sidebar through Settings. Open all Computer Control cards and use onscreen Back. Open Timer and Weather from Apps and return. Switch sections, lock/unlock, disconnect, and reconnect without a navigation jump.
- Keep the Mac paired. Open Nocturne Bluetooth Settings and observe BlueZ Pairable and Discoverable becoming true without manual writes. Pair Windows using the matching code confirmed on Windows. Leave the page and observe both properties becoming false after the final owner exits.
- Interrupt the daemon socket during activation and while the page remains open. Verify reapplication after reconnect. Simulate a BlueZ activation failure, verify the visible error, restore the service, and use Retry pairing. Check overlapping pairing surfaces and unmount during activation.
- With Windows active, verify volume, mute, Play/Pause, metadata, and Next/Previous in a browser playlist and a native player that advertises skipping. Record the RPC result and actual track change. Test a non-skippable session and transient failure without fabricated success or a permanent disabled control.
- Switch players and reconnect Windows while a command is pending. Verify late replies do not affect the replacement session. Disconnect Windows with Mac still connected: Host Status shows fallback, and Windows controls issue no Mac commands. Reconnect Windows and verify priority and control recovery.
- Check Spotify linked and skipped behavior, phone/iOS/Android media, and Mockingbird. Existing Sprint 8 dial and physical Back mappings are unchanged.

Automated validation: `bun run typecheck` and `bun run build` passed. The complete `bun test` suite passed with 586 tests across 47 files; no Rust source changed, so no new Rust checks were required. The build retains the existing large-chunk advisory.

Browser preview verified the shared cards, offline Host Status, and sidebar vertical scrolling at 800 by 480. This used real UI components with no Bluetooth hardware and is not physical validation.
