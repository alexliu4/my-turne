import { useState, useEffect, useCallback, useRef } from "react";
import { useWindowsConnector } from "./useWindowsConnector";
import {
  sendNocturneWsRequest,
  addGlobalWsListener,
  getAppReadyState,
} from "./useNocturned";

export type WindowsVolumeState = {
  /**
   * Confirmed volume percentage 0..100, or null when unknown/unconfirmed.
   */
  volumePercent: number | null;
  /**
   * Confirmed mute status, or null when unknown/unconfirmed.
   */
  muted: boolean | null;
  /** True when a volume RPC request is currently in-flight. */
  isLoading: boolean;
  /** True when the active Connector reports volume control as unsupported. */
  isUnsupported: boolean;
  /** Human-readable error string if the last operation failed. */
  error: string | null;
};

export function parseVolumeUpdate(payload: unknown): {
  volumePercent?: number;
  muted?: boolean;
  status?: string;
  isUnsupported?: boolean;
} {
  if (!payload || typeof payload !== "object") return {};
  const obj = payload as Record<string, unknown>;

  const status = typeof obj.status === "string" ? obj.status.toLowerCase() : undefined;
  const isUnsupported = status === "unsupported" || obj.error === "unsupported";

  const rawVol = obj.volumePercent ?? obj.volume_percent;
  let volumePercent: number | undefined;
  if (typeof rawVol === "number" && Number.isFinite(rawVol)) {
    volumePercent = Math.max(0, Math.min(100, Math.round(rawVol)));
  }

  const muted = typeof obj.muted === "boolean" ? obj.muted : undefined;

  return { volumePercent, muted, status, isUnsupported };
}

