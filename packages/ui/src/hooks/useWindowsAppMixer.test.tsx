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
import { useWindowsAppMixer, parseAudioSessions } from "./useWindowsAppMixer";
import { WindowsAppMixer } from "../components/windows/WindowsAppMixer";

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
let hook: ReturnType<typeof useWindowsAppMixer>;
let dom: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();

function Probe() {
  hook = useWindowsAppMixer();
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

const session = (
  id = "s-a",
  endpointId = "ep-a",
  volumePercent = 40,
  muted = false,
) => ({
  id,
  endpointId,
  appName: id === "s-a" ? "Spotify" : "Discord",
  processId: 123,
  volumePercent,
  muted,
});
const snapshot = (volume = 40, muted = false) => ({
  status: "ok",
  sessions: [session("s-a", "ep-a", volume, muted), session("s-b", "ep-b", 70)],
});
const outputs = {
  status: "ok",
  devices: ["a", "b"].map((id) => ({
    id: `ep-${id}`,
    name: `Output ${id}`,
    state: "active",
    isDefault: false,
    defaultRoles: { console: false, multimedia: false, communications: false },
  })),
};
async function discover(value: unknown = snapshot()) {
  await respond(value);
  await respond(outputs);
}
async function choose(id = "s-a") {
  await act(async () => hook.select(id));
}
async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
}
async function dial(count = 1) {
  await act(async () => {
    for (let i = 0; i < count; i++) hook.adjust(1);
  });
}
function textButton(label: string) {
  const found = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label),
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}

