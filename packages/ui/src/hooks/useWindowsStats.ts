import { useEffect, useState } from "react";
import {
  getAppReadyState,
  subscribeAppReadyState,
  sendNocturneWsRequest,
} from "./useNocturned";
import { getWindowsConnectorState } from "./useWindowsConnector";

export type WindowsStatsSnapshot = {
  cpuPercent: number | null;
  memoryPercent: number | null;
  gpuPercent: number | null;
};

function percentage(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

// Consume only verified Connector percentages. Missing metrics never become zero.
export function parseWindowsStats(
  payload: unknown,
): WindowsStatsSnapshot | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const data = payload as Record<string, unknown>;
  if (data.status !== "ok" || data.available !== true || data.error != null)
    return null;
  const snapshot = {
    cpuPercent: percentage(data.cpu_percent),
    memoryPercent: percentage(data.memory_percent),
    gpuPercent: percentage(data.gpu_percent),
  };
  return Object.values(snapshot).some((value) => value !== null)
    ? snapshot
    : null;
}

export function useWindowsStats() {
  const [ready, setReady] = useState(getAppReadyState);
  const [state, setState] = useState<{
    generation: number;
    snapshot: WindowsStatsSnapshot | null;
    isLoading: boolean;
  }>({ generation: ready.generation, snapshot: null, isLoading: true });
  useEffect(() => subscribeAppReadyState(setReady), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const generation = ready.generation;
    const isCurrent = () =>
      !cancelled &&
      getAppReadyState().generation === generation &&
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    setState({ generation, snapshot: null, isLoading: true });
    if (!getWindowsConnectorState(ready).isWindowsActive) return;

    async function read() {
      if (!isCurrent()) return;
      let snapshot: WindowsStatsSnapshot | null = null;
      try {
        snapshot = parseWindowsStats(
          await sendNocturneWsRequest<unknown>(
            "system_stats.get",
            {},
            { timeoutMs: 4000, appReadyGeneration: generation },
          ),
        );
      } catch (error: unknown) {
        // Keep failures local to this screen; slower retries avoid error spam.
        if (isCurrent()) console.debug("Windows stats unavailable:", error);
      }
      if (!isCurrent()) return;
      setState({ generation, snapshot, isLoading: false });
      // Connector owns sampling and caching. Read only while this screen is mounted,
      // waiting after completion so slow RPCs cannot overlap or accumulate.
      timer = setTimeout(() => void read(), snapshot ? 2000 : 5000);
    }
    void read();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [ready.generation, ready.ready, ready.connectorPlatform]);

  const isWindowsActive = getWindowsConnectorState(ready).isWindowsActive;
  const current = isWindowsActive && state.generation === ready.generation;
  return {
    isWindowsActive,
    snapshot: current ? state.snapshot : null,
    isLoading: isWindowsActive && (!current || state.isLoading),
  };
}
