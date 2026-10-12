import { afterEach, beforeEach, expect, test, spyOn, mock } from "bun:test";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import ViewStore, { View } from "./stores/ViewStore";
import SettingsStore, {
  MainMenuItemId,
  OptionsMenuItemId,
} from "./stores/SettingsStore";
import { ViewLayers } from "./components/Views/ViewLayers";
import ActionMapping from "./components/Settings/ActionMapping/ActionMapping";
import * as daemon from "../../hooks/useNocturned";
import {
  setActionMapping,
  getActionMapping,
  executeAction,
  navigateToSection,
  SUPPORTED_APP_IDS,
} from "../../utils/actionMapping";
import reactToDial from "./eventhandlers/DialHandler";
import reactToBack from "./eventhandlers/BackButtonHandler";
import reactToPresets from "./eventhandlers/PresetButtonHandler";
import reactToSettings from "./eventhandlers/SettingsButtonHandler";

let dom, restore;
beforeEach(() => {
  spyOn(daemon, "sendNocturneWsRequest").mockResolvedValue({});
  dom = new Window({ url: "http://localhost" });
  const entries = {
    window: dom,
    document: dom.document,
    localStorage: dom.localStorage,
    CustomEvent: dom.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = Object.keys(entries).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]);
  for (const [key, value] of Object.entries(entries))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  restore = () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
});
afterEach(async () => {
  await dom.happyDOM.cancelAsync();
  mock.restore();
  restore();
});

function fixture() {
  const calls = [];
  const native = (name) => () => calls.push(name);
  const root = {
    viewStore: {
      appView: "MAIN",
      currentView: "npv",
      showNpv: native("mapped npv"),
      back: native("native back"),
    },
    onboardingStore: { isActive: false },
    setupStore: { shouldShowSetup: false },
    otaStore: { criticalUpdate: false },
    overlayController: {
      anyOverlayIsShowing: false,
      isSettingsShowing: false,
      isShowing: () => false,
      toggleSettings: native("settings"),
    },
    settingsStore: {
      handleBack: native("settings back"),
      handleDialPress: native("settings dial"),
      handleDialLeft() {},
      handleDialRight() {},
      handleSettingsButtonLongPress: native("settings long"),
    },
    voiceStore: {},
    shelfStore: {},
    tracklistStore: {},
    queueStore: {},
    hardwareStore: {},
    ubiLogger: {},
    npvStore: {
      npvController: {
        handleBackButton: native("native back"),
        handleDialPress: native("native dial"),
        handleDialLongPress: native("native long"),
        handleDialLeft: native("native left"),
        handleDialRight: native("native right"),
      },
    },
    presetsController: {
      isPresetButtonsEnabled: true,
      presetsUiState: {
        handlePresetButtonPress: native("native preset"),
        handlePresetButtonLongPress() {},
      },
    },
  };
  const handlers = {};
  const events = new Proxy(
    {},
    {
      get: (_, name) => (callback) => {
        handlers[name] = callback;
      },
    },
  );
  reactToDial(events, root);
  reactToBack(events, root);
  reactToPresets(events, root);
  reactToSettings(events, root);
  return { root, handlers, calls };
}
const events = [
  ["dial_press", "onDialPress"],
  ["dial_long_press", "onDialLongPress"],
  ["dial_turn_left", "onDialLeft"],
  ["dial_turn_right", "onDialRight"],
  ["back_press", "onBack"],
  ["preset_1", "onPreset1"],
  ["settings_long_press", "onSettingsLongPress"],
];
for (const protectedState of [
  "setup",
  "ota",
  "onboarding",
  "call",
  "voice",
  "lets_drive",
  "settings",
  "critical overlay",
  "shell setup",
]) {
  test(`${protectedState} protects every mapped hardware handler`, async () => {
    for (const [trigger, event] of events) {
      const { root, handlers, calls } = fixture();
      expect(
        setActionMapping(trigger, {
          kind: "device",
          action: "navigate.now_playing",
        }).success,
      ).toBe(true);
      if (protectedState === "shell setup")
        root.mappingSystemScreenActive = true;
      else if (protectedState === "setup")
        root.setupStore.shouldShowSetup = true;
      else if (protectedState === "ota") root.otaStore.criticalUpdate = true;
      else if (protectedState === "onboarding")
        root.viewStore.appView = "ONBOARDING";
      else if (protectedState === "settings")
        root.overlayController.isSettingsShowing = true;
      else {
        root.overlayController.anyOverlayIsShowing = true;
        root.overlayController.currentOverlay = protectedState;
      }
      await handlers[event]();
      await Promise.resolve();
      expect(calls).not.toContain("mapped npv");
    }
  });
}

