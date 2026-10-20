import { useEffect, useRef, useState } from "react";
import {
  addGlobalWsListener,
  getAppReadyState,
  sendNocturneWsRequest,
  subscribeAppReadyState,
} from "./useNocturned";
import { getWindowsConnectorState } from "./useWindowsConnector";

export type WindowsSessionSnapshot = {
  observerId: string;
  sequence: number;
  session: "locked" | "unlocked" | "unknown";
  activeSession: "active" | "inactive" | "unknown";
  displayPower: "on" | "off" | "dimmed" | "unknown";
  systemPower: "awake" | "suspending" | "resuming" | "unknown";
};

export function parseWindowsSession(
  raw: unknown,
): WindowsSessionSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (
    data.error != null ||
    typeof data.observerId !== "string" ||
    data.observerId.length > 64 ||
    typeof data.sequence !== "number" ||
    !Number.isSafeInteger(data.sequence) ||
    data.sequence < 0
  )
    return null;
  return {
    observerId: data.observerId,
    sequence: data.sequence,
    session:
      data.sessionMonitoring === true &&
      (data.session === "locked" || data.session === "unlocked")
        ? data.session
        : "unknown",
    activeSession:
      data.sessionMonitoring === true &&
      (data.activeSession === "active" || data.activeSession === "inactive")
        ? data.activeSession
        : "unknown",
    displayPower:
      data.displayPowerMonitoring === true &&
      (data.displayPower === "on" ||
        data.displayPower === "off" ||
        data.displayPower === "dimmed")
        ? data.displayPower
        : "unknown",
    systemPower:
      data.systemPowerMonitoring === true &&
      (data.systemPower === "awake" ||
        data.systemPower === "suspending" ||
        data.systemPower === "resuming")
        ? data.systemPower
        : "unknown",
  };
}

type SessionReading = {
  status: "offline" | "loading" | "ready" | "unsupported" | "error";
  snapshot: WindowsSessionSnapshot | null;
};

export function useWindowsSession() {
  const [ready, setReady] = useState(getAppReadyState);
  const [reading, setReading] = useState<SessionReading>({
    status: "offline",
    snapshot: null,
  });
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const routeRef = useRef(ready);
  const epoch = useRef(0);
  useEffect(
    () =>
      subscribeAppReadyState((next) => {
        const previous = routeRef.current;
        if (
          previous.generation === next.generation &&
          previous.ready === next.ready &&
          previous.platform === next.platform &&
          previous.connectorPlatform === next.connectorPlatform
        )
          return;
        routeRef.current = next;
        epoch.current++;
        setReading({ status: "offline", snapshot: null });
        setReady(next);
      }),
    [],
  );

  useEffect(() => {
    const active = getWindowsConnectorState(ready).isWindowsActive;
    const token = ++epoch.current;
    let snapshot: WindowsSessionSnapshot | null = null;
    let pending = false;
    let revision = 0;
    let lastObserverRefresh = -Infinity;
    let observerRefreshNeeded: string | null = null;
    const current = () =>
      epoch.current === token &&
      getAppReadyState().generation === ready.generation &&
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const read = async () => {
      if (!active || !current() || pending) return;
      pending = true;
      const startedRevision = revision;
      // Clear unverified readings during refresh; events may update after this snapshot.
      setReading({ status: "loading", snapshot: null });
      try {
        const raw = await sendNocturneWsRequest<unknown>(
          "windows.session.get_status",
          {},
          {
            timeoutMs: 3000,
            appReadyGeneration: ready.generation,
          },
        );
        if (!current()) return;
        const response =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : null;
        if (response?.status === "unsupported" && response.error == null) {
          snapshot = null;
          setReading({ status: "unsupported", snapshot: null });
          return;
        }
        const parsed =
          response?.status === "ok" && response.error == null
            ? parseWindowsSession(response.sessionState)
            : null;
        if (!parsed) throw new Error("Invalid session snapshot");
        // Newer events in the same instance supersede an older in-flight read.
        if (
          !snapshot ||
          parsed.observerId !== snapshot.observerId ||
          parsed.sequence >= snapshot.sequence
        ) {
          snapshot = parsed;
        }
        setReading({ status: "ready", snapshot });
      } catch (error: unknown) {
        if (!current()) return;
        if (revision !== startedRevision) {
          setReading({ status: "ready", snapshot });
          return;
        }
        snapshot = null;
        const unsupported =
          error instanceof Error &&
          /^(unsupported|unknown method|method not found)(?:[.: ]|$)/i.test(
            error.message,
          );
        setReading({
          status: unsupported ? "unsupported" : "error",
          snapshot: null,
        });
      } finally {
        pending = false;
        const expectedObserver = observerRefreshNeeded;
        observerRefreshNeeded = null;
        if (
          expectedObserver !== null &&
          snapshot?.observerId !== expectedObserver &&
          current()
        ) {
          void read();
        }
      }
    };
    refreshRef.current = read;
    setReading({ status: active ? "loading" : "offline", snapshot: null });
    const remove = active
      ? addGlobalWsListener(`windows-session-${crypto.randomUUID()}`, {
          onMessage: (message) => {
            if (
              !active ||
              !current() ||
              message.type !== "event" ||
              message.topic !== "windows.session.changed"
            )
              return;
            const parsed = parseWindowsSession(message.data);
            if (!parsed || !snapshot) return;
            if (parsed.observerId !== snapshot.observerId) {
              // An event cannot establish a new native instance. Bound refresh attempts.
              if (performance.now() - lastObserverRefresh >= 3000) {
                lastObserverRefresh = performance.now();
                if (pending) observerRefreshNeeded = parsed.observerId;
                else void read();
              }
              return;
            }
            if (parsed.sequence <= snapshot.sequence) return;
            snapshot = parsed;
            revision++;
            setReading({ status: "ready", snapshot });
          },
        })
      : null;
    void read();
    return () => {
      epoch.current++;
      remove?.();
      refreshRef.current = null;
    };
  }, [ready.generation, ready.ready, ready.platform, ready.connectorPlatform]);

  return {
    ...reading,
    refreshSession: () => {
      void refreshRef.current?.();
    },
  };
}
