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
import {
  useWindowsAudioOutputs,
  parseAudioOutputs,
} from "./useWindowsAudioOutputs";
import { WindowsAudioOutputs } from "../components/windows/WindowsAudioOutputs";

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
let hook: ReturnType<typeof useWindowsAudioOutputs>;
let dom: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();

function Probe() {
  hook = useWindowsAudioOutputs();
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
const endpoint = (id: string, defaults: string[] = []) => ({
  id,
  name: id === "a" ? "Speakers" : "Headphones",
  state: "active",
  isDefault: defaults.includes("console"),
  defaultRoles: {
    console: defaults.includes("console"),
    multimedia: defaults.includes("multimedia"),
    communications: defaults.includes("communications"),
  },
});
const snapshot = (selected = "a") => ({
  status: "ok",
  selectedDeviceId: selected,
  devices: [
    endpoint("a", selected === "a" ? ["console", "multimedia"] : []),
    endpoint("b", selected === "b" ? ["console", "multimedia"] : []),
  ],
});
async function select(
  id = "b",
  scope: "playback" | "communications" | "all" = "playback",
) {
  await act(async () => {
    void hook.select(id, scope);
  });
}
function textButton(text: string) {
  const found = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );
  if (!found) throw new Error(`Missing ${text}`);
  return found;
}

describe("audio output boundary", () => {
  test("accepts empty lists and distinct role defaults without inference", () => {
    expect(parseAudioOutputs({ status: "ok", devices: [] })).toEqual([]);
    expect(parseAudioOutputs(snapshot())?.[1].defaultRoles.console).toBe(false);
    expect(
      parseAudioOutputs({
        status: "ok",
        devices: [endpoint("a", ["communications"])],
      })?.[0].defaultRoles,
    ).toEqual({ console: false, multimedia: false, communications: true });
  });
  test("rejects contradictory defaults and filters inactive endpoints", () => {
    expect(
      parseAudioOutputs({
        status: "ok",
        devices: [endpoint("a", ["console"]), endpoint("b", ["console"])],
      }),
    ).toBeNull();
    expect(
      parseAudioOutputs({
        status: "ok",
        devices: [{ ...endpoint("a"), isDefault: true }],
      }),
    ).toBeNull();
    expect(
      parseAudioOutputs({
        status: "ok",
        devices: [{ ...endpoint("a"), state: "disabled" }],
      }),
    ).toEqual([]);
  });
  test("rejects malformed, failed, duplicate and oversized lists", () => {
    for (const payload of [
      null,
      {},
      { status: "unsupported", devices: [] },
      { ...snapshot(), error: "failed" },
      { ...snapshot(), selectedDeviceId: "gone" },
      { status: "ok", devices: [endpoint("a"), endpoint("a")] },
      {
        status: "ok",
        devices: Array.from({ length: 129 }, (_, i) => endpoint(String(i))),
      },
    ])
      expect(parseAudioOutputs(payload)).toBeNull();
    for (const bad of [
      { id: "" },
      { name: 7 },
      { isDefault: "true" },
      {
        defaultRoles: { console: 1, multimedia: false, communications: false },
      },
      { state: null },
    ])
      expect(
        parseAudioOutputs({
          status: "ok",
          devices: [{ ...endpoint("a"), ...bad }],
        }),
      ).toBeNull();
  });
});

