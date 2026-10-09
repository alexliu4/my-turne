import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  PhoneCallStartedEvent,
  PhoneCallUpdatedEvent,
  PhoneCallsGetResponse,
} from "@schema/phone";
import { addGlobalWsListener, sendNocturneWsRequest } from "./useNocturned";
import type { UnknownRecord, WsMessage } from "../types";

export type PhoneCall = PhoneCallStartedEvent | PhoneCallUpdatedEvent;
export type PhoneCallAction = "accept" | "decline";
export type PendingPhoneCallAction = {
  callKey: string;
  action: PhoneCallAction;
};

export type PhoneCallOverlayProps = {
  call: PhoneCall | null;
  pendingAction: PendingPhoneCallAction | null;
  error: string | null;
  onAccept: () => void | Promise<boolean>;
  onDecline: () => void | Promise<boolean>;
};

export type PhoneCallState = {
  calls: Record<string, PhoneCall>;
  order: string[];
};

type PhoneCallStateAction =
  | { type: "replace"; calls: PhoneCall[] }
  | { type: "replaceDevice"; device: string; calls: PhoneCall[] }
  | { type: "upsert"; call: PhoneCall }
  | { type: "remove"; callId: string; device: string }
  | { type: "clear" };

const EMPTY_STATE: PhoneCallState = { calls: {}, order: [] };
const ACTION_REQUEST_TIMEOUT_MS = 5000;
const ACTION_SETTLE_TIMEOUT_MS = 10000;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;

const readString = (
  value: UnknownRecord,
  camelKey: string,
  snakeKey = camelKey,
) => {
  const candidate = value[camelKey] ?? value[snakeKey];
  return typeof candidate === "string" ? candidate : null;
};

export const phoneCallKey = (call: Pick<PhoneCall, "device" | "callId">) =>
  `${call.device}:${call.callId}`;

export const normalizePhoneCall = (value: unknown): PhoneCall | null => {
  const call = asRecord(value);
  if (!call) return null;

  const callId = readString(call, "callId", "call_id");
  const device = readString(call, "device");
  const status = readString(call, "status");
  const direction = readString(call, "direction");
  if (!callId || !device || !status || !direction) return null;

  const label = readString(call, "label");
  const service = readString(call, "service");
  const startedAt = call.startedAtUnixS ?? call.started_at_unix_s;

  return {
    callId,
    device,
    remoteId: readString(call, "remoteId", "remote_id") ?? "",
    displayName: readString(call, "displayName", "display_name") ?? "",
    status,
    direction,
    ...(label ? { label } : {}),
    ...(service ? { service } : {}),
    ...(typeof startedAt === "number" ? { startedAtUnixS: startedAt } : {}),
  };
};

export const phoneCallReducer = (
  state: PhoneCallState,
  action: PhoneCallStateAction,
): PhoneCallState => {
  if (action.type === "clear") return EMPTY_STATE;

  if (action.type === "replaceDevice") {
    return phoneCallReducer(state, {
      type: "replace",
      calls: [
        ...state.order
          .map((key) => state.calls[key])
          .filter((call) => call.device !== action.device),
        ...action.calls,
      ],
    });
  }

  if (action.type === "replace") {
    const calls: Record<string, PhoneCall> = {};
    const order: string[] = [];
    action.calls.forEach((call) => {
      const key = phoneCallKey(call);
      calls[key] = call;
      order.push(key);
    });
    return { calls, order };
  }

  if (action.type === "remove") {
    const key = `${action.device}:${action.callId}`;
    if (!state.calls[key]) return state;
    const calls = { ...state.calls };
    delete calls[key];
    return {
      calls,
      order: state.order.filter((candidate) => candidate !== key),
    };
  }

  const key = phoneCallKey(action.call);
  return {
    calls: { ...state.calls, [key]: action.call },
    order: state.calls[key] ? state.order : [...state.order, key],
  };
};

export const selectIncomingCall = (state: PhoneCallState): PhoneCall | null => {
  for (let index = state.order.length - 1; index >= 0; index -= 1) {
    const call = state.calls[state.order[index]];
    if (call?.direction === "incoming" && call.status === "ringing") {
      return call;
    }
  }
  return null;
};

