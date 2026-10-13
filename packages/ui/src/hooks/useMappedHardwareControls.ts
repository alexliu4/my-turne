import { useEffect, useRef } from "react";
import {
  executeAction,
  getActionMapping,
  type ActionExecutionContext,
  type ControlTrigger,
} from "../utils/actionMapping";
import { getAppReadyState } from "./useNocturned";
import { getActivePresetDeviceId } from "../utils/presetStorage";

// Capture only explicitly remapped controls. Native screen handlers own defaults.
export function useMappedHardwareControls(
  disabled: boolean,
  context: ActionExecutionContext,
) {
  const clearRotations = useRef<(() => void) | undefined>(undefined);
  const live = useRef({ disabled, context });
  live.current = { disabled, context };
  useEffect(() => {
    if (disabled) clearRotations.current?.();
  }, [disabled]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let heldEvent: KeyboardEvent | undefined;
    let longPressed = false;
    let replaying = false;
    let nativeHold:
      | {
          target: EventTarget;
          releaseRequested: boolean;
          minimumElapsed: boolean;
        }
      | undefined;
    let nativeTimer: ReturnType<typeof setTimeout> | undefined;
    let rotationTimer: ReturnType<typeof setTimeout> | undefined;
    let rotationBusy = false;
    let disposed = false;
    let nextRotationAt = 0;
    const rotations: Array<{
      trigger: ControlTrigger;
      generation: number;
      deviceId: string;
      mapping: string;
    }> = [];
    clearRotations.current = () => {
      rotations.length = 0;
    };
    const replayKey = (target: EventTarget, type: string) => {
      replaying = true;
      try {
        target.dispatchEvent(
          new KeyboardEvent(type, {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      } finally {
        replaying = false;
      }
    };
    const releaseNativeHold = () => {
      if (!nativeHold) return;
      const target = nativeHold.target;
      nativeHold = undefined;
      replayKey(target, "keyup");
    };
    const mapped = (trigger: ControlTrigger) =>
      getActionMapping(trigger).kind !== "default";
    const consume = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const run = (trigger: ControlTrigger) => {
      if (!live.current.disabled)
        void executeAction(trigger, live.current.context);
    };
    const drainRotations = () => {
      if (disposed || rotationBusy) return;
      if (live.current.disabled) {
        rotations.length = 0;
        return;
      }
      const remaining = nextRotationAt - Date.now();
      if (remaining > 0) {
        if (!rotationTimer)
          rotationTimer = setTimeout(() => {
            rotationTimer = undefined;
            drainRotations();
          }, remaining);
        return;
      }
      const queued = rotations.shift();
      if (!queued) return;
      if (
        queued.generation !== getAppReadyState().generation ||
        queued.deviceId !== getActivePresetDeviceId() ||
        queued.mapping !== JSON.stringify(getActionMapping(queued.trigger))
      ) {
        drainRotations();
        return;
      }
      rotationBusy = true;
      nextRotationAt = Date.now() + 50;
      void executeAction(
        queued.trigger,
        live.current.context,
        queued.deviceId,
      ).finally(() => {
        rotationBusy = false;
        drainRotations();
      });
    };
    const keyDown = (event: KeyboardEvent) => {
      if (replaying || live.current.disabled) return;
      if (event.key === "Escape" && mapped("back_press")) {
        consume(event);
        if (!event.repeat) run("back_press");
      } else if (
        event.key === "Enter" &&
        (mapped("dial_press") || mapped("dial_long_press"))
      ) {
        consume(event);
        if (heldEvent || nativeHold || event.repeat) return;
        heldEvent = event;
        longPressed = false;
        timer = setTimeout(() => {
          longPressed = true;
          if (live.current.disabled) return;
          if (mapped("dial_long_press")) run("dial_long_press");
          else {
            // Replay an actual hold through native key handlers, rather than a
            // down/up pair that their long-press parser would classify as short.
            const target = heldEvent?.target || window;
            nativeHold = {
              target,
              releaseRequested: false,
              minimumElapsed: false,
            };
            replayKey(target, "keydown");
            nativeTimer = setTimeout(() => {
              if (!nativeHold) return;
              nativeHold.minimumElapsed = true;
              if (nativeHold.releaseRequested) releaseNativeHold();
            }, 1000);
          }
        }, 1000);
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (replaying || event.key !== "Enter" || (!heldEvent && !nativeHold))
        return;
      consume(event);
      if (!heldEvent) {
        if (nativeHold) nativeHold.releaseRequested = true;
        return;
      }
      if (timer) clearTimeout(timer);
      const original = heldEvent;
      heldEvent = undefined;
      if (nativeHold) {
        nativeHold.releaseRequested = true;
        if (nativeHold.minimumElapsed) releaseNativeHold();
      }
      if (live.current.disabled || longPressed) return;
      if (mapped("dial_press")) run("dial_press");
      else {
        // A long-press-only mapping must preserve the native short Enter action.
        const target = original.target || window;
        replayKey(target, "keydown");
        replayKey(target, "keyup");
      }
    };
    const wheel = (event: WheelEvent) => {
      if (live.current.disabled) return;
      // Car Thing rotary events are horizontal. Vertical/diagonal scrolling,
      // trackpad pinch and wheel input on form controls belong to the UI.
      if (
        event.deltaY !== 0 ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.metaKey
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input, select, textarea, [contenteditable='true']",
        )
      )
        return;
      const delta = event.deltaX;
      if (!delta) return;
      const trigger = delta < 0 ? "dial_turn_left" : "dial_turn_right";
      if (!mapped(trigger)) return;
      consume(event);
      const mapping = getActionMapping(trigger);
      if (mapping.kind === "device" && !mapping.action.startsWith("media.")) {
        run(trigger);
        return;
      }
      // One in-flight rotary RPC, at most 20 starts/sec and eight buffered steps.
      // Bounded buffering preserves intentional steps without an unbounded backlog.
      if (rotations.length < 8)
        rotations.push({
          trigger,
          generation: getAppReadyState().generation,
          deviceId: getActivePresetDeviceId(),
          mapping: JSON.stringify(mapping),
        });
      drainRotations();
    };
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => {
      disposed = true;
      rotations.length = 0;
      if (timer) clearTimeout(timer);
      if (rotationTimer) clearTimeout(rotationTimer);
      clearRotations.current = undefined;
      // A replay already delivered to native handlers must finish as a long
      // hold, even if this hook unmounts before their threshold expires.
      if (nativeHold) {
        nativeHold.releaseRequested = true;
        if (nativeHold.minimumElapsed) releaseNativeHold();
      } else if (nativeTimer) clearTimeout(nativeTimer);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("wheel", wheel, true);
    };
  }, []);
}
