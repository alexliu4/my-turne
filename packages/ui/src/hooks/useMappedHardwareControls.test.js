import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { useMappedHardwareControls } from "./useMappedHardwareControls";
import { setActionMapping } from "../utils/actionMapping";

let dom, root, restore, destinations, defaults;
function Harness({ disabled = false }) {
  useMappedHardwareControls(disabled, {
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
  await act(async () => root.unmount());
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
