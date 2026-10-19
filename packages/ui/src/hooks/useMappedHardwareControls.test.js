import { afterEach, beforeEach, expect, test, spyOn, mock } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { useMappedHardwareControls } from "./useMappedHardwareControls";
import { HardwareEvents } from "../mockingbird/ui/helpers/HardwareEvents";
import * as daemon from "./useNocturned";
import { setActionMapping } from "../utils/actionMapping";

let dom, root, restore, destinations, defaults, nativeEvents;
function Harness({ disabled = false, sendWsRequest }) {
  useMappedHardwareControls(disabled, {
    sendWsRequest,
    setActiveSection: (section) => {
      destinations.push(section);
    },
  });
  return null;
}
beforeEach(async () => {
  dom = new Window({ url: "http://localhost" });
  const entries = {
    window: dom,
    document: dom.document,
    localStorage: dom.localStorage,
    CustomEvent: dom.CustomEvent,
    KeyboardEvent: dom.KeyboardEvent,
    Element: dom.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = Object.keys(entries).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]);
  for (const [key, value] of Object.entries(entries))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  restore = () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  destinations = [];
  defaults = [];
  await act(async () => root.render(createElement(Harness)));
  document.addEventListener("keydown", (event) => defaults.push(event.key));
  document.addEventListener("wheel", () => defaults.push("wheel"));
});
afterEach(async () => {
  nativeEvents?.stopListening();
  nativeEvents = undefined;
  await act(async () => root.unmount());
  mock.restore();
  await dom.happyDOM.cancelAsync();
  restore();
});
function key(type, value, repeat = false) {
  document.dispatchEvent(
    new dom.KeyboardEvent(type, {
      key: value,
      code: value,
      bubbles: true,
      cancelable: true,
      repeat,
    }),
  );
}
async function flush() {
  await Promise.resolve();
}

