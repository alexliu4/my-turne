import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  spyOn,
  mock,
} from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import AppsSection from "./AppsSection";
import ComputerControlSection from "./ComputerControlSection";
import Settings from "../../components/settings/Settings";
import { HostStatus } from "../../components/windows/HostStatus";
import * as daemon from "../../hooks/useNocturned";
import Sidebar from "../../components/common/navigation/Sidebar";
import { TimerApp } from "../../components/apps/TimerApp";
import { getTimerState, resetTimer } from "../../components/apps/timerStore";
import {
  shouldShowConnectionLostScreen,
  useSectionNavigation,
} from "../../hooks/useSectionNavigation";
import * as settingsContext from "../../contexts/SettingsContext";
import * as windowsConnector from "../../hooks/useWindowsConnector";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AppsSection component behavioral tests", () => {
  let ready: daemon.AppReadyState;
  let root: Root;
  let dom: Window;
  const originals = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    resetTimer();
    ready = {
      ready: false,
      platform: null,
      connectorPlatform: null,
      generation: 1,
    };
    spyOn(daemon, "addGlobalWsListener").mockImplementation(() => () => {});
    spyOn(daemon, "getAppReadyState").mockImplementation(() => ready);
    spyOn(daemon, "subscribeAppReadyState").mockImplementation((listener) => {
      listener(ready);
      return () => {};
    });
    spyOn(daemon, "sendNocturneWsRequest").mockResolvedValue({
      capabilities: { volume: true },
    });
    dom = new Window({ url: "http://localhost" });
    for (const [key, value] of Object.entries({
      window: dom,
      document: dom.document,
      navigator: dom.navigator,
      HTMLElement: dom.HTMLElement,
      Element: dom.Element,
      Node: dom.Node,
      HTMLSlotElement:
        dom.HTMLSlotElement || class HTMLSlotElement extends dom.HTMLElement {},
      ResizeObserver: MockResizeObserver,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    resetTimer();
    mock.restore();
    await dom.happyDOM.cancelAsync();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });

  it("Apps has exactly Timer and Weather with working destinations", async () => {
    const select = mock((_section: string) => {});
    await act(async () =>
      root.render(<AppsSection activeSection="apps" onSelectApp={select} />),
    );
    expect(
      Array.from(document.querySelectorAll("[data-id]")).map((el) =>
        el.getAttribute("data-id"),
      ),
    ).toEqual(["timer", "weather"]);
    expect(document.body.textContent).not.toContain("Windows");
    for (const id of ["timer", "weather"]) {
      const card = document.querySelector(`[data-id="${id}"] [style]`);
      if (!(card instanceof HTMLElement)) throw new Error(`Missing ${id}`);
      await act(async () => card.click());
      expect(select).toHaveBeenCalledWith(id);
    }
  });

  it.each([true, false])(
    "Computer Control destinations and Windows availability (%s)",
    async (active) => {
      spyOn(windowsConnector, "useWindowsConnector").mockReturnValue({
        isWindowsActive: active,
        isFallbackActive: !active,
        hasActiveConnector: true,
        activeConnectorPlatform: active ? "windows" : "macos",
        appPlatform: "web",
      });
      const select = mock((_section: string) => {});
      await act(async () =>
        root.render(
          <ComputerControlSection
            activeSection="computerControl"
            onSelectApp={select}
          />,
        ),
      );
      expect(
        Array.from(document.querySelectorAll("[data-id]")).map((el) =>
          el.getAttribute("data-id"),
        ),
      ).toEqual([
        "windows-media",
        "windows-controls",
        "audio-outputs",
        "app-mixer",
        "discord",
        "pc-stats",
        "windows-actions",
        "host-status",
      ]);
      expect(
        Array.from(document.querySelectorAll("[data-id] h4:first-of-type")).map(
          (el) => el.textContent,
        ),
      ).toEqual([
        "Windows Media",
        "Windows Control",
        "Audio Outputs",
        "App Mixer",
        "Discord",
        "PC Stats",
        "Apps & Macros",
        "Host Status",
      ]);
      for (const [id, destination] of [
        ["windows-media", "windowsMedia"],
        ["windows-controls", "windowsVolume"],
        ["discord", "discord"],
        ["pc-stats", "pcStats"],
        ["audio-outputs", "audioOutputs"],
        ["app-mixer", "appMixer"],
        ["windows-actions", "windowsActions"],
        ["host-status", "hostStatus"],
      ]) {
        const card = document.querySelector(`[data-id="${id}"] [style]`);
        if (!(card instanceof HTMLElement)) throw new Error(`Missing ${id}`);
        expect(card.getAttribute("aria-disabled")).toBe(
          String(!active && id !== "host-status"),
        );
        await act(async () => card.click());
        if (active || id === "host-status")
          expect(select).toHaveBeenCalledWith(destination);
      }
      expect(select).toHaveBeenCalledTimes(active ? 8 : 1);
      expect(daemon.sendNocturneWsRequest).not.toHaveBeenCalled();
    },
  );

  // Use App's section state and lock handlers with the real screens.
  // Mock only daemon I/O and the shared Settings context.
  let navigation: ReturnType<typeof useSectionNavigation>;
  let renderedSections: string[];
  function NavigationProbe({
    connected = false,
    windowsActive = connected,
  }: {
    connected?: boolean;
    windowsActive?: boolean;
  }) {
    navigation = useSectionNavigation(windowsActive, connected);
    const section = navigation.activeSection;
    renderedSections.push(section);
    if (section === "lock") {
      return <button onClick={navigation.handleCloseLockView}>Unlock</button>;
    }
    if (
      shouldShowConnectionLostScreen(
        !connected,
        navigation.bypassOfflineScreen,
        section,
      )
    ) {
      return <button onClick={navigation.openOfflineApps}>Open Apps</button>;
    }
    if (section === "timer") {
      return (
        <TimerApp
          onClose={() =>
            navigation.setActiveSection(navigation.appsBackSection)
          }
        />
      );
    }
    if (section === "settings") {
      return (
        <Settings
          onOpenDonationModal={() => {}}
          setActiveSection={navigation.setActiveSection}
        />
      );
    }
    if (section === "hostStatus" || section === "host-status") {
      return (
        <HostStatus
          onClose={() =>
            navigation.setActiveSection(navigation.appsBackSection)
          }
        />
      );
    }
    return (
      <Sidebar
        activeSection={section}
        setActiveSection={navigation.setActiveSection}
        onExitOfflineMode={
          navigation.bypassOfflineScreen
            ? navigation.exitOfflineMode
            : undefined
        }
      />
    );
  }

  async function mountNavigation(connected = false, windowsActive = connected) {
    renderedSections = [];
    spyOn(settingsContext, "useSettings").mockReturnValue({
      settings: { showStatusBar: false },
      updateSetting: () => {},
      isAppLaunchSettingReady: false,
      isAppLaunchSettingSaving: false,
      appLaunchSettingError: null,
      isMicLocked: true,
      appPlatform: null,
      isNativePhonePresentationLocked: true,
      nativePhonePresentationLockMessage: null,
      showNativePhoneCalls: false,
      showNativeNotifications: false,
    });
    await act(async () =>
      root.render(
        <NavigationProbe connected={connected} windowsActive={windowsActive} />,
      ),
    );
  }

  async function clickText(text: string) {
    const target = Array.from(document.querySelectorAll("button, h4")).find(
      (element) => element.textContent === text,
    );
    if (!(target instanceof HTMLElement)) throw new Error(`Missing ${text}`);
    await act(async () => target.click());
  }

  it("blocks unsupported sidebar destinations before rendering and can return to connection mode", async () => {
    await mountNavigation();
    await clickText("Open Apps");
    const renderedBefore = renderedSections.length;
    for (const label of [
      "Now Playing",
      "Recents",
      "Library",
      "Artists",
      "Radio",
      "Podcasts",
      "Settings",
    ]) {
      await clickText(label);
    }
    expect(navigation.activeSection).toBe("apps");
    expect(renderedSections.length).toBe(renderedBefore);
    // Also reject hardware/programmatic destinations at the parent boundary.
    await act(async () => {
      for (const section of [
        "windowsMedia",
        "windowsVolume",
        "discord",
        "pcStats",
        "windowsActions",
        "audioOutputs",
        "appMixer",
      ])
        navigation.setActiveSection(section);
    });
    expect(renderedSections.length).toBe(renderedBefore);
    await clickText("Reconnect / Bluetooth");
    expect(navigation.bypassOfflineScreen).toBe(false);
    expect(document.body.textContent).toBe("Open Apps");
  });

  it("uses the exact sidebar ordering and allows offline diagnostics", async () => {
    await mountNavigation(true);
    expect(
      Array.from(document.querySelectorAll("h4")).map((el) => el.textContent),
    ).toEqual([
      "Now Playing",
      "Recents",
      "Library",
      "Computer Control",
      "Apps",
      "Artists",
      "Radio",
      "Podcasts",
      "Settings",
    ]);
    await act(async () => root.render(<NavigationProbe connected={false} />));
    await clickText("Open Apps");
    await clickText("Computer Control");
    expect(navigation.activeSection).toBe("computerControl");
    await act(async () => navigation.setActiveSection("hostStatus"));
    expect(navigation.activeSection).toBe("hostStatus");
    expect(navigation.appsBackSection).toBe("computerControl");
    expect(document.body.textContent).toContain("Offline");
    expect(daemon.sendNocturneWsRequest).not.toHaveBeenCalled();
  });

  it("preserves native vertical sidebar scrolling with a mounted carousel", async () => {
    await mountNavigation(true);
    await act(async () =>
      root.render(
        <>
          <Sidebar activeSection="apps" setActiveSection={() => {}} />
          <AppsSection activeSection="apps" onSelectApp={() => {}} />
        </>,
      ),
    );
    const sidebarItem = Array.from(document.querySelectorAll("h4")).find(
      (el) => el.textContent === "Computer Control",
    );
    if (!sidebarItem) throw new Error("Computer Control missing");
    const vertical = new window.WheelEvent("wheel", {
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      sidebarItem.dispatchEvent(vertical);
    });
    expect(vertical.defaultPrevented).toBe(false);
    const horizontal = new window.WheelEvent("wheel", {
      deltaX: 120,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      sidebarItem.dispatchEvent(horizontal);
    });
    expect(horizontal.defaultPrevented).toBe(true);
  });

  it.each([
    "apps",
    "timer",
    "weather",
    "computerControl",
    "hostStatus",
    "windowsMedia",
    "windowsVolume",
    "pcStats",
    "windowsActions",
    "audioOutputs",
    "appMixer",
  ])("disconnect preserves the %s surface", (section) => {
    expect(shouldShowConnectionLostScreen(true, false, section)).toBe(false);
  });

  it("initial socket connection selects Now Playing once and reconnect preserves Computer Control", async () => {
    await mountNavigation(true);
    await act(async () => navigation.initializeConnectedSection());
    expect(navigation.activeSection).toBe("nowPlaying");
    await act(async () => navigation.setActiveSection("computerControl"));
    await act(async () => root.render(<NavigationProbe connected={false} />));
    expect(navigation.activeSection).toBe("computerControl");
    await act(async () => {
      root.render(<NavigationProbe connected />);
      navigation.initializeConnectedSection();
    });
    expect(navigation.activeSection).toBe("computerControl");
  });

  it("reconnect exits offline-only mode and the next disconnect shows the connection screen", async () => {
    await mountNavigation();
    await clickText("Open Apps");
    await act(async () => root.render(<NavigationProbe connected />));
    expect(navigation.bypassOfflineScreen).toBe(false);
    expect(document.body.textContent).not.toContain("Reconnect / Bluetooth");
    // Sidebar must update even when Apps remains selected through reconnect.
    await clickText("Settings");
    expect(navigation.activeSection).toBe("settings");
    await act(async () => root.render(<NavigationProbe connected={false} />));
    expect(document.body.textContent).toBe("Open Apps");
    expect(navigation.bypassOfflineScreen).toBe(false);
  });

  it("idle lock takes precedence over offline Timer and preserves its Back destination", async () => {
    await mountNavigation();
    await clickText("Open Apps");
    await act(async () => navigation.setActiveSection("timer"));
    expect(document.body.textContent).toContain("Timer");
    await clickText("Start");
    const deadline = getTimerState().endTime;
    expect(getTimerState().isRunning).toBe(true);
    await act(async () => navigation.handleIdleLock());
    expect(navigation.activeSection).toBe("lock");
    expect(navigation.activeSectionRef.current).toBe("lock");
    expect(navigation.idleLockActiveRef.current).toBe(true);
    expect(navigation.previousSectionRef.current).toBe("timer");
    expect(navigation.appsBackSection).toBe("apps");
    await act(async () => navigation.setActiveSection("apps"));
    expect(document.body.textContent).toBe("Unlock");
    await clickText("Unlock");
    expect(navigation.activeSection).toBe("timer");
    expect(navigation.idleLockActiveRef.current).toBe(false);
    expect(getTimerState().isRunning).toBe(true);
    expect(getTimerState().endTime).toBe(deadline);
    const back = document.querySelector('[aria-label="Go Back"]');
    if (!(back instanceof HTMLElement)) throw new Error("Timer Back missing");
    await act(async () => back.click());
    expect(navigation.activeSection).toBe("apps");
  });

  it("system transitions remain available offline without replacing app Back origins", async () => {
    await mountNavigation();
    await clickText("Open Apps");
    for (const section of ["auth", "splash", "network"]) {
      await act(async () => navigation.setActiveSection(section));
      expect(navigation.activeSection).toBe(section);
      expect(navigation.appsBackSection).toBe("apps");
    }
    await act(async () => navigation.setActiveSection("weather"));
    expect(navigation.activeSection).toBe("weather");
    expect(navigation.appsBackSection).toBe("apps");
  });

  it("connected Apps and Settings origins survive lock/unlock and app Back", async () => {
    await mountNavigation(true);
    for (const origin of ["apps", "settings", "computerControl"]) {
      await act(async () => {
        navigation.setActiveSection(origin);
        navigation.setActiveSection("timer");
        navigation.handleIdleLock();
      });
      expect(navigation.appsBackSection).toBe(origin);
      expect(navigation.previousSectionRef.current).toBe("timer");
      await clickText("Unlock");
      expect(navigation.activeSection).toBe("timer");
      const back = document.querySelector('[aria-label="Go Back"]');
      if (!(back instanceof HTMLElement)) throw new Error("Timer Back missing");
      await act(async () => back.click());
      expect(navigation.activeSection).toBe(origin);
      for (const detail of [
        "weather",
        "windowsMedia",
        "windowsVolume",
        "discord",
        "pcStats",
        "windowsActions",
        "audioOutputs",
        "appMixer",
        "hostStatus",
      ]) {
        await act(async () => navigation.setActiveSection(detail));
        expect(navigation.activeSection).toBe(detail);
        expect(navigation.appsBackSection).toBe(origin);
        await act(async () =>
          navigation.setActiveSection(navigation.appsBackSection),
        );
        expect(navigation.activeSection).toBe(origin);
      }
    }
  });

  it("unlock after a Windows session disappears preserves its unavailable screen and lock refs", async () => {
    await mountNavigation(true);
    await act(async () => {
      navigation.setActiveSection("settings");
      navigation.setActiveSection("windowsVolume");
      navigation.handleIdleLock();
    });
    await act(async () => root.render(<NavigationProbe connected={false} />));
    expect(document.body.textContent).toBe("Unlock");
    expect(shouldShowConnectionLostScreen(true, false, "lock")).toBe(false);
    await clickText("Unlock");
    expect(navigation.activeSection).toBe("windowsVolume");
    expect(navigation.activeSectionRef.current).toBe("windowsVolume");
    expect(navigation.idleLockActiveRef.current).toBe(false);
  });

  it.each(["windows", "macos", "ios"])(
    "Computer Control Host Status remains accessible with %s and preserves lock/unlock and Back",
    async (platform) => {
      ready = {
        ready: true,
        platform: platform === "ios" ? "ios" : "web",
        connectorPlatform: platform === "ios" ? null : platform,
        generation: 2,
      };
      const windowsActive = platform === "windows";
      await mountNavigation(true, windowsActive);
      await clickText("Settings");
      const general = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("General"),
      );
      if (!general) throw new Error("General settings missing");
      await act(async () => {
        general.click();
        await Bun.sleep(350);
      });
      for (const label of ["Windows Media", "Windows Volume", "Host Status"]) {
        expect(document.body.textContent).not.toContain(label);
      }
      await act(async () => {
        navigation.setActiveSection("computerControl");
        navigation.setActiveSection("hostStatus");
      });
      expect(navigation.activeSection).toBe("hostStatus");
      expect(navigation.appsBackSection).toBe("computerControl");
      expect(document.body.textContent).toContain("Host Status");
      if (windowsActive) {
        expect(document.body.textContent).toContain("Windows Connector active");
        expect(document.body.textContent).toContain("Available");
      } else {
        expect(document.body.textContent).toContain("Offline");
        expect(document.body.textContent).toContain(
          platform === "macos" ? "Mac fallback active" : "No Connector ready",
        );
        const refresh = Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent === "Refresh",
        );
        expect(refresh?.disabled).toBe(true);
        expect(daemon.sendNocturneWsRequest).not.toHaveBeenCalled();
      }
      await act(async () => navigation.handleIdleLock());
      await clickText("Unlock");
      expect(navigation.activeSection).toBe("hostStatus");
      expect(navigation.activeSectionRef.current).toBe("hostStatus");
      expect(navigation.idleLockActiveRef.current).toBe(false);
      const back = document.querySelector('[aria-label="Go Back"]');
      if (!(back instanceof HTMLElement))
        throw new Error("Host Status Back missing");
      await act(async () => back.click());
      expect(navigation.activeSection).toBe("computerControl");
    },
  );
});
