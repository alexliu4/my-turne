import { describe, it, expect, beforeEach, spyOn, type Mock } from "bun:test";
import {
  parseCapabilities,
  buildCapabilitiesMap,
  extractHandshakeCapabilities,
} from "./useWindowsCapabilities";
import * as daemon from "./useNocturned";

describe("Windows capability parsing & map building", () => {
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

  it("parses object with capabilities array or boolean flags", () => {
    const parsedFromObj = parseCapabilities({
      capabilities: ["volume", "media"],
    });
    expect(parsedFromObj.volume).toBe(true);
    expect(parsedFromObj.media).toBe(true);
    expect(parsedFromObj.discord).toBe(false);

    const parsedFromFlags = parseCapabilities({
      volume: true,
      media: "available",
      discord: false,
    });
    expect(parsedFromFlags.volume).toBe(true);
    expect(parsedFromFlags.media).toBe(true);
    expect(parsedFromFlags.discord).toBe(false);
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
      capabilities: ["volume", "discord"],
    } as any;
    expect(extractHandshakeCapabilities(rootState)).toEqual([
      "volume",
      "discord",
    ]);

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
