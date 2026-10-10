import React from "react";
import { useWindowsMedia } from "../../hooks/useWindowsMedia";
import {
  BackIcon,
  PlayIcon,
  PauseIcon,
  ForwardIcon,
  CircleOffIcon,
} from "../common/icons";

function formatTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "--:--";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function WindowsMedia({
  onClose,
}: {
  onClose?: () => void;
}): React.ReactElement {
  const {
    isWindowsActive,
    hasActiveSession,
    appName,
    title,
    artist,
    album,
    artworkUrl,
    playbackStatus,
    elapsedTimeMs,
    durationMs,
    isLoading,
    error,
    togglePlayPause,
    nextTrack,
    previousTrack,
  } = useWindowsMedia();

  const isPlaying = playbackStatus === "playing";
  const controlsDisabled = !isWindowsActive || !hasActiveSession || isLoading;

  const progressPercent =
    durationMs && durationMs > 0 && elapsedTimeMs !== null && elapsedTimeMs !== undefined
      ? Math.max(0, Math.min(100, (elapsedTimeMs / durationMs) * 100))
      : 0;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 select-none p-6 relative overflow-hidden rounded-2xl">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-4 z-10">
        <div className="flex items-center space-x-3">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full hover:bg-zinc-800 active:bg-zinc-700 transition"
              aria-label="Go Back"
            >
              <BackIcon className="w-6 h-6 text-zinc-300" />
            </button>
          )}
          <h1 className="text-xl font-bold tracking-tight text-zinc-200">
            Windows Media
          </h1>
        </div>

        <div className="flex items-center space-x-2">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              isWindowsActive ? "bg-green-500 animate-pulse" : "bg-zinc-600"
            }`}
          />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {isWindowsActive ? "Connected" : "Offline"}
          </span>
        </div>
      </div>

      {!isWindowsActive ? (
        /* Windows Offline State */
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
          <CircleOffIcon className="w-16 h-16 mb-4 text-zinc-600" />
          <h2 className="text-2xl font-bold text-zinc-200 mb-2">
            PC unavailable
          </h2>
          <p className="text-sm text-zinc-400 max-w-sm">
            Windows PC is offline or not selected as the active Connector.
            Media controls are safely disabled.
          </p>
        </div>
      ) : !hasActiveSession ? (
        /* No Media Session State */
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
          <div className="w-16 h-16 mb-4 rounded-2xl bg-zinc-800 flex items-center justify-center border border-zinc-700">
            <span className="text-2xl text-zinc-500 font-bold">♫</span>
          </div>
          <h2 className="text-2xl font-bold text-zinc-200 mb-2">
            No media playing
          </h2>
          <p className="text-sm text-zinc-400 max-w-sm">
            No active media session detected on Windows. Start playing media on
            your PC.
          </p>
        </div>
      ) : (
        /* Active Windows Media Session */
        <div className="flex-1 flex flex-col justify-between p-2">
          {/* Top Info Bar */}
          <div className="flex items-center space-x-4">
            <div className="w-24 h-24 rounded-xl bg-zinc-800 border border-zinc-700 overflow-hidden flex-shrink-0 flex items-center justify-center relative shadow-lg">
              {artworkUrl ? (
                <img
                  src={artworkUrl}
                  alt={title || "Artwork"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-3xl text-zinc-500 font-bold">♫</span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              {appName && (
                <span className="inline-block px-2.5 py-0.5 mb-1 text-xs font-semibold rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300">
                  {appName}
                </span>
              )}
              <h2 className="text-xl font-extrabold text-zinc-100 truncate tracking-tight">
                {title || "Unknown Title"}
              </h2>
              <p className="text-sm font-medium text-zinc-400 truncate">
                {artist || "Unknown Artist"}
              </p>
              {album && (
                <p className="text-xs text-zinc-500 truncate mt-0.5">{album}</p>
              )}
            </div>
          </div>

          {/* Timeline / Progress Bar */}
          <div className="my-4">
            <div className="w-full bg-zinc-800 h-2.5 rounded-full overflow-hidden border border-zinc-700/60 mb-2">
              <div
                className="bg-green-500 h-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs font-medium text-zinc-400 px-0.5">
              <span>{formatTime(elapsedTimeMs)}</span>
              <span>{formatTime(durationMs)}</span>
            </div>
          </div>

          {/* Player Controls */}
          <div className="flex items-center justify-center space-x-6">
            <button
              type="button"
              onClick={previousTrack}
              disabled={controlsDisabled}
              className="p-3 rounded-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 border border-zinc-700 transition disabled:opacity-40"
              aria-label="Previous Track"
            >
              <ForwardIcon className="w-6 h-6 text-zinc-200 transform rotate-180" />
            </button>

            <button
              type="button"
              onClick={togglePlayPause}
              disabled={controlsDisabled}
              className="p-4 rounded-full bg-green-500 hover:bg-green-400 active:bg-green-600 text-zinc-950 font-bold transition disabled:opacity-40 shadow-lg"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <PauseIcon className="w-8 h-8 text-zinc-950 fill-current" />
              ) : (
                <PlayIcon className="w-8 h-8 text-zinc-950 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={nextTrack}
              disabled={controlsDisabled}
              className="p-3 rounded-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 border border-zinc-700 transition disabled:opacity-40"
              aria-label="Next Track"
            >
              <ForwardIcon className="w-6 h-6 text-zinc-200" />
            </button>
          </div>

          {error && (
            <p className="text-center text-xs text-red-400 mt-2 font-medium">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
