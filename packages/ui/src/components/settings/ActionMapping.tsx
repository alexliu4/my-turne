import React, { useState } from "react";
import { useActionMapping } from "../../hooks/useActionMapping";
import {
  CONTROL_TRIGGERS,
  type ActionDefinition,
  type ControlTrigger,
} from "../../utils/actionMapping";

import {
  TRIGGER_LABELS,
  AVAILABLE_ACTIONS,
} from "../../utils/actionMappingOptions";

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
          Map physical controls to trigger typed device or Windows actions. A
          short Settings press always keeps its original behavior for recovery.
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
          {CONTROL_TRIGGERS.filter(
            (trigger) => trigger !== "settings_press",
          ).map((trigger) => (
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