describe("mixer contracts", () => {
  test("validates opaque sessions and empty, rejects malformed/oversized/duplicate payloads", () => {
    expect(parseAudioSessions(snapshot())).toHaveLength(2);
    expect(parseAudioSessions({ status: "ok", sessions: [] })).toEqual([]);
    for (const value of [
      null,
      {},
      { ...snapshot(), error: "bad" },
      { status: "unsupported", sessions: [] },
      { status: "ok", sessions: [session(), session()] },
      {
        status: "ok",
        sessions: Array.from({ length: 257 }, (_, i) => session(String(i))),
      },
    ])
      expect(parseAudioSessions(value)).toBeNull();
    for (const bad of [
      { id: "" },
      { endpointId: "" },
      { appName: {} },
      { muted: 0 },
      { volumePercent: NaN },
      { volumePercent: -1 },
      { volumePercent: 101 },
      { processId: 1.2 },
    ])
      expect(
        parseAudioSessions({
          status: "ok",
          sessions: [{ ...session(), ...bad }],
        }),
      ).toBeNull();
  });
});
describe("mixer lifecycle", () => {
  test("coalesces dial, exact ID/endpoint only, confirms without changing other sessions", async () => {
    await mount();
    expect(calls[0]).toMatchObject({
      method: "audio.sessions.list",
      params: {},
      options: { timeoutMs: 4000, appReadyGeneration: 1 },
    });
    await discover();
    await choose();
    expect(calls).toHaveLength(2);
    await dial(10);
    expect(calls).toHaveLength(2);
    expect(hook.desired?.value).toBe(60);
    expect(hook.sessions?.[0].volumePercent).toBe(40);
    await tick();
    await respond(snapshot());
    expect(calls.at(-1)).toMatchObject({
      method: "audio.sessions.set_volume",
      params: { sessionId: "s-a", deviceId: "ep-a", volumePercent: 60 },
    });
    await dial(5);
    await tick();
    expect(calls.filter((c) => c.method.endsWith("set_volume"))).toHaveLength(
      1,
    );
    await respond({ status: "ok", confirmedVolumePercent: 60 });
    await discover(snapshot(60));
    await tick();
    await respond(snapshot(60));
    expect(calls.at(-1)?.params).toEqual({
      sessionId: "s-a",
      deviceId: "ep-a",
      volumePercent: 70,
    });
    await respond({ status: "ok", confirmedVolumePercent: 70 });
    await discover(snapshot(70));
    expect(hook.sessions?.map((s) => s.volumePercent)).toEqual([70, 70]);
    expect(hook.desired).toBeNull();
    expect(
      calls.every(
        (c) =>
          c.method.startsWith("audio.sessions.") ||
          c.method === "audio.outputs.list",
      ),
    ).toBe(true);
  });
  test("mute is serialized and requires readback", async () => {
    await mount();
    await discover();
    await choose();
    await act(async () => {
      void hook.toggleMute();
      void hook.toggleMute();
    });
    await respond(snapshot());
    expect(calls.at(-1)?.params).toEqual({
      sessionId: "s-a",
      deviceId: "ep-a",
      muted: true,
    });
    await respond({ status: "ok", confirmedMuted: true });
    expect(hook.sessions?.[0].muted).toBe(false);
    await discover(snapshot(40, true));
    expect(hook.sessions?.[0].muted).toBe(true);
  });
  test.each([
    "invalid_session",
    "invalid_device",
    "unsupported",
    "failed",
    "superseded",
  ])("handles %s without confirmation or retry", async (status) => {
    await mount();
    await discover();
    await choose();
    await dial();
    await tick();
    await respond(snapshot());
    await respond({ status });
    await discover();
    expect(hook.notice).toBeTruthy();
    expect(hook.sessions?.[0].volumePercent).toBe(40);
    expect(hook.desired).toBeNull();
    expect(calls.filter((c) => c.method.endsWith("set_volume"))).toHaveLength(
      1,
    );
  });
  test("closed session preflight never writes; endpoint changes never reuse IDs", async () => {
    await mount();
    await discover();
    await choose();
    await dial();
    await tick();
    await discover({ status: "ok", sessions: [session("s-a", "ep-new")] });
    expect(calls.some((c) => c.method.endsWith("set_volume"))).toBe(false);
    expect(hook.notice).toContain("changed");
  });
  test("handoff cancels queue, rejects late response, reconnect probes", async () => {
    await mount();
    await discover();
    await choose();
    await dial();
    await tick();
    const old = calls.length - 1;
    await route("macos");
    expect(hook.sessions).toBeNull();
    expect(hook.desired).toBeNull();
    await respond(snapshot(), old);
    expect(calls).toHaveLength(old + 1);
    await route("windows");
    await discover();
    expect(hook.sessions).toHaveLength(2);
    expect(hook.selected).toBeNull();
    await choose();
    await dial();
    await route(null, false);
    await tick();
    expect(calls.at(-1)?.method).toBe("audio.outputs.list");
  });
  test("timeout after dispatch is unknown and never replays", async () => {
    await mount();
    await discover();
    await choose();
    await dial();
    await tick();
    await respond(snapshot());
    await act(async () => calls.at(-1)?.reject(new Error("timeout")));
    await discover();
    expect(hook.notice).toContain("Outcome unknown");
    expect(calls.filter((c) => c.method.endsWith("set_volume"))).toHaveLength(
      1,
    );
  });
  test("unmount cancels timers and dispatched preflight", async () => {
    await mount();
    await discover();
    await choose();
    await dial();
    await act(async () => root.render(null));
    await tick();
    expect(calls).toHaveLength(2);
  });
  test("failed or malformed snapshots clear values and refresh recovers", async () => {
    await mount();
    await respond({ status: "unsupported" });
    expect(hook.notice).toContain("unsupported");
    expect(hook.sessions).toBeNull();
    await act(async () => {
      void hook.refresh();
    });
    await discover();
    await act(async () => {
      void hook.refresh();
    });
    await respond({ status: "ok", sessions: [{}] });
    expect(hook.sessions).toBeNull();
  });
});
describe("mixer presentation/input", () => {
  test("real labels, endpoint names, select only, dial/mute/back capture and cleanup", async () => {
    const close = mock(() => {});
    await mount(<WindowsAppMixer onClose={close} />);
    await discover();
    expect(container.textContent).toContain("Output a");
    expect(container.textContent).toContain("Discord");
    const downstream = mock(() => {});
    window.addEventListener("wheel", downstream);
    await act(async () =>
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "2" })),
    );
    expect(calls).toHaveLength(2);
    expect(textButton("Spotify").getAttribute("aria-pressed")).toBe("true");
    await act(async () =>
      window.dispatchEvent(
        new window.WheelEvent("wheel", { deltaX: 20, cancelable: true }),
      ),
    );
    expect(downstream).not.toHaveBeenCalled();
    expect(container.textContent).toContain("awaiting confirmation");
    await act(async () => textButton("Next app").click());
    await tick();
    expect(calls).toHaveLength(2);
    expect(textButton("Discord").getAttribute("aria-pressed")).toBe("true");
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter" }),
      ),
    );
    await respond(snapshot());
    expect(calls.at(-1)?.params).toEqual({
      sessionId: "s-b",
      deviceId: "ep-b",
      muted: true,
    });
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape" }),
      ),
    );
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    window.dispatchEvent(new window.WheelEvent("wheel", { deltaX: 20 }));
    expect(downstream).toHaveBeenCalledTimes(1);
    window.removeEventListener("wheel", downstream);
  });
  test("overlays suppress input and cancel pending dial; native controls retain keys", async () => {
    await mount(<WindowsAppMixer />);
    await discover();
    await act(async () => textButton("Spotify").click());
    await dial();
    await mount(<WindowsAppMixer inputEnabled={false} />);
    await tick();
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new window.WheelEvent("wheel", { deltaX: 20 }));
    expect(calls).toHaveLength(2);
    await mount(<WindowsAppMixer />);
    const event = new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    textButton("Refresh").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    await route("macos");
    expect(container.textContent).toContain("Windows inactive");
    expect(container.textContent).not.toContain("Spotify");
  });
});

