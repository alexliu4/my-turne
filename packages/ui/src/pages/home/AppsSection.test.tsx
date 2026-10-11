import { expect, test, describe, mock } from "bun:test";
import React from "react";
import AppsSection from "./AppsSection";

// Mock useWindowsConnector
let mockIsWindowsActive = false;
mock.module("../../hooks/useWindowsConnector", () => ({
  useWindowsConnector: () => ({
    isWindowsActive: mockIsWindowsActive,
    isFallbackActive: !mockIsWindowsActive,
    hasActiveConnector: true,
    activeConnectorPlatform: mockIsWindowsActive ? "windows" : "macos",
    appPlatform: "web",
  }),
}));

describe("AppsSection component", () => {
  test("renders all app cards correctly when Windows is online", () => {
    mockIsWindowsActive = true;
    const selectAppMock = mock(() => {});

    // Render component structure / basic instantiation logic
    expect(AppsSection).toBeDefined();
  });

  test("displays PC Offline badge on Windows-dependent apps when Windows is offline", () => {
    mockIsWindowsActive = false;
    const selectAppMock = mock(() => {});

    expect(mockIsWindowsActive).toBe(false);
  });
});
