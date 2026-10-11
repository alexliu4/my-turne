import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  spyOn,
  mock,
} from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import {
  useWindowsCapabilities,
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

  it("parses the UI-unwrapped RPC response", () => {
    expect(
      parseCapabilities({
        capabilities: { volume: true, media: true, discord: false },
      }),
    ).toEqual({
      volume: true,
      media: true,
      discord: false,
      systemStats: false,
      macros: false,
      appLaunch: false,
    });
  });

  it.each(
    [
      "available",
      "supported",
      "enabled",
      "true",
      1,
      null,
      undefined,
      {},
      [],
      false,
    ].map((value) => ({ value })),
  )("rejects malformed boolean-map value %p and unknown keys", ({ value }) => {
    const parsed = parseCapabilities({
      capabilities: {
        volume: value,
        media: true,
        discord: value,
        unknown: true,
        constructor: true,
        toString: true,
        ["__proto__"]: true,
      },
    });
    expect(parsed).toEqual({
      volume: false,
      media: true,
      discord: false,
      systemStats: false,
      macros: false,
      appLaunch: false,
    });
  });

  it.each([null, undefined, "volume", 1, { capabilities: "volume" }])(
    "fails closed for malformed payload %p",
    (payload) =>
      expect(Object.values(parseCapabilities(payload))).not.toContain(true),
  );

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
    const parsed = parseCapabilities([
      "volume",
      "media",
      "discord",
      "unknown",
      "constructor",
      null,
      1,
    ]);
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
    } satisfies daemon.AppReadyState;
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
    } satisfies daemon.AppReadyState & { data: { capabilities: string[] } };
    expect(extractHandshakeCapabilities(dataState)).toEqual(["media"]);
  });
});

