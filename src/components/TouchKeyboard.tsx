import { useEffect, useState } from "react";
import { Delete, ChevronUp } from "lucide-react";
import { useTouchKeyboardContext } from "@/lib/touch-keyboard";
import { applyKeyToValue } from "@/lib/touch-keyboard-logic";
import { cn } from "@/lib/utils";

// Kept as one constant rather than measured per-layout — simpler, and every
// layout's panel is close enough in height (4 rows of comfortably-sized
// keys) that a single reserved height is a good enough approximation for
// "don't cover the field/total/Pay button", without needing a
// ResizeObserver for a fixed, non-resizing panel.
const KEYBOARD_HEIGHT_PX = 300;

const NUMERIC_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
];

const PHONE_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["+", "0", "back"],
];

const QWERTY_LETTERS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["shift", "z", "x", "c", "v", "b", "n", "m", "back"],
];

const QWERTY_SYMBOLS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["-", "/", ":", ";", "(", ")", "@", "'"],
  ["ABC", ".", ",", "?", "!", "back"],
];

function KeyButton({
  label,
  display,
  onPress,
  className,
  ariaLabel,
}: {
  label: string;
  display: React.ReactNode;
  onPress: (key: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      // Prevent the button from ever taking DOM focus away from the real
      // input being edited — without this, tapping a key would blur the
      // input (losing the caret) even though the value keeps updating.
      // This is the standard technique on-screen keyboards use everywhere.
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onPress(label)}
      className={cn(
        "flex items-center justify-center rounded-xl bg-secondary text-base font-semibold text-foreground",
        "select-none transition-transform active:scale-90 active:bg-secondary/70",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className
      )}
    >
      {display}
    </button>
  );
}

/**
 * The single on-screen keyboard host, mounted once at the app root
 * (App.tsx). Renders nothing unless a field opted in via useTouchField()
 * has focus. See src/lib/touch-keyboard.tsx for the shared state and
 * src/lib/touch-keyboard-logic.ts for the (separately unit-tested)
 * per-keypress value logic.
 */
export default function TouchKeyboard() {
  const { active, close } = useTouchKeyboardContext();
  const [qwertyMode, setQwertyMode] = useState<"letters" | "symbols">("letters");
  const [caps, setCaps] = useState(false);

  // A dialog open elsewhere in the app must not close itself just because a
  // tap landed on this keyboard (see the matching onPointerDownOutside
  // guard in components/ui/dialog.tsx, which looks for this attribute) —
  // and pages/pieces that want to leave room for the keyboard (so it never
  // covers the field being edited or the checkout/Pay action) read this via
  // the --touch-keyboard-height CSS variable and the touch-keyboard-open
  // body class this effect sets.
  useEffect(() => {
    const root = document.documentElement;
    if (active) {
      root.style.setProperty("--touch-keyboard-height", `${KEYBOARD_HEIGHT_PX}px`);
      document.body.classList.add("touch-keyboard-open");
    } else {
      root.style.setProperty("--touch-keyboard-height", "0px");
      document.body.classList.remove("touch-keyboard-open");
    }
    return () => {
      root.style.setProperty("--touch-keyboard-height", "0px");
      document.body.classList.remove("touch-keyboard-open");
    };
  }, [active]);

  // Reset transient QWERTY state whenever a different field takes over.
  useEffect(() => {
    setQwertyMode("letters");
    setCaps(false);
  }, [active?.id]);

  if (!active) return null;

  function press(key: string) {
    if (!active) return;
    if (key === "shift") {
      // Caps-Lock behaviour (stays on until pressed again), not a real
      // phone keyboard's one-shot shift — simpler to implement and reason
      // about, and good enough for the short, mostly-single-case fields
      // this keyboard is used for (store codes, reasons, notes).
      setCaps((c) => !c);
      return;
    }
    if (key === "123") {
      setQwertyMode("symbols");
      return;
    }
    if (key === "ABC") {
      setQwertyMode("letters");
      return;
    }
    if (key === "done") {
      active.onDone?.();
      close(active.id);
      return;
    }
    // "space" is a button TOKEN, not the literal character to insert —
    // translate it before it ever reaches applyKeyToValue(), or the literal
    // 5-character string "space" gets typed instead of a space.
    const literal = key === "space" ? " " : key;
    const char = active.layout === "QWERTY" && qwertyMode === "letters" && literal.length === 1 && /[a-z]/.test(literal)
      ? (caps ? literal.toUpperCase() : literal)
      : literal;
    active.onChange(applyKeyToValue(active.layout, active.value, char, active.maxLength));
  }

  function renderNumericLike(rows: string[][]) {
    return (
      <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-2">
        {rows.flat().map((key, i) => (
          <KeyButton
            key={`${key}-${i}`}
            label={key}
            ariaLabel={key === "back" ? "Backspace" : key}
            onPress={press}
            className="h-14 text-xl"
            display={key === "back" ? <Delete className="h-5 w-5" /> : key}
          />
        ))}
      </div>
    );
  }

  function renderQwerty() {
    const rows = qwertyMode === "letters" ? QWERTY_LETTERS : QWERTY_SYMBOLS;
    return (
      <div className="mx-auto w-full max-w-2xl space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex justify-center gap-1.5">
            {row.map((key) => {
              const isWide = key === "shift" || key === "back" || key === "123" || key === "ABC";
              const displayLabel =
                key === "back" ? <Delete className="h-4 w-4" /> :
                key === "shift" ? <ChevronUp className="h-4 w-4" /> :
                qwertyMode === "letters" && caps ? key.toUpperCase() : key;
              return (
                <KeyButton
                  key={key}
                  label={key}
                  ariaLabel={key === "back" ? "Backspace" : key === "shift" ? "Shift" : key}
                  onPress={press}
                  className={cn("h-12 flex-1 text-sm", isWide ? "max-w-[64px] flex-[1.4]" : "max-w-[44px]")}
                  display={displayLabel}
                />
              );
            })}
          </div>
        ))}
        <div className="flex justify-center gap-1.5">
          <KeyButton
            label={qwertyMode === "letters" ? "123" : "ABC"}
            ariaLabel={qwertyMode === "letters" ? "Numbers and symbols" : "Letters"}
            onPress={press}
            className="h-12 w-20 text-xs"
            display={qwertyMode === "letters" ? "123" : "ABC"}
          />
          <KeyButton label="space" ariaLabel="Space" onPress={press} className="h-12 flex-1 max-w-xs text-sm" display="Space" />
        </div>
      </div>
    );
  }

  return (
    <div
      data-touch-keyboard-root=""
      className="fixed inset-x-0 bottom-0 z-[90] border-t border-border bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
      style={{ height: KEYBOARD_HEIGHT_PX }}
      role="group"
      aria-label="On-screen keyboard"
    >
      <div className="flex h-full flex-col justify-between">
        <div className="flex-1 overflow-hidden">
          {active.layout === "NUMERIC" && renderNumericLike(NUMERIC_ROWS)}
          {active.layout === "CURRENCY" && renderNumericLike(NUMERIC_ROWS)}
          {active.layout === "PHONE" && renderNumericLike(PHONE_ROWS)}
          {active.layout === "QWERTY" && renderQwerty()}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <KeyButton label="clear" ariaLabel="Clear field" onPress={press} className="h-11 px-4 text-sm text-muted-foreground" display="Clear" />
          <KeyButton label="done" ariaLabel="Done" onPress={press} className="h-11 flex-1 bg-primary px-4 text-sm font-semibold text-primary-foreground active:bg-primary/90" display="Done" />
        </div>
      </div>
    </div>
  );
}
