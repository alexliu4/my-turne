import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  mock,
} from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import * as daemon from "./useNocturned";
import { useWindowsDiscord, parseDiscordSnapshot } from "./useWindowsDiscord";
import { Discord } from "../components/windows/Discord";

let ready: daemon.AppReadyState;
let readinessListener: ((state: daemon.AppReadyState) => void) | undefined;
let calls: {
  method: string;
  params: object;
  options: { timeoutMs?: number; appReadyGeneration?: number };
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}[];
let root: Root;
let container: HTMLDivElement;
let hook: ReturnType<typeof useWindowsDiscord>;
let dom: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();

function Probe() {
  hook = useWindowsDiscord();
  return null;
}

beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  container = document.createElement("div");
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
  spyOn(daemon, "subscribeAppReadyState").mockImplementation((listener) => {
    readinessListener = listener;
    listener(ready);
    return () => {
      readinessListener = undefined;
    };
  });
  spyOn(daemon, "sendNocturneWsRequest").mockImplementation(
    <T,>(
      method: string,
      params: object = {},
      options: { timeoutMs?: number; appReadyGeneration?: number } = {},
    ) => {
      const promise = new Promise<unknown>((resolve, reject) =>
        calls.push({ method, params, options, resolve, reject }),
      );
      // The real boundary is generic; tests deliberately supply untrusted wire payloads.
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

async function mount(element: React.ReactElement = <Probe />) {
  await act(async () => root.render(element));
}
async function respond(value: unknown, index = calls.length - 1) {
  await act(async () => calls[index].resolve(value));
}
async function route(connectorPlatform: string | null, active = true) {
  await act(async () => {
    ready = {
      ...ready,
      ready: active,
      connectorPlatform,
      generation: ready.generation + 1,
    };
    readinessListener?.(ready);
  });
}
function button(label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

const unknown = {
  status: "ok",
  available: true,
  running: true,
  state_known: false,
  muted: null,
  deafened: null,
};
const known = { ...unknown, state_known: true, muted: true, deafened: false };

function textButton(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}

describe("Discord contract and lifecycle", () => {
  test("ignores booleans when state is unverified and rejects malformed data", () => {
    expect(
      parseDiscordSnapshot({ ...known, state_known: false }),
    ).toMatchObject({ muted: null, deafened: null });
    expect(parseDiscordSnapshot(known)).toMatchObject({
      muted: true,
      deafened: false,
    });
    for (const payload of [
      null,
      {},
      [],
      { ...known, muted: "false" },
      { ...known, state_known: "true" },
      { ...known, status: "mystery" },
      { ...known, running: 1 },
      { ...known, error: "failed" },
    ]) {
      expect(parseDiscordSnapshot(payload)).toBeNull();
    }
    expect(parseDiscordSnapshot({ ...known, available: false })).toMatchObject({
      available: false,
      muted: null,
      deafened: null,
    });
  });

  test("unverified mute and deafen never fabricate state; actions serialize", async () => {
    await mount();
    expect(calls[0]).toMatchObject({
      method: "discord.get_status",
      params: {},
      options: { timeoutMs: 4000, appReadyGeneration: 1 },
    });
    await respond(unknown);
    await act(async () => {
      void hook.toggleMute();
      void hook.toggleDeafen();
      void hook.refresh();
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe("discord.toggle_mute");
    await respond({ ...unknown, action: "toggled_mute" });
    expect(hook.muted).toBeNull();
    expect(hook.deafened).toBeNull();
    expect(hook.notice).toContain("State unverified");
    await act(async () => {
      void hook.toggleDeafen();
    });
    expect(calls[2].method).toBe("discord.toggle_deafen");
    await respond({ ...unknown, action: "toggled_deafen" });
    expect(hook.deafened).toBeNull();
  });

  test("known Connector snapshots display actual state and Back works", async () => {
    const close = mock(() => {});
    await mount(<Discord onClose={close} />);
    await respond(known);
    expect(container.textContent).toContain("Mic: Muted");
    expect(container.textContent).toContain("Audio: On");
    expect(textButton("Toggle Mic").disabled).toBe(false);
    await act(async () => button("Go Back").click());
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => textButton("Toggle Mic").click());
    expect(textButton("Toggle Mic").disabled).toBe(true);
    await respond(unknown);
    expect(container.textContent).toContain("Mic: Unknown");
    expect(container.textContent).toContain("Audio: Unknown");
    expect(container.textContent).toContain("State unverified");
  });

  test("Discord exit and restart recover with Refresh in the same Windows session", async () => {
    await mount(<Discord />);
    await respond(unknown);
    await act(async () => textButton("Refresh").click());
    await respond({ ...unknown, available: false, running: false });
    expect(container.textContent).toContain("Discord unavailable");
    expect(textButton("Toggle Mic").disabled).toBe(true);
    expect(container.textContent).toContain("Mic: Unknown");
    await act(async () => textButton("Refresh").click());
    await respond(unknown);
    expect(container.textContent).toContain("Connected");
    expect(textButton("Toggle Mic").disabled).toBe(false);
    expect(calls.map((call) => call.method)).toEqual([
      "discord.get_status",
      "discord.get_status",
      "discord.get_status",
    ]);
  });

  test.each(["macos", null, "ios", "android"])(
    "blocks %s ownership, clears state and ignores stale results across reconnect",
    async (platform) => {
      await mount();
      await respond(known);
      await act(async () => {
        void hook.toggleMute();
      });
      await route(platform, platform !== null);
      expect(hook.muted).toBeNull();
      expect(hook.available).toBe(false);
      await act(async () => {
        void hook.toggleMute();
        void hook.refresh();
      });
      expect(calls).toHaveLength(2);
      await route("windows");
      expect(calls).toHaveLength(3);
      await respond(unknown, 2);
      await respond(known, 1);
      expect(hook.muted).toBeNull();
      expect(hook.available).toBe(true);
      expect(hook.notice).toBeNull();
    },
  );

  test("unknown, error, unsupported, malformed and timed-out toggle results do not retain known state", async () => {
    await mount();
    for (const payload of [
      { ...known, status: "unknown" },
      { ...known, status: "error" },
      { ...known, status: "unsupported" },
      { ...known, available: false, running: false },
      { status: "ok" },
    ]) {
      await respond(known);
      await act(async () => {
        void hook.toggleMute();
      });
      await respond(payload);
      expect(hook.muted).toBeNull();
      expect(hook.deafened).toBeNull();
      expect(hook.available).toBe(false);
      expect(hook.notice).not.toBeNull();
      await act(async () => {
        void hook.refresh();
      });
    }
    await respond(known);
    await act(async () => {
      void hook.toggleDeafen();
    });
    await act(async () => calls.at(-1)?.reject(new Error("timed out")));
    expect(hook.notice).toContain("may have executed");
    expect(hook.deafened).toBeNull();
    expect(hook.available).toBe(false);
  });

  test("Windows-to-Windows handoff discards old results without releasing the new pending request", async () => {
    await mount();
    await respond(known);
    await act(async () => {
      void hook.toggleMute();
    });
    await route("windows");
    await respond(known, 1);
    expect(hook.muted).toBeNull();
    expect(hook.isLoading).toBe(true);
    await act(async () => {
      void hook.toggleMute();
    });
    expect(calls).toHaveLength(3);
    await respond(unknown, 2);
    expect(hook.isLoading).toBe(false);
    expect(hook.muted).toBeNull();
  });

  test("late response after unmount cannot affect a new screen", async () => {
    await mount();
    await act(async () => root.render(null));
    await mount();
    await respond(unknown, 1);
    await respond(known, 0);
    expect(hook.muted).toBeNull();
    expect(hook.available).toBe(true);
  });
});