// Same React DOM/Happy DOM boundary harness used by the Windows volume tests.
describe("Windows capability hook lifecycle", () => {
  let ready: daemon.AppReadyState;
  let listener: ((state: daemon.AppReadyState) => void) | undefined;
  let calls: {
    method: string;
    params: object;
    options: unknown;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }[];
  let root: Root;
  let hook: ReturnType<typeof useWindowsCapabilities>;
  let dom: Window;
  const originals = new Map<string, PropertyDescriptor | undefined>();

  function Probe() {
    hook = useWindowsCapabilities();
    return null;
  }

  beforeEach(() => {
    dom = new Window({ url: "http://localhost" });
    for (const [key, value] of Object.entries({
      window: dom,
      document: dom.document,
      navigator: dom.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    calls = [];
    ready = {
      ready: true,
      platform: "web",
      connectorPlatform: "windows",
      generation: 1,
    };
    spyOn(daemon, "getAppReadyState").mockImplementation(() => ready);
    spyOn(daemon, "subscribeAppReadyState").mockImplementation((subscriber) => {
      listener = subscriber;
      subscriber(ready);
      return () => {
        listener = undefined;
      };
    });
    spyOn(daemon, "sendNocturneWsRequest").mockImplementation(
      <T,>(method: string, params: object = {}, options?: unknown) => {
        const promise = new Promise<unknown>((resolve, reject) =>
          calls.push({ method, params, options, resolve, reject }),
        );
        return promise as Promise<T>;
      },
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    mock.restore();
    await dom.happyDOM.cancelAsync();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });

  async function mount() {
    await act(async () => root.render(<Probe />));
  }
  async function route(
    connectorPlatform: string | null,
    capabilities?: unknown,
  ) {
    await act(async () => {
      ready = {
        ready: connectorPlatform !== null,
        platform: connectorPlatform === null ? null : "web",
        connectorPlatform,
        generation: ready.generation + 1,
        capabilities,
      };
      listener?.(ready);
    });
  }
  async function respond(value: unknown, index = calls.length - 1) {
    await act(async () => calls[index].resolve(value));
  }
  async function fail(index = calls.length - 1) {
    await act(async () => calls[index].reject(new Error("RPC failed")));
  }
  async function refresh() {
    await act(async () => {
      void hook.refreshCapabilities();
    });
  }

  it("resets Windows to Mac to Windows and reconnects without routing RPCs to fallback", async () => {
    await mount();
    expect(calls[0]).toMatchObject({
      method: "connector.capabilities",
      params: {},
      options: { timeoutMs: 3000, appReadyGeneration: 1 },
    });
    await respond({
      capabilities: { volume: true, media: true, discord: false },
    });
    expect(hook.capabilities.volume).toBe("Available");
    await refresh();
    await route("macos");
    expect(hook.isFallbackActive).toBe(true);
    expect(Object.values(hook.capabilities)).toEqual(Array(6).fill("Offline"));
    expect(hook.isLoading).toBe(false);
    await refresh();
    expect(calls).toHaveLength(2);
    await route("windows");
    expect(calls).toHaveLength(3);
    expect(hook.capabilities.volume).toBe("Unavailable");
    await respond({ capabilities: { discord: true } }, 1);
    expect(hook.capabilities.discord).toBe("Unavailable");
    expect(hook.isLoading).toBe(true);
    await respond({ capabilities: { media: true } });
    expect(hook.capabilities.media).toBe("Available");
    expect(hook.capabilities.volume).toBe("Unavailable");
    await route(null);
    await route("windows");
    expect(calls[3].options).toEqual({
      timeoutMs: 3000,
      appReadyGeneration: ready.generation,
    });
    await respond({ capabilities: { volume: true } });
    expect(hook.capabilities.volume).toBe("Available");
    expect(hook.capabilities.media).toBe("Unavailable");
  });

  it("keeps the latest refresh when overlapping RPCs complete out of order", async () => {
    await mount();
    await refresh();
    await refresh();
    await respond({ capabilities: { media: true } }, 1);
    expect(hook.capabilities.media).toBe("Unavailable");
    expect(hook.isLoading).toBe(true);
    await respond({ capabilities: { discord: true } }, 2);
    await fail(0);
    expect(hook.capabilities.discord).toBe("Available");
    expect(hook.capabilities.media).toBe("Unavailable");
    expect(hook.error).toBeNull();
    expect(hook.isLoading).toBe(false);
  });

  it.each(["success", "failure"])(
    "ignores stale RPC %s after disconnect",
    async (outcome) => {
      ready.capabilities = { volume: true };
      await mount();
      await route(null);
      if (outcome === "success")
        await respond({ capabilities: { media: true } });
      else await fail();
      expect(Object.values(hook.capabilities)).toEqual(
        Array(6).fill("Offline"),
      );
      expect(hook.error).toBeNull();
      expect(hook.isLoading).toBe(false);
    },
  );

  it("RPC failures use only valid capabilities from the current handshake", async () => {
    ready.capabilities = { volume: true };
    await mount();
    expect(hook.capabilities.volume).toBe("Available");
    await route("windows", { media: true, discord: "supported" });
    expect(hook.capabilities.volume).toBe("Unavailable");
    expect(hook.capabilities.media).toBe("Available");
    await fail(0);
    expect(hook.error).toBeNull();
    expect(hook.isLoading).toBe(true);
    await fail(1);
    expect(hook.error).toBe("RPC failed");
    expect(hook.capabilities.media).toBe("Available");
    expect(hook.capabilities.discord).toBe("Unavailable");
    await route("windows");
    await fail();
    expect(Object.values(hook.capabilities)).toEqual(
      Array(6).fill("Unavailable"),
    );
    await route("windows", { volume: "available", media: 1 });
    await fail();
    expect(Object.values(hook.capabilities)).toEqual(
      Array(6).fill("Unavailable"),
    );
  });

  it.each(["success", "failure"])(
    "invalidates pending RPC %s on unmount",
    async (outcome) => {
      await mount();
      const readState = spyOn(daemon, "getAppReadyState");
      await act(async () => root.render(null));
      expect(listener).toBeUndefined();
      readState.mockClear();
      // With the cleanup token invalidated, neither continuation reaches the session
      // read or state setters, even though the same Windows session is still active.
      if (outcome === "success")
        await respond({ capabilities: { volume: true } });
      else await fail();
      expect(readState).not.toHaveBeenCalled();
      await mount();
      expect(hook.capabilities.volume).toBe("Unavailable");
      expect(hook.error).toBeNull();
      await respond({ capabilities: { media: true } });
      expect(hook.capabilities.media).toBe("Available");
    },
  );
});
