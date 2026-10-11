import React, { useState, useEffect } from "react";
import { BackIcon } from "../common/icons";
import {
  getTimerState,
  subscribeTimerState,
  startTimer,
  pauseTimer,
  resetTimer,
  addTimerMs,
  updateTimerTick,
} from "./timerStore";

export function TimerApp({
  onClose,
}: {
  onClose?: () => void;
}): React.ReactElement {
  const [timerState, setTimerState] = useState(getTimerState());

  useEffect(() => {
    const unsubscribe = subscribeTimerState(() => {
      setTimerState(getTimerState());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!timerState.isRunning) return;

    const interval = setInterval(() => {
      updateTimerTick();
      setTimerState(getTimerState());
    }, 100);

    return () => clearInterval(interval);
  }, [timerState.isRunning]);

  const calculateRemainingSeconds = () => {
    if (timerState.isRunning && timerState.endTime) {
      const remainingMs = Math.max(0, timerState.endTime - Date.now());
      return Math.ceil(remainingMs / 1000);
    }
    return Math.ceil(timerState.remainingMs / 1000);
  };

  const remainingSeconds = calculateRemainingSeconds();

  const handleStartPause = () => {
    if (timerState.isRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  };

  const handleReset = () => {
    resetTimer();
  };

  const handleAddPreset = (addSeconds: number) => {
    addTimerMs(addSeconds * 1000);
  };

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const hrs = Math.floor(mins / 60);
    const displayMins = mins % 60;

    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(displayMins).padStart(
        2,
        "0",
      )}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(displayMins).padStart(2, "0")}:${String(secs).padStart(
      2,
      "0",
    )}`;
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 select-none p-6 relative overflow-hidden rounded-2xl">
      {/* Header Bar */}
      <div className="flex items-center justify-between mb-4 z-10 border-b border-zinc-800 pb-4">
        <div className="flex items-center space-x-3">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full hover:bg-zinc-800 active:bg-zinc-700 transition"
              aria-label="Go Back"
            >
              <BackIcon className="w-6 h-6 text-zinc-300" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
              Timer
            </h1>
            <p className="text-sm font-semibold text-zinc-400">Device App</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="inline-block w-3 h-3 rounded-full bg-green-500" />
          <span className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Offline Ready
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center space-y-8">
        <div className="text-7xl font-mono font-bold tracking-wider text-zinc-100 bg-zinc-900/80 px-8 py-6 rounded-2xl border border-zinc-800 shadow-inner">
          {remainingSeconds === 0 && !timerState.isRunning && timerState.remainingMs === 0 ? "00:00" : formatTime(remainingSeconds)}
        </div>

        {/* Presets */}
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={() => handleAddPreset(60)}
            className="px-4 py-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 active:bg-zinc-600 text-sm font-medium text-zinc-200 border border-zinc-700/50 transition"
          >
            +1 Min
          </button>
          <button
            type="button"
            onClick={() => handleAddPreset(300)}
            className="px-4 py-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 active:bg-zinc-600 text-sm font-medium text-zinc-200 border border-zinc-700/50 transition"
          >
            +5 Min
          </button>
          <button
            type="button"
            onClick={() => handleAddPreset(600)}
            className="px-4 py-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 active:bg-zinc-600 text-sm font-medium text-zinc-200 border border-zinc-700/50 transition"
          >
            +10 Min
          </button>
        </div>

        {/* Control Buttons */}
        <div className="flex space-x-4">
          <button
            type="button"
            onClick={handleStartPause}
            className={`px-8 py-3 rounded-xl font-semibold text-lg transition ${
              timerState.isRunning
                ? "bg-amber-600 hover:bg-amber-500 text-zinc-100"
                : "bg-emerald-600 hover:bg-emerald-500 text-zinc-100"
            }`}
          >
            {timerState.isRunning ? "Pause" : "Start"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="px-8 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold text-lg transition border border-zinc-700/50"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
