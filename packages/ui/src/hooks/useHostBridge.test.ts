import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  getHostBridgeState,
  subscribeHostBridgeState,
  connectHostBridge,
  disconnectHostBridge,
  sendHostMessage,
} from "./useHostBridge";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];
  url: string;
  readyState: number = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }

  simulateOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) this.onopen();
  }

  simulateMessage(data: object) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }

  simulateError(err: unknown) {
    if (this.onerror) this.onerror(err);
  }
}

const originalWebSocket = globalThis.WebSocket;

describe("useHostBridge singleton manager", () => {
  beforeEach(() => {
    disconnectHostBridge();
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    disconnectHostBridge();
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  test("connectHostBridge stays connecting on open until valid host.hello is received", () => {
    connectHostBridge({ url: "ws://192.168.1.50:8893", autoConnect: false });

    expect(getHostBridgeState().connectionState).toBe("connecting");
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://192.168.1.50:8893");

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    expect(getHostBridgeState().connectionState).toBe("connecting");

    ws.simulateMessage({
      type: "host.hello",
      protocolVersion: 1,
      hostName: "Windows-PC",
      capabilities: [],
    });

    expect(getHostBridgeState().connectionState).toBe("connected");
    expect(getHostBridgeState().hostName).toBe("Windows-PC");
  });

  test("appends token query param when token option is provided", () => {
    connectHostBridge({ url: "ws://192.168.1.50:8893", token: "secret_pass" });

    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://192.168.1.50:8893?token=secret_pass");
  });

  test("rejects unsupported protocol version and closes connection", () => {
    connectHostBridge({ url: "ws://192.168.1.50:8893", autoConnect: false });
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: "host.hello",
      protocolVersion: 999,
      hostName: "Future-PC",
      capabilities: [],
    });

    expect(getHostBridgeState().connectionState).toBe("disconnected");
    expect(getHostBridgeState().lastError).toBe("Unsupported protocol version 999");
  });

  test("sendHostMessage sends JSON payload via active WebSocket", () => {
    connectHostBridge({ url: "ws://192.168.1.50:8893", autoConnect: false });
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    const success = sendHostMessage({
      type: "host.ping",
    });

    expect(success).toBe(true);
    expect(ws.sentMessages.some((m) => m.includes("host.ping"))).toBe(true);
  });

  test("manual disconnectHostBridge stays disconnected without auto-reconnecting", () => {
    connectHostBridge({ url: "ws://192.168.1.50:8893", autoConnect: true });
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    disconnectHostBridge();

    expect(getHostBridgeState().connectionState).toBe("disconnected");
    expect(getHostBridgeState().capabilities).toEqual([]);
    expect(MockWebSocket.instances.length).toBe(1);
  });
});
