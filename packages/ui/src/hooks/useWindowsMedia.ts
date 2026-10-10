import { useState, useEffect, useCallback, useRef } from "react";
import { getWindowsConnectorState } from "./useWindowsConnector";
import {
  sendNocturneWsRequest,
  addGlobalWsListener,
  getAppReadyState,
  subscribeAppReadyState,
} from "./useNocturned";

export type SupportedControls = {
  toggle: boolean;
  play: boolean;
  pause: boolean;
  next: boolean;
  previous: boolean;
};

export type WindowsMediaState = {
  appName: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  mediaGeneration: number | null;
  playbackStatus: string | null;
  playbackRate: number;
  elapsedTimeMs: number | null;
  durationMs: number | null;
  hasActiveSession: boolean;
  supportedControls: SupportedControls;
  isLoading: boolean;
  error: string | null;
};

const defaultSupportedControls: SupportedControls = {
  toggle: true,
  play: true,
  pause: true,
  next: true,
  previous: true,
};

export const clearedMediaState: WindowsMediaState = {
  appName: null,
  title: null,
  artist: null,
  album: null,
  artworkUrl: null,
  mediaGeneration: null,
  playbackStatus: null,
  playbackRate: 1,
  elapsedTimeMs: null,
  durationMs: null,
  hasActiveSession: false,
  supportedControls: defaultSupportedControls,
  isLoading: false,
  error: null,
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export function normalizeMediaGeneration(value: unknown): number | null {
  const num = number(value);
  return num !== null && Number.isInteger(num) && num >= 0 ? num : null;
}

export function formatArtworkUrl(data: string, contentType?: string | null): string {
  if (data.startsWith("data:") || data.startsWith("http://") || data.startsWith("https://")) {
    return data;
  }
  const mime = contentType || "image/jpeg";
  return `data:${mime};base64,${data}`;
}

export function useWindowsMedia() {
  const [appReady, setAppReady] = useState(getAppReadyState);
  const { isWindowsActive } = getWindowsConnectorState(appReady);
  const [state, setState] = useState<WindowsMediaState>(clearedMediaState);

  const revision = useRef(0);
  const pendingRef = useRef<{ generation: number; revision: number } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => subscribeAppReadyState(setAppReady), []);

  const sendMediaControl = useCallback(
    async (method: string) => {
      const ready = getAppReadyState();
      const currentConnector = getWindowsConnectorState(ready);
      if (!currentConnector.isWindowsActive) {
        return;
      }

      const operation = {
        generation: ready.generation,
        revision: revision.current,
      };
      pendingRef.current = operation;
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const isCurrent = () =>
        pendingRef.current === operation &&
        getAppReadyState().generation === operation.generation &&
        getWindowsConnectorState(getAppReadyState()).isWindowsActive;

      try {
        const response = await sendNocturneWsRequest<unknown>(method, {}, { timeoutMs: 3000 });
        if (!isCurrent() || revision.current !== operation.revision) return;

        const obj = record(response);
        if (obj?.status === "unsupported" || obj?.error === "unsupported") {
          setState((prev) => ({
            ...prev,
            error: "Control unsupported",
          }));
        }
      } catch (error: unknown) {
        if (!isCurrent() || revision.current !== operation.revision) return;
        const message = error instanceof Error ? error.message : String(error);
        const unsupported = message.toLowerCase().includes("unsupported");
        setState((prev) => ({
          ...prev,
          error: unsupported ? "Control unsupported" : message,
        }));
      } finally {
        if (pendingRef.current === operation) {
          pendingRef.current = null;
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    },
    [],
  );

  useEffect(() => {
    setState(clearedMediaState);
    const generation = appReady.generation;

    const removeListener = addGlobalWsListener("windows-media-listener", {
      onMessage: (message) => {
        if (!isWindowsActive || getAppReadyState().generation !== generation) return;

        if (message.type !== "event") return;

        if (message.topic === "media.now_playing.update" || message.topic === "media.nowPlaying.update") {
          const body = record(message.data) ?? {};
          const mediaAttrs =
            record(body.media_item_attributes) ??
            record(body.mediaItemAttributes) ??
            record(body.MediaItemAttributes) ??
            {};
          const playbackAttrs =
            record(body.playback_attributes) ??
            record(body.playbackAttributes) ??
            record(body.PlaybackAttributes) ??
            {};

          const title = text(mediaAttrs.MediaItemTitle ?? mediaAttrs.title);
          const artist = text(mediaAttrs.MediaItemArtist ?? mediaAttrs.artist);
          const album = text(mediaAttrs.MediaItemAlbumName ?? mediaAttrs.MediaItemAlbum ?? mediaAttrs.album);
          const appName = text(playbackAttrs.PlaybackAppName ?? playbackAttrs.appName);
          const rawStatus = text(playbackAttrs.PlaybackStatus ?? playbackAttrs.status);
          const playbackStatus = rawStatus ? rawStatus.toLowerCase() : null;

          const durationMs =
            number(mediaAttrs.MediaItemPlaybackDurationInMilliseconds) ??
            (number(mediaAttrs.MediaItemDuration) !== null
              ? (number(mediaAttrs.MediaItemDuration) as number) * 1000
              : null);

          const elapsedTimeMs =
            number(playbackAttrs.PlaybackElapsedTimeInMilliseconds) ??
            (number(playbackAttrs.PlaybackElapsedTime) !== null
              ? (number(playbackAttrs.PlaybackElapsedTime) as number) * 1000
              : null);

          const playbackRate = number(playbackAttrs.PlaybackRate) ?? number(playbackAttrs.PlaybackSpeed) ?? 1;

          const incomingGen = normalizeMediaGeneration(
            body.media_generation ?? body.mediaGeneration
          );

          const isStoppedOrClosed = playbackStatus === "stopped" || playbackStatus === "closed";
          const hasTrackInfo = Boolean(title || artist);
          const hasSession = hasTrackInfo || (Boolean(playbackStatus) && !isStoppedOrClosed);

          revision.current++;

          if (!hasSession) {
            setState({
              ...clearedMediaState,
              isLoading: stateRef.current.isLoading,
            });
            return;
          }

          setState((prev) => {
            const trackChanged = prev.title !== title || prev.artist !== artist;
            const genChanged = incomingGen !== null && prev.mediaGeneration !== null && incomingGen !== prev.mediaGeneration;
            const shouldClearArtwork = trackChanged || genChanged;

            return {
              ...prev,
              appName,
              title,
              artist,
              album,
              playbackStatus,
              playbackRate,
              elapsedTimeMs,
              durationMs,
              mediaGeneration: incomingGen ?? prev.mediaGeneration,
              hasActiveSession: true,
              artworkUrl: shouldClearArtwork ? null : prev.artworkUrl,
              error: null,
            };
          });
        } else if (message.topic === "media.now_playing.artwork" || message.topic === "media.nowPlaying.artwork") {
          const body = record(message.data) ?? {};
          const artworkGen = normalizeMediaGeneration(
            body.media_generation ?? body.mediaGeneration
          );
          const dataStr = text(body.data);
          const contentType = text(body.content_type ?? body.contentType);

          if (!dataStr) return;

          setState((prev) => {
            if (!prev.hasActiveSession) return prev;

            if (
              artworkGen !== null &&
              prev.mediaGeneration !== null &&
              artworkGen !== prev.mediaGeneration
            ) {
              return prev;
            }

            const artworkUrl = formatArtworkUrl(dataStr, contentType);
            return {
              ...prev,
              artworkUrl,
            };
          });
        } else if (
          message.topic === "media.now_playing.artwork.failed" ||
          message.topic === "media.nowPlaying.artwork.failed"
        ) {
          // Artwork fetch failed, keep existing or clear artwork
        }
      },
    });

    return () => {
      removeListener();
      revision.current++;
      pendingRef.current = null;
    };
  }, [appReady.generation, isWindowsActive]);

  const togglePlayPause = useCallback(
    () => sendMediaControl("media.control.toggle"),
    [sendMediaControl],
  );

  const play = useCallback(
    () => sendMediaControl("media.control.play"),
    [sendMediaControl],
  );

  const pause = useCallback(
    () => sendMediaControl("media.control.pause"),
    [sendMediaControl],
  );

  const nextTrack = useCallback(
    () => sendMediaControl("media.control.next"),
    [sendMediaControl],
  );

  const previousTrack = useCallback(
    () => sendMediaControl("media.control.previous"),
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
