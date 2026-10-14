# Separate task: distinguish Windows GSMTC rejection from capability

Repository: `alexliu4/my-turne-connector`. No Connector source changes are part of the Computer Control PR.

Read-only inspection at revision `2b4f640b01d28cef1c188dd4357da2d22c99bf4b` found a concrete error-reporting bug in [native/media.rs lines 809 to 878](https://github.com/alexliu4/my-turne-connector/blob/2b4f640b01d28cef1c188dd4357da2d22c99bf4b/windows/src-tauri/src/native/media.rs#L809): no session returns unsupported; both skip calls discard WinRT errors through `.get().ok()`; the final response maps everything except `Some(true)` to unsupported. This incorrectly reports transient failures as unsupported capability. It does not prove why skipping failed on the tested PC.

The device sends UUID-correlated `media.control.next` or `media.control.previous` with empty companion parameters over the selected Windows SPP route. `windows_only: true` is a UI-to-daemon guard, removed before forwarding. Expected results are `status: ok` only when the Windows operation returns true, an explicit unsupported capability result, or a distinguishable failed/no-session outcome. The current device treats legacy bare unsupported as ambiguous rejection and permits retry.

Implement and validate in the Connector:

1. Inspect `GetPlaybackInfo().Controls()` and its Next/Previous enable flags for the exact current session. Log source application and session identity alongside those flags and RPC outcomes, without unrelated sensitive metadata.
2. Distinguish unsupported controls, absent sessions, disabled integration, false operation completion, and WinRT errors. Retain error/HRESULT diagnostics instead of discarding them. Never acknowledge success before the native operation confirms it.
3. Publish session-correlated control availability with the metadata snapshot. Coordinate any new wire fields with the shared schema/codegen in `my-turne`; current metadata normalization does not preserve arbitrary control fields. Do not invent an uncoordinated device-only contract.
4. Check session identity before applying or reporting asynchronous control outcomes. Test native and browser playlists with available skipping, disabled skipping, session replacement, WinRT failure, and Windows reconnect.
5. Capture the actual failing Car Thing RPC and native outcome. Determine whether the player lacks skip support, rejects it temporarily, or the Connector implementation fails. Verify real track changes before declaring the hardware issue resolved.

No arbitrary media-key injection or Mac fallback workaround is proposed. Physical dial and Back mappings remain the separate Sprint 8 concern.
