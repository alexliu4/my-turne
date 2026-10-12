import { useState } from "react";
import { useActionMapping } from "../../../../../hooks/useActionMapping";
import {
  CONTROL_TRIGGERS,
  type ControlTrigger,
} from "../../../../../utils/actionMapping";
import {
  AVAILABLE_ACTIONS,
  TRIGGER_LABELS,
} from "../../../../../utils/actionMappingOptions";
import SubmenuHeader from "../Submenu/SubmenuHeader";
import styles from "./ActionMapping.module.scss";

export default function ActionMapping() {
  const { mappings, setMapping, resetMappings } = useActionMapping();
  const [trigger, setTrigger] = useState<ControlTrigger>("preset_1");
  const [message, setMessage] = useState("");
  const actions = AVAILABLE_ACTIONS.filter(
    (item) =>
      !(
        item.definition.kind === "device" &&
        item.definition.action === "app.launch"
      ),
  );
  return (
    <>
      <SubmenuHeader name="Action mapping" />
      <div className={styles.content}>
        <p>
          Use touch to configure controls. Short Settings press always opens
          Settings. Apps are available only in the Nocturne UI.
        </p>
        <label>
          Physical control
          <select
            aria-label="Physical control"
            value={trigger}
            onChange={(event) => {
              const selected = CONTROL_TRIGGERS.find(
                (value) => value === event.target.value,
              );
              if (selected) setTrigger(selected);
            }}
          >
            {CONTROL_TRIGGERS.filter((value) => value !== "settings_press").map(
              (value) => (
                <option key={value} value={value}>
                  {TRIGGER_LABELS[value]}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Assigned action
          <select
            aria-label="Assigned action"
            value={JSON.stringify(mappings[trigger])}
            onChange={(event) => {
              const selected = actions.find(
                (item) =>
                  JSON.stringify(item.definition) === event.target.value,
              );
              if (!selected) return;
              const result = setMapping(trigger, selected.definition);
              setMessage(
                result.success
                  ? result.conflictResolved
                    ? "Saved. The previous assignment was reset."
                    : "Saved."
                  : "Could not save mapping.",
              );
            }}
          >
            {!actions.some(
              (item) =>
                JSON.stringify(item.definition) ===
                JSON.stringify(mappings[trigger]),
            ) && (
              <option value={JSON.stringify(mappings[trigger])}>
                Unavailable in Mockingbird
              </option>
            )}
            {actions.map((item) => (
              <option key={item.label} value={JSON.stringify(item.definition)}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            resetMappings();
            setMessage("Controls restored to defaults.");
          }}
        >
          Reset All Controls to Default
        </button>
        <p role="status">{message}</p>
      </div>
    </>
  );
}
