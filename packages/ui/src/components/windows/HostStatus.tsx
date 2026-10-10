import React from "react";
import {
  useWindowsCapabilities,
  CAPABILITY_KEYS,
  CAPABILITY_DISPLAY_NAMES,
  type CapabilityStatus,
} from "../../hooks/useWindowsCapabilities";
import { BackIcon } from "../common/icons";

export function HostStatus({
  onClose,
}: {
  onClose?: () => void;
}): React.ReactElement {
  const {
    isWindowsActive,
    isFallbackActive,
    hasActiveConnector,
    activeConnectorPlatform,
    capabilities,
    isLoading,
    error,
    refreshCapabilities,
  } = useWindowsCapabilities();

  const getStatusColor = (status: CapabilityStatus) => {
    switch (status) {
      case "Available":
        return "text-green-400 font-semibold";
      case "Unavailable":
        return "text-amber-400/80 font-medium";
      case "Offline":
      default:
        return "text-zinc-500 font-medium";
    }
  };

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
              Windows PC
            </h1>
            <p className="text-sm font-semibold text-zinc-400">
              {isWindowsActive
                ? "Connected"
                : isFallbackActive
                  ? "Offline"
                  : "Disconnected"}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span
            className={`inline-block w-3 h-3 rounded-full ${
              isWindowsActive ? "bg-green-500 animate-pulse" : "bg-zinc-600"
            }`}
          />
          <span className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            {isWindowsActive ? "Connected" : "Offline"}
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col justify-between overflow-y-auto pr-1">
        {!isWindowsActive && (
          <div className="mb-4 p-3 bg-zinc-900/80 rounded-xl border border-zinc-800/80 text-sm text-zinc-400">
            {isFallbackActive ? (
              <p>
                Using fallback Connector
                {activeConnectorPlatform ? ` (${activeConnectorPlatform})` : ""}
              </p>
            ) : (
              <p>Windows PC is offline or disconnected.</p>
            )}
          </div>
        )}

        {/* Capability List */}
        <div className="space-y-2 mb-4">
          {CAPABILITY_KEYS.map((key) => {
            const displayName = CAPABILITY_DISPLAY_NAMES[key];
            const status = capabilities[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between px-4 py-3 bg-zinc-900/60 rounded-xl border border-zinc-800/50"
              >
                <span className="text-lg font-medium text-zinc-200">
                  {displayName}
                </span>
                <span className={`text-base ${getStatusColor(status)}`}>
                  {status}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer / Controls */}
        {isWindowsActive && (
          <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60">
            <span className="text-xs text-zinc-500">
              {isLoading ? "Refreshing capabilities..." : error ? error : ""}
            </span>
            <button
              type="button"
              onClick={refreshCapabilities}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-300 transition disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
