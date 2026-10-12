import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import { runInAction } from "mobx";
import { executeAction } from "../../../utils/actionMapping";
import { getWindowsConnectorState } from "../../../hooks/useWindowsConnector";
import { getAppReadyState } from "../../../hooks/useNocturned";

export const isDialEnabled = (
  appView: string,
  isSettings: boolean,
  onboardingButtonEnabled: boolean,
  isPhoneCall?: boolean,
) =>
  (appView === "MAIN" && !isPhoneCall) ||
  isSettings ||
  (appView === "ONBOARDING" && onboardingButtonEnabled);

const reactToDial = (hardwareEvents: HardwareEvents, rootStore: RootStore) => {
  const {
    viewStore,
    npvStore,
    shelfStore,
    tracklistStore,
    queueStore,
    hardwareStore,
    ubiLogger,
    overlayController,
    settingsStore,
    onboardingStore,
    voiceStore,
  } = rootStore;

  const runDefaultDialPress = () => {
    if (onboardingStore.isActive) {
      if (
        onboardingStore.dialPressEnabled ||
        onboardingStore.noInteractionModal
      ) {
        onboardingStore.handleDialPress();
      }
      if (!onboardingStore.dialPressEnabled) {
        return;
      }
    }
    if (overlayController.isShowing("voice")) {
      if (voiceStore.error || voiceStore.friendlyError) {
        voiceStore.retry();
      }
      return;
    }
    if (overlayController.isSettingsShowing) {
      settingsStore.handleDialPress();
      return;
    }
    switch (viewStore.currentView) {
      case "shelf":
        if (shelfStore.shelfController) {
          shelfStore.shelfController.handleDialPress();
        }
        break;

      case "tracklist":
        if (tracklistStore.tracklistUiState.selectedItem) {
          const id =
            ubiLogger &&
            ubiLogger.trackListUbiLogger &&
            ubiLogger.trackListUbiLogger.logDialPressTrackRow
              ? ubiLogger.trackListUbiLogger.logDialPressTrackRow(
                  tracklistStore.tracklistUiState.selectedItemIndex,
                  tracklistStore.tracklistUiState.selectedItem.uri,
                )
              : Date.now();
          tracklistStore.tracklistUiState.handleItemSelected(
            tracklistStore.tracklistUiState.selectedItem,
            id,
          );
        }
        break;

      case "npv":
        if (npvStore.npvController) {
          npvStore.npvController.handleDialPress();
        }
        break;

      case "queue":
        if (queueStore.queueUiState) {
          queueStore.queueUiState.handleDialPress();
        }
        break;

      default:
        break;
    }
  };

  const handleDialPress = async () => {
    if (
      onboardingStore.isActive ||
      overlayController.isShowing("voice") ||
      overlayController.isSettingsShowing
    ) {
      runInAction(runDefaultDialPress);
      return;
    }

    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("dial_press", {
      isWindowsActive,
      viewStore,
    });
    if (actionRes.executed || !actionRes.fallbackToDefault) {
      return;
    }

    runInAction(runDefaultDialPress);
  };

  const runDefaultDialLongPress = () => {
    switch (viewStore.currentView) {
      case "npv":
        if (npvStore.npvController) {
          npvStore.npvController.handleDialLongPress();
        }
        break;

      default:
        break;
    }
  };

  const handleDialLongPress = async () => {
    if (
      onboardingStore.isActive ||
      overlayController.isShowing("voice") ||
      overlayController.isSettingsShowing
    ) {
      runInAction(runDefaultDialLongPress);
      return;
    }

    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("dial_long_press", {
      isWindowsActive,
      viewStore,
    });
    if (actionRes.executed || !actionRes.fallbackToDefault) {
      return;
    }

    runInAction(runDefaultDialLongPress);
  };

  const handleDialDown = () => {
    hardwareStore.setDialPressed(true);
  };

  const handleDialUp = () => {
    hardwareStore.setDialPressed(false);
  };

  const runDefaultDialLeft = () => {
    if (onboardingStore.isActive) {
      if (
        onboardingStore.dialTurnEnabled ||
        onboardingStore.noInteractionModal
      ) {
        onboardingStore.handleDialTurn();
      }
      if (!onboardingStore.dialTurnEnabled) {
        return;
      }
    }
    if (overlayController.isShowing("voice")) {
      return;
    }
    if (overlayController.isSettingsShowing) {
      settingsStore.handleDialLeft();
      return;
    }
    switch (viewStore.currentView) {
      case "shelf":
        if (shelfStore.shelfController) {
          shelfStore.shelfController.handleDialLeft();
        }
        break;

      case "tracklist":
        if (
          tracklistStore.tracklistUiState.leftItem &&
          tracklistStore.tracklistUiState.leftItem !==
            tracklistStore.tracklistUiState.selectedItem
        ) {
          tracklistStore.tracklistUiState.updateSelectedItem(
            tracklistStore.tracklistUiState.leftItem,
            true,
          );
        }
        break;

      case "npv":
        if (npvStore.npvController) {
          npvStore.npvController.handleDialLeft();
        }
        break;

      case "queue":
        if (queueStore.queueUiState) {
          queueStore.queueUiState.handleDialLeft();
        }
        break;

      default:
        break;
    }
  };

  const handleDialLeft = async () => {
    if (
      onboardingStore.isActive ||
      overlayController.isShowing("voice") ||
      overlayController.isSettingsShowing
    ) {
      runInAction(runDefaultDialLeft);
      return;
    }

    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("dial_turn_left", {
      isWindowsActive,
      viewStore,
    });
    if (actionRes.executed || !actionRes.fallbackToDefault) {
      return;
    }

    runInAction(runDefaultDialLeft);
  };

  const runDefaultDialRight = () => {
    if (onboardingStore.isActive) {
      if (
        onboardingStore.dialTurnEnabled ||
        onboardingStore.noInteractionModal
      ) {
        onboardingStore.handleDialTurn();
      }
      if (!onboardingStore.dialTurnEnabled) {
        return;
      }
    }
    if (overlayController.isShowing("voice")) {
      return;
    }
    if (overlayController.isSettingsShowing) {
      settingsStore.handleDialRight();
      return;
    }
    switch (viewStore.currentView) {
      case "shelf":
        if (shelfStore.shelfController) {
          shelfStore.shelfController.handleDialRight();
        }
        break;

      case "tracklist":
        if (
          tracklistStore.tracklistUiState.rightItem &&
          tracklistStore.tracklistUiState.rightItem !==
            tracklistStore.tracklistUiState.selectedItem
        ) {
          tracklistStore.tracklistUiState.updateSelectedItem(
            tracklistStore.tracklistUiState.rightItem,
            true,
          );
        }
        break;

      case "npv":
        if (npvStore.npvController) {
          npvStore.npvController.handleDialRight();
        }
        break;

      case "queue":
        if (queueStore.queueUiState) {
          queueStore.queueUiState.handleDialRight();
        }
        break;

      default:
        break;
    }
  };

  const handleDialRight = async () => {
    if (
      onboardingStore.isActive ||
      overlayController.isShowing("voice") ||
      overlayController.isSettingsShowing
    ) {
      runInAction(runDefaultDialRight);
      return;
    }

    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("dial_turn_right", {
      isWindowsActive,
      viewStore,
    });
    if (actionRes.executed || !actionRes.fallbackToDefault) {
      return;
    }

    runInAction(runDefaultDialRight);
  };

  hardwareEvents.onDialPress(() => {
    void handleDialPress();
  });
  hardwareEvents.onDialLongPress(() => {
    void handleDialLongPress();
  });
  hardwareEvents.onDialButtonDown(handleDialDown);
  hardwareEvents.onDialButtonUp(handleDialUp);
  hardwareEvents.onDialLeft(() => {
    void handleDialLeft();
  });
  hardwareEvents.onDialRight(() => {
    void handleDialRight();
  });
};

export default reactToDial;
