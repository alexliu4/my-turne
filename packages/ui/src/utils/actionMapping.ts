import {
  getActivePresetDeviceId,
  getDevicePresetStorageKey,
  normalizePresetDeviceId,
} from "./presetStorage";
import { sendNocturneWsRequest, getAppReadyState } from "../hooks/useNocturned";
import { getWindowsConnectorState } from "../hooks/useWindowsConnector";

export const CONTROL_TRIGGERS = [
  "preset_1",
  "preset_2",
  "preset_3",
  "preset_4",
  "dial_turn_left",
  "dial_turn_right",
  "dial_press",
  "dial_long_press",
  "back_press",
  "settings_press",
  "settings_long_press",
] as const;

export type ControlTrigger = (typeof CONTROL_TRIGGERS)[number];

export const DEVICE_ACTION_IDS = [
  "media.play_pause",
  "media.next",
  "media.previous",
  "navigate.home",
  "navigate.now_playing",
  "app.launch",
] as const;

export type DeviceActionId = (typeof DEVICE_ACTION_IDS)[number];

export const WINDOWS_ACTION_IDS = [
  "volume.adjust",
  "volume.toggle_mute",
  "media.play_pause",
  "media.next",
  "media.previous",
] as const;

export type WindowsActionId = (typeof WINDOWS_ACTION_IDS)[number];

export const SUPPORTED_APP_IDS = [
  "weather",
  "timer",
  "hostStatus",
  "windowsMedia",
  "windowsVolume",
] as const;

export type SupportedAppId = (typeof SUPPORTED_APP_IDS)[number];

export type DefaultActionDefinition = {
  kind: "default";
};

export type DeviceActionDefinition = {
  kind: "device";
  action: DeviceActionId;
  appId?: SupportedAppId;
};

export type WindowsActionDefinition = {
  kind: "windows";
  action: WindowsActionId;
  delta?: number;
};

export type ActionDefinition =
  | DefaultActionDefinition
  | DeviceActionDefinition
  | WindowsActionDefinition;

export type ActionMappingsMap = Record<ControlTrigger, ActionDefinition>;

export type ViewStoreLike = {
  showContentShelf?: () => void;
  showNpv?: () => void;
};

export type ActionExecutionContext = {
  isWindowsActive?: boolean;
  playTrack?: (
    trackUri?: string | null,
    contextUri?: string | null,
    uris?: string[] | null,
  ) => Promise<boolean>;
  refreshPlaybackState?: () => void;
  setActiveSection?: (section: string) => boolean | void;
  viewStore?: ViewStoreLike;
  sendWsRequest?: (
    method: string,
    params: Record<string, unknown>,
    options: { timeoutMs?: number; appReadyGeneration?: number },
  ) => Promise<unknown>;
};

export type ActionResult = {
  executed: boolean;
  fallbackToDefault: boolean;
  reason?: string;
  result?: unknown;
};

const ACTION_MAPPINGS_STORAGE_KEY = "nocturne_action_mappings";

const DEFAULT_ACTION: DefaultActionDefinition = { kind: "default" };

