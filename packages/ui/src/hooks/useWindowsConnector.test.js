import { describe, expect, it } from "bun:test";
import {
  getWindowsConnectorState,
} from "./useWindowsConnector";

describe("getWindowsConnectorState", () => {
  it("detects active Windows Connector", () => {
    const state = getWindowsConnectorState({
      ready: true,
      platform: "web",
      connectorPlatform: "windows",
      generation: 1,
    });

    expect(state).toEqual({
      isWindowsActive: true,
      isFallbackActive: false,
      hasActiveConnector: true,
      activeConnectorPlatform: "windows",
      appPlatform: "web",
    });
  });

  it("handles case-insensitive Windows connectorPlatform strings", () => {
    const state = getWindowsConnectorState({
      ready: true,
      platform: "web",
      connectorPlatform: "WINDOWS",
      generation: 1,
    });

    expect(state.isWindowsActive).toBe(true);
    expect(state.isFallbackActive).toBe(false);
    expect(state.hasActiveConnector).toBe(true);
  });

  it("detects active non-Windows fallback Connector (macOS)", () => {
    const state = getWindowsConnectorState({
      ready: true,
      platform: "web",
      connectorPlatform: "macos",
      generation: 1,
    });

    expect(state).toEqual({
      isWindowsActive: false,
      isFallbackActive: true,
      hasActiveConnector: true,
      activeConnectorPlatform: "macos",
      appPlatform: "web",
    });
  });

  it("detects active non-Windows fallback Connector (legacy web platform without connectorPlatform)", () => {
    const state = getWindowsConnectorState({
      ready: true,
      platform: "web",
      connectorPlatform: null,
      generation: 1,
    });

    expect(state).toEqual({
      isWindowsActive: false,
      isFallbackActive: true,
      hasActiveConnector: true,
      activeConnectorPlatform: "web",
      appPlatform: "web",
    });
  });

  it("detects active non-Windows fallback Connector (legacy macos platform)", () => {
    const state = getWindowsConnectorState({
      ready: true,
      platform: "macos",
      connectorPlatform: null,
      generation: 1,
    });

    expect(state).toEqual({
      isWindowsActive: false,
      isFallbackActive: true,
      hasActiveConnector: true,
      activeConnectorPlatform: "macos",
      appPlatform: "macos",
    });
  });

  it("reports no active Connector when a phone session is connected", () => {
    const state = getWindowsConnectorState({
      ready: true,
      platform: "ios",
      connectorPlatform: null,
      generation: 1,
    });

    expect(state).toEqual({
      isWindowsActive: false,
      isFallbackActive: false,
      hasActiveConnector: false,
      activeConnectorPlatform: null,
      appPlatform: "ios",
    });
  });

  it("reports no active Connector when Android phone session is connected", () => {
    const state = getWindowsConnectorState({
      ready: true,
      platform: "android",
      connectorPlatform: null,
      generation: 1,
    });

    expect(state).toEqual({
      isWindowsActive: false,
      isFallbackActive: false,
      hasActiveConnector: false,
      activeConnectorPlatform: null,
      appPlatform: "android",
    });
  });

  it("reports no active Connector when not ready / disconnected", () => {
    const state = getWindowsConnectorState({
      ready: false,
      platform: null,
      connectorPlatform: null,
      generation: 0,
    });

    expect(state).toEqual({
      isWindowsActive: false,
      isFallbackActive: false,
      hasActiveConnector: false,
      activeConnectorPlatform: null,
      appPlatform: null,
    });
  });
});
