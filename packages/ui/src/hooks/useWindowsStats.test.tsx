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
import { useWindowsStats, parseWindowsStats } from "./useWindowsStats";
import { PCStats } from "../components/windows/PCStats";

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
let hook: ReturnType<typeof useWindowsStats>;
let dom: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();

function Probe() {
  hook = useWindowsStats();
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

const sample = {
  status: "ok",
  available: true,
  cpu_percent: 32.4,
  memory_percent: 61,
  gpu_percent: null,
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Windows PC stats", () => {
  test("uses only valid percentages, including zero, without inventing missing metrics", () => {
    expect(parseWindowsStats(sample)).toEqual({
      cpuPercent: 32.4,
      memoryPercent: 61,
      gpuPercent: null,
    });
    expect(
      parseWindowsStats({ ...sample, cpu_percent: 0, gpu_percent: 100 }),
    ).toEqual({ cpuPercent: 0, memoryPercent: 61, gpuPercent: 100 });
    for (const value of [
      null,
      [],
      {},
      { ...sample, available: false },
      { ...sample, status: "unsupported" },
      { ...sample, status: "unknown" },
      { ...sample, error: "bad" },
    ])
      expect(parseWindowsStats(value)).toBeNull();
    for (const value of [-1, 101, NaN, Infinity, "32", null, undefined]) {
      expect(parseWindowsStats({ ...sample, cpu_percent: value })).toEqual({
        cpuPercent: null,
        memoryPercent: 61,
        gpuPercent: null,
      });
    }
    expect(parseWindowsStats({ status: "ok", available: true })).toBeNull();
  });

  test("renders actual CPU/RAM and optional GPU, missing data, and functioning Back", async () => {
    const close = mock(() => {});
    await mount(<PCStats onClose={close} />);
    expect(container.textContent).toContain("Reading stats...");
    expect(calls[0]).toMatchObject({
      method: "system_stats.get",
      params: {},
      options: { timeoutMs: 4000, appReadyGeneration: 1 },
    });
    await respond(sample);
    expect(container.textContent).toContain("32%");
    expect(container.textContent).toContain("61%");
    expect(container.textContent).not.toContain("GPU");
    await route("windows");
    await respond({ ...sample, cpu_percent: null, gpu_percent: 74 });
    expect(container.textContent).toContain("CPUUnavailable");
    expect(container.textContent).toContain("GPU74%");
    expect(container.textContent).not.toContain("32%");
    await act(async () => button("Go Back").click());
    expect(close).toHaveBeenCalledTimes(1);
  });

  test.each(["macos", "ios", "android", null])(
    "clears readings on %s ownership and ignores stale replies after reconnect",
    async (platform) => {
      await mount();
      await respond(sample);
      await route("windows");
      await route(platform, platform !== null);
      expect(hook.snapshot).toBeNull();
      expect(hook.isWindowsActive).toBe(false);
      expect(calls).toHaveLength(2);
      await route("windows");
      expect(calls).toHaveLength(3);
      await respond({ ...sample, cpu_percent: 50 }, 2);
      await respond(sample, 1);
      expect(hook.snapshot?.cpuPercent).toBe(50);
    },
  );

  test("offline entry makes no RPC and the mounted screen recovers on Windows readiness", async () => {
    ready = { ...ready, ready: false, connectorPlatform: null };
    await mount(<PCStats />);
    expect(calls).toHaveLength(0);
    expect(container.textContent).toContain("PC unavailable");
    expect(container.textContent).not.toContain("%");
    await route("windows");
    await respond({ ...sample, available: false });
    expect(container.textContent).toContain("Stats unavailable");
    expect(container.textContent).not.toContain("%");
  });

  test("serializes slow reads, backs off failures, and recovers without overlapping RPCs", async () => {
    await mount();
    await act(async () => {
      await delay(2100);
    });
    expect(calls).toHaveLength(1);
    await respond(sample);
    await act(async () => {
      await delay(2100);
    });
    expect(calls).toHaveLength(2);
    await act(async () => calls[1].reject(new Error("timeout")));
    expect(hook.snapshot).toBeNull();
    await act(async () => {
      await delay(2100);
    });
    expect(calls).toHaveLength(2);
    await act(async () => {
      await delay(3100);
    });
    expect(calls).toHaveLength(3);
    await respond(sample);
    expect(hook.snapshot?.cpuPercent).toBe(32.4);
  }, 15000);

  test("unmount cancels timers and late results cannot schedule more reads", async () => {
    await mount();
    await act(async () => root.render(null));
    await respond(sample, 0);
    await mount();
    await respond({ ...sample, cpu_percent: 88 }, 1);
    expect(hook.snapshot?.cpuPercent).toBe(88);
    await act(async () => root.render(null));
    await act(async () => {
      await delay(2100);
    });
    expect(calls).toHaveLength(2);
  });
});
