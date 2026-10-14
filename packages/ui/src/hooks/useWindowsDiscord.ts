import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAppReadyState,
  subscribeAppReadyState,
  sendNocturneWsRequest,
} from "./useNocturned";
import { getWindowsConnectorState } from "./useWindowsConnector";

type DiscordSnapshot = {
  available: boolean;
  running: boolean;
  muted: boolean | null;
  deafened: boolean | null;
};

// Connector DiscordStatus contract. Never infer state from a successful shortcut.
export function parseDiscordSnapshot(payload: unknown): DiscordSnapshot | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const data = payload as Record<string, unknown>;
  if (
    typeof data.status !== "string" ||
    !["ok", "unsupported", "unknown", "error"].includes(data.status) ||
    data.error != null ||
    typeof data.available !== "boolean" ||
    typeof data.running !== "boolean" ||
    typeof data.state_known !== "boolean" ||
    (data.muted !== null && typeof data.muted !== "boolean") ||
    (data.deafened !== null && typeof data.deafened !== "boolean")
  )
    return null;
  const available = data.status === "ok" && data.available && data.running;
  const known = available && data.state_known;
  return {
    available,
    running: data.running,
    muted: known && typeof data.muted === "boolean" ? data.muted : null,
    deafened:
      known && typeof data.deafened === "boolean" ? data.deafened : null,
  };
}

const emptySnapshot: DiscordSnapshot = {
  available: false,
  running: false,
  muted: null,
  deafened: null,
};
const unknownOutcome =
  "Command outcome unknown; it may have executed. Check Discord before retrying.";

type DiscordViewState = DiscordSnapshot & {
  generation: number;
  isLoading: boolean;
  notice: string | null;
};
type DiscordMethod =
  | "discord.get_status"
  | "discord.toggle_mute"
  | "discord.toggle_deafen";

export function useWindowsDiscord() {
  const [ready, setReady] = useState(getAppReadyState);
  const [state, setState] = useState<DiscordViewState>({
    ...emptySnapshot,
    generation: ready.generation,
    isLoading: false,
    notice: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const pending = useRef<object | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeAppReadyState(setReady);
    return () => {
      mounted.current = false;
      pending.current = null;
      unsubscribe();
    };
  }, []);

  const request = useCallback(async (method: DiscordMethod) => {
    const current = getAppReadyState();
    if (
      !mounted.current ||
      pending.current ||
      !getWindowsConnectorState(current).isWindowsActive
    )
      return;
    const action = method !== "discord.get_status";
    if (
      action &&
      (stateRef.current.generation !== current.generation ||
        !stateRef.current.available)
    )
      return;
    const operation = {};
    pending.current = operation;
    setState((previous) => ({ ...previous, isLoading: true, notice: null }));
    const isCurrent = () =>
      mounted.current &&
      pending.current === operation &&
      getAppReadyState().generation === current.generation &&
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    try {
      const response = await sendNocturneWsRequest<unknown>(
        method,
        {},
        {
          timeoutMs: 4000,
          appReadyGeneration: current.generation,
        },
      );
      if (!isCurrent()) return;
      const snapshot = parseDiscordSnapshot(response);
      if (!snapshot) throw new Error("Invalid Discord response");
      const data = response as Record<string, unknown>;
      const notice = action
        ? data.status === "ok" && snapshot.available
          ? snapshot.muted === null || snapshot.deafened === null
            ? "Toggle command sent. State unverified; check Discord."
            : "Discord state verified."
          : data.status === "unknown"
            ? unknownOutcome
            : "Discord command unavailable or failed. Check Discord before retrying."
        : data.status === "ok"
          ? null
          : "Discord unavailable. Open Discord on the PC, then Refresh.";
      setState({
        ...snapshot,
        generation: current.generation,
        isLoading: false,
        notice,
      });
    } catch (error: unknown) {
      if (!isCurrent()) return;
      console.warn("Discord request failed:", error);
      setState({
        ...emptySnapshot,
        generation: current.generation,
        isLoading: false,
        notice: action
          ? unknownOutcome
          : "Discord unavailable. Open Discord on the PC, then Refresh.",
      });
    } finally {
      if (pending.current === operation) pending.current = null;
    }
  }, []);

  const refresh = useCallback(() => request("discord.get_status"), [request]);
  useEffect(() => {
    pending.current = null;
    setState({
      ...emptySnapshot,
      generation: ready.generation,
      isLoading: false,
      notice: null,
    });
    if (getWindowsConnectorState(ready).isWindowsActive) void refresh();
    return () => {
      pending.current = null;
    };
  }, [ready.generation, ready.ready, ready.connectorPlatform, refresh]);

  const isWindowsActive = getWindowsConnectorState(ready).isWindowsActive;
  const visible =
    isWindowsActive && state.generation === ready.generation
      ? state
      : { ...emptySnapshot, isLoading: false, notice: null };
  return {
    ...visible,
    isWindowsActive,
    refresh,
    toggleMute: () => request("discord.toggle_mute"),
    toggleDeafen: () => request("discord.toggle_deafen"),
  };
}
