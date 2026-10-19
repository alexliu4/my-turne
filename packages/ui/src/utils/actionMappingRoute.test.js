import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  addGlobalWsListener,
  cleanupGlobalWebSocket,
  getGlobalWebSocket,
  getAppReadyState,
} from "../hooks/useNocturned";
import {
  executeAction,
  setActionMapping,
  WINDOWS_ACTION_IDS,
} from "./actionMapping";

class Socket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  readyState = Socket.OPEN;
  requests = [];
  response = { status: "ok" };
  receive(message) {
    this.onmessage({ data: JSON.stringify(message) });
  }
  send(raw) {
    const request = JSON.parse(raw);
    this.requests.push(request);
    this.receive({
      type: "response",
      id: request.id,
      result: request.method === "device.time.get" ? {} : this.response,
    });
  }
  close() {
    this.readyState = Socket.CLOSED;
    this.onclose?.({ code: 1000 });
  }
}
let socket, restore, remove;
beforeEach(() => {
  const values = new Map();
  const replacements = {
    WebSocket: Socket,
    window: { dispatchEvent() {} },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  const descriptors = Object.keys(replacements).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]);
  restore = () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  for (const [key, value] of Object.entries(replacements))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  cleanupGlobalWebSocket();
  remove = addGlobalWsListener("mapping-route-regression", {});
  socket = getGlobalWebSocket();
});
afterEach(() => {
  remove();
  cleanupGlobalWebSocket();
  restore();
});
async function ready(platform) {
  socket.receive({
    type: "event",
    topic: "app.ready",
    data: { platform: "web", connectorPlatform: platform },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(getAppReadyState().connectorPlatform).toBe(platform);
  socket.requests.length = 0;
}

test.each(WINDOWS_ACTION_IDS)(
  "%s uses live Windows/Mac route despite stale true/false context",
  async (action) => {
    setActionMapping("preset_1", { kind: "windows", action, delta: 5 });
    await ready("windows");
    expect(
      (await executeAction("preset_1", { isWindowsActive: false })).executed,
    ).toBe(true);
    expect(socket.requests).toHaveLength(1);
    if (action.startsWith("media."))
      expect(socket.requests[0].params.windows_only).toBe(true);
    await ready("macos");
    expect(
      (await executeAction("preset_1", { isWindowsActive: true })).reason,
    ).toBe("windows_unavailable");
    expect(socket.requests).toHaveLength(0);
    await ready("windows");
    expect(
      (await executeAction("preset_1", { isWindowsActive: false })).executed,
    ).toBe(true);
  },
);

test("a queued Windows action is cancelled on route generation change", async () => {
  await ready("windows");
  setActionMapping("preset_1", { kind: "windows", action: "media.next" });
  socket.readyState = Socket.CONNECTING;
  const pending = executeAction("preset_1", { isWindowsActive: true });
  // A real incoming readiness event invalidates a queued send before dispatch.
  socket.readyState = Socket.OPEN;
  await ready("macos");
  expect((await pending).executed).toBe(false);
  expect(
    socket.requests.filter(
      (request) => request.method === "media.control.next",
    ),
  ).toHaveLength(0);
});

for (const kind of ["device", "windows"]) {
  const actions =
    kind === "windows"
      ? WINDOWS_ACTION_IDS
      : ["media.play_pause", "media.next", "media.previous"];
  test.each(actions)(
    `${kind} %s rejects every malformed/failed acknowledgement`,
    async (action) => {
      await ready("windows");
      setActionMapping("preset_1", { kind, action, delta: 5 });
      let refreshes = 0;
      for (const response of [
        {},
        null,
        [],
        "ok",
        true,
        { status: 1 },
        { status: "failed" },
        { error: "bad" },
        { status: "ok", error: "bad" },
        { status: "unsupported" },
      ]) {
        // Inject only the response; dispatch still consults the real live session.
        const result = await executeAction("preset_1", {
          sendWsRequest: async () => response,
          refreshPlaybackState: () => refreshes++,
        });
        expect(result.executed).toBe(false);
        expect(result.fallbackToDefault).toBe(false);
      }
      expect(refreshes).toBe(0);
      expect(
        (
          await executeAction("preset_1", {
            sendWsRequest: async () => ({ status: "ok" }),
          })
        ).executed,
      ).toBe(true);
    },
  );
}
