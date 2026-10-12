import { useCallback, useEffect, useState } from "react";
import {
  getStoredInputMode,
  setStoredInputMode,
  resolveTouchActive,
  resolveCustomKeyboardActive,
  INPUT_MODE_CHANGE_EVENT,
  type InputModeSetting,
} from "@/lib/touch-input";

/**
 * The device's POS Input Mode (Auto / Touchscreen / Keyboard + Mouse) plus
 * the resolved touch-active boolean every field/consumer actually cares
 * about. Safe to use from multiple components at once (Profile page,
 * Login page, TouchKeyboard host) — a change from any one of them is
 * broadcast via a window event and picked up by every other instance.
 */
export function useInputMode() {
  const [mode, setModeState] = useState<InputModeSetting>(() => getStoredInputMode());

  useEffect(() => {
    function handleChange(e: Event) {
      const detail = (e as CustomEvent<InputModeSetting>).detail;
      setModeState(detail ?? getStoredInputMode());
    }
    window.addEventListener(INPUT_MODE_CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(INPUT_MODE_CHANGE_EVENT, handleChange);
  }, []);

  const setMode = useCallback((next: InputModeSetting) => {
    setStoredInputMode(next);
    setModeState(next);
  }, []);

  return {
    mode,
    touchActive: resolveTouchActive(mode),
    /** Whether fields should open the CUSTOM on-screen keyboard (Windows-touch workaround only; always false on iOS/Android). */
    customKeyboardActive: resolveCustomKeyboardActive(mode),
    setMode,
  };
}
