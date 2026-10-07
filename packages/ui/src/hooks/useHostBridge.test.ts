import { describe, expect, test } from "bun:test";
import { useHostBridge, type HostBridgeOptions, type HostBridgeState } from "./useHostBridge";

describe("useHostBridge state functions", () => {
  test("module exports useHostBridge hook function", () => {
    expect(typeof useHostBridge).toBe("function");
  });

  test("hasCapability returns true if capability is present in state", () => {
    const state: HostBridgeState = {
      connectionState: "connected",
      hostName: "Windows-Desktop",
      protocolVersion: 1,
      capabilities: ["media", "volume", "discord"],
      lastError: null,
    };

    const hasCapability = (cap: any) => state.capabilities.includes(cap);

    expect(hasCapability("media")).toBe(true);
    expect(hasCapability("volume")).toBe(true);
    expect(hasCapability("macros")).toBe(false);
  });
});
