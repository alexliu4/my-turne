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
import { useWindowsActions, parseConfiguredActions } from "./useWindowsActions";
import { WindowsActions } from "../components/windows/WindowsActions";

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
let hook: ReturnType<typeof useWindowsActions>;
let dom: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();

function Probe() {
  hook = useWindowsActions();
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

const apps = {
  status: "ok",
  available: true,
  apps: [{ id: "vscode", name: "VS Code", target: "vscode://", enabled: true }],
};
const macros = {
  status: "ok",
  available: true,
  macros: [
    {
      id: "shortcut",
      name: "Configured shortcut",
      action: { type: "shortcut", shortcut: "CTRL+K" },
    },
  ],
};
async function catalogs() {
  await respond(apps, calls.length - 2);
  await respond(macros);
}
function textButton(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}

describe("configured Windows actions", () => {
  test("catalogs require verified availability and retain only unique enabled display metadata", () => {
    expect(parseConfiguredActions(apps, "apps")).toEqual([
      { id: "vscode", name: "VS Code" },
    ]);
    for (const payload of [
      null,
      [],
      {},
      { ...apps, status: "unknown" },
      { ...apps, available: false },
      { ...apps, error: "failed" },
      { ...apps, apps: {} },
    ]) {
      expect(parseConfiguredActions(payload, "apps")).toBeNull();
    }
    expect(
      parseConfiguredActions(
        {
          ...apps,
          apps: [
            ...apps.apps,
            ...apps.apps,
            { id: "off", name: "Off", enabled: false },
            { id: "x", name: 2 },
            { id: " ", name: "Blank" },
            { id: "bad", name: "Bad", enabled: "yes" },
          ],
        },
        "apps",
      ),
    ).toEqual([{ id: "vscode", name: "VS Code" }]);
  });

  test("advertised apps and macros send only IDs, serialize taps and acknowledge success", async () => {
    await mount();
    expect(calls.map((call) => call.method)).toEqual([
      "app_launch.get_status",
      "macros.get_status",
    ]);
    expect(calls[0].options).toEqual({
      timeoutMs: 4000,
      appReadyGeneration: 1,
    });
    await catalogs();
    await act(async () => {
      void hook.execute("apps", "missing");
    });
    expect(calls).toHaveLength(2);
    await act(async () => {
      void hook.execute("apps", "vscode");
      void hook.execute("macros", "shortcut");
      void hook.refresh();
    });
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({
      method: "app_launch.launch",
      params: { app: "vscode" },
    });
    await respond({ status: "ok", app: "vscode", launched: true });
    expect(hook.notice).toBe("Action completed.");
    await act(async () => {
      void hook.execute("macros", "shortcut");
    });
    expect(calls[3]).toMatchObject({
      method: "macros.execute",
      params: { id: "shortcut" },
    });
    await respond({ status: "ok", action: "shortcut" });
    expect(hook.notice).toBe("Action completed.");
  });

  test("screen renders host names, scrollable catalogs and functioning Back", async () => {
    const close = mock(() => {});
    await mount(<WindowsActions onClose={close} />);
    await catalogs();
    expect(textButton("VS Code").disabled).toBe(false);
    expect(container.querySelector("input")).toBeNull();
    await act(async () => textButton("Configured shortcut").click());
    expect(textButton("VS Code").disabled).toBe(true);
    await respond({ status: "ok", action: "shortcut" });
    await act(async () => button("Go Back").click());
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("independent catalog failures clear old actions and Refresh recovers", async () => {
    await mount();
    await catalogs();
    await act(async () => {
      void hook.refresh();
    });
    await respond({ status: "unsupported", available: false, apps: [] }, 2);
    await respond(macros, 3);
    expect(hook.apps).toBeNull();
    expect(hook.macros).toHaveLength(1);
    await act(async () => {
      void hook.refresh();
    });
    await catalogs();
    expect(hook.apps).toHaveLength(1);
  });

  test.each(["macos", "ios", "android", null])(
    "%s ownership clears actions and blocks sends; reconnect rejects stale results",
    async (platform) => {
      await mount();
      await catalogs();
      await act(async () => {
        void hook.execute("apps", "vscode");
      });
      await route(platform, platform !== null);
      expect(hook.apps).toBeNull();
      expect(hook.macros).toBeNull();
      await act(async () => {
        void hook.execute("apps", "vscode");
        void hook.refresh();
      });
      expect(calls).toHaveLength(3);
      await route("windows");
      await respond({ status: "ok", launched: true }, 2);
      expect(hook.busy).toBe(true);
      await catalogs();
      expect(hook.apps).toHaveLength(1);
      expect(hook.notice).toBeNull();
    },
  );

  test("unknown outcomes never auto retry or claim success; Refresh required", async () => {
    await mount();
    for (const payload of [
      { status: "ok", launched: false },
      { status: "invalid_app", launched: false },
      { status: "unsupported" },
      { status: "ok", launched: true, error: "failed" },
      {},
      null,
    ]) {
      await catalogs();
      await act(async () => {
        void hook.execute("apps", "vscode");
      });
      await respond(payload);
      expect(hook.notice).toContain("may have executed");
      expect(hook.apps).toBeNull();
      const count = calls.length;
      await act(async () => {
        void hook.execute("apps", "vscode");
      });
      expect(calls).toHaveLength(count);
      await act(async () => {
        void hook.refresh();
      });
    }
    await catalogs();
    await act(async () => {
      void hook.execute("macros", "shortcut");
    });
    await act(async () => calls.at(-1)?.reject(new Error("timeout")));
    expect(hook.notice).toContain("may have executed");
    expect(hook.macros).toBeNull();
  });

  test("Windows handoff and unmount discard late catalogs", async () => {
    await mount();
    await route("windows");
    await catalogs();
    await respond({ ...apps, apps: [{ id: "old", name: "Old" }] }, 0);
    await respond(macros, 1);
    expect(hook.apps?.[0].id).toBe("vscode");
    await act(async () => {
      void hook.refresh();
    });
    const old = calls.length - 2;
    await act(async () => root.render(null));
    await mount();
    await catalogs();
    await respond({ ...apps, apps: [] }, old);
    await respond({ ...macros, macros: [] }, old + 1);
    expect(hook.apps).toHaveLength(1);
  });
});
