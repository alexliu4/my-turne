import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  adjustHostVolume,
  configureHostBridge,
  connectHostBridge,
  disconnectHostBridge,
  getHostBridgeState,
  sendHostMessage,
  setHostVolume,
  subscribeHostBridgeState,
  toggleHostMute,
} from "./useHostBridge";

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sentMessages: string[] = [];
  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sentMessages.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  hello(capabilities: ("media" | "volume")[] = []) {
    this.message({
      type: "host.hello",
      protocolVersion: 1,
      hostName: "Windows-PC",
      capabilities,
    });
  }
}

const originalWebSocket = globalThis.WebSocket;
beforeEach(() => {
  disconnectHostBridge();
  connectHostBridge({ url: "", token: "", autoConnect: false });
  MockWebSocket.instances = [];
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  disconnectHostBridge();
  globalThis.WebSocket = originalWebSocket;
});

describe("HostBridge", () => {
  test("unconfigured host is inactive; configured host auto-connects once", () => {
    configureHostBridge({ url: "", autoConnect: true });
    expect(MockWebSocket.instances).toHaveLength(0);
    configureHostBridge({ url: "ws://192.168.1.50:8893", autoConnect: true });
    configureHostBridge({ url: "ws://192.168.1.50:8893", autoConnect: true });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://192.168.1.50:8893/");
  });

  test("only a complete version 1 hello marks the host connected", () => {
    connectHostBridge({ url: "ws://192.168.1.50:8893" });
    const ws = MockWebSocket.instances[0];
    ws.open();
    expect(getHostBridgeState().connectionState).toBe("connecting");
    expect(sendHostMessage({ type: "host.ping" })).toBe(false);
    ws.message({ type: "host.pong" });
    ws.message({ type: "host.hello", protocolVersion: 1, hostName: "PC" });
    expect(getHostBridgeState().connectionState).toBe("disconnected");
    expect(getHostBridgeState().lastError).toBe("Invalid host.hello");
  });

  test("version mismatch closes without connecting", () => {
    connectHostBridge({ url: "ws://192.168.1.50:8893" });
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.message({
      type: "host.hello",
      protocolVersion: 2,
      hostName: "PC",
      capabilities: [],
    });
    expect(ws.readyState).toBe(3);
    ws.onerror?.();
    expect(getHostBridgeState().connectionState).toBe("disconnected");
    expect(getHostBridgeState().lastError).toBe(
      "Unsupported protocol version 2",
    );
  });

  test("encodes token and exposes one shared connected state", () => {
    const observed: string[] = [];
    const unsubscribe = subscribeHostBridgeState(() => {
      observed.push(getHostBridgeState().connectionState);
    });
    connectHostBridge({
      url: "ws://192.168.1.50:8893/path?x=1",
      token: "a+b &/%",
    });
    const ws = MockWebSocket.instances[0];
    expect(new URL(ws.url).searchParams.get("token")).toBe("a+b &/%");
    expect(new URL(ws.url).searchParams.get("x")).toBe("1");
    ws.open();
    ws.hello();
    expect(getHostBridgeState().hostName).toBe("Windows-PC");
    expect(observed).toEqual(["connecting", "connected"]);
    expect(sendHostMessage({ type: "host.ping" })).toBe(true);
    expect(
      ws.sentMessages.some((message) => message.includes("host.ping")),
    ).toBe(true);
    configureHostBridge({
      url: "ws://192.168.1.50:8893/path?x=1",
      autoConnect: true,
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    unsubscribe();
  });

  test("initial volumeState is null; volume.state event and matched actionResult update state", () => {
    connectHostBridge({ url: "ws://192.168.1.50:8893" });
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.hello(["volume"]);

    expect(getHostBridgeState().volumeState).toEqual({
      volumePercent: null,
      muted: null,
    });

    // Unmatched actionResult is ignored
    ws.message({
      type: "host.actionResult",
      requestId: "unknown-req",
      success: true,
      payload: { volumePercent: 99, muted: true },
    });
    expect(getHostBridgeState().volumeState).toEqual({
      volumePercent: null,
      muted: null,
    });

    // Broadcast volume.state event updates volumeState
    ws.message({
      type: "host.action",
      requestId: "ext",
      action: "volume.state",
      payload: { volumePercent: 75, muted: false },
    });
    expect(getHostBridgeState().volumeState).toEqual({
      volumePercent: 75,
      muted: false,
    });

    // Trigger volume set with explicit reqId
    setHostVolume(85, "req-123");
    expect(
      ws.sentMessages.some((m) => m.includes("req-123") && m.includes("85")),
    ).toBe(true);

    // Matched actionResult updates state
    ws.message({
      type: "host.actionResult",
      requestId: "req-123",
      success: true,
      payload: { volumePercent: 85, muted: false },
    });
    expect(getHostBridgeState().volumeState).toEqual({
      volumePercent: 85,
      muted: false,
    });
  });

  test("manual disconnect resets volumeState and cancels automatic reconnect", async () => {
    connectHostBridge({
      url: "ws://192.168.1.50:8893",
      autoConnect: true,
      reconnectIntervalMs: 10,
    });
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.hello(["volume"]);

    ws.message({
      type: "host.action",
      requestId: "ext",
      action: "volume.state",
      payload: { volumePercent: 50, muted: false },
    });
    expect(getHostBridgeState().volumeState.volumePercent).toBe(50);

    disconnectHostBridge();
    await Bun.sleep(30);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(getHostBridgeState().connectionState).toBe("disconnected");
    expect(getHostBridgeState().volumeState).toEqual({
      volumePercent: null,
      muted: null,
    });
  });

  test("auth failures preserve increasing reconnect backoff", async () => {
    connectHostBridge({
      url: "ws://192.168.1.50:8893",
      autoConnect: true,
      reconnectIntervalMs: 30,
      maxReconnectIntervalMs: 200,
    });
    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].message({
      type: "host.status",
      connected: false,
    });
    expect(getHostBridgeState().lastError).toBe("Host authentication failed");
    await Bun.sleep(45);
    expect(MockWebSocket.instances).toHaveLength(2);
    MockWebSocket.instances[1].open();
    MockWebSocket.instances[1].message({
      type: "host.status",
      connected: false,
    });
    await Bun.sleep(40);
    expect(MockWebSocket.instances).toHaveLength(2);
    await Bun.sleep(35);
    expect(MockWebSocket.instances).toHaveLength(3);
    MockWebSocket.instances[2].open();
    MockWebSocket.instances[2].hello();
    MockWebSocket.instances[2].close();
    await Bun.sleep(45);
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  test("heartbeat requires pong and reconnects after timeout", async () => {
    connectHostBridge({
      url: "ws://192.168.1.50:8893",
      autoConnect: true,
      reconnectIntervalMs: 100,
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 15,
    });
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.hello();
    await Bun.sleep(20);
    expect(
      ws.sentMessages.some((message) => message.includes("host.ping")),
    ).toBe(true);
    ws.message({ type: "unknown" });
    await Bun.sleep(35);
    expect(ws.readyState).toBe(3);
    expect(getHostBridgeState().lastError).toBe("Heartbeat timeout");
    await Bun.sleep(105);
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
  });
});
