export interface TimerState {
  endTime: number | null; // epoch ms deadline when running
  remainingMs: number; // remaining ms when paused or initial
  isRunning: boolean;
  isFinished: boolean;
}

type Listener = () => void;

let globalTimerState: TimerState = {
  endTime: null,
  remainingMs: 0,
  isRunning: false,
  isFinished: false,
};

const listeners = new Set<Listener>();

const checkAndReconcileTimer = () => {
  if (globalTimerState.isRunning && globalTimerState.endTime) {
    const now = Date.now();
    if (globalTimerState.endTime <= now) {
      globalTimerState = {
        endTime: null,
        remainingMs: 0,
        isRunning: false,
        isFinished: true,
      };
    }
  }
};

export const getTimerState = (): TimerState => {
  checkAndReconcileTimer();
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
  checkAndReconcileTimer();
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
    isFinished: false,
  };
  notifyListeners();
};

export const pauseTimer = () => {
  checkAndReconcileTimer();
  if (!globalTimerState.isRunning) return;

  const now = Date.now();
  const remaining = Math.max(0, (globalTimerState.endTime ?? now) - now);

  globalTimerState = {
    endTime: null,
    remainingMs: remaining,
    isRunning: false,
    isFinished: remaining === 0,
  };
  notifyListeners();
};

export const resetTimer = () => {
  globalTimerState = {
    endTime: null,
    remainingMs: 0,
    isRunning: false,
    isFinished: false,
  };
  notifyListeners();
};

export const addTimerMs = (additionalMs: number) => {
  checkAndReconcileTimer();
  const now = Date.now();
  if (globalTimerState.isRunning && globalTimerState.endTime) {
    const newEndTime = globalTimerState.endTime + additionalMs;
    globalTimerState = {
      ...globalTimerState,
      endTime: newEndTime,
      remainingMs: Math.max(0, newEndTime - now),
      isFinished: false,
    };
  } else {
    const newRemaining = globalTimerState.remainingMs + additionalMs;
    globalTimerState = {
      ...globalTimerState,
      remainingMs: newRemaining,
      isFinished: false,
    };
  }
  notifyListeners();
};

export const updateTimerTick = () => {
  checkAndReconcileTimer();
  notifyListeners();
};
