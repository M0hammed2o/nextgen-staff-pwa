import { useEffect, useId, useRef, type HTMLAttributes } from "react";
import { useTouchKeyboardContext, type TouchKeyboardLayout } from "@/lib/touch-keyboard";
import { useInputMode } from "@/hooks/useInputMode";

export type NativeInputMode = NonNullable<HTMLAttributes<HTMLInputElement>["inputMode"]>;

/**
 * The OS keyboard each custom layout corresponds to, used whenever the
 * custom keyboard is NOT in charge (desktop, iOS, Android) so the device's
 * own keyboard opens with the right keys.
 */
export const LAYOUT_TO_NATIVE_INPUT_MODE: Record<TouchKeyboardLayout, NativeInputMode> = {
  NUMERIC: "numeric",
  CURRENCY: "decimal",
  PHONE: "tel",
  QWERTY: "text",
};

interface UseTouchFieldOptions {
  value: string;
  onChange: (value: string) => void;
  layout: TouchKeyboardLayout;
  maxLength?: number;
  /** Set false to opt a field out even in touch mode (rare — none of this app's fields need it today). */
  enabled?: boolean;
  /**
   * Overrides the layout's default native inputMode for the native-keyboard
   * path only. For a NUMERIC field that accepts decimals (the custom NUMERIC
   * pad has a "." key, the OS "numeric" keyboard does not on iOS) or one that
   * historically used the phone pad.
   */
  nativeInputMode?: NativeInputMode;
}

interface UseTouchFieldResult {
  /** True only while this field is driven by the CUSTOM on-screen keyboard (never on iOS/Android). */
  touchActive: boolean;
  /**
   * Spread onto the underlying <input>/<textarea>, AFTER any of the field's
   * own props.
   *
   * Custom-keyboard mode (Windows-touch workaround): sets `inputMode="none"`
   * so the OS/browser's own virtual keyboard does not ALSO try to open
   * (which is the actual Windows+Chrome bug this whole system exists to work
   * around) while opening our on-screen keyboard on focus. The input stays a
   * real, focusable, controlled element — never `readOnly` (which would kill
   * the caret) — so a physical keyboard, if one is plugged in, keeps working.
   *
   * Everywhere else (desktop, iOS, Android): only a native `inputMode`
   * matching the layout, so the device's own keyboard opens normally with
   * the right keys. No focus handler is attached.
   */
  fieldProps: { inputMode: NativeInputMode; onFocus?: () => void };
}

/**
 * Opts a single controlled input/textarea into the shared on-screen
 * TouchKeyboard. Each call site keeps its own value/onChange exactly as
 * before — this only adds the touch-specific wiring.
 */
export function useTouchField({ value, onChange, layout, maxLength, enabled = true, nativeInputMode }: UseTouchFieldOptions): UseTouchFieldResult {
  const id = useId();
  const { active, open, sync, close } = useTouchKeyboardContext();
  const { customKeyboardActive } = useInputMode();
  const isActive = customKeyboardActive && enabled;

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
    return { touchActive: false, fieldProps: { inputMode: nativeInputMode ?? LAYOUT_TO_NATIVE_INPUT_MODE[layout] } };
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
