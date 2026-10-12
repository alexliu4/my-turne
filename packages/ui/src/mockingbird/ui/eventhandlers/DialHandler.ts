import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import { action } from "mobx";
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

  const handleDialPress = action(async () => {
    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("dial_press", {
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
  });

  const handleDialLongPress = action(async () => {
    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("dial_long_press", {
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

    switch (viewStore.currentView) {
      case "npv":
        if (npvStore.npvController) {
          npvStore.npvController.handleDialLongPress();
        }
        break;

      default:
        break;
    }
  });

  const handleDialDown = action(() => {
    hardwareStore.setDialPressed(true);
  });

  const handleDialUp = action(() => {
    hardwareStore.setDialPressed(false);
  });

  const handleDialLeft = action(async () => {
    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("dial_turn_left", {
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
  });

  const handleDialRight = action(async () => {
    const isWindowsActive =
      getWindowsConnectorState(getAppReadyState()).isWindowsActive;
    const actionRes = await executeAction("dial_turn_right", {
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
  });

  hardwareEvents.onDialPress(handleDialPress);
  hardwareEvents.onDialLongPress(handleDialLongPress);
  hardwareEvents.onDialButtonDown(handleDialDown);
  hardwareEvents.onDialButtonUp(handleDialUp);
  hardwareEvents.onDialLeft(handleDialLeft);
  hardwareEvents.onDialRight(handleDialRight);
};

export default reactToDial;
