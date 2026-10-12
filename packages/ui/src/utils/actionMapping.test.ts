import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import {
  validateActionMapping,
  getAllActionMappings,
  getActionMapping,
  setActionMapping,
  resetActionMappings,
  executeAction,
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

describe("actionMapping utils", () => {
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

  test("validateActionMapping accepts valid device and windows action mappings", () => {
    expect(
      validateActionMapping({ kind: "device", action: "media.play_pause" }),
    ).toEqual({ kind: "device", action: "media.play_pause" });

    expect(
      validateActionMapping({
        kind: "device",
        action: "app.launch",
        appId: "weather",
      }),
    ).toEqual({ kind: "device", action: "app.launch", appId: "weather" });

    expect(
      validateActionMapping({
        kind: "windows",
        action: "volume.adjust",
        delta: 10,
      }),
    ).toEqual({ kind: "windows", action: "volume.adjust", delta: 10 });
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

    // Reassign same action to preset_2; conflict handling should unbind preset_1
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

    expect(getActionMapping("preset_1").kind).toBe("device");
    expect(getActionMapping("dial_press").kind).toBe("windows");

    resetActionMappings();

    const all = getAllActionMappings();
    Object.values(all).forEach((mapping) => {
      expect(mapping).toEqual({ kind: "default" });
    });
  });

  test("executeAction returns fallbackToDefault: true when mapped to default", async () => {
    const context: ActionExecutionContext = { isWindowsActive: true };
    const res = await executeAction("preset_1", context);
    expect(res.executed).toBe(false);
    expect(res.fallbackToDefault).toBe(true);
  });

  test("executeAction blocks Windows actions on non-Windows fallback routes gracefully", async () => {
    setActionMapping("preset_1", {
      kind: "windows",
      action: "volume.toggle_mute",
    });

    let wsCalled = false;
    const mockWsReq = async () => {
      wsCalled = true;
      return {};
    };

    const context: ActionExecutionContext = {
      isWindowsActive: false, // Fallback route!
      sendWsRequest: mockWsReq as any,
    };

    const res = await executeAction("preset_1", context);

    expect(res.executed).toBe(false);
    expect(res.fallbackToDefault).toBe(false);
    expect(res.reason).toBe("windows_unavailable");
    expect(wsCalled).toBe(false); // MUST NOT send WS request to non-Windows target
  });

  test("executeAction executes Windows action safely when Windows is active", async () => {
    setActionMapping("preset_1", {
      kind: "windows",
      action: "volume.adjust",
      delta: 5,
    });

    let calledMethod = "";
    let calledParams: any = null;

    const mockWsReq = async (method: string, params: any) => {
      calledMethod = method;
      calledParams = params;
      return { status: "ok" };
    };

    const context: ActionExecutionContext = {
      isWindowsActive: true,
      sendWsRequest: mockWsReq as any,
    };

    const res = await executeAction("preset_1", context);

    expect(res.executed).toBe(true);
    expect(calledMethod).toBe("volume.adjust");
    expect(calledParams).toEqual({ delta: 5 });
  });

  test("executeAction executes device action safely", async () => {
    setActionMapping("dial_press", {
      kind: "device",
      action: "navigate.now_playing",
    });

    let navigatedSection = "";
    const context: ActionExecutionContext = {
      isWindowsActive: false,
      setActiveSection: (sec) => {
        navigatedSection = sec;
      },
    };

    const res = await executeAction("dial_press", context);

    expect(res.executed).toBe(true);
    expect(navigatedSection).toBe("nowPlaying");
  });
});
