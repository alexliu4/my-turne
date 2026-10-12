import React, { useState } from "react";
import { useActionMapping } from "../../hooks/useActionMapping";
import {
  CONTROL_TRIGGERS,
  type ActionDefinition,
  type ControlTrigger,
} from "../../utils/actionMapping";

const TRIGGER_LABELS: Record<ControlTrigger, string> = {
  preset_1: "Preset 1 Button",
  preset_2: "Preset 2 Button",
  preset_3: "Preset 3 Button",
  preset_4: "Preset 4 Button",
  dial_turn_left: "Dial Turn Left",
  dial_turn_right: "Dial Turn Right",
  dial_press: "Dial Press",
  dial_long_press: "Dial Long Press",
  back_press: "Back Button",
  settings_press: "Settings Button",
  settings_long_press: "Settings Button Long Press",
};

const AVAILABLE_ACTIONS: Array<{
  label: string;
  definition: ActionDefinition;
}> = [
  {
    label: "Default (Original Physical Control)",
    definition: { kind: "default" },
  },
  {
    label: "Device: Play / Pause",
    definition: { kind: "device", action: "media.play_pause" },
  },
  {
    label: "Device: Next Track",
    definition: { kind: "device", action: "media.next" },
  },
  {
    label: "Device: Previous Track",
    definition: { kind: "device", action: "media.previous" },
  },
  {
    label: "Device: Toggle Mute",
    definition: { kind: "device", action: "volume.mute_toggle" },
  },
  {
    label: "Device: Navigate Home",
    definition: { kind: "device", action: "navigate.home" },
  },
  {
    label: "Device: Navigate Now Playing",
    definition: { kind: "device", action: "navigate.now_playing" },
  },
  {
    label: "Device: Launch Weather App",
    definition: { kind: "device", action: "app.launch", appId: "weather" },
  },
  {
    label: "Device: Launch Timer App",
    definition: { kind: "device", action: "app.launch", appId: "timer" },
  },
  {
    label: "Device: Launch Host Status",
    definition: { kind: "device", action: "app.launch", appId: "hostStatus" },
  },
  {
    label: "Device: Launch Windows Media",
    definition: { kind: "device", action: "app.launch", appId: "windowsMedia" },
  },
  {
    label: "Device: Launch Windows Volume",
    definition: {
      kind: "device",
      action: "app.launch",
      appId: "windowsVolume",
    },
  },
  {
    label: "Windows: Volume Up (+5)",
    definition: { kind: "windows", action: "volume.adjust", delta: 5 },
  },
  {
    label: "Windows: Volume Down (-5)",
    definition: { kind: "windows", action: "volume.adjust", delta: -5 },
  },
  {
    label: "Windows: Toggle Mute",
    definition: { kind: "windows", action: "volume.toggle_mute" },
  },
  {
    label: "Windows: Play / Pause",
    definition: { kind: "windows", action: "media.play_pause" },
  },
  {
    label: "Windows: Next Track",
    definition: { kind: "windows", action: "media.next" },
  },
  {
    label: "Windows: Previous Track",
    definition: { kind: "windows", action: "media.previous" },
  },
];

function getActionLabel(def: ActionDefinition): string {
  const matched = AVAILABLE_ACTIONS.find(
    (item) => JSON.stringify(item.definition) === JSON.stringify(def),
  );
  if (matched) return matched.label;
  if (def.kind === "default") return "Default (Original Physical Control)";
  return `${def.kind.toUpperCase()}: ${def.action}`;
}

export function ActionMappingComponent() {
  const { mappings, setMapping, resetMappings } = useActionMapping();
  const [selectedTrigger, setSelectedTrigger] =
    useState<ControlTrigger>("preset_1");

  const currentDef = mappings[selectedTrigger] || { kind: "default" };

  return (
    <div className="space-y-6 text-white max-w-xl">
      <div className="mb-4">
        <p className="text-[24px] font-[560] text-white/60 mb-2">
          Map physical controls to trigger typed device or Windows actions.
        </p>
      </div>

      <div className="flex flex-col space-y-2">
        <label className="text-[28px] font-[580] text-white/90">
          Select Physical Control:
        </label>
        <select
          value={selectedTrigger}
          onChange={(e) => setSelectedTrigger(e.target.value as ControlTrigger)}
          className="bg-white/10 text-white text-[28px] p-3 rounded-xl border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
        >
          {CONTROL_TRIGGERS.map((trigger) => (
            <option
              key={trigger}
              value={trigger}
              className="bg-black text-white"
            >
              {TRIGGER_LABELS[trigger]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col space-y-2">
        <label className="text-[28px] font-[580] text-white/90">
          Assigned Action:
        </label>
        <select
          value={JSON.stringify(currentDef)}
          onChange={(e) => {
            try {
              const def = JSON.parse(e.target.value) as ActionDefinition;
              setMapping(selectedTrigger, def);
            } catch (err) {
              console.error("Failed to set action mapping:", err);
            }
          }}
          className="bg-white/10 text-white text-[28px] p-3 rounded-xl border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
        >
          {AVAILABLE_ACTIONS.map((item, idx) => (
            <option
              key={idx}
              value={JSON.stringify(item.definition)}
              className="bg-black text-white"
            >
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="p-4 bg-white/5 rounded-xl border border-white/10 mt-6">
        <span className="text-[24px] font-[560] text-white/80 block mb-1">
          Current Trigger:{" "}
          <strong className="text-white">
            {TRIGGER_LABELS[selectedTrigger]}
          </strong>
        </span>
        <span className="text-[24px] font-[560] text-white/80 block">
          Current Mapping:{" "}
          <strong className="text-white">{getActionLabel(currentDef)}</strong>
        </span>
      </div>

      <div className="pt-4">
        <button
          onClick={() => resetMappings()}
          className="bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[28px] font-[580] px-6 py-3 rounded-xl border border-red-500/30 transition-colors focus:outline-none"
        >
          Reset All Controls to Default
        </button>
      </div>
    </div>
  );
}

export default ActionMappingComponent;
