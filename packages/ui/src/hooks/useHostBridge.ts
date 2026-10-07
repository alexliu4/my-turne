import { useEffect, useState } from "react";
import type { HostCapability, HostHello, HostMessage } from "../../../../crates/shared/bindings/host";

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

// Module-level singleton state
let globalWs: WebSocket | null = null;
let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
let isManuallyDisconnected = false;
let lastMessageTimestamp = 0;

let activeConfig = {
  url: typeof window !== "undefined" && (window as unknown as { NOCTURNE_WINDOWS_HOST_URL?: string }).NOCTURNE_WINDOWS_HOST_URL
    ? (window as unknown as { NOCTURNE_WINDOWS_HOST_URL: string }).NOCTURNE_WINDOWS_HOST_URL
    : "",
  token: typeof window !== "undefined" ? (window as unknown as { NOCTURNE_WINDOWS_TOKEN?: string }).NOCTURNE_WINDOWS_TOKEN : undefined,
  autoConnect: false,
  reconnectIntervalMs: 1000,
  maxReconnectIntervalMs: 16000,
  heartbeatIntervalMs: 10000,
  heartbeatTimeoutMs: 20000,
};

let currentState: HostBridgeState = {
  connectionState: "disconnected",
  hostName: null,
  protocolVersion: null,
  capabilities: [],
  lastError: null,
};

const subscribers = new Set<(state: HostBridgeState) => void>();

function notifySubscribers() {
  subscribers.forEach((listener) => listener(currentState));
}

function updateState(partial: Partial<HostBridgeState>) {
  currentState = { ...currentState, ...partial };
  notifySubscribers();
}

function clearTimers() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}

export function sendHostMessage(msg: HostMessage): boolean {
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    globalWs.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

export function disconnectHostBridge() {
  isManuallyDisconnected = true;
  clearTimers();
  if (globalWs) {
    globalWs.close();
    globalWs = null;
  }
  updateState({
    connectionState: "disconnected",
    hostName: null,
    protocolVersion: null,
    capabilities: [],
  });
}

export function connectHostBridge(overrideConfig?: Partial<typeof activeConfig>) {
  if (overrideConfig) {
    activeConfig = { ...activeConfig, ...overrideConfig };
  }
  isManuallyDisconnected = false;

  if (!activeConfig.url) {
    updateState({
      connectionState: "disconnected",
      lastError: "No Windows host URL configured",
    });
    return;
  }

  clearTimers();
  if (globalWs) {
    globalWs.close();
    globalWs = null;
  }

  updateState({
    connectionState: "connecting",
    lastError: null,
  });

  let fullUrl = activeConfig.url;
  if (activeConfig.token) {
    const hasQuery = fullUrl.includes("?");
    const param = `token=${encodeURIComponent(activeConfig.token)}`;
    fullUrl = hasQuery ? `${fullUrl}&${param}` : `${fullUrl}?${param}`;
  }

  try {
    const ws = new WebSocket(fullUrl);
    globalWs = ws;

    ws.onopen = () => {
      if (globalWs !== ws) return;
      lastMessageTimestamp = Date.now();

      // Keep state as connecting until valid host.hello is received
      sendHostMessage({
        type: "host.hello",
        protocolVersion: 1,
        hostName: "CarThing",
        capabilities: [],
      });

      // Setup heartbeat ping / timeout check
      if (activeConfig.heartbeatIntervalMs > 0) {
        heartbeatIntervalId = setInterval(() => {
          if (globalWs !== ws) return;
          const now = Date.now();

          // Check for heartbeat timeout
          if (
            activeConfig.heartbeatTimeoutMs > 0 &&
            lastMessageTimestamp > 0 &&
            now - lastMessageTimestamp > activeConfig.heartbeatTimeoutMs
          ) {
            updateState({
              connectionState: "disconnected",
              lastError: "Heartbeat timeout",
            });
            ws.close();
            return;
          }

          // Send host.ping
          sendHostMessage({ type: "host.ping" });
        }, activeConfig.heartbeatIntervalMs);
      }
    };

    ws.onmessage = (event) => {
      if (globalWs !== ws) return;
      lastMessageTimestamp = Date.now();

      try {
        const message = JSON.parse(event.data);
        if (message.type === "host.hello") {
          const hello = message as HostHello;
          if (hello.protocolVersion !== 1) {
            updateState({
              connectionState: "disconnected",
              lastError: `Unsupported protocol version ${hello.protocolVersion}`,
            });
            ws.close();
            return;
          }

          reconnectAttempt = 0;
          updateState({
            connectionState: "connected",
            hostName: hello.hostName,
            protocolVersion: hello.protocolVersion,
            capabilities: hello.capabilities || [],
          });
        } else if (message.type === "host.status") {
          if (!message.connected) {
            updateState({
              connectionState: "disconnected",
            });
          }
        } else if (message.type === "host.pong") {
          // Heartbeat pong received
        }
      } catch (e) {
        // Safe handling for unknown/non-JSON messages
      }
    };

    ws.onerror = (_err) => {
      if (globalWs !== ws) return;
      updateState({
        lastError: "WebSocket connection error",
      });
    };

    ws.onclose = () => {
      if (globalWs !== ws) return;
      globalWs = null;
      clearTimers();

      updateState({
        connectionState: "disconnected",
        hostName: null,
        protocolVersion: null,
        capabilities: [],
      });

      if (!isManuallyDisconnected && activeConfig.autoConnect && activeConfig.url) {
        const attempt = reconnectAttempt;
        const delay = Math.min(
          activeConfig.reconnectIntervalMs * Math.pow(2, attempt),
          activeConfig.maxReconnectIntervalMs
        );
        reconnectAttempt = attempt + 1;
        reconnectTimeoutId = setTimeout(() => {
          connectHostBridge();
        }, delay);
      }
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    updateState({
      connectionState: "disconnected",
      lastError: errorMsg,
    });
  }
}

export function getHostBridgeState(): HostBridgeState {
  return currentState;
}

export function subscribeHostBridgeState(listener: (state: HostBridgeState) => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function useHostBridge(options: HostBridgeOptions = {}) {
  const [state, setState] = useState<HostBridgeState>(currentState);

  useEffect(() => {
    const unsubscribe = subscribeHostBridgeState(setState);

    const hasOptions =
      options.url ||
      options.token ||
      options.autoConnect !== undefined ||
      options.reconnectIntervalMs ||
      options.maxReconnectIntervalMs ||
      options.heartbeatIntervalMs ||
      options.heartbeatTimeoutMs;

    if (hasOptions) {
      activeConfig = {
        ...activeConfig,
        ...options,
        autoConnect: options.autoConnect ?? (Boolean(options.url) || Boolean(activeConfig.url)),
      };
    }

    if (
      currentState.connectionState === "disconnected" &&
      !isManuallyDisconnected &&
      activeConfig.autoConnect &&
      activeConfig.url
    ) {
      connectHostBridge();
    }

    return () => {
      unsubscribe();
    };
  }, [
    options.url,
    options.token,
    options.autoConnect,
    options.reconnectIntervalMs,
    options.maxReconnectIntervalMs,
    options.heartbeatIntervalMs,
    options.heartbeatTimeoutMs,
  ]);

  return {
    ...state,
    connect: (overrideConfig?: Partial<typeof activeConfig>) => connectHostBridge(overrideConfig),
    disconnect: disconnectHostBridge,
    sendHostMessage,
    hasCapability: (cap: HostCapability) => state.capabilities.includes(cap),
  };
}