export const selectPresentedPhoneCall = (
  call: PhoneCall | null,
  enabled: boolean,
) => (enabled ? call : null);

export const beginPhoneCallAction = (
  pending: PendingPhoneCallAction | null,
  call: PhoneCall,
  action: PhoneCallAction,
): PendingPhoneCallAction | null =>
  pending ? null : { callKey: phoneCallKey(call), action };

export const isCurrentPhoneCallAction = (
  current: PendingPhoneCallAction | null,
  candidate: PendingPhoneCallAction,
) => current === candidate;

export const shouldRefreshPhoneCallSnapshot = (message: WsMessage) => {
  if (message.type !== "event") return false;
  if (message.topic !== "app.ready" && message.topic !== "phone.session.ready")
    return false;
  const ready = asRecord(message.data);
  if (
    !ready ||
    ready.connectorPlatform !== undefined ||
    ready.connector_platform !== undefined
  )
    return false;
  const platform = readString(ready, "platform");
  return platform === "android" || platform === "ios";
};

const normalizeSnapshot = (response: PhoneCallsGetResponse | unknown) => {
  const snapshot = asRecord(response);
  const calls = snapshot?.calls;
  if (!Array.isArray(calls)) return [];
  return calls
    .map(normalizePhoneCall)
    .filter((call): call is PhoneCall => call !== null);
};

// Each device's revision gate covers snapshot requests and live call updates. A new
// readiness always refreshes, including a reconnect while an older read is pending.
export const createPhoneCallSnapshotRefresher = (
  request: (device: string) => Promise<unknown>,
  apply: (calls: PhoneCall[], device: string) => void,
  legacyDevice: () => string | null,
) => {
  let revision = 0;
  const currentRequests = new Map<string, number>();
  let modernReadiness = false;
  let legacyPendingDevice: string | null = null;
  return {
    invalidate: (device?: string) => {
      if (device) currentRequests.delete(device);
      else currentRequests.clear();
      legacyPendingDevice = null;
    },
    reset: () => {
      currentRequests.clear();
      modernReadiness = false;
      legacyPendingDevice = null;
    },
    onMessage: async (message: WsMessage) => {
      if (!shouldRefreshPhoneCallSnapshot(message)) return;
      const ready = asRecord(message.data);
      const modern = message.topic === "phone.session.ready";
      if (!modern && modernReadiness) return;
      const device = ready ? readString(ready, "device") : null;
      const target = modern ? device : device || legacyDevice();
      if (!target) return;
      if (modern) modernReadiness = true;
      else if (legacyPendingDevice === target) return;
      if (!modern) legacyPendingDevice = target;
      const current = ++revision;
      currentRequests.set(target, current);
      try {
        const response = await request(target);
        if (currentRequests.get(target) !== current) return;
        const snapshot = asRecord(response);
        if (!Array.isArray(snapshot?.calls)) return;
        apply(
          normalizeSnapshot(response).filter((call) => call.device === target),
          target,
        );
      } catch (error) {
        // A failed read must never erase valid calls, including another phone's.
        console.warn("Failed to refresh phone calls", error);
      } finally {
        if (!modern && currentRequests.get(target) === current)
          legacyPendingDevice = null;
      }
    },
  };
};

