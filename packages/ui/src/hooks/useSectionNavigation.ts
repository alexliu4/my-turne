import { useCallback, useEffect, useRef, useState } from "react";
import type { ActiveSection, StateSetter } from "../types";

const isOfflineAppSection = (section: ActiveSection) =>
  [
    "apps",
    "computerControl",
    "hostStatus",
    "host-status",
    "timer",
    "weather",
  ].includes(section);

const isSystemSection = (section: ActiveSection) =>
  ["lock", "splash", "auth", "network"].includes(section);

const isWindowsAppSection = (section: ActiveSection) =>
  [
    "hostStatus",
    "host-status",
    "windowsMedia",
    "windows-media",
    "discord",
    "pcStats",
    "windowsActions",
    "windowsVolume",
    "windows-volume",
  ].includes(section);

// Host Status is read-only diagnostics, including when Windows is offline.
const requiresWindowsConnector = (section: ActiveSection) =>
  isWindowsAppSection(section) &&
  section !== "hostStatus" &&
  section !== "host-status";

export const shouldShowConnectionLostScreen = (
  connectionLost: boolean,
  bypassOfflineScreen: boolean,
  section: ActiveSection,
) =>
  connectionLost &&
  !bypassOfflineScreen &&
  section !== "lock" &&
  !isOfflineAppSection(section) &&
  !isWindowsAppSection(section);

// Section state remains local to App. System transitions are never offline destinations.
export function useSectionNavigation(
  isWindowsActive: boolean,
  appReady: boolean,
) {
  const [activeSection, setSection] = useState<ActiveSection>("recents");
  const [appsBackSection, setAppsBackSection] =
    useState<ActiveSection>("recents");
  const [bypassOfflineScreen, setBypassOfflineScreen] = useState(false);
  const previousSectionRef = useRef<ActiveSection>("recents");
  const activeSectionRef = useRef(activeSection);
  const idleLockActiveRef = useRef(false);
  const availabilityRef = useRef({ bypassOfflineScreen, isWindowsActive });
  availabilityRef.current = { bypassOfflineScreen, isWindowsActive };

  const setActiveSection: StateSetter<ActiveSection> = useCallback((next) => {
    const section =
      typeof next === "function" ? next(activeSectionRef.current) : next;
    const availability = availabilityRef.current;
    if (activeSectionRef.current === "lock" && !isSystemSection(section))
      return;
    if (
      !isSystemSection(section) &&
      ((availability.bypassOfflineScreen && !isOfflineAppSection(section)) ||
        (requiresWindowsConnector(section) && !availability.isWindowsActive))
    ) {
      return;
    }

    activeSectionRef.current = section;
    if (section !== "lock") idleLockActiveRef.current = false;
    if (!isSystemSection(section)) {
      previousSectionRef.current = section;
      if (
        !isWindowsAppSection(section) &&
        section !== "timer" &&
        section !== "weather"
      ) {
        setAppsBackSection(section);
      }
    }
    setSection(section);
  }, []);

  const initialConnectionApplied = useRef(false);
  const initializeConnectedSection = useCallback(() => {
    if (initialConnectionApplied.current) return;
    initialConnectionApplied.current = true;
    if (activeSectionRef.current === "recents") setActiveSection("nowPlaying");
  }, [setActiveSection]);

  const openOfflineApps = useCallback(() => {
    availabilityRef.current.bypassOfflineScreen = true;
    setBypassOfflineScreen(true);
    setActiveSection("apps");
  }, [setActiveSection]);

  const clearOfflineMode = useCallback(() => {
    availabilityRef.current.bypassOfflineScreen = false;
    setBypassOfflineScreen(false);
  }, []);

  const exitOfflineMode = useCallback(() => {
    clearOfflineMode();
    setActiveSection("network");
  }, [clearOfflineMode, setActiveSection]);

  useEffect(() => {
    if (appReady) clearOfflineMode();
  }, [appReady, clearOfflineMode]);

  const handleIdleLock = useCallback(() => {
    if (activeSectionRef.current === "lock") return;
    previousSectionRef.current = activeSectionRef.current;
    idleLockActiveRef.current = true;
    setActiveSection("lock");
  }, [setActiveSection]);

  const handleCloseLockView = useCallback(() => {
    idleLockActiveRef.current = false;
    const availability = availabilityRef.current;
    const previous = previousSectionRef.current;
    const target =
      availability.bypassOfflineScreen && !isOfflineAppSection(previous)
        ? "apps"
        : previous;
    activeSectionRef.current = target;
    setSection(target);
  }, []);

  return {
    activeSection,
    setActiveSection,
    initializeConnectedSection,
    appsBackSection,
    bypassOfflineScreen,
    openOfflineApps,
    exitOfflineMode,
    handleIdleLock,
    handleCloseLockView,
    previousSectionRef,
    activeSectionRef,
    idleLockActiveRef,
  };
}
