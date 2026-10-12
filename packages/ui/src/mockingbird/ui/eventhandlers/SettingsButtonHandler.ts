import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import { runInAction } from "mobx";
import { executeAction } from "../../../utils/actionMapping";
import { getWindowsConnectorState } from "../../../hooks/useWindowsConnector";
import { getAppReadyState } from "../../../hooks/useNocturned";

const reactToSettingsButton = (
  hardwareEvents: HardwareEvents,
  rootStore: RootStore,
) => {
  const { overlayController, settingsStore, viewStore, onboardingStore } =
    rootStore;

  const handleSettings = async () => {
    if (onboardingStore?.isActive) {
      overlayController.toggleSettings();
      return;
    }

    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("settings_press", {
      isWindowsActive,
      viewStore,
    });
    if (actionRes.executed || !actionRes.fallbackToDefault) {
      return;
    }

    runInAction(() => {
      overlayController.toggleSettings();
    });
  };

  const handleSettingsLongPress = async () => {
    if (onboardingStore?.isActive) {
      if (settingsStore) {
        settingsStore.handleSettingsButtonLongPress();
      }
      return;
    }

    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("settings_long_press", {
      isWindowsActive,
      viewStore,
    });
    if (actionRes.executed || !actionRes.fallbackToDefault) {
      return;
    }

    runInAction(() => {
      if (settingsStore) {
        settingsStore.handleSettingsButtonLongPress();
      }
    });
  };

  hardwareEvents.onSettings(() => {
    void handleSettings();
  });
  hardwareEvents.onSettingsLongPress(() => {
    void handleSettingsLongPress();
  });
};

export default reactToSettingsButton;
