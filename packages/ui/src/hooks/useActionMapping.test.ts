import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import {
  getAllActionMappings,
  setActionMapping,
  resetActionMappings,
  executeAction,
  type ActionExecutionContext,
} from "../utils/actionMapping";

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

describe("useActionMapping logic & action execution", () => {
  test("initial mappings default to kind: default", () => {
    const mappings = getAllActionMappings("test-device");
    expect(mappings.preset_1).toEqual({ kind: "default" });
    expect(mappings.dial_press).toEqual({ kind: "default" });
  });

  test("setting action mapping updates storage and returns stored values", () => {
    const deviceId = "test-device-2";
    setActionMapping(
      "preset_1",
      { kind: "device", action: "media.play_pause" },
      deviceId,
    );

    const mappings = getAllActionMappings(deviceId);
    expect(mappings.preset_1).toEqual({
      kind: "device",
      action: "media.play_pause",
    });
  });

  test("Windows actions do not execute against non-Windows fallback routes", async () => {
    const deviceId = "test-device-3";
    setActionMapping(
      "dial_press",
      { kind: "windows", action: "volume.adjust", delta: 5 },
      deviceId,
    );

    let wsCallCount = 0;
    const context: ActionExecutionContext = {
      isWindowsActive: false, // Non-Windows fallback route!
      sendWsRequest: async () => {
        wsCallCount++;
        return {};
      },
    };

    const res = await executeAction("dial_press", context, deviceId);

    expect(res.executed).toBe(false);
    expect(res.fallbackToDefault).toBe(false);
    expect(res.reason).toBe("windows_unavailable");
    expect(wsCallCount).toBe(0);
  });

  test("device navigation executes but stale Windows context cannot authorize an RPC", async () => {
    // 1. Device action execution
    setActionMapping("preset_1", {
      kind: "device",
      action: "app.launch",
      appId: "weather",
    });

    let launchedApp = "";
    const devContext: ActionExecutionContext = {
      isWindowsActive: false,
      setActiveSection: (app) => {
        launchedApp = app;
      },
    };

    const devRes = await executeAction("preset_1", devContext);
    expect(devRes.executed).toBe(true);
    expect(launchedApp).toBe("weather");

    // 2. Windows action execution when Windows is active
    setActionMapping("preset_2", {
      kind: "windows",
      action: "volume.toggle_mute",
    });

    let calledMethod = "";
    const winContext: ActionExecutionContext = {
      isWindowsActive: true,
      sendWsRequest: async (method: string) => {
        calledMethod = method;
        return { status: "ok" };
      },
    };

    const winRes = await executeAction("preset_2", winContext);
    expect(winRes.executed).toBe(false);
    expect(calledMethod).toBe("");
  });
});
