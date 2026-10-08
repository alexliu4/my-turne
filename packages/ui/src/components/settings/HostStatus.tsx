import React from "react";
import { useHostBridge } from "../../hooks/useHostBridge";
import type { HostCapability } from "../../../../../crates/shared/bindings/host";

const ALL_CAPABILITIES: { key: HostCapability; label: string }[] = [
  { key: "media", label: "Media" },
  { key: "volume", label: "Volume" },
  { key: "discord", label: "Discord" },
  { key: "systemStats", label: "System Stats" },
  { key: "macros", label: "Macros" },
  { key: "appLaunch", label: "App Launch" },
];

export default function HostStatus() {
  const { connectionState, hostName, capabilities, lastError } = useHostBridge();

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";

  const statusText = isConnected
    ? "Connected"
    : isConnecting
      ? "Connecting..."
      : "Offline";

  const statusColorClass = isConnected
    ? "text-emerald-400"
    : isConnecting
      ? "text-amber-400"
      : "text-white/40";

  return (
    <div className="space-y-6">
      <div className="bg-white/10 rounded-xl p-5 border border-white/10 flex items-center justify-between">
        <div>
          <p className="text-[24px] font-[560] text-white/40 tracking-tight mb-1">
            Host Name
          </p>
          <p className="text-[28px] font-[580] text-white tracking-tight">
            {hostName || "Windows PC"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[24px] font-[560] text-white/40 tracking-tight mb-1">
            Status
          </p>
          <p className={`text-[28px] font-[580] tracking-tight ${statusColorClass}`}>
            {statusText}
          </p>
        </div>
      </div>

      {lastError && !isConnected && (
        <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20 text-red-300 text-[24px] font-[560]">
          {lastError}
        </div>
      )}

      <div>
        <h3 className="text-[32px] font-[580] text-white tracking-tight mb-4">
          Capabilities
        </h3>
        <div className="space-y-3">
          {ALL_CAPABILITIES.map(({ key, label }) => {
            const isAvailable = isConnected && capabilities.includes(key);
            return (
              <div
                key={key}
                className="bg-white/10 rounded-xl p-4 border border-white/10 flex items-center justify-between"
              >
                <span className="text-[28px] font-[580] text-white tracking-tight">
                  {label}
                </span>
                <span
                  className={`text-[24px] font-[560] px-3 py-1 rounded-full ${
                    isAvailable
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-white/5 text-white/40 border border-white/10"
                  }`}
                >
                  {isAvailable ? "Available" : "Unavailable"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
