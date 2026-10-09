import { describe, expect, test } from "bun:test";
import {
  beginPhoneCallAction,
  createPhoneCallSnapshotRefresher,
  isCurrentPhoneCallAction,
  normalizePhoneCall,
  phoneCallKey,
  phoneCallReducer,
  selectIncomingCall,
  selectPresentedPhoneCall,
  shouldRefreshPhoneCallSnapshot,
} from "./usePhoneCalls";

const incomingCall = (overrides = {}) => ({
  callId: "call-1",
  device: "AA:BB:CC:DD:EE:FF",
  remoteId: "+15555550100",
  displayName: "Test Caller",
  status: "ringing",
  direction: "incoming",
  service: "telephony",
  ...overrides,
});

describe("phone call normalization", () => {
  test("normalizes native snake-case call snapshots", () => {
    expect(
      normalizePhoneCall({
        call_id: "call-1",
        device: "AA:BB:CC:DD:EE:FF",
        remote_id: "+15555550100",
        display_name: "Test Caller",
        status: "ringing",
        direction: "incoming",
        started_at_unix_s: 1777777777,
      }),
    ).toEqual({
      callId: "call-1",
      device: "AA:BB:CC:DD:EE:FF",
      remoteId: "+15555550100",
      displayName: "Test Caller",
      status: "ringing",
      direction: "incoming",
      startedAtUnixS: 1777777777,
    });
  });

  test("accepts generated camel-case call snapshots", () => {
    expect(normalizePhoneCall(incomingCall())).toEqual(incomingCall());
  });

  test("rejects snapshots without routing or lifecycle identity", () => {
    expect(normalizePhoneCall({ status: "ringing" })).toBeNull();
    expect(
      normalizePhoneCall({
        call_id: "call-1",
        status: "ringing",
        direction: "incoming",
      }),
    ).toBeNull();
  });
});

describe("phone call lifecycle", () => {
  test("refreshes only on phone readiness, not Bluetooth establishment", () => {
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "app.ready",
        data: { platform: "android" },
      }),
    ).toBe(true);
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "app.ready",
        data: { platform: "ios" },
      }),
    ).toBe(true);
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "app.ready",
        data: { platform: "web" },
      }),
    ).toBe(false);
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "bluetooth.connection",
        data: { event: "connection_established", connection_type: "generic" },
      }),
    ).toBe(false);
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "bluetooth.connection",
        data: { event: "connection_established", connection_type: "iap2" },
      }),
    ).toBe(false);
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "bluetooth.connection",
        data: {
          event: "connection_established",
          connection_type: "macos_connector",
        },
      }),
    ).toBe(false);
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "phone.call.started",
        data: incomingCall(),
      }),
    ).toBe(false);
  });

  test("keeps lifecycle state while presentation is disabled", () => {
    const call = incomingCall();

    expect(selectPresentedPhoneCall(call, false)).toBeNull();
    expect(selectPresentedPhoneCall(call, true)).toBe(call);
  });

  test("hydrates a ringing call from a snapshot replacement", () => {
    const state = phoneCallReducer(
      { calls: {}, order: [] },
      { type: "replace", calls: [incomingCall()] },
    );

    expect(selectIncomingCall(state)).toEqual(incomingCall());
  });

  test("keeps the newest ringing incoming call and ignores outgoing calls", () => {
    let state = { calls: {}, order: [] };
    state = phoneCallReducer(state, {
      type: "upsert",
      call: incomingCall({ callId: "outgoing", direction: "outgoing" }),
    });
    state = phoneCallReducer(state, {
      type: "upsert",
      call: incomingCall({ callId: "first", displayName: "First" }),
    });
    state = phoneCallReducer(state, {
      type: "upsert",
      call: incomingCall({ callId: "second", displayName: "Second" }),
    });

    expect(selectIncomingCall(state)?.displayName).toBe("Second");
  });

  test("removes a disconnected call without disturbing another call", () => {
    const first = incomingCall({ callId: "first" });
    const second = incomingCall({ callId: "second" });
    let state = phoneCallReducer(
      { calls: {}, order: [] },
      { type: "replace", calls: [first, second] },
    );

    state = phoneCallReducer(state, {
      type: "remove",
      callId: "second",
      device: second.device,
    });

    expect(selectIncomingCall(state)).toEqual(first);
    expect(state.calls[phoneCallKey(second)]).toBeUndefined();
  });

  test("blocks a second action while the first action is pending", () => {
    const call = incomingCall();
    const pending = beginPhoneCallAction(null, call, "accept");

    expect(pending).toEqual({ callKey: phoneCallKey(call), action: "accept" });
    expect(beginPhoneCallAction(pending, call, "decline")).toBeNull();
  });

  test("does not let a stale request settle a newer call action", () => {
    const call = incomingCall();
    const stale = beginPhoneCallAction(null, call, "accept");
    const current = beginPhoneCallAction(null, call, "decline");

    expect(stale).not.toBeNull();
    expect(current).not.toBeNull();
    expect(isCurrentPhoneCallAction(current, stale)).toBe(false);
    expect(isCurrentPhoneCallAction(current, current)).toBe(true);
  });
});

