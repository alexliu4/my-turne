import { useState, useEffect, useCallback, useRef } from "react";
import { getWindowsConnectorState } from "./useWindowsConnector";
import {
  sendNocturneWsRequest,
  getAppReadyState,
  subscribeAppReadyState,
  type AppReadyState,
} from "./useNocturned";

export type WindowsCapabilityKey =
  | "volume"
  | "media"
  | "discord"
  | "systemStats"
  | "macros"
  | "appLaunch";

export type CapabilityStatus =
  | "Available"
  | "Unavailable"
  | "Offline"
  | "Unknown"
  | "Stale";
export type CapabilityReadStatus =
  | "unknown"
  | "loading"
  | "ready"
  | "unsupported"
  | "error";

export const CAPABILITY_KEYS: WindowsCapabilityKey[] = [
  "volume",
  "media",
  "discord",
  "systemStats",
  "macros",
  "appLaunch",
];

export const CAPABILITY_DISPLAY_NAMES: Record<WindowsCapabilityKey, string> = {
  volume: "Volume",
  media: "Media",
  discord: "Discord",
  systemStats: "System Stats",
  macros: "Macros",
  appLaunch: "App Launch",
};

export type WindowsCapabilitiesState = {
  isWindowsActive: boolean;
  isFallbackActive: boolean;
  hasActiveConnector: boolean;
  activeConnectorPlatform: string | null;
  capabilities: Record<WindowsCapabilityKey, CapabilityStatus>;
  isLoading: boolean;
  error: string | null;
  readStatus: CapabilityReadStatus;
};

const createOfflineCapabilities = (): Record<
  WindowsCapabilityKey,
  CapabilityStatus
> => ({
  volume: "Offline",
  media: "Offline",
  discord: "Offline",
  systemStats: "Offline",
  macros: "Offline",
  appLaunch: "Offline",
});

const KEY_MAP: Record<string, WindowsCapabilityKey> = {
  volume: "volume",
  audio_control: "volume",
  media: "media",
  gsmtc: "media",
  discord: "discord",
  systemstats: "systemStats",
  system_stats: "systemStats",
  system_stat: "systemStats",
  stats: "systemStats",
  pc_stats: "systemStats",
  macros: "macros",
  macro: "macros",
  macro_execution: "macros",
  applaunch: "appLaunch",
  app_launch: "appLaunch",
  app_launcher: "appLaunch",
  apps: "appLaunch",
};

export function parseCapabilities(
  raw: unknown,
): Record<WindowsCapabilityKey, boolean> {
  const result: Record<WindowsCapabilityKey, boolean> = {
    volume: false,
    media: false,
    discord: false,
    systemStats: false,
    macros: false,
    appLaunch: false,
  };

  if (!raw) return result;

  let payload: unknown = raw;
  // Legacy versions omit status. Explicit failure always overrides advertised flags,
  // including an error on the outer envelope of a wrapped response.
  const failed = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const object = value as Record<string, unknown>;
    return (
      object.error != null ||
      (object.status != null && object.status !== "ok") ||
      object.available === false ||
      object.success === false
    );
  };
  if (failed(payload)) return result;
  if (
    typeof payload === "object" &&
    payload !== null &&
    "result" in (payload as Record<string, unknown>)
  ) {
    payload = (payload as Record<string, unknown>).result;
  }
  if (failed(payload)) return result;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item === "string") {
        const lower = item.toLowerCase().trim();
        const mapped = Object.hasOwn(KEY_MAP, lower) ? KEY_MAP[lower] : null;
        if (mapped) {
          result[mapped] = true;
        }
      }
    }
    return result;
  }

  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    const targetCaps =
      typeof obj.capabilities === "object" && obj.capabilities !== null
        ? obj.capabilities
        : obj;

    if (Array.isArray(targetCaps)) {
      for (const item of targetCaps) {
        if (typeof item === "string") {
          const lower = item.toLowerCase().trim();
          const mapped = Object.hasOwn(KEY_MAP, lower) ? KEY_MAP[lower] : null;
          if (mapped) {
            result[mapped] = true;
          }
        }
      }
      return result;
    }

    const targetObj = targetCaps as Record<string, unknown>;
    for (const [key, val] of Object.entries(targetObj)) {
      const lowerKey = key.toLowerCase().trim();
      const mappedKey = Object.hasOwn(KEY_MAP, lowerKey)
        ? KEY_MAP[lowerKey]
        : null;

      if (mappedKey && val === true) {
        result[mappedKey] = true;
      }
    }
  }

  return result;
}

