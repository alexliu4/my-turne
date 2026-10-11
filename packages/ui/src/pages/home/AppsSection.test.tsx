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
  let root: Root;
  let dom: Window;
  const originals = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    resetTimer();
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

  it("renders catalog items and displays 'Connected' badges when Windows is active", async () => {
    spyOn(windowsConnector, "useWindowsConnector").mockImplementation(() => ({
      isWindowsActive: true,
      isFallbackActive: false,
      hasActiveConnector: true,
      activeConnectorPlatform: "windows",
      appPlatform: "web",
    }));

    const onSelectApp = mock(() => {});

    await act(async () => {
      root.render(
        <AppsSection activeSection="apps" onSelectApp={onSelectApp} />,
      );
    });

    const textContent = document.body.textContent ?? "";
    expect(textContent).toContain("Timer");
    expect(textContent).toContain("Weather");
    expect(textContent).toContain("Windows Media");
    expect(textContent).toContain("Windows Controls");
    expect(textContent).toContain("Host Status");
    expect(textContent).toContain("Connected");
    expect(textContent).not.toContain("PC Offline");
  });

  it("displays 'PC Offline' and 'PC Unavailable' badges when Windows is offline", async () => {
    spyOn(windowsConnector, "useWindowsConnector").mockImplementation(() => ({
      isWindowsActive: false,
      isFallbackActive: true,
      hasActiveConnector: true,
      activeConnectorPlatform: "macos",
      appPlatform: "web",
    }));

    const onSelectApp = mock(() => {});

    await act(async () => {
      root.render(
        <AppsSection activeSection="apps" onSelectApp={onSelectApp} />,
      );
    });

    const textContent = document.body.textContent ?? "";
    expect(textContent).toContain("PC Offline");
    expect(textContent).toContain("PC Unavailable");
  });

  it("invokes onSelectApp callback with target section when card is selected", async () => {
    spyOn(windowsConnector, "useWindowsConnector").mockImplementation(() => ({
      isWindowsActive: true,
      isFallbackActive: false,
      hasActiveConnector: true,
      activeConnectorPlatform: "windows",
      appPlatform: "web",
    }));

    const onSelectApp = mock((_section: string) => {});

    await act(async () => {
      root.render(
        <AppsSection activeSection="apps" onSelectApp={onSelectApp} />,
      );
    });

    const timerCard = document.querySelector('[data-id="timer"]');
    expect(timerCard).not.toBeNull();
    const card = timerCard?.querySelector("[style]");
    if (!(card instanceof HTMLElement)) throw new Error("Timer card missing");
    await act(async () => card.click());
    expect(onSelectApp).toHaveBeenCalledTimes(1);
    expect(onSelectApp).toHaveBeenCalledWith("timer");
  });
  it("blocks Windows card and title clicks without a Windows Connector, while native apps open", async () => {
    spyOn(windowsConnector, "useWindowsConnector").mockReturnValue({
      isWindowsActive: false,
      isFallbackActive: false,
      hasActiveConnector: false,
      activeConnectorPlatform: null,
      appPlatform: null,
    });
    const onSelectApp = mock((_section: string) => {});
    await act(async () => {
      root.render(
        <AppsSection activeSection="apps" onSelectApp={onSelectApp} />,
      );
    });
    for (const id of ["windows-media", "windows-controls", "host-status"]) {
      const card = document.querySelector(`[data-id="${id}"] [style]`);
      const title = document.querySelector(`[data-id="${id}"] h4`);
      if (!(card instanceof HTMLElement) || !(title instanceof HTMLElement)) {
        throw new Error(`Missing ${id} card`);
      }
      expect(card.getAttribute("aria-disabled")).toBe("true");
      await act(async () => {
        card.click();
        title.click();
      });
    }
    // Knob selection reaches the carousel callback rather than a card click.
    for (let index = 0; index < 5; index++) {
      await act(async () =>
        window.dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "ArrowRight" }),
        ),
      );
      if (index >= 2) {
        await act(async () =>
          window.dispatchEvent(
            new window.KeyboardEvent("keydown", { key: "Enter" }),
          ),
        );
      }
    }
    expect(onSelectApp).not.toHaveBeenCalled();
    for (const id of ["timer", "weather"]) {
      const card = document.querySelector(`[data-id="${id}"] [style]`);
      if (!(card instanceof HTMLElement)) throw new Error(`Missing ${id}`);
      await act(async () => card.click());
      expect(onSelectApp).toHaveBeenCalledWith(id);
    }
    expect(onSelectApp).toHaveBeenCalledTimes(2);
  });

  // Use App's section state and lock handlers with the real Sidebar and Timer.
  // Connection and lock presentation require no daemon I/O in this probe.
  let navigation: ReturnType<typeof useSectionNavigation>;
  let renderedSections: string[];
  function NavigationProbe({ connected = false }: { connected?: boolean }) {
    navigation = useSectionNavigation(connected, connected);
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

  async function mountNavigation(connected = false) {
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
      root.render(<NavigationProbe connected={connected} />),
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
    await act(async () => navigation.setActiveSection("windowsMedia"));
    expect(renderedSections.length).toBe(renderedBefore);
    await clickText("Reconnect / Bluetooth");
    expect(navigation.bypassOfflineScreen).toBe(false);
    expect(document.body.textContent).toBe("Open Apps");
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
    for (const origin of ["apps", "settings"]) {
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

  it("unlock after a Windows session disappears restores the origin with consistent lock refs", async () => {
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
    expect(navigation.activeSection).toBe("settings");
    expect(navigation.activeSectionRef.current).toBe("settings");
    expect(navigation.idleLockActiveRef.current).toBe(false);
    expect(document.body.textContent).toBe("Open Apps");
  });
});
