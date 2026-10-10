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

  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.capabilities)) {
      items = obj.capabilities;
    } else if (Array.isArray(obj.items)) {
      items = obj.items;
    } else {
      for (const [key, val] of Object.entries(obj)) {
        if (
          val === true ||
          val === "available" ||
          val === "enabled" ||
          val === "supported"
        ) {
          items.push(key);
        }
      }
    }
  }

  for (const item of items) {
    if (typeof item !== "string") continue;
    const lower = item.toLowerCase().trim();

    if (
      lower === "volume" ||
      lower.startsWith("volume") ||
      lower === "audio_control"
    ) {
      result.volume = true;
    } else if (
      lower === "media" ||
      lower.startsWith("media") ||
      lower === "gsmtc"
    ) {
      result.media = true;
    } else if (lower === "discord" || lower.startsWith("discord")) {
      result.discord = true;
    } else if (
      lower === "systemstats" ||
      lower === "system_stats" ||
      lower === "system_stat" ||
      lower === "stats" ||
      lower === "pc_stats"
    ) {
      result.systemStats = true;
    } else if (
      lower === "macros" ||
      lower === "macro" ||
      lower === "macro_execution"
    ) {
      result.macros = true;
    } else if (
      lower === "applaunch" ||
      lower === "app_launch" ||
      lower === "app_launcher" ||
      lower === "apps"
    ) {
      result.appLaunch = true;
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

  const pendingGeneration = useRef<number | null>(null);

  useEffect(() => {
    return subscribeAppReadyState(setAppReady);
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

    const currentGen = ready.generation;
    pendingGeneration.current = currentGen;
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendNocturneWsRequest<unknown>(
        "connector.capabilities",
        {},
        { timeoutMs: 3000 },
      );

      if (
        pendingGeneration.current !== currentGen ||
        getAppReadyState().generation !== currentGen ||
        !getWindowsConnectorState(getAppReadyState()).isWindowsActive
      ) {
        return;
      }

      const parsed = parseCapabilities(response);
      setCapabilitiesMap(buildCapabilitiesMap(parsed, true));
    } catch (err: unknown) {
      if (
        pendingGeneration.current !== currentGen ||
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
      if (pendingGeneration.current === currentGen) {
        pendingGeneration.current = null;
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isWindowsActive) {
      setCapabilitiesMap(createOfflineCapabilities());
      setIsLoading(false);
      setError(null);
      pendingGeneration.current = null;
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
