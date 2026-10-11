import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { TimerApp } from "./TimerApp";
import {
  getTimerState,
  startTimer,
  pauseTimer,
  resetTimer,
  addTimerMs,
} from "./timerStore";

describe("TimerApp and timerStore behavioral tests", () => {
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

  it("renders TimerApp component with initial 00:00 display and controls", async () => {
    await act(async () => {
      root.render(<TimerApp />);
    });

    const textContent = document.body.textContent ?? "";
    expect(textContent).toContain("Timer");
    expect(textContent).toContain("00:00");
    expect(textContent).toContain("Start");
    expect(textContent).toContain("Reset");
    expect(textContent).toContain("+1 Min");
  });

  it("starts timer with default 60s duration when start clicked at 00:00", async () => {
    await act(async () => {
      root.render(<TimerApp />);
    });

    const startButton = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Start"),
    );
    expect(startButton).toBeDefined();

    await act(async () => {
      startButton?.click();
    });

    const state = getTimerState();
    expect(state.isRunning).toBe(true);
    expect(state.remainingMs).toBe(60000);
  });

  it("pauses timer and preserves remaining duration", async () => {
    addTimerMs(30000); // 30s
    startTimer();

    await act(async () => {
      root.render(<TimerApp />);
    });

    const pauseButton = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Pause"),
    );
    expect(pauseButton).toBeDefined();

    await act(async () => {
      pauseButton?.click();
    });

    const state = getTimerState();
    expect(state.isRunning).toBe(false);
    expect(state.remainingMs).toBeGreaterThan(0);
  });

  it("resets timer", async () => {
    addTimerMs(60000);

    await act(async () => {
      root.render(<TimerApp />);
    });

    const resetButton = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Reset"),
    );
    expect(resetButton).toBeDefined();

    await act(async () => {
      resetButton?.click();
    });

    const state = getTimerState();
    expect(state.isRunning).toBe(false);
    expect(state.remainingMs).toBe(0);
  });
});
