import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import { runInAction } from "mobx";
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
  const {
    presetsController,
    viewStore,
    onboardingStore,
    setupStore,
    otaStore,
  } = rootStore;

  const handlePresetButtonPress = async (presetNumber: number) => {
    if (!presetsController.isPresetButtonsEnabled) {
      return;
    }

    if (
      onboardingStore?.isActive ||
      setupStore?.shouldShowSetup ||
      otaStore?.criticalUpdate
    ) {
      presetsController.presetsUiState.handlePresetButtonPress(presetNumber);
      return;
    }

    const trigger = `preset_${presetNumber}` as ControlTrigger;
    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction(trigger, {
      isWindowsActive,
      viewStore,
    });

    if (actionRes.executed || !actionRes.fallbackToDefault) {
      return;
    }

    runInAction(() => {
      presetsController.presetsUiState.handlePresetButtonPress(presetNumber);
    });
  };

  const handlePresetButtonLongPress = (presetNumber: number) => {
    if (!presetsController.isPresetButtonsEnabled) {
      return;
    }

    presetsController.presetsUiState.handlePresetButtonLongPress(presetNumber);
  };

  const handlePreset1 = () => {
    void handlePresetButtonPress(1);
  };

  const handlePreset1LongPress = () => {
    handlePresetButtonLongPress(1);
  };

  const handlePreset2 = () => {
    void handlePresetButtonPress(2);
  };

  const handlePreset2LongPress = () => {
    handlePresetButtonLongPress(2);
  };

  const handlePreset3 = () => {
    void handlePresetButtonPress(3);
  };

  const handlePreset3LongPress = () => {
    handlePresetButtonLongPress(3);
  };

  const handlePreset4 = () => {
    void handlePresetButtonPress(4);
  };

  const handlePreset4LongPress = () => {
    handlePresetButtonLongPress(4);
  };

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
