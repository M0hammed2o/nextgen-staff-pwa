import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

export type TouchKeyboardLayout = "NUMERIC" | "CURRENCY" | "PHONE" | "QWERTY";

export interface TouchKeyboardField {
  /** Stable per-mount identity (from React's useId()) so a second field's focus safely takes over the keyboard, and a stale close() from an unmounted field can never clear a newer one. */
  id: string;
  value: string;
  layout: TouchKeyboardLayout;
  onChange: (value: string) => void;
  /** Optional cap matching the underlying input's own maxLength, if any. */
  maxLength?: number;
  /** Called when "Done" is pressed, before the keyboard closes. */
  onDone?: () => void;
}

interface TouchKeyboardContextValue {
  active: TouchKeyboardField | null;
  open: (field: TouchKeyboardField) => void;
  /** Keeps the keyboard's copy of the value in sync when it changes from outside (e.g. a quick-amount button writing the input's value directly) while this field owns the keyboard. */
  sync: (id: string, value: string) => void;
  /** No-ops unless `id` matches the currently active field (or is omitted) — a stale unmount from a field that's no longer active must never clear a newer one. */
  close: (id?: string) => void;
}

const TouchKeyboardContext = createContext<TouchKeyboardContextValue | null>(null);

export function TouchKeyboardProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<TouchKeyboardField | null>(null);
  const location = useLocation();

  const open = useCallback((field: TouchKeyboardField) => {
    setActive(field);
  }, []);

  const sync = useCallback((id: string, value: string) => {
    setActive((prev) => (prev && prev.id === id ? { ...prev, value } : prev));
  }, []);

  const close = useCallback((id?: string) => {
    setActive((prev) => (!id || prev?.id === id ? null : prev));
  }, []);

  // Close on route change — a field that navigated away is no longer on screen.
  useEffect(() => {
    setActive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const value = useMemo(() => ({ active, open, sync, close }), [active, open, sync, close]);

  return <TouchKeyboardContext.Provider value={value}>{children}</TouchKeyboardContext.Provider>;
}

export function useTouchKeyboardContext(): TouchKeyboardContextValue {
  const ctx = useContext(TouchKeyboardContext);
  if (!ctx) throw new Error("useTouchKeyboardContext must be used within TouchKeyboardProvider");
  return ctx;
}

/**
 * For components with their OWN nested scroll region (a Radix Dialog body
 * using `overflow-y-auto`, which a plain `body`-level padding cannot
 * reach) — spread the result onto that scrolling element's `style` so its
 * content (and any pinned action button at the bottom of it) can scroll
 * into view above the on-screen keyboard while it's open, instead of being
 * permanently hidden behind it.
 */
export function useTouchKeyboardSpacerStyle(): CSSProperties {
  const { active } = useTouchKeyboardContext();
  return active ? { paddingBottom: "var(--touch-keyboard-height, 0px)" } : {};
}
