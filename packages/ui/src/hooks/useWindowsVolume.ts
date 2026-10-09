import { useState, useEffect, useCallback, useRef } from "react";
import { useWindowsConnector } from "./useWindowsConnector";
import { sendNocturneWsRequest, addGlobalWsListener } from "./useNocturned";

export type WindowsVolumeState = {
  volumePercent: number;
  muted: boolean;
  isLoading: boolean;
  error: string | null;
};

export function parseVolumeUpdate(payload: unknown): { volumePercent?: number; muted?: boolean } {
  if (!payload || typeof payload !== "object") return {};
  const obj = payload as Record<string, unknown>;
  const rawVol = obj.volumePercent ?? obj.volume_percent;
  const volumePercent =
    typeof rawVol === "number" && !Number.isNaN(rawVol)
      ? Math.max(0, Math.min(100, Math.round(rawVol)))
      : undefined;
  const muted = typeof obj.muted === "boolean" ? obj.muted : undefined;
  return { volumePercent, muted };
}

export function useWindowsVolume() {
  const { isWindowsActive } = useWindowsConnector();

  const [volumeState, setVolumeState] = useState<WindowsVolumeState>({
    volumePercent: 50,
    muted: false,
    isLoading: false,
    error: null,
  });

  const isWindowsActiveRef = useRef(isWindowsActive);
  useEffect(() => {
    isWindowsActiveRef.current = isWindowsActive;
  }, [isWindowsActive]);

  const refreshVolume = useCallback(async () => {
    if (!isWindowsActiveRef.current) return;
    try {
      setVolumeState((prev) => ({ ...prev, isLoading: true, error: null }));
      const response = await sendNocturneWsRequest<Record<string, unknown>>(
        "volume.get",
        {},
        { timeoutMs: 3000 }
      );
      const parsed = parseVolumeUpdate(response);
      setVolumeState((prev) => ({
        ...prev,
        volumePercent: parsed.volumePercent ?? prev.volumePercent,
        muted: parsed.muted ?? prev.muted,
        isLoading: false,
        error: null,
      }));
    } catch (err: unknown) {
      if (isWindowsActiveRef.current) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setVolumeState((prev) => ({ ...prev, isLoading: false, error: errorMsg }));
      } else {
        setVolumeState((prev) => ({ ...prev, isLoading: false, error: null }));
      }
    }
  }, []);

  useEffect(() => {
    if (isWindowsActive) {
      refreshVolume();
    } else {
      setVolumeState((prev) => ({ ...prev, isLoading: false, error: null }));
    }
  }, [isWindowsActive, refreshVolume]);

  useEffect(() => {
    const removeListener = addGlobalWsListener("windows-volume-listener", {
      onMessage: (message) => {
        if (
          message.type === "event" &&
          (message.topic === "volume.update" || message.topic === "volume.state")
        ) {
          const parsed = parseVolumeUpdate(message.data);
          if (parsed.volumePercent !== undefined || parsed.muted !== undefined) {
            setVolumeState((prev) => ({
              ...prev,
              volumePercent: parsed.volumePercent ?? prev.volumePercent,
              muted: parsed.muted ?? prev.muted,
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
      if (!isWindowsActive) return;
      const clamped = Math.max(0, Math.min(100, Math.round(targetPercent)));
      setVolumeState((prev) => ({ ...prev, volumePercent: clamped }));
      try {
        const response = await sendNocturneWsRequest<Record<string, unknown>>(
          "volume.set",
          { volumePercent: clamped },
          { timeoutMs: 3000 }
        );
        const parsed = parseVolumeUpdate(response);
        setVolumeState((prev) => ({
          ...prev,
          volumePercent: parsed.volumePercent ?? clamped,
          muted: parsed.muted ?? prev.muted,
          error: null,
        }));
      } catch (err: unknown) {
        if (isWindowsActiveRef.current) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          setVolumeState((prev) => ({ ...prev, error: errorMsg }));
        }
      }
    },
    [isWindowsActive]
  );

  const adjustVolume = useCallback(
    async (delta: number) => {
      if (!isWindowsActive) return;
      setVolumeState((prev) => {
        const next = Math.max(0, Math.min(100, Math.round(prev.volumePercent + delta)));
        return { ...prev, volumePercent: next };
      });
      try {
        const response = await sendNocturneWsRequest<Record<string, unknown>>(
          "volume.adjust",
          { delta },
          { timeoutMs: 3000 }
        );
        const parsed = parseVolumeUpdate(response);
        setVolumeState((prev) => ({
          ...prev,
          volumePercent: parsed.volumePercent ?? prev.volumePercent,
          muted: parsed.muted ?? prev.muted,
          error: null,
        }));
      } catch (err: unknown) {
        if (isWindowsActiveRef.current) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          setVolumeState((prev) => ({ ...prev, error: errorMsg }));
        }
      }
    },
    [isWindowsActive]
  );

  const toggleMute = useCallback(async () => {
    if (!isWindowsActive) return;
    setVolumeState((prev) => ({ ...prev, muted: !prev.muted }));
    try {
      const response = await sendNocturneWsRequest<Record<string, unknown>>(
        "volume.toggleMute",
        {},
        { timeoutMs: 3000 }
      );
      const parsed = parseVolumeUpdate(response);
      setVolumeState((prev) => ({
        ...prev,
        volumePercent: parsed.volumePercent ?? prev.volumePercent,
        muted: parsed.muted ?? !prev.muted,
        error: null,
      }));
    } catch (err: unknown) {
      if (isWindowsActiveRef.current) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setVolumeState((prev) => ({ ...prev, error: errorMsg }));
      }
    }
  }, [isWindowsActive]);

  return {
    ...volumeState,
    isWindowsActive,
    refreshVolume,
    setVolume,
    adjustVolume,
    toggleMute,
  };
}
