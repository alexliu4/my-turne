import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAppReadyState,
  subscribeAppReadyState,
  sendNocturneWsRequest,
} from "./useNocturned";
import { getWindowsConnectorState } from "./useWindowsConnector";

export type OutputRole = "console" | "multimedia" | "communications";
export type OutputScope = "playback" | "communications" | "all";
export const OUTPUT_ROLES: Record<OutputScope, OutputRole[]> = {
  playback: ["console", "multimedia"],
  communications: ["communications"],
  all: ["console", "multimedia", "communications"],
};
export type AudioOutput = {
  id: string;
  name: string;
  defaultRoles: Record<OutputRole, boolean>;
};
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function parseAudioOutputs(value: unknown): AudioOutput[] | null {
  const data = record(value);
  if (
    data?.status !== "ok" ||
    data.error != null ||
    !Array.isArray(data.devices) ||
    data.devices.length > 128
  )
    return null;
  const devices: AudioOutput[] = [];
  const seen = new Set<string>();
  for (const entry of data.devices) {
    const item = record(entry);
    const roles = record(item?.defaultRoles);
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      item.id.length > 4096 ||
      seen.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 256 ||
      typeof item.state !== "string" ||
      typeof item.isDefault !== "boolean" ||
      !roles ||
      typeof roles.console !== "boolean" ||
      typeof roles.multimedia !== "boolean" ||
      typeof roles.communications !== "boolean" ||
      item.isDefault !== roles.console
    )
      return null;
    seen.add(item.id);
    if (item.state === "active")
      devices.push({
        id: item.id,
        name: item.name,
        defaultRoles: {
          console: roles.console,
          multimedia: roles.multimedia,
          communications: roles.communications,
        },
      });
  }
  if (
    OUTPUT_ROLES.all.some(
      (role) => devices.filter((item) => item.defaultRoles[role]).length > 1,
    )
  )
    return null;
  if (
    data.selectedDeviceId != null &&
    (typeof data.selectedDeviceId !== "string" ||
      !seen.has(data.selectedDeviceId))
  )
    return null;
  return devices;
}
function failure(value: unknown): string {
  const status = record(value)?.status;
  switch (status) {
    case "unsupported":
      return "Audio outputs unsupported or unavailable on this Connector. Try Refresh.";
    case "invalid_device":
    case "device_missing":
      return "Output removed or unavailable. Refresh and choose another output.";
    case "access_denied":
      return "Windows denied the output change.";
    default:
      return "Output change failed or could not be verified. Check Windows before retrying.";
  }
}
const empty = { devices: null, busy: false, notice: null };
type State = {
  generation: number;
  devices: AudioOutput[] | null;
  busy: boolean;
  notice: string | null;
};

export function useWindowsAudioOutputs() {
  const [ready, setReady] = useState(getAppReadyState);
  const [state, setState] = useState<State>({
    ...empty,
    generation: ready.generation,
  });
  const latest = useRef(state);
  latest.current = state;
  const mounted = useRef(false);
  const pending = useRef<object | null>(null);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeAppReadyState(setReady);
    return () => {
      mounted.current = false;
      pending.current = null;
      unsubscribe();
    };
  }, []);
  const request = useCallback(
    async (selection?: { id: string; scope: OutputScope }) => {
      const current = getAppReadyState();
      if (
        !mounted.current ||
        pending.current ||
        !getWindowsConnectorState(current).isWindowsActive
      )
        return;
      if (
        selection &&
        (latest.current.generation !== current.generation ||
          !latest.current.devices?.some((item) => item.id === selection.id) ||
          !Object.hasOwn(OUTPUT_ROLES, selection.scope))
      )
        return;
      const operation = {};
      pending.current = operation;
      setState((previous) => ({ ...previous, busy: true, notice: null }));
      const isCurrent = () =>
        mounted.current &&
        pending.current === operation &&
        getAppReadyState().generation === current.generation &&
        getWindowsConnectorState(getAppReadyState()).isWindowsActive;
      const options = {
        timeoutMs: 4000,
        appReadyGeneration: current.generation,
      };
      const publish = (
        devices: AudioOutput[] | null,
        notice: string | null,
      ) => {
        if (isCurrent())
          setState({
            generation: current.generation,
            devices,
            notice,
            busy: false,
          });
      };
      const read = () =>
        sendNocturneWsRequest<unknown>("audio.outputs.list", {}, options);
      try {
        const response = await read();
        if (!isCurrent()) return;
        const devices = parseAudioOutputs(response);
        if (!devices) {
          publish(
            null,
            record(response)?.status === "unsupported"
              ? failure(response)
              : "Output list invalid or unavailable. Try Refresh.",
          );
          return;
        }
        if (!selection) {
          publish(devices, null);
          return;
        }
        // Revalidate discovery immediately before mutation: unplugged IDs never dispatch.
        if (!devices.some((item) => item.id === selection.id)) {
          publish(devices, "Output removed. Choose another output.");
          return;
        }
        let confirmed = false;
        let notice: string | null = null;
        try {
          const result = record(
            await sendNocturneWsRequest<unknown>(
              "audio.outputs.select",
              { deviceId: selection.id, roles: OUTPUT_ROLES[selection.scope] },
              options,
            ),
          );
          if (!isCurrent()) return;
          confirmed =
            result?.status === "ok" &&
            result.error == null &&
            result.confirmed === true &&
            result.deviceId === selection.id;
          if (!confirmed) notice = failure(result);
        } catch (error: unknown) {
          if (!isCurrent()) return;
          console.debug("Audio output selection uncertain:", error);
          notice =
            "Outcome unknown; the output may have changed. Check Windows before retrying.";
        }
        // Even failed multi-role writes can partially change Windows defaults.
        const snapshot = await read();
        if (!isCurrent()) return;
        const updated = parseAudioOutputs(snapshot);
        const matches = updated?.some(
          (item) =>
            item.id === selection.id &&
            OUTPUT_ROLES[selection.scope].every(
              (role) => item.defaultRoles[role],
            ),
        );
        publish(
          updated,
          !updated
            ? "Output state unknown after switch. Refresh before retrying."
            : confirmed && matches
              ? "Windows output confirmed."
              : (notice ??
                "Windows default did not match the requested output. Refresh before retrying."),
        );
      } catch (error: unknown) {
        if (!isCurrent()) return;
        console.debug("Audio outputs unavailable:", error);
        const message = error instanceof Error ? error.message : "";
        publish(
          null,
          /^(unsupported|unknown method|method not found)$/i.test(
            message.trim(),
          )
            ? failure({ status: "unsupported" })
            : selection
              ? "Output state unknown. The output may have changed. Refresh before retrying."
              : "Output list unavailable. Try Refresh.",
        );
      } finally {
        if (pending.current === operation) pending.current = null;
      }
    },
    [],
  );
  const refresh = useCallback(() => request(), [request]);
  useEffect(() => {
    pending.current = null;
    setState({ ...empty, generation: ready.generation });
    if (getWindowsConnectorState(ready).isWindowsActive) void refresh();
    return () => {
      pending.current = null;
    };
  }, [ready.generation, ready.ready, ready.connectorPlatform, refresh]);
  const isWindowsActive = getWindowsConnectorState(ready).isWindowsActive;
  return {
    ...(isWindowsActive && state.generation === ready.generation
      ? state
      : empty),
    generation: ready.generation,
    isWindowsActive,
    refresh,
    select: (id: string, scope: OutputScope) => request({ id, scope }),
  };
}
