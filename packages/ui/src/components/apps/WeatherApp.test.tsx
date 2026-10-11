import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { WeatherApp } from "./WeatherApp";

describe("WeatherApp component behavioral tests", () => {
  let root: Root;
  let dom: Window;
  const originals = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    dom = new Window({ url: "http://localhost" });
    for (const [key, value] of Object.entries({
      window: dom,
      document: dom.document,
      navigator: dom.navigator,
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

  it("renders honest unconfigured Weather state", async () => {
    await act(async () => {
      root.render(<WeatherApp />);
    });

    const textContent = document.body.textContent ?? "";
    expect(textContent).toContain("Weather Data Unavailable");
    expect(textContent).toContain("Weather integration is coming soon");
    expect(textContent).toContain("Unconfigured");
    expect(textContent).not.toContain("72°F");
  });
});
