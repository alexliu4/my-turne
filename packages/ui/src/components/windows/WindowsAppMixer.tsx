import { useEffect, useRef } from "react";
import { useWindowsAppMixer } from "../../hooks/useWindowsAppMixer";
import { BackIcon } from "../common/icons";

export function WindowsAppMixer({
  onClose,
  inputEnabled = true,
}: {
  onClose?: () => void;
  inputEnabled?: boolean;
}) {
  const mixer = useWindowsAppMixer();
  const live = useRef({ mixer, inputEnabled, onClose });
  live.current = { mixer, inputEnabled, onClose };
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [mixer.selected]);
  useEffect(() => {
    if (!inputEnabled) mixer.cancelPending();
  }, [inputEnabled, mixer.cancelPending]);
  const move = (direction: number) => {
    const current = live.current.mixer;
    const sessions = current.sessions;
    if (!sessions?.length) return;
    const index = sessions.findIndex((s) => s.id === current.selected);
    current.select(
      sessions[
        Math.max(
          0,
          Math.min(sessions.length - 1, index < 0 ? 0 : index + direction),
        )
      ].id,
    );
  };
  useEffect(() => {
    const consume = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const wheel = (event: WheelEvent) => {
      if (
        !live.current.inputEnabled ||
        !event.deltaX ||
        event.deltaY ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      consume(event);
      live.current.mixer.adjust(event.deltaX);
    };
    const key = (event: KeyboardEvent) => {
      if (
        !live.current.inputEnabled ||
        !["Enter", "Escape", "ArrowLeft", "ArrowRight", "1", "2"].includes(
          event.key,
        )
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          "button, a[href], input, select, textarea, [role='button'], [contenteditable]:not([contenteditable='false'])",
        )
      )
        return;
      consume(event);
      if (event.type !== "keydown" || event.repeat) return;
      if (event.key === "Escape") live.current.onClose?.();
      else if (event.key === "Enter") void live.current.mixer.toggleMute();
      else move(["1", "ArrowLeft"].includes(event.key) ? -1 : 1);
    };
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    return () => {
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
    };
  }, []);
  const selected = mixer.sessions?.find((s) => s.id === mixer.selected);
  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950 text-zinc-100 select-none p-6 rounded-2xl">
      <div className="flex items-center gap-3 mb-3 shrink-0">
        {onClose && (
          <button
            type="button"
            aria-label="Go Back"
            onClick={onClose}
            className="p-3 rounded-full bg-zinc-800"
          >
            <BackIcon className="w-6 h-6" />
          </button>
        )}
        <h1 className="text-2xl font-bold flex-1">App Mixer</h1>
        <button
          type="button"
          disabled={!mixer.isWindowsActive || mixer.busy}
          onClick={() => void mixer.refresh()}
          className="p-3 rounded-xl bg-zinc-800 disabled:opacity-40"
        >
          Refresh
        </button>
      </div>
      <p className="text-zinc-300 text-sm mb-2">
        Windows session volume. Select an app, then turn the dial. Buttons 1/2
        select; press dial to mute.
      </p>
      <p role="status" className="text-zinc-300 mb-3">
        {!mixer.isWindowsActive
          ? "Windows inactive. App Mixer unavailable."
          : mixer.busy
            ? "Checking Windows sessions... Shown values may be stale."
            : (mixer.notice ??
              (mixer.sessions === null
                ? "Session state unknown. Try Refresh."
                : mixer.sessions.length === 0
                  ? "No active audio sessions."
                  : "Session values read from Windows."))}
      </p>
      <div className="flex gap-2 mb-3 shrink-0">
        <button
          type="button"
          disabled={!mixer.sessions?.length || !inputEnabled}
          onClick={() => move(-1)}
          className="p-3 rounded-xl bg-zinc-800 disabled:opacity-40"
        >
          Previous app
        </button>
        <button
          type="button"
          disabled={!mixer.sessions?.length || !inputEnabled}
          onClick={() => move(1)}
          className="p-3 rounded-xl bg-zinc-800 disabled:opacity-40"
        >
          Next app
        </button>
        <button
          type="button"
          disabled={!selected || mixer.busy || !!mixer.desired || !inputEnabled}
          onClick={() => void mixer.toggleMute()}
          className="p-3 rounded-xl bg-zinc-800 disabled:opacity-40"
        >
          {selected?.muted ? "Unmute app" : "Mute app"}
        </button>
      </div>
      <div
        ref={list}
        className="overflow-y-auto flex-1 space-y-2"
        aria-label="Windows audio sessions"
      >
        {mixer.sessions?.map((session) => (
          <button
            type="button"
            key={session.id}
            aria-pressed={mixer.selected === session.id}
            disabled={!inputEnabled}
            onClick={() => mixer.select(session.id)}
            className={`w-full p-3 rounded-xl text-left ${mixer.selected === session.id ? "bg-zinc-700 ring-2 ring-blue-400" : "bg-zinc-800"}`}
          >
            <span className="block text-xl break-words">
              {session.appName} · {session.volumePercent}% ·{" "}
              {session.muted ? "Muted" : "Unmuted"}
            </span>
            <span className="block text-sm text-zinc-300 break-words">
              {mixer.outputs[session.endpointId] ?? "Output name unavailable"}
            </span>
            {mixer.desired?.id === session.id && (
              <span className="block text-sm text-blue-300">
                Requested {mixer.desired.value}% · awaiting confirmation
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
