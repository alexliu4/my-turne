import { useEffect, useRef, useState } from "react";
import {
  useWindowsAudioOutputs,
  type OutputScope,
} from "../../hooks/useWindowsAudioOutputs";
import { BackIcon } from "../common/icons";

export function WindowsAudioOutputs({
  onClose,
  inputEnabled = true,
}: {
  onClose?: () => void;
  inputEnabled?: boolean;
}) {
  const output = useWindowsAudioOutputs();
  const [scope, setScope] = useState<OutputScope>("playback");
  const [focus, setFocus] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const live = useRef({ output, scope, focus, inputEnabled, onClose });
  live.current = { output, scope, focus, inputEnabled, onClose };
  useEffect(() => {
    setFocus(null);
    setScope("playback");
  }, [output.generation]);
  useEffect(() => {
    if (focus && !output.devices?.some((item) => item.id === focus))
      setFocus(null);
  }, [output.devices, focus]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[data-focused="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [focus]);
  useEffect(() => {
    const consume = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const wheel = (event: WheelEvent) => {
      const current = live.current;
      if (
        !current.inputEnabled ||
        !event.deltaX ||
        event.deltaY ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      consume(event);
      const devices = current.output.devices;
      if (current.output.busy || !devices?.length) return;
      const index = devices.findIndex((item) => item.id === current.focus);
      const next =
        index < 0
          ? event.deltaX > 0
            ? 0
            : devices.length - 1
          : Math.max(
              0,
              Math.min(devices.length - 1, index + Math.sign(event.deltaX)),
            );
      live.current.focus = devices[next].id;
      setFocus(devices[next].id);
    };
    const key = (event: KeyboardEvent) => {
      const current = live.current;
      if (!current.inputEnabled || !["Enter", "Escape"].includes(event.key))
        return;
      // Focused controls own native keyboard activation. Untargeted kiosk
      // Enter/Escape events retain the dial/Back capture path below.
      if (
        event.target instanceof Element &&
        event.target.closest(
          "button, a[href], input, select, textarea, [role='button'], [contenteditable]:not([contenteditable='false'])",
        )
      )
        return;
      consume(event);
      if (event.type !== "keydown" || event.repeat) return;
      if (event.key === "Escape") current.onClose?.();
      else if (current.focus && !current.output.busy)
        void current.output.select(current.focus, current.scope);
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
  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950 text-zinc-100 select-none p-6 rounded-2xl">
      <div className="flex items-center gap-3 mb-3 shrink-0">
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
        <h1 className="text-2xl font-bold flex-1">Audio Outputs</h1>
        <button
          type="button"
          disabled={!output.isWindowsActive || output.busy}
          onClick={() => void output.refresh()}
          className="p-3 rounded-xl bg-zinc-800 disabled:opacity-40"
        >
          Refresh
        </button>
      </div>
      <div className="flex gap-2 mb-3 shrink-0" aria-label="Output roles">
        {(
          [
            ["playback", "Playback"],
            ["communications", "Calls"],
            ["all", "All roles"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={scope === value}
            disabled={output.busy || !output.isWindowsActive}
            onClick={() => setScope(value)}
            className={`px-4 py-2 rounded-xl disabled:opacity-40 ${scope === value ? "bg-blue-700" : "bg-zinc-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p role="status" className="text-zinc-300 mb-3 shrink-0">
        {!output.isWindowsActive
          ? "Windows inactive. PC outputs unavailable."
          : output.busy
            ? "Checking Windows outputs... Shown defaults may be stale."
            : (output.notice ??
              (output.devices === null
                ? "Output state unknown. Try Refresh."
                : output.devices.length === 0
                  ? "No active audio outputs."
                  : "Turn to focus, press to switch. Playback changes console and multimedia."))}
      </p>
      <div
        ref={list}
        className="overflow-y-auto flex-1 space-y-2"
        aria-label="Audio output devices"
      >
        {output.isWindowsActive &&
          output.devices?.map((device) => (
            <button
              type="button"
              key={device.id}
              data-focused={focus === device.id}
              disabled={output.busy}
              onClick={() => {
                setFocus(device.id);
                void output.select(device.id, scope);
              }}
              className={`w-full p-4 rounded-xl text-left disabled:opacity-50 ${focus === device.id ? "bg-zinc-700 ring-2 ring-blue-400" : "bg-zinc-800"}`}
            >
              <span className="block text-xl break-words">{device.name}</span>
              <span className="block text-sm text-zinc-300">
                {(
                  [
                    ["console", "Console"],
                    ["multimedia", "Multimedia"],
                    ["communications", "Calls"],
                  ] as const
                )
                  .filter(([role]) => device.defaultRoles[role])
                  .map(([, label]) => `${label} default`)
                  .join(" · ") || "No default roles"}
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}