describe("audio output RPC lifecycle", () => {
  test("probes support, serializes, revalidates then confirms via fresh defaults", async () => {
    await mount();
    expect(calls[0]).toMatchObject({
      method: "audio.outputs.list",
      params: {},
      options: { timeoutMs: 4000, appReadyGeneration: 1 },
    });
    await respond(snapshot());
    await select("invented");
    expect(calls).toHaveLength(1);
    await select();
    await select();
    await act(async () => {
      void hook.refresh();
    });
    expect(calls).toHaveLength(2);
    await respond(snapshot());
    expect(calls.at(-1)).toMatchObject({
      method: "audio.outputs.select",
      params: { deviceId: "b", roles: ["console", "multimedia"] },
      options: { timeoutMs: 4000, appReadyGeneration: 1 },
    });
    expect(hook.devices?.[0].defaultRoles.console).toBe(true);
    await respond({ status: "ok", confirmed: true, deviceId: "b" });
    expect(calls.at(-1)?.method).toBe("audio.outputs.list");
    expect(hook.busy).toBe(true);
    expect(hook.notice).toBeNull();
    await respond(snapshot("b"));
    expect(hook.notice).toBe("Windows output confirmed.");
    expect(hook.devices?.[1].defaultRoles.multimedia).toBe(true);
  });
  test.each(["communications", "all"] as const)(
    "sends explicit %s roles",
    async (scope) => {
      await mount();
      await respond(snapshot());
      await select("b", scope);
      await respond(snapshot());
      expect(calls.at(-1)?.params).toEqual({
        deviceId: "b",
        roles:
          scope === "all"
            ? ["console", "multimedia", "communications"]
            : ["communications"],
      });
      await respond({ status: "ok", confirmed: true, deviceId: "b" });
      await respond({
        status: "ok",
        devices: [endpoint("b", ["console", "multimedia", "communications"])],
      });
      expect(hook.notice).toBe("Windows output confirmed.");
    },
  );
  test("unplug before switch dispatches no mutation, replug is discovered on Refresh", async () => {
    await mount();
    await respond(snapshot());
    await select();
    await respond({
      status: "ok",
      devices: [endpoint("a", ["console", "multimedia"])],
    });
    expect(calls).toHaveLength(2);
    expect(hook.notice).toContain("removed");
    await select();
    expect(calls).toHaveLength(2);
    await act(async () => {
      void hook.refresh();
    });
    await respond(snapshot());
    expect(hook.devices).toHaveLength(2);
  });
  test.each([
    {},
    { status: "ok", confirmed: true, deviceId: "wrong" },
    { status: "ok", deviceId: "b" },
    { status: "failed", confirmed: false },
    { status: "access_denied" },
    { status: "device_missing" },
    { status: "unsupported" },
  ])(
    "unverified result %j rereads partial changes without claiming success",
    async (payload) => {
      await mount();
      await respond(snapshot());
      await select();
      await respond(snapshot());
      await respond(payload);
      await respond(snapshot("b"));
      expect(hook.notice).not.toBe("Windows output confirmed.");
      expect(hook.devices?.[1].defaultRoles.console).toBe(true);
    },
  );
  test("mismatching defaults fail; failed readback clears prior values", async () => {
    await mount();
    await respond(snapshot());
    await select();
    await respond(snapshot());
    await respond({ status: "ok", confirmed: true, deviceId: "b" });
    await respond(snapshot());
    expect(hook.notice).toContain("did not match");
    await select();
    await respond(snapshot());
    await respond({ status: "ok", confirmed: true, deviceId: "b" });
    await respond({});
    expect(hook.devices).toBeNull();
    expect(hook.notice).toContain("unknown");
    const count = calls.length;
    await select();
    expect(calls).toHaveLength(count);
  });
  test("timeout performs only readback and never retries mutation", async () => {
    await mount();
    await respond(snapshot());
    await select();
    await respond(snapshot());
    await act(async () => calls.at(-1)?.reject(new Error("timeout")));
    expect(calls.at(-1)?.method).toBe("audio.outputs.list");
    await respond(snapshot());
    expect(hook.notice).toContain("may have changed");
    expect(
      calls.filter((call) => call.method === "audio.outputs.select"),
    ).toHaveLength(1);
  });
  test.each(["macos", "ios", "android", null])(
    "%s handoff rejects old replies and refreshes on Windows return",
    async (platform) => {
      await mount();
      await respond(snapshot());
      await select();
      await respond(snapshot());
      const oldIndex = calls.length - 1;
      await route(platform, platform !== null);
      expect(hook.devices).toBeNull();
      await select();
      await act(async () => {
        void hook.refresh();
      });
      expect(calls).toHaveLength(oldIndex + 1);
      await route("windows");
      await respond({ status: "ok", confirmed: true, deviceId: "b" }, oldIndex);
      expect(hook.busy).toBe(true);
      expect(hook.devices).toBeNull();
      await respond(snapshot());
      expect(hook.devices?.[0].defaultRoles.console).toBe(true);
    },
  );
  test("late list readback cannot overwrite a new Windows session", async () => {
    await mount();
    await respond(snapshot());
    await select();
    await respond(snapshot());
    await respond({ status: "ok", confirmed: true, deviceId: "b" });
    const old = calls.length - 1;
    await route("windows");
    await respond(snapshot("b"), old);
    expect(hook.devices).toBeNull();
    expect(hook.busy).toBe(true);
    await respond(snapshot());
    expect(hook.devices?.[0].defaultRoles.console).toBe(true);
  });
  test("generation change during preflight blocks select; unmount drops readback", async () => {
    await mount();
    await respond(snapshot());
    await select();
    const old = calls.length - 1;
    await route("windows");
    await respond(snapshot(), old);
    expect(
      calls.filter((call) => call.method === "audio.outputs.select"),
    ).toHaveLength(0);
    await respond(snapshot());
    await select();
    await respond(snapshot());
    await respond({ status: "ok", confirmed: true, deviceId: "b" });
    await act(async () => root.render(null));
    const count = calls.length;
    await respond(snapshot("b"));
    expect(calls).toHaveLength(count);
  });
  test.each(["unsupported", "unknown method", "method not found", "timeout"])(
    "mixed Connector versions and read errors: %s",
    async (error) => {
      await mount();
      await act(async () => calls[0].reject(new Error(error)));
      expect(hook.devices).toBeNull();
      expect(hook.notice).toContain(
        error === "timeout" ? "unavailable" : "unsupported",
      );
      await act(async () => {
        void hook.refresh();
      });
      await respond(snapshot());
      expect(hook.devices).toHaveLength(2);
    },
  );
});

