import {
  isMappingProtected,
  isHardwareActionBlocked,
} from "./mappingProtection";
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
  const { overlayController, settingsStore, viewStore } = rootStore;

  const handleSettings = () => {
    if (isHardwareActionBlocked(rootStore, true)) return;
    runInAction(() => overlayController.toggleSettings());
  };

  const handleSettingsLongPress = async () => {
    if (isHardwareActionBlocked(rootStore)) return;
    if (isMappingProtected(rootStore)) {
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
