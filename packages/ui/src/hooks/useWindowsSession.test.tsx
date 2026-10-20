import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import * as daemon from "./useNocturned";
import { parseWindowsSession, useWindowsSession } from "./useWindowsSession";
import { WindowsSessionStatus } from "../components/windows/WindowsSessionStatus";
import type { WsMessage } from "../types";

const state = (sequence = 1, observerId = "observer-a") => ({
  observerId,
  sequence,
  observedAt: 123,
  session: "locked",
  activeSession: "active",
  displayPower: "off",
  systemPower: "awake",
  sessionMonitoring: true,
  displayPowerMonitoring: true,
  systemPowerMonitoring: true,
});
const response = (snapshot = state()) => ({
  status: "ok",
  sessionState: snapshot,
});

describe("Windows session boundary", () => {
  it.each(
    [
      null,
      [],
      {},
      { ...state(), sequence: -1 },
      { ...state(), sequence: 1.5 },
      { ...state(), sequence: Infinity },
      { ...state(), observerId: "x".repeat(65) },
    ].map((raw) => ({ raw })),
  )("rejects malformed ordering %p", ({ raw }) => {
    expect(parseWindowsSession(raw)).toBeNull();
  });
  it("requires each monitoring source independently and never invents known state", () => {
    expect(
      parseWindowsSession({
        ...state(),
        sessionMonitoring: false,
        displayPower: "invalid",
        systemPowerMonitoring: "true",
      }),
    ).toEqual({
      observerId: "observer-a",
      sequence: 1,
      session: "unknown",
      activeSession: "unknown",
      displayPower: "unknown",
      systemPower: "unknown",
    });
  });
});

