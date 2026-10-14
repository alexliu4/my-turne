import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  spyOn,
  mock,
} from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import BluetoothDevices from "./BluetoothDevices";
import * as daemon from "../../../hooks/useNocturned";

// Keep the real discovery lease implementation; replace only the rendered hook's I/O.
describe("Bluetooth pairing Settings lifecycle", () => {
  let root: Root;
  let dom: Window;
  let failure: string | null;
  let coordinator: ReturnType<
    typeof daemon.createBluetoothDiscoveryCoordinator
  >;
  let transitions: boolean[];
  const originals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    dom = new Window({ url: "http://localhost" });
    for (const [key, value] of Object.entries({
      window: dom,
      document: dom.document,
      navigator: dom.navigator,
      HTMLElement: dom.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    transitions = [];
    failure = null;
    coordinator = daemon.createBluetoothDiscoveryCoordinator(
      async (enabled) => {
        transitions.push(enabled);
        if (enabled && failure) throw new Error(failure);
      },
    );
    spyOn(daemon, "useBluetooth").mockImplementation(() => {
      const [discoveryError, setError] = React.useState<string | null>(null);
      const owner = React.useRef(Symbol("settings"));
      React.useEffect(() => coordinator.subscribe(setError), []);
      const fetchDevices = React.useCallback(async () => [], []);
      const startDiscovery = React.useCallback(async () => {
        try {
          await coordinator.acquire(owner.current);
          return true;
        } catch (error) {
          console.error("Pairing activation failed", error);
          return false;
        }
      }, []);
      const stopDiscovery = React.useCallback(async () => {
        await coordinator.release(owner.current);
      }, []);
      return {
        devices: [],
        loading: false,
        error: null,
        discoveryError,
        fetchDevices,
        startDiscovery,
        stopDiscovery,
        connected: false,
        wsConnected: false,
        connectedDevices: [],
        activeSessionDevices: [],
        hasFetchedInitialDevices: true,
        isConnecting: false,
        lastConnectedDevice: null,
        reconnectAttempt: 0,
        isReconnectPending: false,
        pairingRequest: null,
        acceptPairing: async () => {},
        denyPairing: async () => {},
        setDiscoverable: async () => {},
        connectDevice: async () => false,
        connectDeviceNoRetry: async () => false,
        disconnectDevice: async () => false,
        forgetDevice: async () => false,
        enableNetworking: async () => {},
        attemptReconnect: async () => {},
        stopRetrying: () => {},
      };
    });
    spyOn(daemon, "useDeviceInfo").mockReturnValue({
      deviceInfo: null,
      isLoading: false,
      error: null,
      refetch: async () => {},
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    mock.restore();
    await dom.happyDOM.cancelAsync();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  test("opens on mount and closes only after overlapping owners leave", async () => {
    const other = Symbol("other pairing surface");
    await coordinator.acquire(other);
    await act(async () => root.render(<BluetoothDevices />));
    expect(transitions).toEqual([true]);
    await act(async () => root.render(null));
    expect(transitions).toEqual([true]);
    await coordinator.release(other);
    expect(transitions).toEqual([true, false]);
  });
  test("shows an actionable activation failure, retries, and closes on exit", async () => {
    failure = "BlueZ unavailable";
    await act(async () => root.render(<BluetoothDevices />));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "BlueZ unavailable",
    );
    failure = null;
    const retry = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry pairing",
    );
    if (!retry) throw new Error("Retry pairing missing");
    await act(async () => retry.click());
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.render(null));
    expect(transitions).toEqual([true, true, false]);
  });
});