export function usePhoneCalls() {
  const [state, dispatch] = useReducer(phoneCallReducer, EMPTY_STATE);
  const [pendingAction, setPendingAction] =
    useState<PendingPhoneCallAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<PendingPhoneCallAction | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePending = useCallback(
    (pending: PendingPhoneCallAction | null) => {
      pendingRef.current = pending;
      setPendingAction(pending);
    },
    [],
  );

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const clearPending = useCallback(() => {
    clearSettleTimer();
    updatePending(null);
  }, [clearSettleTimer, updatePending]);

  const applySnapshot = useCallback(
    (calls: PhoneCall[], device: string) => {
      dispatch({ type: "replaceDevice", calls, device });
      const pending = pendingRef.current;
      if (
        pending &&
        pending.callKey.startsWith(`${device}:`) &&
        !calls.some(
          (call) =>
            phoneCallKey(call) === pending.callKey && call.status === "ringing",
        )
      ) {
        clearPending();
      }
      if (
        !calls.some(
          (call) => call.direction === "incoming" && call.status === "ringing",
        )
      ) {
        setError(null);
      }
    },
    [clearPending],
  );

  useEffect(() => {
    const snapshots = createPhoneCallSnapshotRefresher(
      (device) =>
        sendNocturneWsRequest<PhoneCallsGetResponse>(
          "phone.calls.get",
          { device },
          { timeoutMs: ACTION_REQUEST_TIMEOUT_MS },
        ),
      applySnapshot,
      () => localStorage.getItem("lastConnectedBluetoothDevice"),
    );

    const removeListener = addGlobalWsListener("native-phone-calls", {
      onClose: () => {
        snapshots.reset();
        clearPending();
        setError(null);
        dispatch({ type: "clear" });
      },
      onMessage: (message: WsMessage) => {
        if (message.type !== "event") return;

        if (shouldRefreshPhoneCallSnapshot(message)) {
          void snapshots.onMessage(message);
          return;
        }

        if (
          message.topic === "phone.call.started" ||
          message.topic === "phone.call.updated"
        ) {
          const call = normalizePhoneCall(message.data);
          if (!call) return;
          snapshots.invalidate(call.device);
          if (message.topic === "phone.call.started") setError(null);
          dispatch({ type: "upsert", call });
          if (
            pendingRef.current?.callKey === phoneCallKey(call) &&
            call.status !== "ringing"
          ) {
            clearPending();
          }
          return;
        }

        if (message.topic === "phone.call.ended") {
          const ended = asRecord(message.data);
          if (!ended) return;
          const callId = readString(ended, "callId", "call_id");
          const device = readString(ended, "device");
          if (!callId || !device) return;
          snapshots.invalidate(device);
          dispatch({ type: "remove", callId, device });
          if (pendingRef.current?.callKey === `${device}:${callId}`) {
            clearPending();
          }
          setError(null);
        }
      },
    });

    return () => {
      snapshots.reset();
      removeListener();
      clearSettleTimer();
    };
  }, [clearPending, clearSettleTimer, applySnapshot]);

  const incomingCall = useMemo(() => {
    const pendingCall = pendingAction
      ? state.calls[pendingAction.callKey]
      : null;
    if (
      pendingCall?.direction === "incoming" &&
      pendingCall.status === "ringing"
    ) {
      return pendingCall;
    }
    return selectIncomingCall(state);
  }, [pendingAction, state]);

  const performAction = useCallback(
    async (action: PhoneCallAction, call: PhoneCall | null) => {
      if (!call) return false;
      const pending = beginPhoneCallAction(pendingRef.current, call, action);
      if (!pending) return false;

      clearSettleTimer();
      setError(null);
      updatePending(pending);
      try {
        await sendNocturneWsRequest(
          action === "accept" ? "phone.call.accept" : "phone.call.decline",
          { call_id: call.callId, device: call.device },
          { timeoutMs: ACTION_REQUEST_TIMEOUT_MS },
        );
        if (!isCurrentPhoneCallAction(pendingRef.current, pending)) {
          return true;
        }
        settleTimerRef.current = setTimeout(() => {
          if (isCurrentPhoneCallAction(pendingRef.current, pending)) {
            updatePending(null);
            setError("The phone did not confirm the call action. Try again.");
          }
        }, ACTION_SETTLE_TIMEOUT_MS);
        return true;
      } catch (actionError) {
        if (!isCurrentPhoneCallAction(pendingRef.current, pending)) {
          return false;
        }
        clearPending();
        setError(
          actionError instanceof Error
            ? actionError.message
            : "The call action failed. Try again.",
        );
        return false;
      }
    },
    [clearPending, clearSettleTimer, updatePending],
  );

  const accept = useCallback(
    () => performAction("accept", incomingCall),
    [incomingCall, performAction],
  );
  const decline = useCallback(
    () => performAction("decline", incomingCall),
    [incomingCall, performAction],
  );

  return { incomingCall, pendingAction, error, accept, decline };
}
