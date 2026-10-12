import React from "react";
import { BackIcon } from "../common/icons";

export function WeatherApp({
  onClose,
}: {
  onClose?: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 select-none p-6 relative overflow-hidden rounded-2xl">
      {/* Header Bar */}
      <div className="flex items-center justify-between mb-4 z-10 border-b border-zinc-800 pb-4">
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
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
              Weather
            </h1>
            <p className="text-sm font-semibold text-zinc-400">Device App</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="inline-block w-3 h-3 rounded-full bg-amber-500" />
          <span className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Unconfigured
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="text-7xl mb-2">⛅</div>
        <h2 className="text-3xl font-bold text-zinc-100">
          Weather Data Unavailable
        </h2>
        <p className="text-lg text-zinc-400 max-w-md">
          Weather integration is coming soon. Weather data services are not
          configured on this device yet.
        </p>
      </div>
    </div>
  );
}
