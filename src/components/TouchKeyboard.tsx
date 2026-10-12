import { useEffect, useRef, useState } from "react";
import { Delete, ChevronUp } from "lucide-react";
import { useTouchKeyboardContext } from "@/lib/touch-keyboard";
import { applyKeyToValue } from "@/lib/touch-keyboard-logic";
import { cn } from "@/lib/utils";

// Used only for the very first paint of a given keyboard session, before a
// ResizeObserver has had a chance to report the real, rendered height (the
// QWERTY layout's 3 rows + space bar is visibly taller than the numeric
// layout's 4 rows, and the previous single fixed constant under-estimated
// both — the bottom key row was clipped). The real height, which is what
// every consumer of --touch-keyboard-height (dialog.tsx, BottomNav, page
// layouts) actually gets, is measured live below.
const FALLBACK_KEYBOARD_HEIGHT_PX = 300;

// Landscape phones (~375-430px tall). The full-size keyboard is ~325px tall
// in every layout, which left a dialog above it only 30-50px -- not enough to
// show even the field being typed into (Playwright viewport suite, 844x390 /
// 667x375 / 915x412). On a screen this short the SAME 56px keys are arranged
// flatter instead of being shrunk: the numeric pad becomes 6 columns x 2 rows,
// and the QWERTY layout's Clear/Done move into its space-bar row.
const SHORT_VIEWPORT_QUERY = "(max-height: 500px)";

