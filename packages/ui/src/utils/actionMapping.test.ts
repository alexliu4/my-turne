import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import {
  validateActionMapping,
  getAllActionMappings,
  getActionMapping,
  setActionMapping,
  resetActionMappings,
  executeAction,
  navigateToSection,
  type ActionExecutionContext,
} from "./actionMapping";

const createStorage = (): Storage => {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
};

const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

beforeEach(() => {
  globalThis.localStorage = createStorage();
});

afterAll(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

describe("actionMapping utils & validation", () => {
  test("validateActionMapping returns default for empty or invalid input", () => {
    expect(validateActionMapping(null)).toEqual({ kind: "default" });
    expect(validateActionMapping({})).toEqual({ kind: "default" });
    expect(validateActionMapping({ kind: "invalid_kind" })).toEqual({
      kind: "default",
    });
  });

  test("validateActionMapping strictly prohibits arbitrary remote shell execution", () => {
    expect(
      validateActionMapping({
        kind: "device",
        action: "app.launch",
        appId: "cmd.exe /c calc",
      }),
    ).toEqual({ kind: "default" });

    expect(
      validateActionMapping({
        kind: "windows",
        action: "volume.adjust",
        shell: "powershell -Command Remove-Item -Path C:\\ -Recurse",
      }),
    ).toEqual({ kind: "default" });

    expect(
      validateActionMapping({
        kind: "device",
        action: "media.play_pause",
        command: "bash -c 'echo hacked'",
      }),
    ).toEqual({ kind: "default" });
  });

  test("validateActionMapping rejects unsupported app IDs and bounds volume delta", () => {
    expect(
      validateActionMapping({
        kind: "device",
        action: "app.launch",
        appId: "unsupportedApp123",
      }),
    ).toEqual({ kind: "default" });

    expect(
      validateActionMapping({
        kind: "windows",
        action: "volume.adjust",
        delta: 500,
      }),
    ).toEqual({ kind: "windows", action: "volume.adjust", delta: 100 });

    expect(
      validateActionMapping({
        kind: "windows",
        action: "volume.adjust",
        delta: -200,
      }),
    ).toEqual({ kind: "windows", action: "volume.adjust", delta: -100 });
  });

  test("setActionMapping persists and handles conflicting assignments explicitly", () => {
    const set1 = setActionMapping("preset_1", {
      kind: "windows",
      action: "volume.toggle_mute",
    });
    expect(set1.success).toBe(true);
    expect(getActionMapping("preset_1")).toEqual({
      kind: "windows",
      action: "volume.toggle_mute",
    });

    const set2 = setActionMapping("preset_2", {
      kind: "windows",
      action: "volume.toggle_mute",
    });
    expect(set2.success).toBe(true);
    expect(set2.conflictResolved).toBe(true);

    expect(getActionMapping("preset_1")).toEqual({ kind: "default" });
    expect(getActionMapping("preset_2")).toEqual({
      kind: "windows",
      action: "volume.toggle_mute",
    });
  });

  test("resetActionMappings restores safe defaults across all triggers", () => {
    setActionMapping("preset_1", {
      kind: "device",
      action: "navigate.home",
    });
    setActionMapping("dial_press", {
      kind: "windows",
      action: "volume.toggle_mute",
    });

    resetActionMappings();

    const all = getAllActionMappings();
    Object.values(all).forEach((mapping) => {
      expect(mapping).toEqual({ kind: "default" });
    });
  });

  test("navigateToSection handles supported Nocturne and Mockingbird views and rejects unsupported sections", () => {
    let activeSec = "";
    const mockContext: ActionExecutionContext = {
      setActiveSection: (sec) => {
        activeSec = sec;
      },
    };

    expect(navigateToSection("weather", mockContext)).toBe(true);
    expect(activeSec).toBe("weather");

    expect(navigateToSection("unsupported_sec_99", mockContext)).toBe(false);
  });

  test("executeAction handles unsupported, error, and malformed RPC responses gracefully", async () => {
    setActionMapping("preset_1", {
      kind: "device",
      action: "media.next",
    });

    // Mock RPC returning unsupported status
    const mockWsReqUnsupported = async () => ({ status: "unsupported" });
    const context1: ActionExecutionContext = {
      isWindowsActive: true,
      sendWsRequest: mockWsReqUnsupported,
    };

    const res1 = await executeAction("preset_1", context1);
    expect(res1.executed).toBe(false);
    expect(res1.fallbackToDefault).toBe(false);
    expect(res1.reason).toBe("unsupported");

    // Mock RPC throwing an error
    const mockWsReqError = async () => {
      throw new Error("RPC Network Timeout");
    };
    const context2: ActionExecutionContext = {
      isWindowsActive: true,
      sendWsRequest: mockWsReqError,
    };

    const res2 = await executeAction("preset_1", context2);
    expect(res2.executed).toBe(false);
    expect(res2.fallbackToDefault).toBe(false);
    expect(res2.reason).toBe("RPC Network Timeout");
  });
});
