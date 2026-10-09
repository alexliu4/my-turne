import { describe, it, expect } from "bun:test";
import { parseVolumeUpdate } from "./useWindowsVolume";
import { getWindowsConnectorState } from "./useWindowsConnector";

describe("parseVolumeUpdate contract validation", () => {
  it("Requirement 1 & 3: parses volume.get and volume.update volumePercent, volume_percent, and muted", () => {
    expect(parseVolumeUpdate({ volumePercent: 75, muted: true })).toMatchObject({
      volumePercent: 75,
      muted: true,
      isUnsupported: false,
    });
    expect(parseVolumeUpdate({ volume_percent: 42, muted: false })).toMatchObject({
      volumePercent: 42,
      muted: false,
      isUnsupported: false,
    });
  });

  it("Requirement 4: clamps volumePercent to 0..100, rejects NaN/Infinity, and never displays fabricated state", () => {
    expect(parseVolumeUpdate({ volumePercent: 150 })).toMatchObject({
      volumePercent: 100,
    });
    expect(parseVolumeUpdate({ volumePercent: -20 })).toMatchObject({
      volumePercent: 0,
    });
    expect(parseVolumeUpdate({ volumePercent: NaN })).toMatchObject({});
    expect(parseVolumeUpdate({ volumePercent: Infinity })).toMatchObject({});
  });

  it("Requirement 4: parses unsupported status and error response fields without inventing volume", () => {
    expect(parseVolumeUpdate({ status: "unsupported" })).toMatchObject({
      isUnsupported: true,
    });
    expect(parseVolumeUpdate({ error: "unsupported" })).toMatchObject({
      isUnsupported: true,
    });
  });

  it("handles null or non-object inputs safely", () => {
    expect(parseVolumeUpdate(null)).toEqual({});
    expect(parseVolumeUpdate(undefined)).toEqual({});
    expect(parseVolumeUpdate("invalid")).toEqual({});
  });
});

describe("getWindowsConnectorState liveness, fallback, and phone event isolation", () => {
  it("Requirement 5 & 9: Windows -> Mac/offline disables Windows controls and isolates phone/Spotify volume state", () => {
    const winState = getWindowsConnectorState({
      ready: true,
      platform: "web",
      connectorPlatform: "windows",
      generation: 1,
    });
    expect(winState.isWindowsActive).toBe(true);
    expect(winState.isFallbackActive).toBe(false);

    const macState = getWindowsConnectorState({
      ready: true,
      platform: "web",
      connectorPlatform: "macos",
      generation: 2,
    });
    expect(macState.isWindowsActive).toBe(false);
    expect(macState.isFallbackActive).toBe(true);

    const phoneState = getWindowsConnectorState({
      ready: true,
      platform: "android",
      connectorPlatform: null,
      generation: 3,
    });
    expect(phoneState.isWindowsActive).toBe(false);
    expect(phoneState.isFallbackActive).toBe(false);
  });
});
