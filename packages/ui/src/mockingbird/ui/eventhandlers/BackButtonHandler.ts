import { View } from "../stores/ViewStore";
import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import { action } from "mobx";
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

  const handleBackButton = action(async () => {
    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("back_press", {
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
  });

  hardwareEvents.onBack(handleBackButton);
};

export default reactToBackButton;
