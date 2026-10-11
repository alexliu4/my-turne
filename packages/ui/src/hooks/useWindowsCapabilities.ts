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

export type CapabilityStatus = "Available" | "Unavailable" | "Offline";

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
  if (
    typeof payload === "object" &&
    payload !== null &&
    "result" in (payload as Record<string, unknown>)
  ) {
    payload = (payload as Record<string, unknown>).result;
  }

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

export function useWindowsCapabilities(): WindowsCapabilitiesState & {
  refreshCapabilities: () => Promise<void>;
} {
  const [appReady, setAppReady] = useState<AppReadyState>(getAppReadyState);
  const connectorState = getWindowsConnectorState(appReady);
  const { isWindowsActive } = connectorState;

  const [capabilitiesMap, setCapabilitiesMap] = useState<
    Record<WindowsCapabilityKey, CapabilityStatus>
  >(() => {
    const handshakeCaps = extractHandshakeCapabilities(appReady);
    if (handshakeCaps && isWindowsActive) {
      return buildCapabilitiesMap(parseCapabilities(handshakeCaps), true);
    }
    return buildCapabilitiesMap(
      {
        volume: false,
        media: false,
        discord: false,
        systemStats: false,
        macros: false,
        appLaunch: false,
      },
      isWindowsActive,
    );
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const requestTokenRef = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribeAppReadyState(setAppReady);
    return () => {
      requestTokenRef.current++;
      unsubscribe();
    };
  }, []);

  const refreshCapabilities = useCallback(async () => {
    const ready = getAppReadyState();
    const conn = getWindowsConnectorState(ready);

    if (!conn.isWindowsActive) {
      setCapabilitiesMap(createOfflineCapabilities());
      setIsLoading(false);
      setError(null);
      return;
    }

    const currentToken = ++requestTokenRef.current;
    const currentGen = ready.generation;
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendNocturneWsRequest<unknown>(
        "connector.capabilities",
        {},
        { timeoutMs: 3000, appReadyGeneration: currentGen },
      );

      if (
        currentToken !== requestTokenRef.current ||
        getAppReadyState().generation !== currentGen ||
        !getWindowsConnectorState(getAppReadyState()).isWindowsActive
      ) {
        return;
      }

      const parsed = parseCapabilities(response);
      setCapabilitiesMap(buildCapabilitiesMap(parsed, true));
    } catch (err: unknown) {
      if (
        currentToken !== requestTokenRef.current ||
        getAppReadyState().generation !== currentGen ||
        !getWindowsConnectorState(getAppReadyState()).isWindowsActive
      ) {
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);

      // Fall back to handshake capabilities if RPC fails
      const handshakeCaps = extractHandshakeCapabilities(getAppReadyState());
      if (handshakeCaps) {
        const parsed = parseCapabilities(handshakeCaps);
        setCapabilitiesMap(buildCapabilitiesMap(parsed, true));
      } else {
        setCapabilitiesMap(
          buildCapabilitiesMap(
            {
              volume: false,
              media: false,
              discord: false,
              systemStats: false,
              macros: false,
              appLaunch: false,
            },
            true,
          ),
        );
      }
    } finally {
      if (currentToken === requestTokenRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    requestTokenRef.current++;

    if (!isWindowsActive) {
      setCapabilitiesMap(createOfflineCapabilities());
      setIsLoading(false);
      setError(null);
      return;
    }

    const handshakeCaps = extractHandshakeCapabilities(appReady);
    if (handshakeCaps) {
      setCapabilitiesMap(
        buildCapabilitiesMap(parseCapabilities(handshakeCaps), true),
      );
    } else {
      setCapabilitiesMap(
        buildCapabilitiesMap(
          {
            volume: false,
            media: false,
            discord: false,
            systemStats: false,
            macros: false,
            appLaunch: false,
          },
          true,
        ),
      );
    }

    void refreshCapabilities();
  }, [appReady.generation, isWindowsActive, refreshCapabilities]);

  return {
    ...connectorState,
    capabilities: capabilitiesMap,
    isLoading,
    error,
    refreshCapabilities,
  };
}