function useShortViewport(): boolean {
  const [short, setShort] = useState<boolean>(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(SHORT_VIEWPORT_QUERY).matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(SHORT_VIEWPORT_QUERY);
    const update = () => setShort(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return short;
}

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
        "flex select-none items-center justify-center rounded-xl bg-secondary text-base font-semibold text-foreground shadow-sm transition-colors duration-fast",
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState(FALLBACK_KEYBOARD_HEIGHT_PX);
  const shortViewport = useShortViewport();

  // Measure the REAL rendered height (previously a single hardcoded
  // KEYBOARD_HEIGHT_PX=300 constant under-estimated it — the numeric
  // layout's bottom row, '.', '0' and backspace, was clipped to 31 of 56px
  // visible). The panel's own height is intrinsic (no inline height is set
  // below), so this purely reads it; it never feeds back into its own size.
  useEffect(() => {
    const el = rootRef.current;
    if (!active || !el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // contentRect EXCLUDES the root's own padding (pt-3/pb-*, ~24px) and
      // border-t (1px) -- it measures only the content box, not what the
      // element actually occupies on screen. Use the border box instead
      // (what every consumer of --touch-keyboard-height needs to know to
      // leave room for), falling back to offsetHeight -- which also
      // includes padding/border -- for environments where borderBoxSize
      // isn't populated (some WebKit versions).
      const h = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
      if (h) setMeasuredHeight(Math.ceil(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
    // Re-attach whenever a field newly takes over the keyboard (a fresh
    // mount): the ref itself doesn't change identity, but this guarantees a
    // synchronous first measurement rather than waiting on stale state.
  }, [Boolean(active)]);

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
      root.style.setProperty("--touch-keyboard-height", `${measuredHeight}px`);
      document.body.classList.add("touch-keyboard-open");
    } else {
      root.style.setProperty("--touch-keyboard-height", "0px");
      document.body.classList.remove("touch-keyboard-open");
    }
    return () => {
      root.style.setProperty("--touch-keyboard-height", "0px");
      document.body.classList.remove("touch-keyboard-open");
    };
  }, [active, measuredHeight]);

  // Keep the field being edited on screen. Publishing the keyboard height
  // shrinks every open dialog (components/ui/dialog.tsx) and pads the page,
  // but nothing moved the focused field itself: on a short phone (320x568,
  // QWERTY layout) the mobile cart's Name field ended up below the shrunken
  // dialog's visible area, i.e. typed into while invisible. One nudge per
  // field takeover / real height change, after the new height has applied.
  // block "nearest" + the scroll-padding set on <html> (index.css) and on
  // dialogs (dialog.tsx) lands it above the keyboard and above any sticky
  // action row, and never scrolls when the field is already visible.
  //
  // Twice on purpose: once after the next frame (pages, which re-pad
  // instantly) and once after the dialog has finished resizing --
  // DialogContent's `duration-200` (transition-property defaults to `all`)
  // animates its max-height/top over 200ms, and a nudge that only ran
  // mid-animation saw the field as "already visible" in a box that was still
  // shrinking (verified in Chromium: clientHeight 534 -> 411 -> 211).
  useEffect(() => {
    if (!active) return;
    const nudge = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      if (el.closest("[data-touch-keyboard-root]")) return;
      if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = requestAnimationFrame(nudge);
      timer = setTimeout(nudge, 260);
    };
    schedule();
    // Also on every re-focus while the keyboard stays up: tapping the SAME
    // field again (same id, so this effect would not re-run) after it was
    // scrolled partly behind a sticky action row must bring it back too.
    document.addEventListener("focusin", schedule);
    return () => {
      document.removeEventListener("focusin", schedule);
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, measuredHeight]);

  // Reset transient QWERTY state whenever a different field takes over.
  useEffect(() => {
    setQwertyMode("letters");
    setCaps(false);
    setMeasuredHeight(FALLBACK_KEYBOARD_HEIGHT_PX);
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
      <div className={cn("mx-auto grid w-full gap-2", shortViewport ? "max-w-2xl grid-cols-6" : "max-w-sm grid-cols-3")}>
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

  // One definition for both placements (own row, or the short-screen QWERTY
  // space-bar row) so the two can never drift apart.
  function renderClearDone(inline: boolean) {
    const height = inline ? "h-14" : "h-12";
    return (
      <>
        <KeyButton label="clear" ariaLabel="Clear field" onPress={press} className={cn(height, "px-4 text-sm text-muted-foreground")} display="Clear" />
        <KeyButton
          label="done"
          ariaLabel="Done"
          onPress={press}
          className={cn(height, inline ? "w-24" : "flex-1", "bg-brand px-4 text-sm font-semibold text-brand-foreground active:bg-brand-active")}
          display="Done"
        />
      </>
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
                  className={cn("h-14 flex-1 text-base", isWide ? "max-w-[64px] flex-[1.4]" : "max-w-[44px]")}
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
            className="h-14 w-20 text-sm"
            display={qwertyMode === "letters" ? "123" : "ABC"}
          />
          <KeyButton label="space" ariaLabel="Space" onPress={press} className="h-14 flex-1 max-w-xs text-sm" display="Space" />
          {shortViewport && renderClearDone(true)}
        </div>
      </div>
    );
  }

  return (
    <div
      data-touch-keyboard-root=""
      // pointer-events-auto is load-bearing, not decorative: any open Radix
      // Dialog sets `body.block-interactivity-*` (react-remove-scroll, see
      // node_modules/react-remove-scroll/.../SideEffect.js) to
      // `pointer-events: none`, and only the dialog's own Overlay/Content
      // are added to the `allow-interactivity-*` "shards" allow-list. This
      // keyboard is mounted at the app root, outside every dialog's portal,
      // so without this explicit override every tap on it is excluded from
      // hit-testing and falls through to whatever DOM node is underneath —
      // which is exactly how a tap on a key could reach a hidden button
      // behind the keyboard (e.g. "Complete sale"). Dialog.tsx's
      // onPointerDownOutside/onInteractOutside guard (isTouchKeyboardTarget)
      // only works once taps actually land on this element, which requires
      // this override. Radix also aria-hides this element while a modal is
      // open (`hideOthers` from the `aria-hidden` package, dialog.tsx ~L17),
      // which is a real but lower-severity screen-reader-only gap — it does
      // not affect pointer/click hit-testing (verified: Radix calls
      // `hideOthers`, not `suppressOthers`/`inertOthers`, so it never sets
      // the `inert` attribute, only `aria-hidden`).
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-[90] border-t border-border bg-card pb-[max(0.75rem,var(--safe-area-bottom))] pl-[max(0.75rem,var(--safe-area-left))] pr-[max(0.75rem,var(--safe-area-right))] pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
      ref={rootRef}
      role="group"
      aria-label="On-screen keyboard"
    >
      <div className="flex flex-col">
        <div>
          {active.layout === "NUMERIC" && renderNumericLike(NUMERIC_ROWS)}
          {active.layout === "CURRENCY" && renderNumericLike(NUMERIC_ROWS)}
          {active.layout === "PHONE" && renderNumericLike(PHONE_ROWS)}
          {active.layout === "QWERTY" && renderQwerty()}
        </div>
        {!(shortViewport && active.layout === "QWERTY") && (
          <div className="mt-2 flex justify-end gap-2">{renderClearDone(false)}</div>
        )}
      </div>
    </div>
  );
}
