import { useState, useEffect } from "react";
import {
  subscribeAppReadyState,
  getAppReadyState,
  isConnectorPlatform,
  type AppReadyState,
} from "./useNocturned";

export type WindowsConnectorState = {
  /** True when a Windows Connector is currently active. */
  isWindowsActive: boolean;
  /** True when a non-Windows desktop Connector (e.g. macOS / Pi) is currently active. */
  isFallbackActive: boolean;
  /** True when any desktop Connector (Windows or fallback) is active. */
  hasActiveConnector: boolean;
  /**
   * The platform string of the active desktop Connector, if any.
   * e.g. "windows", "macos", or null.
   */
  activeConnectorPlatform: string | null;
  /** The overall app session platform string (e.g. "web", "ios", "android", or null). */
  appPlatform: string | null;
};

export const getWindowsConnectorState = (
  appReadyState: AppReadyState,
): WindowsConnectorState => {
  const { ready, platform, connectorPlatform } = appReadyState;
  const isConnector = ready && isConnectorPlatform(platform);

  const activeConnectorPlatform = isConnector
    ? (connectorPlatform ?? (platform === "macos" ? "macos" : "web"))
    : null;

  const isWindowsActive =
    isConnector &&
    typeof connectorPlatform === "string" &&
    connectorPlatform.toLowerCase() === "windows";

  const isFallbackActive = isConnector && !isWindowsActive;

  return {
    isWindowsActive,
    isFallbackActive,
    hasActiveConnector: isConnector,
    activeConnectorPlatform,
    appPlatform: ready ? platform : null,
  };
};

export const useWindowsConnector = (): WindowsConnectorState => {
  const [state, setState] = useState<WindowsConnectorState>(() =>
    getWindowsConnectorState(getAppReadyState()),
  );

  useEffect(() => {
    return subscribeAppReadyState((appReadyState) => {
      setState(getWindowsConnectorState(appReadyState));
    });
  }, []);

  return state;
};
