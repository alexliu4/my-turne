import { useWindowsDiscord } from "../../hooks/useWindowsDiscord";
import { BackIcon } from "../common/icons";

export function Discord({ onClose }: { onClose?: () => void }) {
  const state = useWindowsDiscord();
  const disabled =
    !state.isWindowsActive || !state.available || state.isLoading;
  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 select-none p-6 rounded-2xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
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
          <h1 className="text-2xl font-bold">Discord</h1>
        </div>
        <button
          type="button"
          onClick={state.refresh}
          disabled={!state.isWindowsActive || state.isLoading}
          className="px-5 py-3 rounded-xl bg-zinc-800 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-5">
        <p className="text-xl text-zinc-300">
          {!state.isWindowsActive
            ? "PC unavailable"
            : state.isLoading
              ? "Checking Discord..."
              : state.available
                ? "Connected"
                : "Discord unavailable"}
        </p>
        <div className="flex gap-12 text-3xl font-semibold">
          <p>
            Mic:{" "}
            {state.muted === null ? "Unknown" : state.muted ? "Muted" : "On"}
          </p>
          <p>
            Audio:{" "}
            {state.deafened === null
              ? "Unknown"
              : state.deafened
                ? "Deafened"
                : "On"}
          </p>
        </div>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={state.toggleMute}
            disabled={disabled}
            className="px-6 py-4 rounded-xl bg-indigo-600 disabled:opacity-50"
          >
            Toggle Mic
          </button>
          <button
            type="button"
            onClick={state.toggleDeafen}
            disabled={disabled}
            className="px-6 py-4 rounded-xl bg-indigo-600 disabled:opacity-50"
          >
            Toggle Audio
          </button>
        </div>
        <p
          role="status"
          className="text-center text-sm text-zinc-400 max-w-lg min-h-10"
        >
          {state.notice ??
            (state.isWindowsActive
              ? "Refresh after starting or restarting Discord. Toggles may require Discord focus on the PC."
              : "Connect the Windows PC to use Discord controls.")}
        </p>
      </div>
    </div>
  );
}
