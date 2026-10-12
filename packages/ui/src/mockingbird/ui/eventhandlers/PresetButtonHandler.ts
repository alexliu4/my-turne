import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import { action } from "mobx";
import {
  executeAction,
  type ControlTrigger,
} from "../../../utils/actionMapping";
import { getWindowsConnectorState } from "../../../hooks/useWindowsConnector";
import { getAppReadyState } from "../../../hooks/useNocturned";

const reactToPresetButtons = (
  hardwareEvents: HardwareEvents,
  rootStore: RootStore,
) => {
  const { presetsController, viewStore } = rootStore;

  const handlePresetButtonPress = async (presetNumber: number) => {
    if (!presetsController.isPresetButtonsEnabled) {
      return;
    }

    const trigger = `preset_${presetNumber}` as ControlTrigger;
    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction(trigger, {
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

    presetsController.presetsUiState.handlePresetButtonPress(presetNumber);
  };

  const handlePresetButtonLongPress = (presetNumber: number) => {
    if (!presetsController.isPresetButtonsEnabled) {
      return;
    }

    presetsController.presetsUiState.handlePresetButtonLongPress(presetNumber);
  };

  const handlePreset1 = action(() => {
    handlePresetButtonPress(1);
  });

  const handlePreset1LongPress = action(() => {
    handlePresetButtonLongPress(1);
  });

  const handlePreset2 = action(() => {
    handlePresetButtonPress(2);
  });

  const handlePreset2LongPress = action(() => {
    handlePresetButtonLongPress(2);
  });

  const handlePreset3 = action(() => {
    handlePresetButtonPress(3);
  });

  const handlePreset3LongPress = action(() => {
    handlePresetButtonLongPress(3);
  });

  const handlePreset4 = action(() => {
    handlePresetButtonPress(4);
  });

  const handlePreset4LongPress = action(() => {
    handlePresetButtonLongPress(4);
  });

  hardwareEvents.onPreset1(handlePreset1);
  hardwareEvents.onPreset1LongPress(handlePreset1LongPress);
  hardwareEvents.onPreset2(handlePreset2);
  hardwareEvents.onPreset2LongPress(handlePreset2LongPress);
  hardwareEvents.onPreset3(handlePreset3);
  hardwareEvents.onPreset3LongPress(handlePreset3LongPress);
  hardwareEvents.onPreset4(handlePreset4);
  hardwareEvents.onPreset4LongPress(handlePreset4LongPress);
};

export default reactToPresetButtons;
