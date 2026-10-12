import { useEffect, useRef } from "react";
import {
  executeAction,
  getActionMapping,
  type ActionExecutionContext,
  type ControlTrigger,
} from "../utils/actionMapping";

// Capture only explicitly remapped controls. Native screen handlers own defaults.
export function useMappedHardwareControls(
  disabled: boolean,
  context: ActionExecutionContext,
) {
  const live = useRef({ disabled, context });
  live.current = { disabled, context };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let heldEvent: KeyboardEvent | undefined;
    let longPressed = false;
    let replaying = false;
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
        if (heldEvent || event.repeat) return;
        heldEvent = event;
        longPressed = false;
        timer = setTimeout(() => {
          longPressed = true;
          if (mapped("dial_long_press")) run("dial_long_press");
        }, 1000);
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !heldEvent) return;
      consume(event);
      if (timer) clearTimeout(timer);
      const original = heldEvent;
      heldEvent = undefined;
      if (live.current.disabled || longPressed) return;
      if (mapped("dial_press")) run("dial_press");
      else {
        // A long-press-only mapping must preserve the native short Enter action.
        replaying = true;
        const target = original.target || window;
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
        target.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
        replaying = false;
      }
    };
    const wheel = (event: WheelEvent) => {
      if (live.current.disabled) return;
      const delta = event.deltaX || event.deltaY;
      if (!delta) return;
      const trigger = delta < 0 ? "dial_turn_left" : "dial_turn_right";
      if (!mapped(trigger)) return;
      consume(event);
      run(trigger);
    };
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("wheel", wheel, true);
    };
  }, []);
}
