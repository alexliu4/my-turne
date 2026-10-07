import { useCallback, useEffect, useRef, useState } from "react";
import type { HostCapability, HostHello, HostMessage } from "@nocturne/shared/bindings/host";

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface HostBridgeOptions {
  url?: string;
  autoConnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

export interface HostBridgeState {
  connectionState: ConnectionState;
  hostName: string | null;
  protocolVersion: number | null;
  capabilities: HostCapability[];
  lastError: string | null;
}

export function useHostBridge(options: HostBridgeOptions = {}) {
  const {
    url = "ws://localhost:8893",
    autoConnect = true,
    reconnectIntervalMs = 1000,
    maxReconnectIntervalMs = 16000,
    heartbeatIntervalMs = 10000,
  } = options;

  const [state, setState] = useState<HostBridgeState>({
    connectionState: "disconnected",
    hostName: null,
    protocolVersion: null,
    capabilities: [],
    lastError: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearTimers();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (isMountedRef.current) {
      setState((prev) => ({
        ...prev,
        connectionState: "disconnected",
        hostName: null,
        protocolVersion: null,
        capabilities: [],
      }));
    }
  }, [clearTimers]);

  const sendHostMessage = useCallback((msg: HostMessage): boolean => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const connect = useCallback(() => {
    disconnect();

    if (!isMountedRef.current) return;

    setState((prev) => ({
      ...prev,
      connectionState: "connecting",
      lastError: null,
    }));

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        reconnectAttemptRef.current = 0;
        setState((prev) => ({
          ...prev,
          connectionState: "connected",
        }));

        // Send client hello
        sendHostMessage({
          type: "host.hello",
          protocolVersion: 1,
          hostName: "CarThing",
          capabilities: [],
        });

        // Setup heartbeat
        if (heartbeatIntervalMs > 0) {
          heartbeatIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }));
            }
          }, heartbeatIntervalMs);
        }
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "host.hello") {
            const hello = message as HostHello;
            setState((prev) => ({
              ...prev,
              hostName: hello.hostName,
              protocolVersion: hello.protocolVersion,
              capabilities: hello.capabilities || [],
            }));
          } else if (message.type === "host.status") {
            if (!message.connected) {
              setState((prev) => ({
                ...prev,
                connectionState: "disconnected",
              }));
            }
          }
        } catch (e) {
          // Safe handling for unknown/non-JSON messages
        }
      };

      ws.onerror = (_err) => {
        if (!isMountedRef.current) return;
        setState((prev) => ({
          ...prev,
          lastError: "WebSocket connection error",
        }));
      };

      ws.onclose = () => {
        if (!isMountedRef.current) return;
        clearTimers();
        setState((prev) => ({
          ...prev,
          connectionState: "disconnected",
          hostName: null,
          protocolVersion: null,
          capabilities: [],
        }));

        if (autoConnect) {
          const attempt = reconnectAttemptRef.current;
          const delay = Math.min(
            reconnectIntervalMs * Math.pow(2, attempt),
            maxReconnectIntervalMs
          );
          reconnectAttemptRef.current = attempt + 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              connect();
            }
          }, delay);
        }
      };
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const errorMsg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        connectionState: "disconnected",
        lastError: errorMsg,
      }));
    }
  }, [
    url,
    autoConnect,
    reconnectIntervalMs,
    maxReconnectIntervalMs,
    heartbeatIntervalMs,
    disconnect,
    clearTimers,
    sendHostMessage,
  ]);

  useEffect(() => {
    isMountedRef.current = true;
    if (autoConnect) {
      connect();
    }
    return () => {
      isMountedRef.current = false;
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    sendHostMessage,
    hasCapability: (cap: HostCapability) => state.capabilities.includes(cap),
  };
}