const PROHIBITED_SHELL_PATTERNS = [
  /cmd/i,
  /powershell/i,
  /bash/i,
  /sh\b/i,
  /exec/i,
  /eval/i,
  /system/i,
  /\/bin\//i,
  /c:\\/i,
  /&/i,
  /\|/i,
  /;/i,
  /`/i,
  /\$/i,
];

const isPlainObject = (val: unknown): val is Record<string, unknown> =>
  Boolean(val) && typeof val === "object" && !Array.isArray(val);

const safeJsonParse = (val: string | null) => {
  if (!val) return null;
  try {
    return JSON.parse(val) as unknown;
  } catch (error) {
    console.warn("Invalid saved action mappings:", error);
    return null;
  }
};

const containsProhibitedShellCommand = (val: unknown): boolean => {
  if (typeof val === "string") {
    return PROHIBITED_SHELL_PATTERNS.some((pattern) => pattern.test(val));
  }
  if (isPlainObject(val)) {
    return Object.values(val).some((v) => containsProhibitedShellCommand(v));
  }
  return false;
};

export function validateActionMapping(mapping: unknown): ActionDefinition {
  if (!isPlainObject(mapping)) {
    return DEFAULT_ACTION;
  }

  if (containsProhibitedShellCommand(mapping)) {
    console.warn(
      "Prohibited shell command pattern detected in action mapping; reverting to default.",
    );
    return DEFAULT_ACTION;
  }

  const kind = mapping.kind;

  if (kind === "default") {
    return DEFAULT_ACTION;
  }

  if (kind === "device") {
    const action = mapping.action;
    if (
      typeof action === "string" &&
      (DEVICE_ACTION_IDS as readonly string[]).includes(action)
    ) {
      if (action === "app.launch") {
        const appId =
          typeof mapping.appId === "string" ? mapping.appId.trim() : "";
        if (
          !appId ||
          !(SUPPORTED_APP_IDS as readonly string[]).includes(appId)
        ) {
          return DEFAULT_ACTION;
        }
        return {
          kind: "device",
          action: "app.launch",
          appId: appId as SupportedAppId,
        };
      }
      return { kind: "device", action: action as DeviceActionId };
    }
    return DEFAULT_ACTION;
  }

  if (kind === "windows") {
    const action = mapping.action;
    if (
      typeof action === "string" &&
      (WINDOWS_ACTION_IDS as readonly string[]).includes(action)
    ) {
      if (action === "volume.adjust") {
        const rawDelta = Number(mapping.delta);
        const clampedDelta = Number.isFinite(rawDelta)
          ? Math.max(-100, Math.min(100, Math.round(rawDelta)))
          : 5;
        return {
          kind: "windows",
          action: "volume.adjust",
          delta: clampedDelta,
        };
      }
      return { kind: "windows", action: action as WindowsActionId };
    }
    return DEFAULT_ACTION;
  }

  return DEFAULT_ACTION;
}

const getStorageKey = (deviceId = getActivePresetDeviceId()) =>
  getDevicePresetStorageKey(
    ACTION_MAPPINGS_STORAGE_KEY,
    normalizePresetDeviceId(deviceId),
  );

export function createDefaultMappingsMap(): ActionMappingsMap {
  return CONTROL_TRIGGERS.reduce((acc, trigger) => {
    acc[trigger] = DEFAULT_ACTION;
    return acc;
  }, {} as ActionMappingsMap);
}

export function getAllActionMappings(
  deviceId = getActivePresetDeviceId(),
): ActionMappingsMap {
  const result = createDefaultMappingsMap();
  if (typeof localStorage === "undefined") return result;

  try {
    const key = getStorageKey(deviceId);
    const raw = safeJsonParse(localStorage.getItem(key));

    if (isPlainObject(raw)) {
      CONTROL_TRIGGERS.forEach((trigger) => {
        if (trigger in raw) {
          result[trigger] =
            trigger === "settings_press"
              ? DEFAULT_ACTION
              : validateActionMapping(raw[trigger]);
        }
      });
    }
  } catch (e) {
    console.error("Failed to read action mappings from storage:", e);
  }

  return result;
}

export function getActionMapping(
  trigger: ControlTrigger,
  deviceId = getActivePresetDeviceId(),
): ActionDefinition {
  const mappings = getAllActionMappings(deviceId);
  return mappings[trigger] || DEFAULT_ACTION;
}

export function setActionMapping(
  trigger: ControlTrigger,
  mappingInput: unknown,
  deviceId = getActivePresetDeviceId(),
): { success: boolean; mapping: ActionDefinition; conflictResolved: boolean } {
  if (!CONTROL_TRIGGERS.includes(trigger) || trigger === "settings_press") {
    return { success: false, mapping: DEFAULT_ACTION, conflictResolved: false };
  }

  const validated = validateActionMapping(mappingInput);
  const currentMappings = getAllActionMappings(deviceId);
  let conflictResolved = false;

  if (validated.kind !== "default") {
    CONTROL_TRIGGERS.forEach((otherTrigger) => {
      if (otherTrigger !== trigger) {
        const otherMapping = currentMappings[otherTrigger];
        if (
          otherMapping.kind === validated.kind &&
          JSON.stringify(otherMapping) === JSON.stringify(validated)
        ) {
          currentMappings[otherTrigger] = DEFAULT_ACTION;
          conflictResolved = true;
        }
      }
    });
  }

  currentMappings[trigger] = validated;

  if (typeof localStorage !== "undefined") {
    try {
      const key = getStorageKey(deviceId);
      localStorage.setItem(key, JSON.stringify(currentMappings));
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("actionMappingsChanged", {
            detail: { deviceId, trigger, mapping: validated },
          }),
        );
      }
    } catch (e) {
      console.error("Failed to save action mappings to storage:", e);
      return {
        success: false,
        mapping: DEFAULT_ACTION,
        conflictResolved: false,
      };
    }
  }

  return { success: true, mapping: validated, conflictResolved };
}

export function resetActionMappings(
  deviceId = getActivePresetDeviceId(),
): void {
  const defaultMap = createDefaultMappingsMap();
  if (typeof localStorage !== "undefined") {
    try {
      const key = getStorageKey(deviceId);
      localStorage.setItem(key, JSON.stringify(defaultMap));
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("actionMappingsChanged", {
            detail: { deviceId, reset: true },
          }),
        );
      }
    } catch (e) {
      console.error("Failed to reset action mappings:", e);
    }
  }
}

export function navigateToSection(
  section: string,
  context: ActionExecutionContext,
): boolean {
  const NOCTURNE_SECTIONS = [
    "recents",
    "nowPlaying",
    "hostStatus",
    "windowsMedia",
    "windowsVolume",
    "timer",
    "weather",
    "library",
    "artists",
    "podcasts",
    "radio",
    "settings",
  ];

  if (context.setActiveSection && NOCTURNE_SECTIONS.includes(section)) {
    return context.setActiveSection(section) !== false;
  }

  if (context.viewStore) {
    if (
      (section === "recents" || section === "shelf") &&
      context.viewStore.showContentShelf
    ) {
      context.viewStore.showContentShelf();
      return true;
    }
    if (
      (section === "nowPlaying" || section === "npv") &&
      context.viewStore.showNpv
    ) {
      context.viewStore.showNpv();
      return true;
    }
    // Apps belong to the Nocturne shell. Mockingbird renders only its own views.
  }

  return false;
}

function rpcActionResult(response: unknown): ActionResult {
  if (
    isPlainObject(response) &&
    response.status === "ok" &&
    !("error" in response)
  ) {
    return { executed: true, fallbackToDefault: false, result: response };
  }
  const reason =
    isPlainObject(response) &&
    (response.status === "unsupported" || response.error === "unsupported")
      ? "unsupported"
      : "rpc_failed";
  return { executed: false, fallbackToDefault: false, reason };
}

export async function executeAction(
  trigger: ControlTrigger,
  context: ActionExecutionContext,
  deviceId = getActivePresetDeviceId(),
): Promise<ActionResult> {
  const mapping = getActionMapping(trigger, deviceId);

  if (mapping.kind === "default") {
    return { executed: false, fallbackToDefault: true };
  }

  if (mapping.kind === "windows") {
    const ready = getAppReadyState();
    const isWindowsActive = getWindowsConnectorState(ready).isWindowsActive;

    if (!isWindowsActive) {
      return {
        executed: false,
        fallbackToDefault: false,
        reason: "windows_unavailable",
      };
    }

    const wsReq = context.sendWsRequest || sendNocturneWsRequest;

    try {
      switch (mapping.action) {
        case "volume.adjust": {
          const delta = mapping.delta ?? 5;
          const res = await wsReq(
            "volume.adjust",
            { delta },
            { timeoutMs: 3000, appReadyGeneration: ready.generation },
          );
          return rpcActionResult(res);
        }
        case "volume.toggle_mute": {
          const res = await wsReq(
            "volume.toggleMute",
            {},
            { timeoutMs: 3000, appReadyGeneration: ready.generation },
          );
          return rpcActionResult(res);
        }
        case "media.play_pause": {
          const res = await wsReq(
            "media.control.toggle",
            { windows_only: true },
            { timeoutMs: 3000, appReadyGeneration: ready.generation },
          );
          return rpcActionResult(res);
        }
        case "media.next": {
          const res = await wsReq(
            "media.control.next",
            { windows_only: true },
            { timeoutMs: 3000, appReadyGeneration: ready.generation },
          );
          return rpcActionResult(res);
        }
        case "media.previous": {
          const res = await wsReq(
            "media.control.previous",
            { windows_only: true },
            { timeoutMs: 3000, appReadyGeneration: ready.generation },
          );
          return rpcActionResult(res);
        }
        default:
          return {
            executed: false,
            fallbackToDefault: false,
            reason: "unknown_windows_action",
          };
      }
    } catch (error) {
      console.warn(
        `Windows action '${mapping.action}' failed gracefully:`,
        error,
      );
      return {
        executed: false,
        fallbackToDefault: false,
        reason: error instanceof Error ? error.message : "rpc_failed",
      };
    }
  }

  if (mapping.kind === "device") {
    const wsReq = context.sendWsRequest || sendNocturneWsRequest;

    try {
      switch (mapping.action) {
        case "media.play_pause": {
          const res = await wsReq(
            "media.control.toggle",
            {},
            { timeoutMs: 3000 },
          );
          const result = rpcActionResult(res);
          if (result.executed) context.refreshPlaybackState?.();
          return result;
        }
        case "media.next": {
          const res = await wsReq(
            "media.control.next",
            {},
            { timeoutMs: 3000 },
          );
          const result = rpcActionResult(res);
          if (result.executed) context.refreshPlaybackState?.();
          return result;
        }
        case "media.previous": {
          const res = await wsReq(
            "media.control.previous",
            {},
            { timeoutMs: 3000 },
          );
          const result = rpcActionResult(res);
          if (result.executed) context.refreshPlaybackState?.();
          return result;
        }
        case "navigate.home": {
          const ok = navigateToSection("recents", context);
          return {
            executed: ok,
            fallbackToDefault: false,
            reason: ok ? undefined : "unsupported_destination",
          };
        }
        case "navigate.now_playing": {
          const ok = navigateToSection("nowPlaying", context);
          return {
            executed: ok,
            fallbackToDefault: false,
            reason: ok ? undefined : "unsupported_destination",
          };
        }
        case "app.launch": {
          if (mapping.appId) {
            const ok = navigateToSection(mapping.appId, context);
            return {
              executed: ok,
              fallbackToDefault: false,
              reason: ok ? undefined : "unsupported_destination",
            };
          }
          return {
            executed: false,
            fallbackToDefault: false,
            reason: "missing_app_id",
          };
        }
        default:
          return {
            executed: false,
            fallbackToDefault: false,
            reason: "unknown_device_action",
          };
      }
    } catch (error) {
      console.warn(
        `Device action '${mapping.action}' failed gracefully:`,
        error,
      );
      return {
        executed: false,
        fallbackToDefault: false,
        reason: error instanceof Error ? error.message : "rpc_failed",
      };
    }
  }

  return { executed: false, fallbackToDefault: true };
}