test("short Settings remains reachable even with a legacy persisted remap", async () => {
  const { handlers, calls } = fixture();
  expect(
    setActionMapping("settings_press", {
      kind: "device",
      action: "navigate.now_playing",
    }).success,
  ).toBe(false);
  localStorage.setItem(
    "nocturne_action_mappings:no-device",
    JSON.stringify({
      settings_press: { kind: "device", action: "navigate.now_playing" },
    }),
  );
  expect(getActionMapping("settings_press")).toEqual({ kind: "default" });
  await handlers.onSettings();
  expect(calls).toEqual(["settings"]);
});

test("Mockingbird app destinations explicitly fail without pushing an invisible view", async () => {
  const { root, calls } = fixture();
  for (const appId of SUPPORTED_APP_IDS) {
    setActionMapping("preset_1", {
      kind: "device",
      action: "app.launch",
      appId,
    });
    const result = await executeAction("preset_1", {
      viewStore: root.viewStore,
    });
    expect(result.executed).toBe(false);
    expect(result.fallbackToDefault).toBe(false);
    expect(result.reason).toBe("unsupported_destination");
  }
  expect(calls).toEqual([]);
  expect(navigateToSection("nowPlaying", { viewStore: {} })).toBe(false);
});

test("mapped home and now-playing render destination content through the production view layers", async () => {
  const root = {
    setupStore: { hasStatusMessage: true },
    onboardingStore: { onboardingMsgReceived: true },
    persistentStorage: { seeded: true },
    hardwareStore: {},
    otaStore: {},
  };
  const store = new ViewStore(root);
  for (const [action, expected] of [
    ["navigate.home", View.CONTENT_SHELF],
    ["navigate.now_playing", View.NPV],
  ]) {
    setActionMapping("preset_1", { kind: "device", action });
    expect(
      (await executeAction("preset_1", { viewStore: store })).executed,
    ).toBe(true);
    const markup = renderToStaticMarkup(
      createElement(ViewLayers, {
        currentView: store.currentView,
        views: [
          {
            name: View.CONTENT_SHELF,
            component: createElement("p", null, "Visible home destination"),
          },
          {
            name: View.NPV,
            component: createElement("p", null, "Visible player destination"),
          },
        ],
      }),
    );
    expect(markup).toContain(
      expected === View.NPV
        ? "Visible player destination"
        : "Visible home destination",
    );
    expect(markup).not.toContain(
      expected === View.NPV
        ? "Visible home destination"
        : "Visible player destination",
    );
  }
});

test("Mockingbird Settings includes a reachable mapping page with reset recovery", () => {
  const store = new SettingsStore({ nightModeController: {} });
  const options = store.settings.rows.find(
    (row) => row.id === MainMenuItemId.OPTIONS,
  );
  const page = options.rows.find(
    (row) => row.id === OptionsMenuItemId.ACTION_MAPPING,
  );
  store.gotoView(page);
  expect(store.currentView.id).toBe(OptionsMenuItemId.ACTION_MAPPING);
  const markup = renderToStaticMarkup(createElement(ActionMapping));
  expect(markup).toContain("Reset All Controls to Default");
  expect(markup).toContain("Short Settings press always opens Settings");
  expect(markup).not.toContain("Launch Weather");
});

test("Mockingbird touch configuration saves mappings and reset restores controls", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(ActionMapping)));
    const action = container.querySelector('[aria-label="Assigned action"]');
    await act(async () => {
      action.value = JSON.stringify({
        kind: "device",
        action: "navigate.home",
      });
      action.dispatchEvent(new dom.Event("change", { bubbles: true }));
    });
    expect(getActionMapping("preset_1")).toEqual({
      kind: "device",
      action: "navigate.home",
    });
    await act(async () => container.querySelector("button").click());
    expect(getActionMapping("preset_1")).toEqual({ kind: "default" });
    expect(container.textContent).toContain("Controls restored to defaults");
  } finally {
    await act(async () => root.unmount());
  }
});

test("presets never play or overwrite saved content beneath protected screens", async () => {
  const { root, handlers, calls } = fixture();
  root.setupStore.shouldShowSetup = true;
  await handlers.onPreset1();
  await handlers.onPreset1LongPress();
  expect(calls).toEqual([]);
});

test("reserved Settings allows setup recovery but respects OTA and critical modals", async () => {
  const { root, handlers, calls } = fixture();
  root.setupStore.shouldShowSetup = true;
  await handlers.onSettings();
  expect(calls).toEqual(["settings"]);
  root.otaStore.criticalUpdate = true;
  await handlers.onSettings();
  expect(calls).toEqual(["settings"]);
  root.otaStore.criticalUpdate = false;
  root.overlayController.anyOverlayIsShowing = true;
  root.overlayController.currentOverlay = "phone_call";
  await handlers.onSettings();
  expect(calls).toEqual(["settings"]);
});
