import { useState, useEffect, useCallback, useRef } from "react";
import { getWindowsConnectorState } from "./useWindowsConnector";
import {
  sendNocturneWsRequest,
  addGlobalWsListener,
  getAppReadyState,
  getWindowsMediaEventGeneration,
  subscribeAppReadyState,
} from "./useNocturned";

import {
  clearedMediaState,
  getWindowsMediaSnapshot,
  updateWindowsMediaSnapshot,
  disableWindowsMediaControl,
  type SupportedControls,
  type WindowsMediaState,
} from "./windowsMediaState";
export {
  clearedMediaState,
  normalizeMediaGeneration,
  formatArtworkUrl,
} from "./windowsMediaState";

// An RPC can outlive the screen that started it. Keep its route locked until it settles.
let inFlightControl: { generation: number } | null = null;

export function useWindowsMedia() {
  const [appReady, setAppReady] = useState(getAppReadyState);
  const { isWindowsActive } = getWindowsConnectorState(appReady);
  const [state, setState] = useState<WindowsMediaState>(() =>
    getWindowsMediaSnapshot(appReady.generation),
  );

  const pendingRef = useRef<{ generation: number } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => subscribeAppReadyState(setAppReady), []);

  const sendMediaControl = useCallback(
    async (control: keyof SupportedControls) => {
      const ready = getAppReadyState();
      const currentConnector = getWindowsConnectorState(ready);
      const method = `media.control.${control}`;
      if (
        !currentConnector.isWindowsActive ||
        pendingRef.current ||
        inFlightControl?.generation === ready.generation ||
        !stateRef.current.hasActiveSession ||
        !stateRef.current.supportedControls[control]
      ) {
        return;
      }

      const operation = {
        generation: ready.generation,
        session: stateRef.current,
      };
      pendingRef.current = operation;
      inFlightControl = operation;
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const isCurrent = () =>
        pendingRef.current === operation &&
        getAppReadyState().generation === operation.generation &&
        getWindowsConnectorState(getAppReadyState()).isWindowsActive;

      try {
        const response = await sendNocturneWsRequest<unknown>(
          method,
          { windows_only: true },
          { timeoutMs: 3000, appReadyGeneration: ready.generation },
        );
        if (
          !isCurrent() ||
          stateRef.current.mediaGeneration !==
            operation.session.mediaGeneration ||
          stateRef.current.title !== operation.session.title ||
          stateRef.current.artist !== operation.session.artist ||
          stateRef.current.appName !== operation.session.appName ||
          !stateRef.current.hasActiveSession
        )
          return;

        const obj =
          response && typeof response === "object"
            ? (response as Record<string, unknown>)
            : null;
        if (obj?.status === "unsupported" || obj?.error === "unsupported") {
          setState((prev) => ({
            ...prev,
            ...disableWindowsMediaControl(control, ready.generation),
            isLoading: prev.isLoading,
            error: "Control unsupported",
          }));
        } else if (obj?.status !== "ok") {
          throw new Error("Invalid Windows media control response");
        }
      } catch (error: unknown) {
        if (
          !isCurrent() ||
          stateRef.current.mediaGeneration !==
            operation.session.mediaGeneration ||
          stateRef.current.title !== operation.session.title ||
          stateRef.current.artist !== operation.session.artist ||
          stateRef.current.appName !== operation.session.appName ||
          !stateRef.current.hasActiveSession
        )
          return;
        const message = error instanceof Error ? error.message : String(error);
        const unsupported = message.toLowerCase().includes("unsupported");
        if (unsupported) disableWindowsMediaControl(control, ready.generation);
        setState((prev) => ({
          ...prev,
          supportedControls: getWindowsMediaSnapshot(ready.generation)
            .supportedControls,
          error: unsupported ? "Control unsupported" : message,
        }));
      } finally {
        if (inFlightControl === operation) inFlightControl = null;
        if (pendingRef.current === operation) {
          pendingRef.current = null;
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    },
    [],
  );

  useEffect(() => {
    setState(
      isWindowsActive
        ? getWindowsMediaSnapshot(appReady.generation)
        : clearedMediaState,
    );
    const generation = appReady.generation;

    const removeListener = addGlobalWsListener("windows-media-listener", {
      onMessage: (message) => {
        if (
          !isWindowsActive ||
          getAppReadyState().generation !== generation ||
          getWindowsMediaEventGeneration() !== generation
        )
          return;

        if (message.type !== "event") return;

        const updated = updateWindowsMediaSnapshot(
          message.topic ?? "",
          message.data,
          generation,
        );
        stateRef.current = {
          ...updated,
          isLoading: pendingRef.current !== null,
        };
        setState(stateRef.current);
      },
    });

    return () => {
      removeListener();
      pendingRef.current = null;
    };
  }, [appReady.generation, isWindowsActive]);

  const togglePlayPause = useCallback(
    () => sendMediaControl("toggle"),
    [sendMediaControl],
  );

  const play = useCallback(() => sendMediaControl("play"), [sendMediaControl]);

  const pause = useCallback(
    () => sendMediaControl("pause"),
    [sendMediaControl],
  );

  const nextTrack = useCallback(
    () => sendMediaControl("next"),
    [sendMediaControl],
  );

  const previousTrack = useCallback(
    () => sendMediaControl("previous"),
    [sendMediaControl],
  );

  return {
    ...state,
    isWindowsActive,
    togglePlayPause,
    play,
    pause,
    nextTrack,
    previousTrack,
  };
}
