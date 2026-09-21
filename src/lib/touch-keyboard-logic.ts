import type { TouchKeyboardLayout } from "@/lib/touch-keyboard";

/**
 * Pure "apply one keypress to the current value" logic, kept separate from
 * the rendering component so it can be unit-tested without mounting React.
 *
 * `key` is the literal character to insert for a printable key ("5", ".",
 * "+", "a", "A", " "), or one of the control tokens: "back" | "clear".
 * Layout/shift/mode-toggle keys ("shift", "123", "ABC", "done") are handled
 * by the component itself, before this function is ever called, since they
 * don't insert anything.
 */
export function applyKeyToValue(
  layout: TouchKeyboardLayout,
  current: string,
  key: string,
  maxLength?: number
): string {
  if (key === "back") return current.slice(0, -1);
  if (key === "clear") return "";

  if (layout === "CURRENCY") {
    if (key === ".") {
      return current.includes(".") ? current : current + ".";
    }
    if (!/^[0-9]$/.test(key)) return current;
    const dotIndex = current.indexOf(".");
    // Rands with (at most) 2 decimal places — matches how every currency
    // field on this till already parses its value (parseFloat, cents
    // computed server-side); this only stops the ON-SCREEN keyboard from
    // typing a third decimal digit, it never changes what gets sent.
    if (dotIndex !== -1 && current.length - dotIndex - 1 >= 2) return current;
    return withinMax(current + key, maxLength);
  }

  if (layout === "NUMERIC") {
    if (key === ".") {
      return current.includes(".") ? current : current + ".";
    }
    if (!/^[0-9]$/.test(key)) return current;
    return withinMax(current + key, maxLength);
  }

  if (layout === "PHONE") {
    if (key === "+") {
      // A leading "+" is the only sane position for one on a phone number.
      return current.length === 0 ? "+" : current;
    }
    if (!/^[0-9]$/.test(key)) return current;
    return withinMax(current + key, maxLength);
  }

  // QWERTY — any single printable character (letter, digit, symbol, space).
  return withinMax(current + key, maxLength);
}

function withinMax(next: string, maxLength?: number): string {
  if (maxLength != null && next.length > maxLength) return next.slice(0, maxLength);
  return next;
}