describe("rendered audio outputs and physical input boundary", () => {
  test("states and manual Refresh are accurate", async () => {
    await mount(<WindowsAudioOutputs />);
    expect(container.textContent).toContain("Checking Windows outputs");
    await respond({ status: "unsupported" });
    expect(container.textContent).toContain("unsupported");
    await act(async () => textButton("Refresh").click());
    await respond({ status: "ok", devices: [] });
    expect(container.textContent).toContain("No active audio outputs");
    await act(async () => textButton("Refresh").click());
    await respond(snapshot());
    expect(container.textContent).toContain("Console default");
    expect(container.textContent).toContain("Headphones");
    await route("macos");
    expect(container.textContent).toContain("Windows inactive");
    expect(container.textContent).not.toContain("Headphones");
  });
  test("rotation focuses without RPC; press serializes switch; Back and cleanup restore handlers", async () => {
    const close = mock(() => {});
    await mount(<WindowsAudioOutputs onClose={close} />);
    await respond(snapshot());
    const other = mock(() => {});
    window.addEventListener("wheel", other);
    await act(async () => {
      window.dispatchEvent(
        new window.WheelEvent("wheel", { deltaX: 20, cancelable: true }),
      );
      window.dispatchEvent(
        new window.WheelEvent("wheel", { deltaX: 20, cancelable: true }),
      );
    });
    expect(calls).toHaveLength(1);
    expect(other).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-focused="true"]')?.textContent,
    ).toContain("Headphones");
    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter" }),
      );
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", repeat: true }),
      );
    });
    expect(calls).toHaveLength(2);
    expect(textButton("Speakers").disabled).toBe(true);
    await respond(snapshot());
    await respond({ status: "ok", confirmed: true, deviceId: "b" });
    await respond(snapshot("b"));
    await act(async () =>
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape" }),
      ),
    );
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    window.dispatchEvent(new window.WheelEvent("wheel", { deltaX: 20 }));
    expect(other).toHaveBeenCalledTimes(1);
    window.removeEventListener("wheel", other);
  });
  test("touch requests chosen roles; overlay disables knob input", async () => {
    await mount(<WindowsAudioOutputs inputEnabled={false} />);
    await respond(snapshot());
    window.dispatchEvent(new window.WheelEvent("wheel", { deltaX: 20 }));
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }));
    expect(calls).toHaveLength(1);
    await act(async () => textButton("Calls").click());
    await act(async () => textButton("Headphones").click());
    await respond(snapshot());
    expect(calls.at(-1)?.params).toEqual({
      deviceId: "b",
      roles: ["communications"],
    });
  });
});

