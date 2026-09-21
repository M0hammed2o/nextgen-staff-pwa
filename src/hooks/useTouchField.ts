import { useEffect, useId, useRef } from "react";
import { useTouchKeyboardContext, type TouchKeyboardLayout } from "@/lib/touch-keyboard";
import { useInputMode } from "@/hooks/useInputMode";

interface UseTouchFieldOptions {
  value: string;
  onChange: (value: string) => void;
  layout: TouchKeyboardLayout;
  maxLength?: number;
  /** Set false to opt a field out even in touch mode (rare — none of this app's fields need it today). */
  enabled?: boolean;
}

interface UseTouchFieldResult {
  touchActive: boolean;
  /**
   * Spread onto the underlying <input>/<textarea>. In touch mode this sets
   * `inputMode="none"` so the OS/browser's own virtual keyboard does not
   * ALSO try to open (which is the actual Windows+Chrome bug this whole
   * system exists to work around) while opening our on-screen keyboard on
   * focus. The input stays a real, focusable, controlled element — never
   * `readOnly` (which would kill the caret) — so a physical keyboard, if one
   * is plugged in, keeps working exactly as before even in touch mode.
   * In keyboard+mouse mode this is an empty object: nothing about the field
   * changes from its pre-existing behaviour.
   */
  fieldProps: { inputMode?: "none"; onFocus?: () => void };
}

/**
 * Opts a single controlled input/textarea into the shared on-screen
 * TouchKeyboard. Each call site keeps its own value/onChange exactly as
 * before — this only adds the touch-specific wiring.
 */
export function useTouchField({ value, onChange, layout, maxLength, enabled = true }: UseTouchFieldOptions): UseTouchFieldResult {
  const id = useId();
  const { active, open, sync, close } = useTouchKeyboardContext();
  const { touchActive } = useInputMode();
  const isActive = touchActive && enabled;

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Keep the keyboard's copy of the value in sync if it changes from
  // outside while this field owns it (e.g. PaymentDialog's quick-tender
  // buttons, CartPanel's programmatic changes).
  useEffect(() => {
    if (active?.id === id) sync(id, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, active?.id]);

  // Close the keyboard if this field unmounts while it owns it (dialog
  // closed, navigated away, item swapped) — close() is a no-op if some other
  // field has since taken over, since it only clears a matching id.
  useEffect(() => {
    return () => close(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isActive) {
    return { touchActive: false, fieldProps: {} };
  }

  return {
    touchActive: true,
    fieldProps: {
      inputMode: "none",
      onFocus: () => {
        open({
          id,
          value: valueRef.current,
          layout,
          maxLength,
          onChange: (v) => onChangeRef.current(v),
        });
      },
    },
  };
}