export function buildCapabilitiesMap(
  parsed: Record<WindowsCapabilityKey, boolean>,
  isWindowsActive: boolean,
): Record<WindowsCapabilityKey, CapabilityStatus> {
  if (!isWindowsActive) return createOfflineCapabilities();

  const map: Record<WindowsCapabilityKey, CapabilityStatus> = {
    volume: "Unavailable",
    media: "Unavailable",
    discord: "Unavailable",
    systemStats: "Unavailable",
    macros: "Unavailable",
    appLaunch: "Unavailable",
  };

  for (const key of CAPABILITY_KEYS) {
    if (parsed[key]) {
      map[key] = "Available";
    }
  }

  return map;
}

export function extractHandshakeCapabilities(
  appReady: AppReadyState,
): unknown | null {
  const readyObj = appReady as unknown as Record<string, unknown>;
  if (readyObj.capabilities !== undefined) {
    return readyObj.capabilities;
  }
  const data = readyObj.data as Record<string, unknown> | undefined;
  if (data && data.capabilities !== undefined) {
    return data.capabilities;
  }
  return null;
}

// Presentation preserves unknown fields; action callers keep the fail-closed
// Boolean parser above. An explicit false is different from an absent field.
export function readCapabilitySnapshot(raw: unknown): {
  capabilities: Record<WindowsCapabilityKey, CapabilityStatus>;
  readStatus: "ready" | "unsupported" | "error";
} {
  const capabilities = unknownCapabilities();
  let payload = raw;
  for (let depth = 0; depth < 2; depth++) {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const object = payload as Record<string, unknown>;
      if (object.status === "unsupported" || object.error === "unsupported")
        return { capabilities, readStatus: "unsupported" };
      if (
        object.error != null ||
        (object.status != null && object.status !== "ok") ||
        object.available === false ||
        object.success === false
      )
        return { capabilities, readStatus: "error" };
      if (depth === 0 && "result" in object) {
        payload = object.result;
        continue;
      }
      if ("capabilities" in object) payload = object.capabilities;
    }
    break;
  }
  if (Array.isArray(payload)) {
    if (payload.some((item) => typeof item !== "string"))
      return { capabilities, readStatus: "error" };
    // Legacy arrays advertise the supported set, so omitted entries are false.
    return {
      capabilities: buildCapabilitiesMap(parseCapabilities(payload), true),
      readStatus: "ready",
    };
  }
  if (!payload || typeof payload !== "object")
    return { capabilities, readStatus: "error" };
  let known = false;
  for (const [key, value] of Object.entries(payload)) {
    const normalized = key.toLowerCase().trim();
    const mapped = Object.hasOwn(KEY_MAP, normalized)
      ? KEY_MAP[normalized]
      : null;
    if (mapped && typeof value === "boolean") {
      capabilities[mapped] = value ? "Available" : "Unavailable";
      known = true;
    }
  }
  return { capabilities, readStatus: known ? "ready" : "error" };
}

const unknownCapabilities = (): Record<
  WindowsCapabilityKey,
  CapabilityStatus
> => {
  const capabilities = createOfflineCapabilities();
  for (const key of CAPABILITY_KEYS) capabilities[key] = "Unknown";
  return capabilities;
};

