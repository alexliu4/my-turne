import { describe, it, expect, beforeEach, spyOn, type Mock } from "bun:test";
import {
  parseCapabilities,
  buildCapabilitiesMap,
  extractHandshakeCapabilities,
} from "./useWindowsCapabilities";
import * as daemon from "./useNocturned";

describe("Windows capability parsing & map building", () => {
  it("parses actual Connector RPC response shape with boolean flags", () => {
    const connectorResponse = {
      result: {
        capabilities: {
          volume: true,
          media: true,
          discord: false,
          systemStats: true,
          macros: false,
          appLaunch: false,
        },
      },
    };

    const parsed = parseCapabilities(connectorResponse);
    expect(parsed.volume).toBe(true);
    expect(parsed.media).toBe(true);
    expect(parsed.discord).toBe(false);
    expect(parsed.systemStats).toBe(true);
    expect(parsed.macros).toBe(false);
    expect(parsed.appLaunch).toBe(false);
  });

  it("parses unwrapped capability boolean map", () => {
    const capsObj = {
      volume: true,
      media: true,
      discord: false,
      systemStats: false,
      macros: false,
      appLaunch: false,
    };

    const parsed = parseCapabilities(capsObj);
    expect(parsed.volume).toBe(true);
    expect(parsed.media).toBe(true);
    expect(parsed.discord).toBe(false);
  });

  it("parses array of capability strings", () => {
    const parsed = parseCapabilities(["volume", "media", "discord"]);
    expect(parsed.volume).toBe(true);
    expect(parsed.media).toBe(true);
    expect(parsed.discord).toBe(true);
    expect(parsed.systemStats).toBe(false);
    expect(parsed.macros).toBe(false);
    expect(parsed.appLaunch).toBe(false);
  });

  it("parses snake_case and alternative names for capabilities", () => {
    const parsed = parseCapabilities([
      "audio_control",
      "gsmtc",
      "system_stats",
      "macro_execution",
      "app_launcher",
    ]);
    expect(parsed.volume).toBe(true);
    expect(parsed.media).toBe(true);
    expect(parsed.systemStats).toBe(true);
    expect(parsed.macros).toBe(true);
    expect(parsed.appLaunch).toBe(true);
  });

  it("builds capabilities map when active vs inactive", () => {
    const activeMap = buildCapabilitiesMap(
      {
        volume: true,
        media: true,
        discord: false,
        systemStats: false,
        macros: false,
        appLaunch: false,
      },
      true,
    );
    expect(activeMap.volume).toBe("Available");
    expect(activeMap.media).toBe("Available");
    expect(activeMap.discord).toBe("Unavailable");
    expect(activeMap.systemStats).toBe("Unavailable");

    const offlineMap = buildCapabilitiesMap(
      {
        volume: true,
        media: true,
        discord: false,
        systemStats: false,
        macros: false,
        appLaunch: false,
      },
      false,
    );
    expect(offlineMap.volume).toBe("Offline");
    expect(offlineMap.media).toBe("Offline");
    expect(offlineMap.discord).toBe("Offline");
  });

  it("extracts capabilities from handshake data object or root", () => {
    const rootState = {
      ready: true,
      platform: "web",
      connectorPlatform: "windows",
      generation: 1,
      capabilities: { volume: true, discord: true },
    } as any;
    expect(extractHandshakeCapabilities(rootState)).toEqual({
      volume: true,
      discord: true,
    });

    const dataState = {
      ready: true,
      platform: "web",
      connectorPlatform: "windows",
      generation: 1,
      data: { capabilities: ["media"] },
    } as any;
    expect(extractHandshakeCapabilities(dataState)).toEqual(["media"]);
  });
});
