import { useState, useEffect, useCallback, useRef } from "react";
import { getWindowsConnectorState } from "./useWindowsConnector";
import {
  sendNocturneWsRequest,
  addGlobalWsListener,
  getAppReadyState,
  subscribeAppReadyState,
} from "./useNocturned";

export type WindowsVolumeState = {
  volumePercent: number | null;
  muted: boolean | null;
  isLoading: boolean;
  isUnsupported: boolean;
  error: string | null;
};

const unknownState: WindowsVolumeState = {
  volumePercent: null,
  muted: null,
  isLoading: false,
  isUnsupported: false,
  error: null,
};

function confirmedVolume(payload: unknown, action = false) {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const volume = obj.volumePercent ?? obj.volume_percent;
  if (
    obj.error != null ||
    (action
      ? obj.status !== "ok"
      : obj.status != null && obj.status !== "ok") ||
    typeof volume !== "number" ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 100 ||
    typeof obj.muted !== "boolean"
  )
    return null;
  return { volumePercent: volume, muted: obj.muted };
}

export function useWindowsVolume() {
  const [appReady, setAppReady] = useState(getAppReadyState);
  const { isWindowsActive } = getWindowsConnectorState(appReady);
  const [state, setState] = useState(unknownState);
  const revision = useRef(0);
  const pending = useRef<{ generation: number; revision: number } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => subscribeAppReadyState(setAppReady), []);

  const request = useCallback(
    async (method: string, params: Record<string, unknown>) => {
      const ready = getAppReadyState();
      if (!getWindowsConnectorState(ready).isWindowsActive || pending.current)
        return;
      if (
        method !== "volume.get" &&
        (stateRef.current.volumePercent === null ||
          stateRef.current.muted === null ||
          stateRef.current.isUnsupported ||
          stateRef.current.error)
      )
        return;

      const operation = {
        generation: ready.generation,
        revision: revision.current,
      };
      pending.current = operation;
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      const isCurrent = () =>
        pending.current === operation &&
        getAppReadyState().generation === operation.generation &&
        getWindowsConnectorState(getAppReadyState()).isWindowsActive;
      try {
        const response = await sendNocturneWsRequest<unknown>(method, params, {
          timeoutMs: 3000,
        });
        if (!isCurrent() || revision.current !== operation.revision) return;
        const obj =
          response && typeof response === "object"
            ? (response as Record<string, unknown>)
            : null;
        if (obj?.status === "unsupported" || obj?.error === "unsupported") {
          setState({ ...unknownState, isUnsupported: true });
          return;
        }
        const confirmed = confirmedVolume(response, method !== "volume.get");
        if (!confirmed)
          throw new Error("Windows volume response is invalid or unavailable");
        setState({ ...unknownState, ...confirmed });
      } catch (error: unknown) {
        if (!isCurrent() || revision.current !== operation.revision) return;
        const message = error instanceof Error ? error.message : String(error);
        const unsupported = message.toLowerCase().includes("unsupported");
        setState({
          ...unknownState,
          isUnsupported: unsupported,
          error: unsupported ? null : message,
        });
      } finally {
        if (pending.current === operation) {
          pending.current = null;
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    },
    [],
  );

  const refreshVolume = useCallback(() => request("volume.get", {}), [request]);

  useEffect(() => {
    setState(unknownState);
    const generation = appReady.generation;
    const removeListener = addGlobalWsListener("windows-volume-listener", {
      onMessage: (message) => {
        if (!isWindowsActive || getAppReadyState().generation !== generation)
          return;
        if (message.type !== "event" || message.topic !== "volume.update")
          return;
        const confirmed = confirmedVolume(message.data);
        if (!confirmed) return;
        revision.current++;
        setState((prev) => ({
          ...unknownState,
          ...confirmed,
          isLoading: prev.isLoading,
        }));
      },
    });
    if (isWindowsActive) void refreshVolume();
    return () => {
      removeListener();
      revision.current++;
      pending.current = null;
    };
  }, [appReady.generation, isWindowsActive, refreshVolume]);

  const setVolume = useCallback(
    (target: number) => {
      if (!Number.isFinite(target)) return Promise.resolve();
      return request("volume.set", {
        volumePercent: Math.max(0, Math.min(100, Math.round(target))),
      });
    },
    [request],
  );
  const adjustVolume = useCallback(
    (delta: number) => {
      if (!Number.isFinite(delta)) return Promise.resolve();
      return request("volume.adjust", { delta });
    },
    [request],
  );
  const toggleMute = useCallback(
    () => request("volume.toggleMute", {}),
    [request],
  );

  return {
    ...state,
    isWindowsActive,
    refreshVolume,
    setVolume,
    adjustVolume,
    toggleMute,
  };
}
