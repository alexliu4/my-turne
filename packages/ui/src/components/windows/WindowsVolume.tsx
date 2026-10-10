import React from "react";
import { useWindowsVolume } from "../../hooks/useWindowsVolume";
import { VolumeLoudIcon, VolumeOffIcon, BackIcon } from "../common/icons";

export function WindowsVolume({
  onClose,
}: {
  onClose?: () => void;
}): React.ReactElement {
  const {
    isWindowsActive,
    volumePercent,
    muted,
    isLoading,
    error,
    isUnsupported,
    refreshVolume,
    adjustVolume,
    toggleMute,
  } = useWindowsVolume();

  const unavailable =
    isLoading ||
    isUnsupported ||
    error !== null ||
    volumePercent === null ||
    muted === null;

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
            Windows Volume
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
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
          <VolumeOffIcon className="w-16 h-16 mb-4 text-zinc-600" />
          <h2 className="text-2xl font-bold text-zinc-200 mb-2">
            Windows Inactive
          </h2>
          <p className="text-sm text-zinc-400 max-w-sm">
            Windows PC is offline or not selected as active Connector. Controls
            are safely disabled.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="flex items-center space-x-3 mb-4">
            {muted ? (
              <VolumeOffIcon className="w-10 h-10 text-red-400" />
            ) : (
              <VolumeLoudIcon className="w-10 h-10 text-green-400" />
            )}
            <span className="text-5xl font-extrabold tracking-tight">
              {muted
                ? "Muted"
                : volumePercent !== null && volumePercent !== undefined
                  ? `${volumePercent}%`
                  : "--%"}
            </span>
          </div>

          <div className="w-full max-w-xs bg-zinc-800 h-3 rounded-full overflow-hidden mb-8 border border-zinc-700/60">
            <div
              className={`h-full transition-all duration-150 ${
                muted ? "bg-red-500/50" : "bg-green-500"
              }`}
              style={{
                width: `${volumePercent !== null && volumePercent !== undefined ? volumePercent : 0}%`,
              }}
            />
          </div>

          <div className="flex items-center space-x-4">
            <button
              type="button"
              onClick={() => adjustVolume(-5)}
              disabled={unavailable}
              className="px-5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 border border-zinc-700 font-semibold text-lg transition disabled:opacity-50"
              aria-label="Decrease Volume"
            >
              -5%
            </button>

            <button
              type="button"
              onClick={toggleMute}
              disabled={unavailable}
              className={`px-6 py-3 rounded-xl font-semibold text-lg transition border border-zinc-700 disabled:opacity-50 ${
                muted
                  ? "bg-red-600/30 text-red-200 hover:bg-red-600/40"
                  : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 active:bg-zinc-600"
              }`}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? "Unmute" : "Mute"}
            </button>

            <button
              type="button"
              onClick={() => adjustVolume(5)}
              disabled={unavailable}
              className="px-5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 border border-zinc-700 font-semibold text-lg transition disabled:opacity-50"
              aria-label="Increase Volume"
            >
              +5%
            </button>
          </div>

          {isUnsupported && (
            <p className="mt-4 text-sm text-zinc-400">
              Volume control is unsupported.
            </p>
          )}
          {!isUnsupported && !error && volumePercent === null && (
            <p className="mt-4 text-sm text-zinc-400">
              {isLoading ? "Loading volume..." : "Volume unknown"}
            </p>
          )}
          {error && (
            <p className="mt-4 text-xs text-red-400 font-medium">{error}</p>
          )}
          {(error || isUnsupported) && (
            <button
              type="button"
              onClick={refreshVolume}
              disabled={isLoading}
              className="mt-4 p-2"
              aria-label="Retry volume"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