test("unmapped main controls preserve native behavior", () => {
  key("keydown", "Enter");
  key("keyup", "Enter");
  key("keydown", "Escape");
  document.dispatchEvent(
    new dom.WheelEvent("wheel", { deltaX: 1, bubbles: true }),
  );
  expect(defaults).toEqual(["Enter", "Escape", "wheel"]);
  expect(destinations).toEqual([]);
});
test("mapped main dial, back and turns dispatch once and consume defaults", async () => {
  for (const trigger of [
    "dial_press",
    "back_press",
    "dial_turn_left",
    "dial_turn_right",
  ]) {
    setActionMapping(trigger, {
      kind: "device",
      action: "navigate.now_playing",
    });
    if (trigger === "dial_press") {
      key("keydown", "Enter");
      key("keydown", "Enter", true);
      key("keyup", "Enter");
    } else if (trigger === "back_press") {
      key("keydown", "Escape");
      key("keydown", "Escape", true);
    } else
      document.dispatchEvent(
        new dom.WheelEvent("wheel", {
          deltaX: trigger.endsWith("left") ? -1 : 1,
          bubbles: true,
          cancelable: true,
        }),
      );
    await flush();
  }
  expect(destinations).toEqual([
    "nowPlaying",
    "nowPlaying",
    "nowPlaying",
    "nowPlaying",
  ]);
  expect(defaults).toEqual([]);
});
test("a long-press-only map retains native short Enter and dispatches long press without short action", async () => {
  setActionMapping("dial_long_press", {
    kind: "device",
    action: "navigate.home",
  });
  key("keydown", "Enter");
  key("keyup", "Enter");
  expect(defaults).toEqual(["Enter"]);
  key("keydown", "Enter");
  await new Promise((resolve) => setTimeout(resolve, 1050));
  key("keyup", "Enter");
  await flush();
  expect(destinations).toEqual(["recents"]);
  expect(defaults).toEqual(["Enter"]);
});
test("entering a protected screen during a hold blocks the mapped action", async () => {
  setActionMapping("dial_press", { kind: "device", action: "navigate.home" });
  key("keydown", "Enter");
  await act(async () =>
    root.render(createElement(Harness, { disabled: true })),
  );
  key("keyup", "Enter");
  await flush();
  expect(destinations).toEqual([]);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function rotary(deltaX = 1, extra = {}, target = document) {
  const event = new dom.WheelEvent("wheel", {
    deltaX,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  // Happy DOM WheelEvent omits modifier-key initialization.
  for (const name of ["ctrlKey", "shiftKey", "altKey", "metaKey"]) {
    if (name in extra)
      Object.defineProperty(event, name, { value: extra[name] });
  }
  target.dispatchEvent(event);
  return event;
}
function nativeDial() {
  const actions = [];
  nativeEvents = new HardwareEvents();
  nativeEvents.onDialPress(() => actions.push("short"));
  nativeEvents.onDialLongPress(() => actions.push("long"));
  return actions;
}

test("short-only mapping replays a real native long hold and never fires mapped short", async () => {
  setActionMapping("dial_press", { kind: "device", action: "navigate.home" });
  const actions = nativeDial();
  key("keydown", "Enter");
  await sleep(1050);
  key("keyup", "Enter");
  key("keyup", "Enter"); // Duplicate release must not reach the native short parser.
  await sleep(1050);
  expect(actions).toEqual(["long"]);
  expect(destinations).toEqual([]);
  expect(nativeEvents.keysDown.size).toBe(0);
});

test("long-only mapping retains native short press through the actual hardware parser", async () => {
  setActionMapping("dial_long_press", {
    kind: "device",
    action: "navigate.home",
  });
  const actions = nativeDial();
  key("keydown", "Enter");
  key("keyup", "Enter");
  expect(actions).toEqual(["short"]);
  expect(destinations).toEqual([]);
});

test("both mappings fire only the classified action, even with repeats and extra releases", async () => {
  setActionMapping("dial_press", { kind: "device", action: "navigate.home" });
  setActionMapping("dial_long_press", {
    kind: "device",
    action: "navigate.now_playing",
  });
  const actions = nativeDial();
  key("keydown", "Enter");
  key("keyup", "Enter");
  await flush();
  expect(destinations).toEqual(["recents"]);
  key("keydown", "Enter");
  key("keydown", "Enter", true);
  await sleep(1050);
  key("keyup", "Enter");
  key("keyup", "Enter");
  await flush();
  expect(destinations).toEqual(["recents", "nowPlaying"]);
  expect(actions).toEqual([]);
});

test("vertical, diagonal, modified and form wheel interactions remain native", async () => {
  setActionMapping("dial_turn_right", {
    kind: "device",
    action: "navigate.home",
  });
  for (const extra of [
    { deltaY: 5 },
    { deltaY: 5, deltaX: 0 },
    { ctrlKey: true },
    { shiftKey: true },
  ]) {
    expect(rotary(1, extra).defaultPrevented).toBe(false);
  }
  const select = document.createElement("select");
  document.body.append(select);
  expect(rotary(1, {}, select).defaultPrevented).toBe(false);
  expect(rotary(-1).defaultPrevented).toBe(false); // unmapped hardware direction
  await flush();
  expect(destinations).toEqual([]);
  expect(defaults).toEqual(Array(6).fill("wheel"));
  expect(rotary(1).defaultPrevented).toBe(true);
  await flush();
  expect(destinations).toEqual(["recents"]);
});

async function rpcHarness() {
  let generation = 10;
  spyOn(daemon, "getAppReadyState").mockImplementation(() => ({
    ready: true,
    platform: "web",
    connectorPlatform: "windows",
    generation,
  }));
  const calls = [],
    pending = [];
  let active = 0,
    peak = 0;
  await act(async () =>
    root.render(
      createElement(Harness, {
        sendWsRequest: async (method, params) => {
          calls.push({ method, params });
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => pending.push(resolve));
          active--;
          return { status: "ok" };
        },
      }),
    ),
  );
  setActionMapping("dial_turn_right", {
    kind: "windows",
    action: "volume.adjust",
    delta: 5,
  });
  setActionMapping("dial_turn_left", {
    kind: "windows",
    action: "volume.adjust",
    delta: -5,
  });
  return { calls, pending, peak: () => peak, changeRoute: () => generation++ };
}

test("rapid rotary RPCs are single-flight, rate limited and bounded", async () => {
  const rpc = await rpcHarness();
  for (let i = 0; i < 100; i++) rotary(1);
  expect(rpc.calls).toHaveLength(1);
  for (let i = 0; i < 9; i++) {
    rpc.pending.shift()();
    await flush();
    if (i === 0) expect(rpc.calls).toHaveLength(1);
    await sleep(55);
  }
  expect(rpc.calls).toHaveLength(9); // in-flight plus eight queued steps
  expect(rpc.peak()).toBe(1);
});

test("intentional repeated volume steps and direction changes retain their order", async () => {
  const rpc = await rpcHarness();
  rotary(1);
  rotary(1);
  rotary(-1);
  for (let i = 0; i < 3; i++) {
    rpc.pending.shift()();
    await flush();
    await sleep(55);
  }
  expect(rpc.calls.map((call) => call.params.delta)).toEqual([5, 5, -5]);
  expect(rpc.peak()).toBe(1);
});

test("buffered rotations are discarded on route handoff or protected state", async () => {
  const rpc = await rpcHarness();
  rotary(1);
  rotary(1);
  rpc.changeRoute();
  rpc.pending.shift()();
  await sleep(60);
  expect(rpc.calls).toHaveLength(1);
  rotary(1);
  rotary(1);
  await act(async () =>
    root.render(createElement(Harness, { disabled: true })),
  );
  rpc.pending.shift()();
  await sleep(60);
  expect(rpc.calls).toHaveLength(2);
});

test("a remap or unmount cancels buffered rotary dispatch", async () => {
  const rpc = await rpcHarness();
  rotary(1);
  rotary(1);
  setActionMapping("dial_turn_right", { kind: "default" });
  rpc.pending.shift()();
  await sleep(60);
  expect(rpc.calls).toHaveLength(1);
  setActionMapping("dial_turn_right", {
    kind: "windows",
    action: "volume.adjust",
    delta: 5,
  });
  rotary(1);
  rotary(1);
  await act(async () => root.unmount());
  rpc.pending.shift()();
  await sleep(60);
  expect(rpc.calls).toHaveLength(2);
});
