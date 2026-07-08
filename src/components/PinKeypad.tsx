interface PinKeypadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
}

// Layout: 1-9, then CLR / 0 / ⌫
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clr", "0", "back"] as const;

export default function PinKeypad({ value, onChange, maxLength = 4, disabled = false }: PinKeypadProps) {
  const handle = (key: string) => {
    if (disabled) return;
    if (key === "back") {
      onChange(value.slice(0, -1));
    } else if (key === "clr") {
      onChange("");
    } else if (value.length < maxLength) {
      onChange(value + key);
    }
  };

  return (
    <div className="flex flex-col items-center gap-8">
      {/* PIN dots */}
      <div className="flex gap-5" role="group" aria-label="PIN progress">
        {Array.from({ length: maxLength }).map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
              i < value.length
                ? "bg-primary border-primary scale-110"
                : "border-muted-foreground/40"
            }`}
          />
        ))}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
        {KEYS.map((key) => {
          const isAction = key === "clr" || key === "back";
          return (
            <button
              key={key}
              type="button"
              onClick={() => handle(key)}
              disabled={disabled}
              aria-label={key === "back" ? "Backspace" : key === "clr" ? "Clear" : key}
              className={[
                "h-16 rounded-2xl text-xl font-semibold",
                "transition-all duration-75 active:scale-90 select-none",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                isAction
                  ? "bg-secondary/60 text-muted-foreground text-base"
                  : "bg-secondary text-foreground hover:bg-secondary/70",
                disabled ? "opacity-50 pointer-events-none" : "",
              ].join(" ")}
            >
              {key === "back" ? "⌫" : key === "clr" ? "CLR" : key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