export function useWindowsCapabilities(): WindowsCapabilitiesState & {
  refreshCapabilities: () => Promise<void>;
} {
  const [appReady, setAppReady] = useState<AppReadyState>(getAppReadyState);
  const connectorState = getWindowsConnectorState(appReady);
  const [snapshot, setSnapshot] = useState<{
    generation: number;
    capabilities: Record<WindowsCapabilityKey, CapabilityStatus>;
    readStatus: CapabilityReadStatus;
    error: string | null;
  }>(() => ({
    generation: appReady.generation,
    capabilities: connectorState.isWindowsActive
      ? unknownCapabilities()
      : createOfflineCapabilities(),
    readStatus: "unknown",
    error: null,
  }));
  const requestTokenRef = useRef(0);
  const routeRef = useRef(appReady);
  const inFlightRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeAppReadyState((ready) => {
      // Invalidate immediately, even if disconnect/reconnect is React-batched.
      const previous = routeRef.current;
      if (
        previous.generation !== ready.generation ||
        previous.ready !== ready.ready ||
        previous.platform !== ready.platform ||
        previous.connectorPlatform !== ready.connectorPlatform
      ) {
        requestTokenRef.current++;
        inFlightRef.current = null;
        routeRef.current = ready;
        setAppReady(ready);
      }
    });
    return () => {
      requestTokenRef.current++;
      inFlightRef.current = null;
      unsubscribe();
    };
  }, []);

  const refreshCapabilities = useCallback(async () => {
    const ready = getAppReadyState();
    if (!getWindowsConnectorState(ready).isWindowsActive) return;
    if (inFlightRef.current === ready.generation) return;

    const token = ++requestTokenRef.current;
    const generation = ready.generation;
    inFlightRef.current = generation;
    setSnapshot((previous) => {
      const capabilities = unknownCapabilities();
      if (previous.generation === generation) {
        for (const key of CAPABILITY_KEYS) {
          if (
            previous.capabilities[key] === "Available" ||
            previous.capabilities[key] === "Unavailable"
          )
            capabilities[key] = "Stale";
        }
      }
      return { generation, capabilities, readStatus: "loading", error: null };
    });
    const current = () =>
      token === requestTokenRef.current &&
      getAppReadyState().generation === generation &&
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    try {
      const response = await sendNocturneWsRequest<unknown>(
        "connector.capabilities",
        {},
        { timeoutMs: 3000, appReadyGeneration: generation },
      );
      if (!current()) return;
      const parsed = readCapabilitySnapshot(response);
      setSnapshot({
        generation,
        ...parsed,
        error:
          parsed.readStatus === "error"
            ? "Host capability response could not be verified."
            : null,
      });
    } catch (err: unknown) {
      if (!current()) return;
      // Never render remote error text: it may contain host identifiers or paths.
      const unsupported =
        err instanceof Error &&
        /^(unsupported|unknown method|method not found)(?:[.: ]|$)/i.test(
          err.message,
        );
      setSnapshot({
        generation,
        capabilities: unknownCapabilities(),
        readStatus: unsupported ? "unsupported" : "error",
        error: unsupported
          ? null
          : "Host request failed or timed out. Try Refresh.",
      });
    } finally {
      if (token === requestTokenRef.current) inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    requestTokenRef.current++;
    inFlightRef.current = null;
    setSnapshot({
      generation: appReady.generation,
      capabilities: connectorState.isWindowsActive
        ? unknownCapabilities()
        : createOfflineCapabilities(),
      readStatus: "unknown",
      error: null,
    });
    void refreshCapabilities();
  }, [
    appReady.generation,
    appReady.ready,
    appReady.platform,
    appReady.connectorPlatform,
    connectorState.isWindowsActive,
    refreshCapabilities,
  ]);

  const valid =
    connectorState.isWindowsActive &&
    snapshot.generation === appReady.generation;
  return {
    ...connectorState,
    capabilities: !connectorState.isWindowsActive
      ? createOfflineCapabilities()
      : valid
        ? snapshot.capabilities
        : unknownCapabilities(),
    isLoading: valid && snapshot.readStatus === "loading",
    readStatus: valid ? snapshot.readStatus : "unknown",
    error: valid ? snapshot.error : null,
    refreshCapabilities,
  };
}
