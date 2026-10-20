import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAppReadyState,
  subscribeAppReadyState,
  sendNocturneWsRequest,
} from "./useNocturned";
import { getWindowsConnectorState } from "./useWindowsConnector";
import { parseAudioOutputs } from "./useWindowsAudioOutputs";

export type AudioSession = {
  id: string;
  endpointId: string;
  appName: string;
  volumePercent: number;
  muted: boolean;
};
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
export function parseAudioSessions(value: unknown): AudioSession[] | null {
  const data = record(value);
  if (
    data?.status !== "ok" ||
    data.error != null ||
    !Array.isArray(data.sessions) ||
    data.sessions.length > 256
  )
    return null;
  const sessions: AudioSession[] = [];
  const ids = new Set<string>();
  for (const entry of data.sessions) {
    const item = record(entry);
    if (
      !item ||
      !text(item.id, 4096) ||
      ids.has(item.id) ||
      !text(item.endpointId, 4096) ||
      !text(item.appName, 256) ||
      typeof item.volumePercent !== "number" ||
      !Number.isFinite(item.volumePercent) ||
      item.volumePercent < 0 ||
      item.volumePercent > 100 ||
      typeof item.muted !== "boolean" ||
      typeof item.processId !== "number" ||
      !Number.isSafeInteger(item.processId) ||
      item.processId < 0
    )
      return null;
    ids.add(item.id);
    sessions.push({
      id: item.id,
      endpointId: item.endpointId,
      appName: item.appName,
      volumePercent: item.volumePercent,
      muted: item.muted,
    });
  }
  return sessions;
}
function failure(value: unknown): string {
  switch (record(value)?.status) {
    case "unsupported":
      return "App Mixer unsupported or unavailable on this Connector. Try Refresh.";
    case "invalid_session":
      return "Session closed or restarted. Select a current session.";
    case "invalid_device":
      return "Output removed or changed. Refresh before retrying.";
    case "superseded":
      return "Request superseded; no change confirmed. Fresh state shown.";
    default:
      return "Change failed or could not be verified. Fresh state shown; check Windows before retrying.";
  }
}
type State = {
  generation: number;
  sessions: AudioSession[] | null;
  outputs: Record<string, string>;
  busy: boolean;
  notice: string | null;
};
type Target = { id: string; endpointId: string; value: number };
const empty = { sessions: null, outputs: {}, busy: false, notice: null };
export function useWindowsAppMixer() {
  const [ready, setReady] = useState(getAppReadyState);
  const [state, setState] = useState<State>({
    ...empty,
    generation: ready.generation,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [desired, setDesired] = useState<Target | null>(null);
  const live = useRef(state);
  live.current = state;
  const selection = useRef(selected);
  selection.current = selected;
  const mounted = useRef(false);
  const operation = useRef<object | null>(null);
  const queued = useRef<Target | null>(null);
  const queueVersion = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearQueue = useCallback(() => {
    queueVersion.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    queued.current = null;
    setDesired(null);
  }, []);
  const run = useCallback(
    async (target?: Target, muted?: boolean) => {
      const current = getAppReadyState();
      if (
        !mounted.current ||
        operation.current ||
        !getWindowsConnectorState(current).isWindowsActive
      )
        return;
      if (
        target &&
        (live.current.generation !== current.generation ||
          selection.current !== target.id ||
          !live.current.sessions?.some(
            (s) => s.id === target.id && s.endpointId === target.endpointId,
          ))
      )
        return;
      const token = {};
      operation.current = token;
      const valid = () =>
        mounted.current &&
        operation.current === token &&
        getAppReadyState().generation === current.generation &&
        getWindowsConnectorState(getAppReadyState()).isWindowsActive;
      const options = {
        timeoutMs: 4000,
        appReadyGeneration: current.generation,
      };
      const read = () =>
        sendNocturneWsRequest<unknown>("audio.sessions.list", {}, options);
      setState((previous) => ({ ...previous, busy: true, notice: null }));
      try {
        const response = await read();
        if (!valid()) return;
        let sessions = parseAudioSessions(response);
        if (!sessions)
          throw new Error(
            record(response)?.status === "unsupported"
              ? "unsupported"
              : "Invalid session list",
          );
        let notice: string | null = null;
        if (target) {
          // Preflight uses the exact discovered endpoint/session pair, never app names or PIDs.
          const found = sessions.find(
            (s) => s.id === target.id && s.endpointId === target.endpointId,
          );
          if (!found || selection.current !== target.id) {
            clearQueue();
            notice =
              "Session closed, changed or deselected. Choose a current session.";
          } else {
            let result: Record<string, unknown> | null = null;
            try {
              result = record(
                await sendNocturneWsRequest<unknown>(
                  muted === undefined
                    ? "audio.sessions.set_volume"
                    : "audio.sessions.set_mute",
                  {
                    sessionId: found.id,
                    deviceId: found.endpointId,
                    ...(muted === undefined
                      ? { volumePercent: target.value }
                      : { muted }),
                  },
                  options,
                ),
              );
            } catch (error) {
              if (!valid()) return;
              console.debug("App Mixer mutation outcome unknown:", error);
              notice =
                "Outcome unknown; check Windows before retrying. No automatic retry.";
              clearQueue();
            }
            if (!valid()) return;
            const confirmed =
              result?.status === "ok" &&
              result.error == null &&
              (muted === undefined
                ? typeof result.confirmedVolumePercent === "number" &&
                  Number.isFinite(result.confirmedVolumePercent) &&
                  result.confirmedVolumePercent >= 0 &&
                  result.confirmedVolumePercent <= 100 &&
                  Math.abs(result.confirmedVolumePercent - target.value) <= 2
                : result.confirmedMuted === muted);
            if (!confirmed) {
              notice ??= failure(result);
              clearQueue();
            }
            const snapshot = await read();
            if (!valid()) return;
            sessions = parseAudioSessions(snapshot);
            if (!sessions)
              throw new Error("Readback unavailable; outcome unknown");
            const updated = sessions.find(
              (s) => s.id === target.id && s.endpointId === target.endpointId,
            );
            if (
              confirmed &&
              (!updated ||
                (muted === undefined
                  ? Math.abs(updated.volumePercent - target.value) > 2
                  : updated.muted !== muted))
            ) {
              notice =
                "Session changed after write; requested value not confirmed. Check Windows.";
              clearQueue();
            }
          }
        }
        const outputResponse = await sendNocturneWsRequest<unknown>(
          "audio.outputs.list",
          {},
          options,
        );
        if (!valid()) return;
        const outputs = parseAudioOutputs(outputResponse);
        setState({
          generation: current.generation,
          sessions,
          outputs: Object.fromEntries(
            outputs?.map((o) => [o.id, o.name]) ?? [],
          ),
          busy: false,
          notice,
        });
        if (!sessions.some((s) => s.id === selection.current)) {
          selection.current = null;
          setSelected(null);
          clearQueue();
        }
      } catch (error) {
        if (!valid()) return;
        console.debug("App Mixer unavailable:", error);
        clearQueue();
        const message = error instanceof Error ? error.message : "";
        setState({
          ...empty,
          generation: current.generation,
          notice: /^(unsupported|unknown method|method not found)$/i.test(
            message.trim(),
          )
            ? failure({ status: "unsupported" })
            : "Session state unknown or stale. Refresh before retrying.",
        });
      } finally {
        if (operation.current === token) operation.current = null;
      }
    },
    [clearQueue],
  );
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeAppReadyState(setReady);
    return () => {
      mounted.current = false;
      operation.current = null;
      if (timer.current) clearTimeout(timer.current);
      queued.current = null;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    operation.current = null;
    clearQueue();
    selection.current = null;
    setSelected(null);
    setState({ ...empty, generation: ready.generation });
    if (getWindowsConnectorState(ready).isWindowsActive) void run();
    return () => {
      operation.current = null;
      clearQueue();
    };
  }, [ready.generation, ready.ready, ready.connectorPlatform, run, clearQueue]);
  // Slow snapshots discover app exits and output changes; no overlapping reads.
  useEffect(() => {
    if (
      !getWindowsConnectorState(ready).isWindowsActive ||
      state.busy ||
      desired
    )
      return;
    const poll = setTimeout(() => void run(), 5000);
    return () => clearTimeout(poll);
  }, [ready, state, desired, run]);
  const drain = useRef<() => void>(() => {});
  drain.current = () => {
    timer.current = null;
    if (!queued.current || !mounted.current) return;
    if (operation.current) {
      timer.current = setTimeout(() => drain.current(), 150);
      return;
    }
    const target = queued.current;
    queued.current = null;
    const version = queueVersion.current;
    void run(target).finally(() => {
      if (
        mounted.current &&
        queueVersion.current === version &&
        !queued.current
      )
        setDesired(null);
    });
  };
  const isWindowsActive = getWindowsConnectorState(ready).isWindowsActive;
  return {
    ...(isWindowsActive && state.generation === ready.generation
      ? state
      : empty),
    generation: ready.generation,
    isWindowsActive,
    selected,
    desired,
    select: (id: string) => {
      clearQueue();
      selection.current = id;
      setSelected(id);
    },
    refresh: () => {
      clearQueue();
      return run();
    },
    cancelPending: clearQueue,
    adjust: (delta: number) => {
      if (
        !Number.isFinite(delta) ||
        !getWindowsConnectorState(getAppReadyState()).isWindowsActive ||
        live.current.generation !== getAppReadyState().generation
      )
        return;
      const session = live.current.sessions?.find(
        (s) => s.id === selection.current,
      );
      if (!session) return;
      const base =
        queued.current?.value ??
        (desired?.id === session.id ? desired.value : session.volumePercent);
      const target = {
        id: session.id,
        endpointId: session.endpointId,
        value: Math.max(
          0,
          Math.min(100, Math.round(base + Math.sign(delta) * 2)),
        ),
      };
      queueVersion.current++;
      queued.current = target;
      setDesired(target);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => drain.current(), 150);
    },
    toggleMute: () => {
      const session = live.current.sessions?.find(
        (s) => s.id === selection.current,
      );
      if (!session || operation.current || queued.current) return;
      return run(
        {
          id: session.id,
          endpointId: session.endpointId,
          value: session.volumePercent,
        },
        !session.muted,
      );
    },
  };
}
