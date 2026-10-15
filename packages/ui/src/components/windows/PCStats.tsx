import { useWindowsStats } from "../../hooks/useWindowsStats";
import { BackIcon } from "../common/icons";

export function PCStats({ onClose }: { onClose?: () => void }) {
  const { isWindowsActive, snapshot, isLoading } = useWindowsStats();
  const metrics = [
    { label: "CPU", value: snapshot?.cpuPercent ?? null },
    { label: "RAM", value: snapshot?.memoryPercent ?? null },
    ...(snapshot?.gpuPercent != null
      ? [{ label: "GPU", value: snapshot.gpuPercent }]
      : []),
  ];
  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 select-none p-6 rounded-2xl">
      <div className="flex items-center gap-3 mb-6">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Go Back"
            className="p-3 rounded-full bg-zinc-800"
          >
            <BackIcon className="w-6 h-6" />
          </button>
        )}
        <h1 className="text-2xl font-bold">PC Stats</h1>
      </div>
      <div className="flex-1 flex flex-col justify-center gap-6">
        <p role="status" className="text-center text-xl text-zinc-300">
          {!isWindowsActive
            ? "PC unavailable"
            : isLoading
              ? "Reading stats..."
              : snapshot
                ? "Connected"
                : "Stats unavailable"}
        </p>
        <dl className="flex justify-center gap-4">
          {metrics.map(({ label, value }) => (
            <div
              key={label}
              className="bg-zinc-900 rounded-2xl p-4 flex-1 min-w-0 max-w-52 text-center"
            >
              <dt className="text-xl text-zinc-400 mb-3">{label}</dt>
              <dd
                className={`font-semibold tabular-nums ${value === null ? "text-lg" : "text-3xl"}`}
              >
                {value === null ? "Unavailable" : `${Math.round(value)}%`}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-center text-sm text-zinc-400">
          {isWindowsActive
            ? "Readings refresh automatically while this screen is open."
            : "Connect the Windows PC to view telemetry."}
        </p>
      </div>
    </div>
  );
}