describe("audio output hardware keys versus interactive targets", () => {
  async function focusSpeakers() {
    await act(async () => {
      document.body.dispatchEvent(
        new window.WheelEvent("wheel", {
          deltaX: 20,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(
      container.querySelector('[data-focused="true"]')?.textContent,
    ).toContain("Speakers");
  }
  function keyEvent(
    target: EventTarget,
    type: "keydown" | "keyup",
    key: string,
    repeat = false,
  ) {
    const event = new window.KeyboardEvent(type, {
      key,
      code: key,
      repeat,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  }
  async function keyboardActivate(
    control: HTMLButtonElement,
    target: EventTarget = control,
  ) {
    control.focus();
    await act(async () => {
      const down = keyEvent(target, "keydown", "Enter");
      expect(down.defaultPrevented).toBe(false);
      // Happy DOM does not synthesize the browser's Enter default action.
      // Apply that click only when the keydown was not canceled.
      if (!down.defaultPrevented) control.click();
      expect(keyEvent(target, "keyup", "Enter").defaultPrevented).toBe(false);
    });
  }

  test.each([
    "Refresh",
    "Go Back",
    "Playback",
    "Calls",
    "All roles",
    "Headphones",
  ])(
    "Enter targeting %s preserves native activation instead of selecting dial focus",
    async (label) => {
      const close = mock(() => {});
      await mount(<WindowsAudioOutputs onClose={close} />);
      await respond(snapshot());
      await focusSpeakers();
      const control = label === "Go Back" ? button(label) : textButton(label);
      const reachedTarget = mock(() => {});
      control.addEventListener("keydown", reachedTarget);
      // Include the nested output label and Back SVG, rather than only buttons.
      await keyboardActivate(control, control.firstElementChild ?? control);
      expect(reachedTarget).toHaveBeenCalledTimes(1);
      if (label === "Go Back") {
        expect(close).toHaveBeenCalledTimes(1);
        expect(calls).toHaveLength(1);
      } else if (["Playback", "Calls", "All roles"].includes(label)) {
        expect(control.getAttribute("aria-pressed")).toBe("true");
        expect(calls).toHaveLength(1);
      } else if (label === "Refresh") {
        expect(calls).toHaveLength(2);
        expect(calls[1].method).toBe("audio.outputs.list");
        await respond(snapshot());
        expect(calls).toHaveLength(2);
      } else {
        expect(calls).toHaveLength(2);
        await respond(snapshot());
        expect(calls.at(-1)).toMatchObject({
          method: "audio.outputs.select",
          params: { deviceId: "b", roles: ["console", "multimedia"] },
        });
        await respond({ status: "ok", confirmed: true, deviceId: "b" });
        await respond(snapshot("b"));
        expect(
          calls.filter((call) => call.method === "audio.outputs.select"),
        ).toHaveLength(1);
      }
      control.removeEventListener("keydown", reachedTarget);
    },
  );

  test.each([
    "Refresh",
    "Go Back",
    "Playback",
    "Calls",
    "All roles",
    "Headphones",
  ])(
    "Escape targeting %s reaches the control without invoking hardware Back",
    async (label) => {
      const close = mock(() => {});
      await mount(<WindowsAudioOutputs onClose={close} />);
      await respond(snapshot());
      await focusSpeakers();
      const control = label === "Go Back" ? button(label) : textButton(label);
      const reachedTarget = mock(() => {});
      control.addEventListener("keydown", reachedTarget);
      await act(async () => {
        expect(
          keyEvent(control.firstElementChild ?? control, "keydown", "Escape")
            .defaultPrevented,
        ).toBe(false);
        expect(keyEvent(control, "keyup", "Escape").defaultPrevented).toBe(
          false,
        );
      });
      expect(reachedTarget).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
      control.removeEventListener("keydown", reachedTarget);
    },
  );

  test("untargeted dial keys consume down, repeat and up with one switch; unmount removes key capture", async () => {
    const close = mock(() => {});
    await mount(<WindowsAudioOutputs onClose={close} />);
    await respond(snapshot());
    await focusSpeakers();
    // Focus alone must not classify a document-dispatched dial event as a button key.
    textButton("Refresh").focus();
    const downstream = mock(() => {});
    document.addEventListener("keydown", downstream);
    document.addEventListener("keyup", downstream);
    try {
      await act(async () => {
        expect(keyEvent(document, "keydown", "Enter").defaultPrevented).toBe(
          true,
        );
        expect(
          keyEvent(document, "keydown", "Enter", true).defaultPrevented,
        ).toBe(true);
        expect(keyEvent(document, "keyup", "Enter").defaultPrevented).toBe(
          true,
        );
      });
      expect(downstream).not.toHaveBeenCalled();
      expect(calls).toHaveLength(2);
      await respond(snapshot());
      expect(calls.at(-1)?.params).toEqual({
        deviceId: "a",
        roles: ["console", "multimedia"],
      });
      await respond({ status: "ok", confirmed: true, deviceId: "a" });
      await respond(snapshot());
      await act(async () => {
        expect(keyEvent(document.body, "keyup", "Enter").defaultPrevented).toBe(
          true,
        );
      });
      expect(
        calls.filter((call) => call.method === "audio.outputs.select"),
      ).toHaveLength(1);
      await act(async () => {
        expect(
          keyEvent(document.body, "keydown", "Escape").defaultPrevented,
        ).toBe(true);
        expect(
          keyEvent(document.body, "keydown", "Escape", true).defaultPrevented,
        ).toBe(true);
        expect(
          keyEvent(document.body, "keyup", "Escape").defaultPrevented,
        ).toBe(true);
      });
      expect(close).toHaveBeenCalledTimes(1);
      expect(downstream).not.toHaveBeenCalled();
      await act(async () => root.render(null));
      const count = calls.length;
      for (const key of ["Enter", "Escape"])
        for (const type of ["keydown", "keyup"] as const)
          expect(keyEvent(document, type, key).defaultPrevented).toBe(false);
      expect(downstream).toHaveBeenCalledTimes(4);
      expect(close).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(count);
    } finally {
      document.removeEventListener("keydown", downstream);
      document.removeEventListener("keyup", downstream);
    }
  });

  test("overlay input disabling leaves dial keys to the overlay and resumes on enable", async () => {
    const close = mock(() => {});
    await mount(<WindowsAudioOutputs onClose={close} />);
    await respond(snapshot());
    await focusSpeakers();
    await mount(<WindowsAudioOutputs onClose={close} inputEnabled={false} />);
    const overlay = mock(() => {});
    window.addEventListener("keydown", overlay);
    window.addEventListener("keyup", overlay);
    try {
      for (const key of ["Enter", "Escape"])
        for (const type of ["keydown", "keyup"] as const)
          expect(keyEvent(document.body, type, key).defaultPrevented).toBe(
            false,
          );
      expect(overlay).toHaveBeenCalledTimes(4);
      expect(close).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
      await mount(<WindowsAudioOutputs onClose={close} inputEnabled />);
      await act(async () => {
        expect(
          keyEvent(document.body, "keydown", "Enter").defaultPrevented,
        ).toBe(true);
      });
      expect(calls).toHaveLength(2);
      expect(overlay).toHaveBeenCalledTimes(4);
    } finally {
      window.removeEventListener("keydown", overlay);
      window.removeEventListener("keyup", overlay);
    }
  });
});
