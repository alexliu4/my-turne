import { describe, it, expect } from "bun:test";
import { parseVolumeUpdate } from "./useWindowsVolume";

describe("parseVolumeUpdate helper", () => {
  it("parses camelCase and snake_case volumePercent and muted", () => {
    expect(parseVolumeUpdate({ volumePercent: 75, muted: true })).toEqual({
      volumePercent: 75,
      muted: true,
    });
    expect(parseVolumeUpdate({ volume_percent: 42, muted: false })).toEqual({
      volumePercent: 42,
      muted: false,
    });
  });

  it("clamps volumePercent to 0..100", () => {
    expect(parseVolumeUpdate({ volumePercent: 150 })).toEqual({
      volumePercent: 100,
      muted: undefined,
    });
    expect(parseVolumeUpdate({ volumePercent: -20 })).toEqual({
      volumePercent: 0,
      muted: undefined,
    });
  });

  it("handles null or non-object inputs safely", () => {
    expect(parseVolumeUpdate(null)).toEqual({});
    expect(parseVolumeUpdate(undefined)).toEqual({});
    expect(parseVolumeUpdate("invalid")).toEqual({});
  });
});
