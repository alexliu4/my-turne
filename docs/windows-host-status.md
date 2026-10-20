# Device Phase 2 D3: Host Status and recovery

October 19, 2026. Implemented for review. Physical integration is untested.

## Audited contract and scope

Device base: merged main `3e2fa0aa` (D2, PR #27). Connector merged main was reverified through the GitHub main ref at `8d0f144bd89a4b56dd52fd3e45f8f95ce3af643f`. The merged dispatcher and `getCapabilities`, `refreshHostStatus` and `getHostStatus` implementations were read from that exact revision. No Connector checkout files were modified.

Authoritative source: [Connector dispatcher and status implementation](https://github.com/alexliu4/my-turne-connector/blob/8d0f144bd89a4b56dd52fd3e45f8f95ce3af643f/src/server/nocturne-manager.ts). Existing device transport and ownership evidence is recorded in [D0](phase2-device-contracts.md).

D3 uses only the existing `connector.capabilities({})` result and daemon-normalized `app.ready` ownership. The RPC returns `{capabilities: {volume, media, discord, systemStats, macros, appLaunch}}`. These are cached service availability observations, not proof a host action works or a live diagnostic probe. Handshake capability flags do not establish fresh screen readings; the screen waits for its bounded RPC. Legacy arrays and aliases remain supported. Audio Outputs and App Mixer keep their separate discovery contracts.

`host.get_status` exists, but its aggregate refresh invokes feature probes and is unnecessary for this small refinement. Its `hostBridgeConnected` implementation can infer true when the bridge lacks `isConnected`; it does not prove distinct native, sidecar and Bluetooth health. D3 adds no such indicators, version claims, logs or service diagnostics. There is no distinct device-safe reconnect-attempt signal in the audited readiness contract. The UI says it is waiting for a Windows Connector session, rather than inventing an active reconnect or a countdown. No new host health contract is needed for this sprint. A future richer health view should first define authoritative nullable per-service health and bounded snapshot freshness in a separate Connector proposal.

No local HTTP config/diagnostic/export surface, direct LAN transport, restart command or new daemon method was added. Refresh only reads capabilities; fallback, phone and no-session states send no Windows RPC.

## Presentation and lifecycle

- Header distinguishes Windows Connector active, Mac fallback active, another fallback Connector active and no Connector ready. Active denotes daemon session ownership, not service health. Unknown fallback platform strings and identifiers are never rendered.
- Windows rows distinguish Available (literal true), Unavailable (literal false), Unknown (absent/malformed or unverified), Stale (previously known readings during Refresh) and Offline (no Windows owner). Legacy arrays describe the supported set; omitted entries are Unavailable.
- Unsupported capability RPC is separate from malformed/failed/timeout responses. Raw host errors, paths, identifiers and arbitrary response fields never enter the view.
- Entry, new readiness and manual Refresh issue one read with a three-second deadline and `appReadyGeneration`. Repeated Refresh calls coalesce while it is pending. There is no polling or automatic failure loop.
- Route callbacks immediately invalidate outstanding continuations. New generations clear readings before presentation, stale replies cannot overwrite a newer read, duplicate readiness cannot strand a request, and unmount invalidates pending work.
- Back and Refresh remain outside the scrolling content. Refresh is disabled during a read and without a Windows owner. Short guidance points to the Windows tray, Connector restart and Bluetooth pairing; it does not claim recovery succeeded.

## Automated verification

Commands run from `packages/ui`, using Bun 1.4.2:

- `bun test src/hooks/useWindowsCapabilities.test.tsx`: 53 passed, 0 failed. Covers tri-state parsing, explicit failures, empty legacy sets, stale refresh, serialized requests, three-second/generation request options, repeated readiness, disconnect, Windows/Mac/Windows, stale success/failure, unmount and rendered recovery/error privacy.
- `bun test`: 739 passed, 0 failed across 52 files.
- `bun test src/hooks/useWindowsCapabilities.test.tsx src/pages/home/AppsSection.test.tsx`: 79 passed, 0 failed after the final readiness dependency refinement.
- `bun run lint-check`: passed strict TypeScript and Prettier checks.
- `bun run build`: passed TypeScript and production Vite build. Existing mixed static/dynamic import and large-chunk advisories remain.

An intermediate `bun test` from the repository root reported 738 passed and one missing relative notification-artwork fixture. The documented UI-directory command above passes. Initial navigation assertions were updated for the new labels and disabled offline Refresh. `git diff --check` passed. No Rust or wire schema files changed. Linux daemon builds and hardware behavior are not inferred from UI tests.

## Physical verification checklist

Every row is **untested**. Run with the D0 daemon and record image/UI/Connector revisions, operator/date and observed outcome. Automated tests do not establish hardware acceptance.

| Scenario | Required observation | Outcome |
| --- | --- | --- |
| Windows connected, open Host Status | Windows owner; only returned capabilities appear known; Refresh finishes without claiming service readiness | Untested |
| Stop/crash Windows Connector, with Mac available | Mac fallback shown, old Windows readings clear; Back and core media/navigation remain responsive | Untested |
| Stop all Connectors, then start Windows | No Connector ready and waiting guidance; new Windows session automatically reads fresh capabilities | Untested |
| Interrupt Bluetooth during Refresh, then reconnect | No stale completion or permanently disabled Refresh; ownership and new readings recover | Untested |
| Older Connector without capability RPC, malformed response or read timeout | Unsupported or generic failure shown, all unverified rows Unknown; manual Refresh can recover | Untested |
| Repeated Windows/Mac handoff, phone/Spotify playback | No Windows request reaches fallback; existing playback and controls remain usable | Untested |
| 800 by 480 kiosk, touch and physical Back | Scrollable rows, reachable Refresh/Back and no knob mapping changes | Untested |
| Final power-only run without USB data | Recovery works without a device restart or USB dependency | Untested |

Stop for D3 review. D4 is outside this change.
