import { describe, it, expect } from "vitest";
import { applyKeyToValue } from "@/lib/touch-keyboard-logic";

describe("applyKeyToValue — NUMERIC layout", () => {
  it("appends digits", () => {
    expect(applyKeyToValue("NUMERIC", "1", "2")).toBe("12");
  });

  it("allows one decimal point", () => {
    expect(applyKeyToValue("NUMERIC", "12", ".")).toBe("12.");
  });

  it("ignores a second decimal point", () => {
    expect(applyKeyToValue("NUMERIC", "12.5", ".")).toBe("12.5");
  });

  it("backspace removes the last character", () => {
    expect(applyKeyToValue("NUMERIC", "12.5", "back")).toBe("12.");
  });

  it("clear empties the value", () => {
    expect(applyKeyToValue("NUMERIC", "12.5", "clear")).toBe("");
  });

  it("respects maxLength", () => {
    expect(applyKeyToValue("NUMERIC", "123", "4", 3)).toBe("123");
  });
});

describe("applyKeyToValue — CURRENCY layout", () => {
  it("appends digits before the decimal point freely", () => {
    expect(applyKeyToValue("CURRENCY", "1", "2")).toBe("12");
  });

  it("allows exactly 2 digits after the decimal point", () => {
    let v = applyKeyToValue("CURRENCY", "12", ".");
    v = applyKeyToValue("CURRENCY", v, "5");
    v = applyKeyToValue("CURRENCY", v, "0");
    expect(v).toBe("12.50");
  });

  it("rejects a third decimal digit — matches how the field parses (rands, 2dp)", () => {
    const v = applyKeyToValue("CURRENCY", "12.50", "9");
    expect(v).toBe("12.50");
  });

  it("ignores a second decimal point", () => {
    expect(applyKeyToValue("CURRENCY", "12.5", ".")).toBe("12.5");
  });

  it("ignores non-digit, non-decimal keys", () => {
    expect(applyKeyToValue("CURRENCY", "12", "a")).toBe("12");
  });
});

describe("applyKeyToValue — PHONE layout", () => {
  it("appends digits", () => {
    expect(applyKeyToValue("PHONE", "082", "5")).toBe("0825");
  });

  it("allows a leading +", () => {
    expect(applyKeyToValue("PHONE", "", "+")).toBe("+");
  });

  it("ignores + once the number already has content", () => {
    expect(applyKeyToValue("PHONE", "082", "+")).toBe("082");
  });

  it("ignores non-digit, non-plus keys", () => {
    expect(applyKeyToValue("PHONE", "082", ".")).toBe("082");
  });
});

describe("applyKeyToValue — QWERTY layout", () => {
  it("appends any printable character (letters, digits, symbols, space)", () => {
    expect(applyKeyToValue("QWERTY", "hi", " ")).toBe("hi ");
    expect(applyKeyToValue("QWERTY", "hi there", "!")).toBe("hi there!");
  });

  it("respects maxLength (e.g. a 6-character store code)", () => {
    expect(applyKeyToValue("QWERTY", "ONU9XE", "Z", 6)).toBe("ONU9XE");
  });

  it("backspace and clear work the same as every other layout", () => {
    expect(applyKeyToValue("QWERTY", "hello", "back")).toBe("hell");
    expect(applyKeyToValue("QWERTY", "hello", "clear")).toBe("");
  });

  it("case is decided by the caller (component applies shift/caps before calling this)", () => {
    expect(applyKeyToValue("QWERTY", "", "A")).toBe("A");
    expect(applyKeyToValue("QWERTY", "", "a")).toBe("a");
  });
});
