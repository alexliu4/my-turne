import { describe, expect, it } from "bun:test";
import { getWindowsConnectorState } from "./useWindowsConnector";

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

describe("Windows connector state transition scenarios", () => {
  it("Scenario 1: Windows app.ready -> Windows active", () => {
    const winReady = {
      ready: true,
      platform: "web",
      connectorPlatform: "windows",
      generation: 1,
    };
    const state = getWindowsConnectorState(winReady);

    expect(state.isWindowsActive).toBe(true);
    expect(state.isFallbackActive).toBe(false);
    expect(state.hasActiveConnector).toBe(true);
    expect(state.activeConnectorPlatform).toBe("windows");
  });

  it("Scenario 2: Mac app.ready -> fallback active", () => {
    const macReady = {
      ready: true,
      platform: "web",
      connectorPlatform: "macos",
      generation: 1,
    };
    const state = getWindowsConnectorState(macReady);

    expect(state.isWindowsActive).toBe(false);
    expect(state.isFallbackActive).toBe(true);
    expect(state.hasActiveConnector).toBe(true);
    expect(state.activeConnectorPlatform).toBe("macos");
  });

  it("Scenario 3: Windows -> Mac promotion -> Mac active without false offline state", () => {
    const history = [];
    const events = [
      {
        ready: true,
        platform: "web",
        connectorPlatform: "windows",
        generation: 1,
      },
      {
        ready: true,
        platform: "web",
        connectorPlatform: "macos",
        generation: 2,
      },
    ];

    events.forEach((event) => {
      history.push(getWindowsConnectorState(event));
    });

    expect(history.length).toBe(2);
    expect(history[0]).toMatchObject({
      isWindowsActive: true,
      isFallbackActive: false,
      hasActiveConnector: true,
    });
    expect(history[1]).toMatchObject({
      isWindowsActive: false,
      isFallbackActive: true,
      hasActiveConnector: true,
      activeConnectorPlatform: "macos",
    });
  });

  it("Scenario 4: Windows -> no surviving Connector -> offline state", () => {
    const history = [];
    const events = [
      {
        ready: true,
        platform: "web",
        connectorPlatform: "windows",
        generation: 1,
      },
      { ready: false, platform: null, connectorPlatform: null, generation: 2 },
    ];

    events.forEach((event) => {
      history.push(getWindowsConnectorState(event));
    });

    expect(history[0]).toMatchObject({
      isWindowsActive: true,
      hasActiveConnector: true,
    });
    expect(history[1]).toMatchObject({
      isWindowsActive: false,
      isFallbackActive: false,
      hasActiveConnector: false,
      activeConnectorPlatform: null,
      appPlatform: null,
    });
  });

  it("Scenario 7: Phone readiness/disconnects do not falsely modify desktop Connector ownership", () => {
    const phoneReady = {
      ready: true,
      platform: "android",
      connectorPlatform: null,
      generation: 1,
    };
    const state = getWindowsConnectorState(phoneReady);

    expect(state.isWindowsActive).toBe(false);
    expect(state.isFallbackActive).toBe(false);
    expect(state.hasActiveConnector).toBe(false);
    expect(state.appPlatform).toBe("android");
  });
});
