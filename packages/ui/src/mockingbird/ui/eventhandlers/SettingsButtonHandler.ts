import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import { action } from "mobx";
import { executeAction } from "../../../utils/actionMapping";
import { getWindowsConnectorState } from "../../../hooks/useWindowsConnector";
import { getAppReadyState } from "../../../hooks/useNocturned";

const reactToSettingsButton = (
  hardwareEvents: HardwareEvents,
  rootStore: RootStore,
) => {
  const { overlayController, settingsStore, viewStore } = rootStore;

  const handleSettings = action(async () => {
    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("settings_press", {
      isWindowsActive,
      setActiveSection: (sec) => {
        if (sec === "recents" || sec === "home" || sec === "shelf") {
          viewStore.showContentShelf();
        } else if (sec === "nowPlaying" || sec === "npv") {
          viewStore.showNpv();
        } else {
          viewStore.showView(sec);
        }
      },
    });
    if (actionRes.executed || !actionRes.fallbackToDefault) {
      return;
    }

    overlayController.toggleSettings();
  });

  const handleSettingsLongPress = action(async () => {
    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("settings_long_press", {
      isWindowsActive,
      setActiveSection: (sec) => {
        if (sec === "recents" || sec === "home" || sec === "shelf") {
          viewStore.showContentShelf();
        } else if (sec === "nowPlaying" || sec === "npv") {
          viewStore.showNpv();
        } else {
          viewStore.showView(sec);
        }
      },
    });
    if (actionRes.executed || !actionRes.fallbackToDefault) {
      return;
    }

    if (settingsStore) {
      settingsStore.handleSettingsButtonLongPress();
    }
  });

  hardwareEvents.onSettings(handleSettings);
  hardwareEvents.onSettingsLongPress(handleSettingsLongPress);
};

export default reactToSettingsButton;