export function useWindowsVolume() {
  const { isWindowsActive } = useWindowsConnector();

  const [volumeState, setVolumeState] = useState<WindowsVolumeState>({
    volumePercent: null,
    muted: null,
    isLoading: false,
    isUnsupported: false,
    error: null,
  });

  const isWindowsActiveRef = useRef(isWindowsActive);
  useEffect(() => {
    isWindowsActiveRef.current = isWindowsActive;
  }, [isWindowsActive]);

  // Generation counter to discard stale RPC responses across route changes / disconnects
  const currentGenerationRef = useRef<number>(getAppReadyState().generation);

  const refreshVolume = useCallback(async () => {
    const currentGen = getAppReadyState().generation;
    currentGenerationRef.current = currentGen;

    if (!isWindowsActiveRef.current) return;

    setVolumeState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));

    try {
      const response = await sendNocturneWsRequest<Record<string, unknown>>(
        "volume.get",
        {},
        { timeoutMs: 3000 }
      );

      // Verify active session generation hasn't changed while request was in-flight
      if (
        !isWindowsActiveRef.current ||
        getAppReadyState().generation !== currentGen
      ) {
        return;
      }

      const parsed = parseVolumeUpdate(response);

      if (parsed.isUnsupported) {
        setVolumeState((prev) => ({
          ...prev,
          isLoading: false,
          isUnsupported: true,
          error: null,
        }));
        return;
      }

      setVolumeState((prev) => ({
        ...prev,
        volumePercent: parsed.volumePercent ?? prev.volumePercent,
        muted: parsed.muted ?? prev.muted,
        isLoading: false,
        isUnsupported: false,
        error: null,
      }));
    } catch (err: unknown) {
      if (
        !isWindowsActiveRef.current ||
        getAppReadyState().generation !== currentGen
      ) {
        return;
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      const isUnsupported = errorMsg.toLowerCase().includes("unsupported");

      setVolumeState((prev) => ({
        ...prev,
        isLoading: false,
        isUnsupported,
        error: isUnsupported ? null : errorMsg,
      }));
    }
  }, []);

  useEffect(() => {
    if (isWindowsActive) {
      refreshVolume();
    } else {
      setVolumeState({
        volumePercent: null,
        muted: null,
        isLoading: false,
        isUnsupported: false,
        error: null,
      });
    }
  }, [isWindowsActive, refreshVolume]);

  useEffect(() => {
    const removeListener = addGlobalWsListener("windows-volume-listener", {
      onMessage: (message) => {
        if (!isWindowsActiveRef.current) return;
        if (
          message.type === "event" &&
          (message.topic === "volume.update" ||
            message.topic === "volume.state" ||
            message.topic === "device.volume.update")
        ) {
          const parsed = parseVolumeUpdate(message.data);
          if (parsed.volumePercent !== undefined || parsed.muted !== undefined) {
            setVolumeState((prev) => ({
              ...prev,
              volumePercent: parsed.volumePercent ?? prev.volumePercent,
              muted: parsed.muted ?? prev.muted,
              isUnsupported: false,
            }));
          }
        }
      },
    });
    return () => {
      removeListener();
    };
  }, []);

  const setVolume = useCallback(
    async (targetPercent: number) => {
      if (!isWindowsActiveRef.current) return;
      if (!Number.isFinite(targetPercent)) return;

      const currentGen = getAppReadyState().generation;
      const clamped = Math.max(0, Math.min(100, Math.round(targetPercent)));

      setVolumeState((prev) => ({ ...prev, isLoading: true }));

      try {
        const response = await sendNocturneWsRequest<Record<string, unknown>>(
          "volume.set",
          { volumePercent: clamped },
          { timeoutMs: 3000 }
        );

        if (
          !isWindowsActiveRef.current ||
          getAppReadyState().generation !== currentGen
        ) {
          return;
        }

        const parsed = parseVolumeUpdate(response);

        if (parsed.isUnsupported) {
          setVolumeState((prev) => ({
            ...prev,
            isLoading: false,
            isUnsupported: true,
          }));
          return;
        }

        setVolumeState((prev) => ({
          ...prev,
          volumePercent: parsed.volumePercent ?? clamped,
          muted: parsed.muted ?? prev.muted,
          isLoading: false,
          isUnsupported: false,
          error: null,
        }));
      } catch (err: unknown) {
        if (
          !isWindowsActiveRef.current ||
          getAppReadyState().generation !== currentGen
        ) {
          return;
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        setVolumeState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMsg,
        }));
      }
    },
    []
  );

  const adjustVolume = useCallback(async (delta: number) => {
    if (!isWindowsActiveRef.current) return;
    if (!Number.isFinite(delta)) return;

    const currentGen = getAppReadyState().generation;

    setVolumeState((prev) => ({ ...prev, isLoading: true }));

    try {
      const response = await sendNocturneWsRequest<Record<string, unknown>>(
        "volume.adjust",
        { delta },
        { timeoutMs: 3000 }
      );

      if (
        !isWindowsActiveRef.current ||
        getAppReadyState().generation !== currentGen
      ) {
        return;
      }

      const parsed = parseVolumeUpdate(response);

      if (parsed.isUnsupported) {
        setVolumeState((prev) => ({
          ...prev,
          isLoading: false,
          isUnsupported: true,
        }));
        return;
      }

      setVolumeState((prev) => ({
        ...prev,
        volumePercent: parsed.volumePercent ?? prev.volumePercent,
        muted: parsed.muted ?? prev.muted,
        isLoading: false,
        isUnsupported: false,
        error: null,
      }));
    } catch (err: unknown) {
      if (
        !isWindowsActiveRef.current ||
        getAppReadyState().generation !== currentGen
      ) {
        return;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      setVolumeState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMsg,
      }));
    }
  }, []);

  const toggleMute = useCallback(async () => {
    if (!isWindowsActiveRef.current) return;

    const currentGen = getAppReadyState().generation;

    setVolumeState((prev) => ({ ...prev, isLoading: true }));

    try {
      const response = await sendNocturneWsRequest<Record<string, unknown>>(
        "volume.toggleMute",
        {},
        { timeoutMs: 3000 }
      );

      if (
        !isWindowsActiveRef.current ||
        getAppReadyState().generation !== currentGen
      ) {
        return;
      }

      const parsed = parseVolumeUpdate(response);

      if (parsed.isUnsupported) {
        setVolumeState((prev) => ({
          ...prev,
          isLoading: false,
          isUnsupported: true,
        }));
        return;
      }

      setVolumeState((prev) => ({
        ...prev,
        volumePercent: parsed.volumePercent ?? prev.volumePercent,
        muted: parsed.muted ?? (prev.muted !== null ? !prev.muted : null),
        isLoading: false,
        isUnsupported: false,
        error: null,
      }));
    } catch (err: unknown) {
      if (
        !isWindowsActiveRef.current ||
        getAppReadyState().generation !== currentGen
      ) {
        return;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      setVolumeState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMsg,
      }));
    }
  }, []);

  return {
    ...volumeState,
    isWindowsActive,
    refreshVolume,
    setVolume,
    adjustVolume,
    toggleMute,
  };
}
