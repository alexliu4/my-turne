import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAppReadyState,
  subscribeAppReadyState,
  sendNocturneWsRequest,
} from "./useNocturned";
import { getWindowsConnectorState } from "./useWindowsConnector";

export type ConfiguredAction = { id: string; name: string };
type ActionKind = "apps" | "macros";
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Retain only display metadata, never host targets or executable definitions.
export function parseConfiguredActions(payload: unknown, kind: ActionKind) {
  const data = record(payload);
  if (
    data?.status !== "ok" ||
    typeof data.available !== "boolean" ||
    data.error != null
  )
    return null;
  const entries = data[kind];
  if (!Array.isArray(entries)) return null;
  // Both Connector services fold configured count into availability. An ok,
  // empty catalog is valid even when no configured action makes it available.
  if (!data.available && entries.length !== 0) return null;
  const actions: ConfiguredAction[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const item = record(entry);
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      (item.enabled !== undefined && item.enabled !== true) ||
      seen.has(item.id)
    )
      continue;
    seen.add(item.id);
    actions.push({ id: item.id, name: item.name });
  }
  return actions;
}

type ViewState = {
  generation: number;
  apps: ConfiguredAction[] | null;
  macros: ConfiguredAction[] | null;
  busy: boolean;
  notice: string | null;
};
const empty = { apps: null, macros: null, busy: false, notice: null };
const unknownOutcome =
  "Outcome unknown; the action may have executed. Check the PC before retrying.";

export function useWindowsActions() {
  const [ready, setReady] = useState(getAppReadyState);
  const [state, setState] = useState<ViewState>({
    ...empty,
    generation: ready.generation,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
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
    async (selection?: { kind: ActionKind; id: string }) => {
      const current = getAppReadyState();
      if (
        !mounted.current ||
        pending.current ||
        !getWindowsConnectorState(current).isWindowsActive
      )
        return;
      if (
        selection &&
        (stateRef.current.generation !== current.generation ||
          !stateRef.current[selection.kind]?.some(
            (item) => item.id === selection.id,
          ))
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
      try {
        if (!selection) {
          // Independent catalogs: failure of one must not hide the other.
          const results = await Promise.allSettled([
            sendNocturneWsRequest<unknown>(
              "app_launch.get_status",
              {},
              options,
            ),
            sendNocturneWsRequest<unknown>("macros.get_status", {}, options),
          ]);
          if (!isCurrent()) return;
          const [apps, macros] = results.map((result, index) =>
            result.status === "fulfilled"
              ? parseConfiguredActions(
                  result.value,
                  index === 0 ? "apps" : "macros",
                )
              : null,
          );
          setState({
            generation: current.generation,
            apps,
            macros,
            busy: false,
            notice: null,
          });
        } else {
          const isApp = selection.kind === "apps";
          const response = record(
            await sendNocturneWsRequest<unknown>(
              isApp ? "app_launch.launch" : "macros.execute",
              isApp ? { app: selection.id } : { id: selection.id },
              options,
            ),
          );
          if (!isCurrent()) return;
          const success =
            response?.status === "ok" &&
            response.error == null &&
            (isApp
              ? response.launched === true
              : typeof response.action === "string" &&
                ["app", "media", "url", "shortcut"].includes(response.action) &&
                response.launched !== false);
          setState((previous) => ({
            ...previous,
            busy: false,
            // Re-read advertised actions before another attempt after a failure.
            ...(!success ? { [selection.kind]: null } : {}),
            notice: success
              ? isApp
                ? "Launch request acknowledged."
                : "Macro dispatch acknowledged. Check the PC for its effect."
              : unknownOutcome,
          }));
        }
      } catch (error: unknown) {
        if (!isCurrent()) return;
        console.debug("Windows configured action unavailable:", error);
        setState((previous) => ({
          ...previous,
          busy: false,
          ...(selection
            ? { [selection.kind]: null }
            : { apps: null, macros: null }),
          notice: selection
            ? unknownOutcome
            : "Actions unavailable. Try Refresh.",
        }));
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
  const visible =
    isWindowsActive && state.generation === ready.generation ? state : empty;
  return {
    ...visible,
    isWindowsActive,
    refresh,
    execute: (kind: ActionKind, id: string) => request({ kind, id }),
  };
}