const readiness = (device, platform = "android") => ({
  type: "event",
  topic: "phone.session.ready",
  data: { device, platform },
});
const legacyReady = (platform = "android") => ({
  type: "event",
  topic: "app.ready",
  data: { platform },
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("phone snapshot readiness", () => {
  test("uses the observed phone instead of stale storage and refreshes same-phone reconnects", async () => {
    const device = incomingCall().device;
    const targets = [];
    const applied = [];
    const refresher = createPhoneCallSnapshotRefresher(
      async (target) => {
        targets.push(target);
        return { calls: [incomingCall()] };
      },
      (calls, target) => applied.push({ calls, target }),
      () => "11:22:33:44:55:66",
    );
    await refresher.onMessage(readiness(device));
    await refresher.onMessage(legacyReady());
    await refresher.onMessage(readiness(device));
    await refresher.onMessage(legacyReady());
    expect(targets).toEqual([device, device]);
    expect(applied).toEqual([
      { calls: [incomingCall()], target: device },
      { calls: [incomingCall()], target: device },
    ]);
  });

  test("ignores desktops, missing identity and transport establishment", async () => {
    const targets = [];
    const refresher = createPhoneCallSnapshotRefresher(
      async (device) => {
        targets.push(device);
        return { calls: [] };
      },
      () => {},
      () => incomingCall().device,
    );
    for (const message of [
      legacyReady("web"),
      {
        type: "event",
        topic: "app.ready",
        data: { platform: "android", connectorPlatform: "windows" },
      },
      {
        type: "event",
        topic: "app.ready",
        data: { platform: "ios", connectorPlatform: "macos" },
      },
      readiness(incomingCall().device, "web"),
      readiness(null),
      {
        type: "event",
        topic: "bluetooth.connection",
        data: {
          event: "connection_established",
          device: incomingCall().device,
          connection_type: "generic",
        },
      },
      {
        type: "event",
        topic: "bluetooth.connection",
        data: {
          event: "connection_established",
          device: incomingCall().device,
          connection_type: "iap2",
          device_type: "iphone",
        },
      },
    ])
      await refresher.onMessage(message);
    expect(targets).toEqual([]);
  });

  test("retains legacy phone app.ready and coalesces overlapping legacy reads", async () => {
    for (const platform of ["android", "ios"]) {
      const pending = deferred();
      const targets = [];
      const refresher = createPhoneCallSnapshotRefresher(
        (device) => {
          targets.push(device);
          return pending.promise;
        },
        () => {},
        () => incomingCall().device,
      );
      const first = refresher.onMessage(legacyReady(platform));
      await refresher.onMessage(legacyReady(platform));
      expect(targets).toEqual([incomingCall().device]);
      pending.resolve({ calls: [] });
      await first;
      await refresher.onMessage(legacyReady(platform));
      expect(targets).toHaveLength(2);
    }
  });

  test("ignores old responses and failures without clearing newer snapshots", async () => {
    for (const failOld of [false, true]) {
      const old = deferred();
      const newer = deferred();
      const applied = [];
      let requests = 0;
      const refresher = createPhoneCallSnapshotRefresher(
        () => (++requests === 1 ? old.promise : newer.promise),
        (calls) => applied.push(calls),
        () => null,
      );
      const first = refresher.onMessage(readiness(incomingCall().device));
      const second = refresher.onMessage(
        readiness(incomingCall().device, "ios"),
      );
      newer.resolve({ calls: [incomingCall()] });
      await second;
      if (failOld) old.reject(new Error("old phone disconnected"));
      else old.resolve({ calls: [] });
      await first;
      expect(applied).toEqual([[incomingCall()]]);
    }
  });

  test("live events and socket close invalidate pending snapshots", async () => {
    for (const action of ["invalidate", "reset"]) {
      const pending = deferred();
      const applied = [];
      const refresher = createPhoneCallSnapshotRefresher(
        () => pending.promise,
        (calls) => applied.push(calls),
        () => null,
      );
      const request = refresher.onMessage(readiness(incomingCall().device));
      refresher[action]();
      pending.resolve({ calls: [] });
      await request;
      expect(applied).toEqual([]);
    }
  });

  test("a device snapshot preserves another phone's valid calls", () => {
    const other = incomingCall({ device: "11:22:33:44:55:66" });
    const state = phoneCallReducer(
      { calls: {}, order: [] },
      {
        type: "replace",
        calls: [incomingCall(), other],
      },
    );
    const refreshed = phoneCallReducer(state, {
      type: "replaceDevice",
      device: incomingCall().device,
      calls: [],
    });
    expect(Object.values(refreshed.calls)).toEqual([other]);
  });
});
