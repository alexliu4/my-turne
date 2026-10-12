import { useState, useEffect, useCallback } from "react";
import {
  getAllActionMappings,
  getActionMapping,
  setActionMapping,
  resetActionMappings,
  executeAction,
  type ActionDefinition,
  type ActionExecutionContext,
  type ActionMappingsMap,
  type ActionResult,
  type ControlTrigger,
} from "../utils/actionMapping";
import { getActivePresetDeviceId } from "../utils/presetStorage";

export function useActionMapping(deviceId = getActivePresetDeviceId()) {
  const [mappings, setMappings] = useState<ActionMappingsMap>(() =>
    getAllActionMappings(deviceId),
  );

  useEffect(() => {
    setMappings(getAllActionMappings(deviceId));

    const handleMappingChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ deviceId?: string }>;
      if (
        !customEvent.detail?.deviceId ||
        customEvent.detail.deviceId === deviceId
      ) {
        setMappings(getAllActionMappings(deviceId));
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("actionMappingsChanged", handleMappingChange);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(
          "actionMappingsChanged",
          handleMappingChange,
        );
      }
    };
  }, [deviceId]);

  const getMapping = useCallback(
    (trigger: ControlTrigger): ActionDefinition => {
      return getActionMapping(trigger, deviceId);
    },
    [deviceId],
  );

  const setMapping = useCallback(
    (trigger: ControlTrigger, mapping: ActionDefinition) => {
      const res = setActionMapping(trigger, mapping, deviceId);
      setMappings(getAllActionMappings(deviceId));
      return res;
    },
    [deviceId],
  );

  const resetMappings = useCallback(() => {
    resetActionMappings(deviceId);
    setMappings(getAllActionMappings(deviceId));
  }, [deviceId]);

  const executeTrigger = useCallback(
    (
      trigger: ControlTrigger,
      context: ActionExecutionContext,
    ): Promise<ActionResult> => {
      return executeAction(trigger, context, deviceId);
    },
    [deviceId],
  );

  return {
    mappings,
    getMapping,
    setMapping,
    resetMappings,
    executeTrigger,
  };
}
