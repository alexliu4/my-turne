import { useEffect, useSyncExternalStore } from "react";
import type {
  HostCapability,
  HostMessage,
} from "../../../../crates/shared/bindings/host";

export type ConnectionState = "disconnected" | "connecting" | "connected";
export interface HostBridgeOptions {
  url?: string;
  token?: string;
  autoConnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectIntervalMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}
export interface HostBridgeState {
  connectionState: ConnectionState;
  hostName: string | null;
  protocolVersion: number | null;
  capabilities: HostCapability[];
  lastError: string | null;
}

const knownCapabilities = new Set<HostCapability>([
  "media",
  "volume",
  "discord",
  "systemStats",
  "macros",
  "appLaunch",
]);
const config: Required<HostBridgeOptions> = {
  url: "",
  token: "",
  autoConnect: false,
  reconnectIntervalMs: 1000,
  maxReconnectIntervalMs: 16000,
  heartbeatIntervalMs: 10000,
  heartbeatTimeoutMs: 20000,
};
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pendingPingAt: number | null = null;
let reconnectAttempt = 0;
let manuallyDisconnected = false;
let state: HostBridgeState = {
  connectionState: "disconnected",
  hostName: null,
  protocolVersion: null,
  capabilities: [],
  lastError: null,
};
const listeners = new Set<() => void>();

function updateState(next: Partial<HostBridgeState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}
function clearTimers() {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  if (handshakeTimer !== null) clearTimeout(handshakeTimer);
  if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
  reconnectTimer = handshakeTimer = heartbeatTimer = null;
  pendingPingAt = null;
}
function offline(error?: string | null) {
  updateState({
    connectionState: "disconnected",
    hostName: null,
    protocolVersion: null,
    capabilities: [],
    lastError: error === undefined ? state.lastError : error,
  });
}
function retry() {
  if (manuallyDisconnected || !config.autoConnect || !config.url) return;
  const delay = Math.min(
    config.reconnectIntervalMs * 2 ** Math.min(reconnectAttempt, 30),
    config.maxReconnectIntervalMs,
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectHostBridge();
  }, delay);
}
function fail(ws: WebSocket, reason: string) {
  if (socket !== ws) return;
  clearTimers();
  offline(reason);
  ws.close();
}
function validHello(value: unknown): value is {
  type: "host.hello";
  protocolVersion: number;
  hostName: string;
  capabilities: HostCapability[];
} {
  if (!value || typeof value !== "object") return false;
  const hello = value as Record<string, unknown>;
  return (
    hello.type === "host.hello" &&
    hello.protocolVersion === 1 &&
    typeof hello.hostName === "string" &&
    hello.hostName.trim().length > 0 &&
    Array.isArray(hello.capabilities) &&
    hello.capabilities.every((cap) => knownCapabilities.has(cap))
  );
}

export function getHostBridgeState(): HostBridgeState {
  return state;
}
export function subscribeHostBridgeState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function sendHostMessage(message: HostMessage): boolean {
  if (
    state.connectionState !== "connected" ||
    socket?.readyState !== WebSocket.OPEN
  )
    return false;
  socket.send(JSON.stringify(message));
  return true;
}
export function disconnectHostBridge() {
  manuallyDisconnected = true;
  clearTimers();
  const old = socket;
  socket = null;
  old?.close();
  offline(null);
}
export function configureHostBridge(options: HostBridgeOptions) {
  Object.assign(config, options);
  if (config.autoConnect && config.url && !manuallyDisconnected)
    connectHostBridge();
}
export function connectHostBridge(options: HostBridgeOptions = {}) {
  Object.assign(config, options);
  manuallyDisconnected = false;
  if (socket || !config.url) return;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  let url: URL;
  try {
    url = new URL(config.url);
    if (url.protocol !== "ws:" && url.protocol !== "wss:")
      throw new Error("Windows host URL must use ws or wss");
    if (config.token) url.searchParams.set("token", config.token);
  } catch (error) {
    offline(error instanceof Error ? error.message : String(error));
    return;
  }
  updateState({
    connectionState: "connecting",
    hostName: null,
    protocolVersion: null,
    capabilities: [],
    lastError: null,
  });
  try {
    const ws = new WebSocket(url.toString());
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      ws.send(
        JSON.stringify({
          type: "host.hello",
          protocolVersion: 1,
          hostName: "CarThing",
          capabilities: [],
        }),
      );
      handshakeTimer = setTimeout(
        () => fail(ws, "Host handshake timeout"),
        10000,
      );
    };
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      const payload = message as Record<string, unknown>;
      if (state.connectionState === "connecting") {
        if (payload.type === "host.status" && payload.connected === false) {
          fail(ws, "Host authentication failed");
          return;
        }
        if (payload.type !== "host.hello") return;
        if (!validHello(payload)) {
          fail(
            ws,
            payload.protocolVersion !== 1
              ? `Unsupported protocol version ${String(payload.protocolVersion)}`
              : "Invalid host.hello",
          );
          return;
        }
        if (handshakeTimer !== null) clearTimeout(handshakeTimer);
        handshakeTimer = null;
        reconnectAttempt = 0;
        updateState({
          connectionState: "connected",
          hostName: payload.hostName,
          protocolVersion: 1,
          capabilities: payload.capabilities,
          lastError: null,
        });
        if (config.heartbeatIntervalMs > 0 && config.heartbeatTimeoutMs > 0) {
          heartbeatTimer = setInterval(() => {
            if (socket !== ws) return;
            if (pendingPingAt !== null) {
              if (Date.now() - pendingPingAt >= config.heartbeatTimeoutMs)
                fail(ws, "Heartbeat timeout");
              return;
            }
            pendingPingAt = Date.now();
            ws.send(JSON.stringify({ type: "host.ping" }));
          }, config.heartbeatIntervalMs);
        }
      } else if (state.connectionState === "connected") {
        if (payload.type === "host.pong") pendingPingAt = null;
        else if (payload.type === "host.status" && payload.connected === false)
          fail(ws, "Host unavailable");
      }
    };
    ws.onerror = () => {
      if (socket === ws && state.connectionState !== "disconnected")
        updateState({ lastError: "WebSocket connection error" });
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      clearTimers();
      offline();
      retry();
    };
  } catch (error) {
    offline(error instanceof Error ? error.message : String(error));
    retry();
  }
}
export function useHostBridge(options?: HostBridgeOptions) {
  const snapshot = useSyncExternalStore(
    subscribeHostBridgeState,
    getHostBridgeState,
  );
  useEffect(() => {
    if (options) configureHostBridge(options);
  }, [
    options?.url,
    options?.token,
    options?.autoConnect,
    options?.reconnectIntervalMs,
    options?.maxReconnectIntervalMs,
    options?.heartbeatIntervalMs,
    options?.heartbeatTimeoutMs,
  ]);
  return {
    ...snapshot,
    connect: connectHostBridge,
    disconnect: disconnectHostBridge,
    sendHostMessage,
    hasCapability: (cap: HostCapability) => snapshot.capabilities.includes(cap),
  };
}
