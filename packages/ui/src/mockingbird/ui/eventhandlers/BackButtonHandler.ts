import { View } from "../stores/ViewStore";
import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import { runInAction } from "mobx";
import { executeAction } from "../../../utils/actionMapping";
import { getWindowsConnectorState } from "../../../hooks/useWindowsConnector";
import { getAppReadyState } from "../../../hooks/useNocturned";

const reactToBackButton = (
  hardwareEvents: HardwareEvents,
  rootStore: RootStore,
) => {
  const {
    viewStore,
    npvStore,
    shelfStore,
    overlayController,
    settingsStore,
    onboardingStore,
    voiceStore,
  } = rootStore;

  const runDefaultBackButton = () => {
    if (onboardingStore.isActive) {
      if (onboardingStore.backEnabled || onboardingStore.noInteractionModal) {
        onboardingStore.handleBack();
      }
      if (!onboardingStore.backEnabled) {
        return;
      }
    }
    if (overlayController.isShowing("voice")) {
      voiceStore.cancel();
      return;
    }
    if (overlayController.isShowing("lets_drive")) {
      overlayController.hideLetsDrive();
      return;
    }
    if (overlayController.isSettingsShowing) {
      settingsStore.handleBack();
      return;
    }

    switch (viewStore.currentView) {
      case View.CONTENT_SHELF:
        if (shelfStore.shelfController) {
          shelfStore.shelfController.handleBackButton();
        }
        break;

      case View.NPV:
        if (npvStore.npvController) {
          npvStore.npvController.handleBackButton();
        } else {
          viewStore.back();
        }
        break;

      default:
        viewStore.back();
        break;
    }
  };

  const handleBackButton = async () => {
    if (
      onboardingStore.isActive ||
      overlayController.isShowing("voice") ||
      overlayController.isShowing("lets_drive") ||
      overlayController.isSettingsShowing
    ) {
      runInAction(runDefaultBackButton);
      return;
    }

    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("back_press", {
      isWindowsActive,
      viewStore,
    });
    if (actionRes.executed || !actionRes.fallbackToDefault) {
      return;
    }

    runInAction(runDefaultBackButton);
  };

  hardwareEvents.onBack(() => {
    void handleBackButton();
  });
};

export default reactToBackButton;