describe("mixer race and confirmation regressions", () => {
  test.each([
    {},
    { status: "ok" },
    { status: "ok", confirmedVolumePercent: NaN },
    { status: "ok", confirmedVolumePercent: 80 },
    { status: "ok", confirmedVolumePercent: 42, error: "denied" },
  ])("unverified result never becomes success %j", async (result) => {
    await mount();
    await discover();
    await choose();
    await dial();
    await tick();
    await respond(snapshot());
    await respond(result);
    await discover();
    expect(hook.notice).toContain("could not be verified");
    expect(hook.sessions?.[0].volumePercent).toBe(40);
  });
  test("readback disagreement shows current Windows value and stops queue", async () => {
    await mount();
    await discover();
    await choose();
    await dial();
    await tick();
    await respond(snapshot());
    await respond({ status: "ok", confirmedVolumePercent: 42 });
    await discover(snapshot(20));
    expect(hook.notice).toContain("not confirmed");
    expect(hook.sessions?.[0].volumePercent).toBe(20);
    expect(hook.desired).toBeNull();
  });
  test("late rejected mutation after handoff cannot cancel new route input", async () => {
    await mount();
    await discover();
    await choose();
    await dial();
    await tick();
    await respond(snapshot());
    const old = calls.length - 1;
    await route("macos");
    await route("windows");
    await discover();
    await choose();
    await dial();
    await act(async () => calls[old].reject(new Error("timeout")));
    expect(hook.desired?.value).toBe(42);
    await tick();
    expect(calls.at(-1)?.method).toBe("audio.sessions.list");
    await respond(snapshot());
    expect(calls.at(-1)?.method).toBe("audio.sessions.set_volume");
  });
  test("late readback after disconnect cannot publish or dispatch outputs", async () => {
    await mount();
    await discover();
    await choose();
    await dial();
    await tick();
    await respond(snapshot());
    await respond({ status: "ok", confirmedVolumePercent: 42 });
    const old = calls.length - 1;
    await route("macos");
    await respond(snapshot(42), old);
    expect(hook.sessions).toBeNull();
    expect(calls).toHaveLength(old + 1);
  });
  test.each(["unknown method", "method not found", "timeout"])(
    "snapshot error %s clears state",
    async (message) => {
      await mount();
      await act(async () => calls[0].reject(new Error(message)));
      expect(hook.sessions).toBeNull();
      expect(hook.notice).toContain(
        message === "timeout" ? "unknown" : "unsupported",
      );
    },
  );
  test("five-second snapshot clears exited sessions", async () => {
    await mount();
    await discover();
    await choose();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5100));
    });
    expect(calls.at(-1)?.method).toBe("audio.sessions.list");
    await discover({ status: "ok", sessions: [] });
    expect(hook.sessions).toEqual([]);
    expect(hook.selected).toBeNull();
  }, 10000);
  test("dial clamps bounded queue and deselection discards unsent change", async () => {
    await mount();
    await discover();
    await choose();
    await dial(1000);
    expect(hook.desired?.value).toBe(100);
    expect(calls).toHaveLength(2);
    await choose("s-b");
    await tick();
    expect(hook.desired).toBeNull();
    expect(calls).toHaveLength(2);
  });
});
