export interface TimerState {
  endTime: number | null; // epoch ms deadline when running
  remainingMs: number; // remaining ms when paused or initial
  isRunning: boolean;
}

type Listener = () => void;

let globalTimerState: TimerState = {
  endTime: null,
  remainingMs: 0,
  isRunning: false,
};

const listeners = new Set<Listener>();

export const getTimerState = (): TimerState => {
  return { ...globalTimerState };
};

export const subscribeTimerState = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notifyListeners = () => {
  listeners.forEach((l) => l());
};

export const startTimer = () => {
  if (globalTimerState.isRunning) return;

  let duration = globalTimerState.remainingMs;
  if (duration <= 0) {
    duration = 60000; // default 1 min if starting from 0
  }

  const now = Date.now();
  globalTimerState = {
    endTime: now + duration,
    remainingMs: duration,
    isRunning: true,
  };
  notifyListeners();
};

export const pauseTimer = () => {
  if (!globalTimerState.isRunning) return;

  const now = Date.now();
  const remaining = Math.max(0, (globalTimerState.endTime ?? now) - now);

  globalTimerState = {
    endTime: null,
    remainingMs: remaining,
    isRunning: false,
  };
  notifyListeners();
};

export const resetTimer = () => {
  globalTimerState = {
    endTime: null,
    remainingMs: 0,
    isRunning: false,
  };
  notifyListeners();
};

export const addTimerMs = (additionalMs: number) => {
  const now = Date.now();
  if (globalTimerState.isRunning && globalTimerState.endTime) {
    globalTimerState = {
      ...globalTimerState,
      endTime: globalTimerState.endTime + additionalMs,
      remainingMs: globalTimerState.endTime + additionalMs - now,
    };
  } else {
    globalTimerState = {
      ...globalTimerState,
      remainingMs: globalTimerState.remainingMs + additionalMs,
    };
  }
  notifyListeners();
};

export const updateTimerTick = () => {
  if (!globalTimerState.isRunning || !globalTimerState.endTime) return;

  const now = Date.now();
  const remaining = globalTimerState.endTime - now;

  if (remaining <= 0) {
    globalTimerState = {
      endTime: null,
      remainingMs: 0,
      isRunning: false,
    };
    notifyListeners();
  }
};
