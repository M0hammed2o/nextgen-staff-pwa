import { useInputMode } from "@/hooks/useInputMode";
import type { InputModeSetting } from "@/lib/touch-input";
import { cn } from "@/lib/utils";

const OPTIONS: { value: InputModeSetting; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "touch", label: "Touchscreen" },
  { value: "keyboard", label: "Keyboard + Mouse" },
];

/**
 * A per-DEVICE (not per-business) preference — see src/lib/touch-input.ts.
 * Reused on both the Login screen (compact — a cashier may hit an unusable
 * native keyboard before any profile page exists to fix it from) and the
 * full Profile page.
 */
export default function InputModeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useInputMode();

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      <p className={cn("font-medium text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
        POS Input Mode
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value)}
            className={cn(
              "rounded-lg text-center font-medium transition-colors",
              compact ? "h-9 px-1 text-[11px]" : "h-11 px-2 text-xs",
              mode === opt.value ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>
        Auto guesses from this screen — it can't detect whether a physical keyboard is
        plugged in. Choose Touchscreen or Keyboard + Mouse to be sure.
      </p>
    </div>
  );
}
