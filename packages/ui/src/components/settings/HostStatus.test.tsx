import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import React from "react";
import HostStatus from "./HostStatus";
import {
  connectHostBridge,
  disconnectHostBridge,
  configureHostBridge,
  getHostBridgeState,
} from "../../hooks/useHostBridge";

describe("HostStatus component model and state", () => {
  beforeEach(() => {
    disconnectHostBridge();
    configureHostBridge({ url: "", autoConnect: false });
  });

  afterEach(() => {
    disconnectHostBridge();
  });

  test("initial state is disconnected", () => {
    const state = getHostBridgeState();
    expect(state.connectionState).toBe("disconnected");
    expect(state.hostName).toBeNull();
    expect(state.capabilities).toEqual([]);
  });

  test("connecting state updates connectionState", () => {
    connectHostBridge({ url: "ws://192.168.1.50:8893" });
    const state = getHostBridgeState();
    expect(state.connectionState).toBe("connecting");
  });
});