describe("Windows session lifecycle", () => {
  let ready: daemon.AppReadyState;
  let readyListener: ((next: daemon.AppReadyState) => void) | undefined;
  let eventListener: ((message: WsMessage) => void) | undefined;
  let calls: {
    method: string;
    options: unknown;
    resolve: (raw: unknown) => void;
    reject: (error: Error) => void;
  }[];
  let root: Root;
  let hook: ReturnType<typeof useWindowsSession>;
  let dom: Window;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  function Probe() {
    hook = useWindowsSession();
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
    ready = {
      ready: true,
      generation: 1,
      platform: "web",
      connectorPlatform: "windows",
    };
    calls = [];
    spyOn(daemon, "getAppReadyState").mockImplementation(() => ready);
    spyOn(daemon, "subscribeAppReadyState").mockImplementation((subscriber) => {
      readyListener = subscriber;
      subscriber(ready);
      return () => {
        readyListener = undefined;
      };
    });
    spyOn(daemon, "addGlobalWsListener").mockImplementation((_id, handlers) => {
      eventListener = handlers.onMessage;
      return () => {
        eventListener = undefined;
      };
    });
    spyOn(daemon, "sendNocturneWsRequest").mockImplementation(
      <T,>(method: string, _params: object = {}, options?: unknown) =>
        new Promise<unknown>((resolve, reject) =>
          calls.push({ method, options, resolve, reject }),
        ) as Promise<T>,
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
  const mount = async () => {
    await act(async () => root.render(<Probe />));
  };
  const event = async (data: unknown) => {
    await act(async () =>
      eventListener?.({
        type: "event",
        topic: "windows.session.changed",
        data,
      }),
    );
  };
  const handoff = async (connectorPlatform: string, generation: number) => {
    await act(async () => {
      ready = { ...ready, connectorPlatform, generation };
      readyListener?.(ready);
    });
  };

  it("reads once with bounded generation options and coalesces refresh", async () => {
    await mount();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("windows.session.get_status");
    expect(calls[0].options).toEqual({
      timeoutMs: 3000,
      appReadyGeneration: 1,
    });
    await act(async () => {
      hook.refreshSession();
      hook.refreshSession();
      readyListener?.(ready);
    });
    expect(calls).toHaveLength(1);
    await act(async () => calls[0].resolve(response()));
    expect(hook.snapshot?.session).toBe("locked");
    expect(ready.ready).toBe(true);
  });
  it("requires reconnect snapshot and ignores lower and conflicting equal event sequences", async () => {
    await mount();
    await event(state(999));
    expect(hook.snapshot).toBeNull();
    await act(async () => calls[0].resolve(response(state(3))));
    await event({ ...state(3), session: "unlocked" });
    await event(state(2));
    expect(hook.snapshot?.session).toBe("locked");
    await event({ ...state(4), session: "unlocked" });
    expect(hook.snapshot?.session).toBe("unlocked");
    await event(state(4));
    expect(hook.snapshot?.session).toBe("unlocked");
    expect(calls).toHaveLength(1);
  });
  it("clears on Mac fallback and discards late replies and old listeners on Windows return", async () => {
    await mount();
    const oldListener = eventListener;
    await handoff("macos", 2);
    expect(hook.status).toBe("offline");
    await act(async () => calls[0].resolve(response()));
    expect(hook.snapshot).toBeNull();
    await event(state(999));
    expect(calls).toHaveLength(1);
    await handoff("windows", 3);
    expect(calls).toHaveLength(2);
    await act(async () =>
      oldListener?.({
        type: "event",
        topic: "windows.session.changed",
        data: state(999),
      }),
    );
    await act(async () => calls[1].resolve(response(state(1, "observer-b"))));
    expect(hook.snapshot?.observerId).toBe("observer-b");
  });
  it("confirms an unfamiliar native observer by snapshot and bounds event storms", async () => {
    await mount();
    await act(async () => calls[0].resolve(response()));
    await event(state(100, "observer-b"));
    await event(state(101, "observer-b"));
    expect(hook.snapshot).toBeNull();
    expect(calls).toHaveLength(2);
    await act(async () => calls[1].resolve(response(state(1, "observer-b"))));
    await event(state(999, "observer-a"));
    expect(calls).toHaveLength(2);
    expect(hook.snapshot?.observerId).toBe("observer-b");
  });
  it("revalidates a new observer arriving during an older read without concurrent requests", async () => {
    await mount();
    await act(async () => calls[0].resolve(response()));
    await act(async () => hook.refreshSession());
    await event(state(100, "observer-b"));
    expect(calls).toHaveLength(2);
    await act(async () => calls[1].resolve(response(state(2))));
    expect(calls).toHaveLength(3);
    await act(async () => calls[2].resolve(response(state(1, "observer-b"))));
    expect(hook.snapshot?.observerId).toBe("observer-b");
  });
  it("keeps a newer event over an older snapshot or failed refresh", async () => {
    await mount();
    await act(async () => calls[0].resolve(response()));
    await act(async () => hook.refreshSession());
    await event(state(3));
    await act(async () => calls[1].resolve(response(state(2))));
    expect(hook.snapshot?.sequence).toBe(3);
    await act(async () => hook.refreshSession());
    await event(state(4));
    await act(async () =>
      calls[2].reject(new Error("timeout private host data")),
    );
    expect(hook.status).toBe("ready");
    expect(hook.snapshot?.sequence).toBe(4);
  });
  it.each([
    { status: "unsupported" },
    { status: "failed", sessionState: state() },
    { status: "ok", sessionState: {} },
  ])(
    "clears previous state for invalid/unsupported snapshots %p",
    async (raw) => {
      await mount();
      await act(async () => calls[0].resolve(response()));
      await act(async () => hook.refreshSession());
      await act(async () => calls[1].resolve(raw));
      expect(hook.snapshot).toBeNull();
      expect(hook.status).toBe(
        raw.status === "unsupported" ? "unsupported" : "error",
      );
    },
  );
  it("rejects unknown method and timeout without exposing raw errors, and can retry", async () => {
    await mount();
    await act(async () =>
      calls[0].reject(new Error("Unknown method: windows.session.get_status")),
    );
    expect(hook.status).toBe("unsupported");
    await act(async () => hook.refreshSession());
    await act(async () => calls[1].reject(new Error("private path")));
    expect(hook.status).toBe("error");
    expect(hook.snapshot).toBeNull();
    await act(async () => hook.refreshSession());
    await act(async () => calls[2].resolve(response()));
    expect(hook.status).toBe("ready");
  });
  it("invalidates immediate disconnect even without a generation change", async () => {
    await mount();
    await act(async () => {
      ready = { ...ready, ready: false };
      readyListener?.(ready);
      calls[0].resolve(response());
    });
    expect(hook.snapshot).toBeNull();
    expect(hook.status).toBe("offline");
  });
  it("unsubscribes on exit and ignores late completion", async () => {
    await mount();
    await act(async () => root.render(null));
    expect(eventListener).toBeUndefined();
    expect(readyListener).toBeUndefined();
    await act(async () => calls[0].resolve(response()));
  });
  it("renders separate states and sanitized failure with manual refresh", async () => {
    await act(async () => root.render(<WindowsSessionStatus />));
    await act(async () => calls[0].resolve(response()));
    expect(document.body.textContent).toContain("Locked");
    expect(document.body.textContent).toContain("Off");
    expect(document.body.textContent).toContain("Awake");
    await act(async () => document.querySelector("button")?.click());
    await act(async () => calls[1].reject(new Error("secret host path")));
    expect(document.body.textContent).not.toContain("secret host path");
    expect(document.body.textContent).toContain("could not be verified");
    expect(document.querySelectorAll("dd")[0].textContent).toBe("Unknown");
  });
});
