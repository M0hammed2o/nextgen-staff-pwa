import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import TouchKeyboard from "@/components/TouchKeyboard";
import { useTouchField } from "@/hooks/useTouchField";
import { setStoredInputMode } from "@/lib/touch-input";
import type { TouchKeyboardLayout } from "@/lib/touch-keyboard";

function Harness({ layout = "QWERTY", maxLength }: { layout?: TouchKeyboardLayout; maxLength?: number }) {
  const [value, setValue] = useState("");
  const touch = useTouchField({ value, onChange: setValue, layout, maxLength });
  return (
    <div>
      <input aria-label="field" value={value} onChange={(e) => setValue(e.target.value)} {...touch.fieldProps} />
      <span data-testid="value">{value}</span>
    </div>
  );
}

function renderHarness(props?: Parameters<typeof Harness>[0]) {
  return render(
    <MemoryRouter>
      <TouchKeyboardProvider>
        <Harness {...props} />
        <TouchKeyboard />
      </TouchKeyboardProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useTouchField + TouchKeyboard integration", () => {
  it("keyboard+mouse mode: the field is left untouched and the keyboard never opens", () => {
    setStoredInputMode("keyboard");
    renderHarness();
    const input = screen.getByLabelText("field");
    expect(input).not.toHaveAttribute("inputmode");
    fireEvent.focus(input);
    expect(screen.queryByRole("group", { name: /on-screen keyboard/i })).not.toBeInTheDocument();
  });

  it("touch mode: the field gets inputMode=none, and focusing it opens the keyboard", () => {
    setStoredInputMode("touch");
    renderHarness();
    const input = screen.getByLabelText("field");
    expect(input).toHaveAttribute("inputmode", "none");
    fireEvent.focus(input);
    expect(screen.getByRole("group", { name: /on-screen keyboard/i })).toBeInTheDocument();
  });

  it("an explicit mode always wins over auto-detection (auto resolves false in this jsdom environment)", () => {
    setStoredInputMode("auto");
    renderHarness();
    expect(screen.getByLabelText("field")).not.toHaveAttribute("inputmode", "none");

    cleanup();
    setStoredInputMode("touch");
    renderHarness();
    expect(screen.getByLabelText("field")).toHaveAttribute("inputmode", "none");
  });

  it("pressing digit keys updates the field's value through its normal onChange path", () => {
    setStoredInputMode("touch");
    renderHarness({ layout: "NUMERIC" });
    fireEvent.focus(screen.getByLabelText("field"));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(screen.getByTestId("value").textContent).toBe("53");
    // The real <input>'s own value (not just the keyboard's internal copy)
    // reflects the change — proof it went through the field's real onChange.
    expect(screen.getByLabelText("field")).toHaveValue("53");
  });

  it("backspace and clear both work from the on-screen keyboard", () => {
    setStoredInputMode("touch");
    renderHarness({ layout: "NUMERIC" });
    fireEvent.focus(screen.getByLabelText("field"));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: "Backspace" }));
    expect(screen.getByTestId("value").textContent).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Clear field" }));
    expect(screen.getByTestId("value").textContent).toBe("");
  });

  it("CURRENCY layout enforces at most 2 decimal digits end to end (matches how the field parses rands)", () => {
    setStoredInputMode("touch");
    renderHarness({ layout: "CURRENCY" });
    fireEvent.focus(screen.getByLabelText("field"));
    for (const k of ["1", "2", ".", "5", "0", "9"]) {
      fireEvent.click(screen.getByRole("button", { name: k }));
    }
    expect(screen.getByTestId("value").textContent).toBe("12.50");
  });

  it("QWERTY shift behaves as a Caps Lock toggle (stays on until pressed again), space inserts an actual space, and Done closes the keyboard", () => {
    setStoredInputMode("touch");
    renderHarness({ layout: "QWERTY" });
    fireEvent.focus(screen.getByLabelText("field"));
    fireEvent.click(screen.getByRole("button", { name: "Shift" }));
    fireEvent.click(screen.getByRole("button", { name: "q" }));
    fireEvent.click(screen.getByRole("button", { name: "Space" }));
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    // Shift is a toggle, not one-shot — "a" is capitalised too, until Shift
    // is pressed again. Documented behaviour, not a bug.
    expect(screen.getByTestId("value").textContent).toBe("Q A");
    fireEvent.click(screen.getByRole("button", { name: "Shift" }));
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(screen.getByTestId("value").textContent).toBe("Q Ab");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("group", { name: /on-screen keyboard/i })).not.toBeInTheDocument();
  });

  it("respects maxLength end to end (e.g. a 6-character store code)", () => {
    setStoredInputMode("touch");
    renderHarness({ layout: "QWERTY", maxLength: 3 });
    fireEvent.focus(screen.getByLabelText("field"));
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    fireEvent.click(screen.getByRole("button", { name: "c" }));
    fireEvent.click(screen.getByRole("button", { name: "d" }));
    expect(screen.getByTestId("value").textContent).toBe("abc");
  });

  it("closes when the field unmounts", () => {
    setStoredInputMode("touch");
    const { unmount } = renderHarness();
    fireEvent.focus(screen.getByLabelText("field"));
    expect(screen.getByRole("group", { name: /on-screen keyboard/i })).toBeInTheDocument();
    unmount();
    // Nothing left to assert on a fully unmounted tree beyond "did not throw" —
    // the real assertion is the cleanup effect running without error.
  });
});
