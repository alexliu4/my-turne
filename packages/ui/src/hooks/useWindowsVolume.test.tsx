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
import * as settingsContext from "../contexts/SettingsContext";
import { useWindowsVolume } from "./useWindowsVolume";
import { WindowsVolume } from "../components/windows/WindowsVolume";
import Settings from "../components/settings/Settings";

let ready: daemon.AppReadyState;
let readinessListener: ((state: daemon.AppReadyState) => void) | undefined;
let eventListener: Parameters<typeof daemon.addGlobalWsListener>[1] | undefined;
let calls: {
  method: string;
  params: object;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}[];
let root: Root;
let container: HTMLDivElement;
let hook: ReturnType<typeof useWindowsVolume>;
let dom: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();

function Probe() {
  hook = useWindowsVolume();
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
  spyOn(daemon, "addGlobalWsListener").mockImplementation((_id, listener) => {
    eventListener = listener;
    return () => {
      eventListener = undefined;
    };
  });
  spyOn(daemon, "sendNocturneWsRequest").mockImplementation(
    <T,>(method: string, params: object = {}) => {
      const promise = new Promise<unknown>((resolve, reject) =>
        calls.push({ method, params, resolve, reject }),
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
async function event(data: unknown, topic = "volume.update") {
  await act(async () =>
    eventListener?.onMessage?.({ type: "event", topic, data }),
  );
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

describe("real Windows volume hook RPC and event lifecycle", () => {
  test("get and successful adjust/set/mute use only returned confirmed state", async () => {
    await mount();
    expect(calls[0].method).toBe("volume.get");
    expect(hook.volumePercent).toBeNull();
    await respond({ volumePercent: 40, muted: false });
    expect(hook.volumePercent).toBe(40);
    await act(async () => {
      void hook.adjustVolume(5);
    });
    expect(calls[1]).toMatchObject({
      method: "volume.adjust",
      params: { delta: 5 },
    });
    await respond({ status: "ok", volumePercent: 44, muted: false });
    expect(hook.volumePercent).toBe(44);
    await act(async () => {
      void hook.setVolume(80);
    });
    expect(calls[2]).toMatchObject({
      method: "volume.set",
      params: { volumePercent: 80 },
    });
    await respond({ status: "ok", volume_percent: 79, muted: false });
    expect(hook.volumePercent).toBe(79);
    await act(async () => {
      void hook.toggleMute();
    });
    expect(calls[3].method).toBe("volume.toggleMute");
    await respond({ status: "ok", volumePercent: 79, muted: true });
    expect(hook.muted).toBe(true);
  });

  test("unsupported and malformed reads never create state", async () => {
    await mount();
    for (const payload of [
      undefined,
      {},
      { volumePercent: 20 },
      { volumePercent: 120, muted: false },
      { volumePercent: NaN, muted: true },
      { status: "error", volumePercent: 20, muted: false },
    ]) {
      await respond(payload);
      expect(hook.volumePercent).toBeNull();
      expect(hook.muted).toBeNull();
      expect(hook.error).not.toBeNull();
      await act(async () => {
        void hook.refreshVolume();
      });
    }
    await respond({ status: "unsupported" });
    expect(hook.isUnsupported).toBe(true);
    expect(hook.volumePercent).toBeNull();
    await act(async () => {
      void hook.toggleMute();
    });
    expect(calls.at(-1)?.method).toBe("volume.get");
  });

  test("actions require ok plus complete state and never echo a target or toggle", async () => {
    await mount();
    for (const payload of [
      {},
      { status: "ok" },
      { volumePercent: 80, muted: true },
      { status: "error", volumePercent: 80, muted: true },
      { status: "ok", volumePercent: 80, muted: "true" },
    ]) {
      await respond({ volumePercent: 40, muted: false });
      await act(async () => {
        void hook.setVolume(80);
      });
      await respond(payload);
      expect(hook.volumePercent).toBeNull();
      expect(hook.muted).toBeNull();
      expect(hook.error).not.toBeNull();
      await act(async () => {
        void hook.refreshVolume();
      });
    }
    await respond({ volumePercent: 40, muted: false });
    await act(async () => {
      void hook.toggleMute();
    });
    await respond({ status: "ok" });
    expect(hook.muted).toBeNull();
  });

  test("rapid operations serialize and pushed state supersedes in-flight replies", async () => {
    await mount();
    await respond({ volumePercent: 40, muted: false });
    await act(async () => {
      void hook.adjustVolume(5);
      void hook.setVolume(90);
      void hook.toggleMute();
      void hook.refreshVolume();
    });
    expect(calls).toHaveLength(2);
    await event({ volumePercent: 60, muted: true });
    await respond({ status: "ok", volumePercent: 45, muted: false });
    expect(hook.volumePercent).toBe(60);
    expect(hook.muted).toBe(true);
    expect(hook.isLoading).toBe(false);
    await act(async () => {
      void hook.adjustVolume(-5);
    });
    await respond({ status: "ok", volumePercent: 55, muted: true });
    expect(hook.volumePercent).toBe(55);
  });

  test("only Windows event topic affects the hook, including during a read", async () => {
    await mount();
    await event({ volumePercent: 70, muted: true }, "phone.volume.update");
    await event({ volumePercent: 70, muted: true }, "device.volume.update");
    expect(hook.volumePercent).toBeNull();
    await event({ volume_percent: 25, muted: false });
    await respond({ volumePercent: 10, muted: true });
    expect(hook.volumePercent).toBe(25);
    await event({ status: "error", volumePercent: 95, muted: true });
    expect(hook.volumePercent).toBe(25);
  });

  test("disconnect/reconnect and Windows-to-Windows generation changes reject old replies", async () => {
    await mount();
    await route(null, false);
    expect(hook.volumePercent).toBeNull();
    expect(hook.isWindowsActive).toBe(false);
    await route("windows");
    expect(calls).toHaveLength(2);
    await respond({ volumePercent: 90, muted: true }, 0);
    expect(hook.volumePercent).toBeNull();
    expect(hook.isLoading).toBe(true);
    await respond({ volumePercent: 30, muted: false }, 1);
    await act(async () => {
      void hook.toggleMute();
    });
    await route("windows");
    expect(calls).toHaveLength(4);
    await respond({ status: "ok", volumePercent: 80, muted: true }, 2);
    expect(hook.volumePercent).toBeNull();
    expect(hook.isLoading).toBe(true);
    await respond({ volumePercent: 35, muted: true }, 3);
    expect(hook.volumePercent).toBe(35);
    await route("macos");
    await event({ volumePercent: 99, muted: false });
    await act(async () => {
      void hook.adjustVolume(5);
    });
    expect(calls).toHaveLength(4);
    expect(hook.volumePercent).toBeNull();
  });

  test("RPC failures expose errors without guessing state", async () => {
    await mount();
    await act(async () => calls[0].reject(new Error("connection lost")));
    expect(hook.error).toBe("connection lost");
    expect(hook.volumePercent).toBeNull();
    await act(async () => {
      void hook.refreshVolume();
    });
    await act(async () => calls[1].reject(new Error("unsupported")));
    expect(hook.isUnsupported).toBe(true);
    expect(hook.error).toBeNull();
  });
});

describe("rendered Windows volume screen", () => {
  test("controls stay unavailable until confirmed and dispatch actions; Back closes", async () => {
    let closed = false;
    await mount(
      <WindowsVolume
        onClose={() => {
          closed = true;
        }}
      />,
    );
    expect(button("Increase Volume").disabled).toBe(true);
    expect(container.textContent).toContain("Loading volume");
    await respond({ volumePercent: 50, muted: false });
    expect(container.textContent).toContain("50%");
    await act(async () => button("Increase Volume").click());
    expect(calls.at(-1)).toMatchObject({
      method: "volume.adjust",
      params: { delta: 5 },
    });
    expect(button("Decrease Volume").disabled).toBe(true);
    await respond({ status: "ok", volumePercent: 55, muted: false });
    await act(async () => button("Decrease Volume").click());
    expect(calls.at(-1)?.params).toEqual({ delta: -5 });
    await respond({ status: "ok", volumePercent: 50, muted: false });
    await act(async () => button("Mute").click());
    await respond({ status: "ok", volumePercent: 50, muted: true });
    expect(container.textContent).toContain("Muted");
    await act(async () => button("Unmute").click());
    await respond({ status: "ok", volumePercent: 50, muted: false });
    await act(async () => button("Go Back").click());
    expect(closed).toBe(true);
  });

  test("unsupported/error/unknown and fallback states disable controls; Retry rereads", async () => {
    await mount(<WindowsVolume />);
    await respond({ status: "unsupported" });
    expect(container.textContent).toContain("unsupported");
    expect(button("Mute").disabled).toBe(true);
    await act(async () => button("Retry volume").click());
    await respond({});
    expect(container.textContent).toContain("invalid or unavailable");
    expect(container.textContent).toContain("--%");
    expect(button("Increase Volume").disabled).toBe(true);
    await route("macos");
    expect(container.textContent).toContain("Windows Inactive");
    expect(container.querySelector('[aria-label="Mute"]')).toBeNull();
  });

  test("Settings General entry opens the volume screen", async () => {
    spyOn(settingsContext, "useSettings").mockReturnValue({
      settings: {},
      updateSetting: () => {},
      isAppLaunchSettingReady: false,
      isAppLaunchSettingSaving: false,
      appLaunchSettingError: null,
      isMicLocked: true,
      appPlatform: "web",
      isNativePhonePresentationLocked: true,
      nativePhonePresentationLockMessage: null,
      showNativePhoneCalls: false,
      showNativeNotifications: false,
    });
    let selected: unknown;
    await mount(
      <Settings
        onOpenDonationModal={() => {}}
        setActiveSection={(section) => {
          selected = section;
        }}
      />,
    );
    const general = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("General"),
    );
    if (!general) throw new Error("General settings entry missing");
    await act(async () => {
      general.click();
      await Bun.sleep(350);
    });
    const volume = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("Windows Volume"),
    );
    if (!volume) throw new Error("Windows Volume settings entry missing");
    await act(async () => volume.click());
    expect(selected).toBe("windowsVolume");
  });
});
