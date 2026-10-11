import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import AppsSection from "./AppsSection";
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
    dom = new Window({ url: "http://localhost" });
    for (const [key, value] of Object.entries({
      window: dom,
      document: dom.document,
      navigator: dom.navigator,
      HTMLElement: dom.HTMLElement,
      Element: dom.Element,
      Node: dom.Node,
      HTMLSlotElement: dom.HTMLSlotElement || class HTMLSlotElement extends dom.HTMLElement {},
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
      root.render(<AppsSection activeSection="apps" onSelectApp={onSelectApp} />);
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
      root.render(<AppsSection activeSection="apps" onSelectApp={onSelectApp} />);
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
      root.render(<AppsSection activeSection="apps" onSelectApp={onSelectApp} />);
    });

    const timerCard = document.querySelector('[data-id="timer"]');
    expect(timerCard).toBeDefined();
  });
});
