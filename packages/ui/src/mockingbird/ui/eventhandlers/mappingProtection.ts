import type { RootStore } from "../stores/RootStore";

// Protected screens retain their own hardware behavior, including Settings recovery.
export function isMappingProtected(rootStore: RootStore): boolean {
  const {
    viewStore,
    setupStore,
    otaStore,
    onboardingStore,
    overlayController,
  } = rootStore;
  return Boolean(
    rootStore.mappingSystemScreenActive ||
    (viewStore.appView !== undefined && viewStore.appView !== "MAIN") ||
    setupStore?.shouldShowSetup ||
    otaStore?.criticalUpdate ||
    onboardingStore?.isActive ||
    overlayController.isSettingsShowing ||
    overlayController.anyOverlayIsShowing,
  );
}

// Setup/OTA and modal surfaces must not operate the hidden player beneath them.
// Onboarding, voice and Settings have native handlers that still need these keys.
export function isHardwareActionBlocked(
  rootStore: RootStore,
  allowSetupRecovery = false,
): boolean {
  const { viewStore, setupStore, otaStore, overlayController } = rootStore;
  const overlay = overlayController.currentOverlay;
  return Boolean(
    (!allowSetupRecovery &&
      rootStore.mappingSystemScreenActive &&
      !rootStore.onboardingStore?.isActive) ||
    (!allowSetupRecovery && setupStore?.shouldShowSetup) ||
    otaStore?.criticalUpdate ||
    (!allowSetupRecovery &&
      viewStore.appView !== undefined &&
      !["MAIN", "ONBOARDING"].includes(viewStore.appView)) ||
    (overlayController.anyOverlayIsShowing &&
      !overlayController.isSettingsShowing &&
      overlay !== "voice" &&
      overlay !== "lets_drive"),
  );
}
