import React from "react";
import { useWindowsSession } from "../../hooks/useWindowsSession";

const labels = {
  locked: "Locked",
  unlocked: "Unlocked",
  unknown: "Unknown",
  active: "Active",
  inactive: "Inactive",
  on: "On",
  off: "Off",
  dimmed: "Dimmed",
  awake: "Awake",
  suspending: "Suspending",
  resuming: "Resuming",
};

export function WindowsSessionStatus(): React.ReactElement {
  const { status, snapshot, refreshSession } = useWindowsSession();
  const description = {
    offline: "Windows route offline. Session and power state unknown.",
    loading: "Refreshing Windows session and power state...",
    ready:
      "Last reported Windows state. Locking does not disconnect the route.",
    unsupported: "This Connector does not support Windows session status.",
    error:
      "Windows session request failed or could not be verified. Try Refresh state.",
  }[status];
  return (
    <section
      aria-label="Windows session and power"
      className="mb-4 p-3 bg-zinc-900/80 rounded-xl border border-zinc-800/80"
    >
      <div className="flex justify-between items-center gap-3 mb-2">
        <h2 className="font-semibold">Windows session and power</h2>
        <button
          type="button"
          onClick={refreshSession}
          disabled={status === "loading" || status === "offline"}
          className="px-3 py-2 rounded-lg bg-zinc-800 text-xs disabled:opacity-50"
        >
          Refresh state
        </button>
      </div>
      <p role="status" className="text-sm text-zinc-400 mb-2">
        {description}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt>Session lock</dt>
        <dd>{labels[snapshot?.session ?? "unknown"]}</dd>
        <dt>Session activity</dt>
        <dd>{labels[snapshot?.activeSession ?? "unknown"]}</dd>
        <dt>Windows display</dt>
        <dd>{labels[snapshot?.displayPower ?? "unknown"]}</dd>
        <dt>System power</dt>
        <dd>{labels[snapshot?.systemPower ?? "unknown"]}</dd>
      </dl>
    </section>
  );
}
