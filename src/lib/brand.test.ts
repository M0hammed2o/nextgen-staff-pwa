import { describe, expect, it } from "vitest";

import {
  AA_LARGE,
  AA_NORMAL,
  NON_TEXT_MIN,
  NEXTGEN_DEFAULT_BRAND,
  applyBrandTokens,
  contrastHsl,
  contrastRatio,
  deriveBrand,
  ensureContrast,
  hexToHsl,
  hexToRgb,
  hslToRgb,
  hslVar,
  isSafeForSmallText,
  readableTextOn,
  relativeLuminance,
  rgbToHsl,
} from "./brand";

/** Parse a `"H S% L%"` custom-property value back into numbers. */
function parseVar(v: string) {
  const m = v.match(/^(-?\d+) (\d+)% (\d+)%$/);
  if (!m) throw new Error(`not an HSL var: ${v}`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

const CHARCOAL = { h: 0, s: 0, l: 11 };
const WHITE = { h: 0, s: 0, l: 100 };

describe("colour space conversions", () => {
  it("round-trips hex through HSL without drifting more than a rounding step", () => {
    for (const hex of ["#1574c1", "#F7F7F5", "#000000", "#FFFFFF", "#D4AF37", "#2E7D32"]) {
      const hsl = hexToHsl(hex)!;
      const back = rgbToHsl(hslToRgb(hsl));
      expect(Math.abs(back.l - hsl.l)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.s - hsl.s)).toBeLessThanOrEqual(2);
    }
  });

  it("accepts 3-digit hex and a missing leading #", () => {
    expect(hexToRgb("fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("rejects nonsense rather than guessing", () => {
    expect(hexToRgb("not-a-colour")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
    expect(hexToHsl("")).toBeNull();
  });
});

describe("WCAG contrast", () => {
  it("matches the known reference values for black and white", () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(relativeLuminance(black)).toBeCloseTo(0, 5);
  });

  it("is order-independent", () => {
    const a = { r: 21, g: 116, b: 193 };
    const b = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe("readableTextOn", () => {
  it("puts white on a dark brand and charcoal on a light one", () => {
    expect(readableTextOn(hexToHsl("#111111")!)).toEqual(WHITE);
    expect(readableTextOn(hexToHsl("#FFE600")!)).toEqual(CHARCOAL);
  });

  it("always returns the genuinely higher-contrast option, including mid-tones", () => {
    // Mid-tones are the cases a luminance-threshold guess gets wrong, so assert
    // the measured property rather than a specific expected colour.
    for (const hex of ["#1574c1", "#2E7D32", "#C62828", "#7B1FA2", "#00897B", "#808080"]) {
      const bg = hexToHsl(hex)!;
      const chosen = readableTextOn(bg);
      const other = chosen === WHITE ? CHARCOAL : WHITE;
      expect(contrastHsl(bg, chosen)).toBeGreaterThanOrEqual(contrastHsl(bg, other));
    }
  });
});

describe("ensureContrast", () => {
  it("leaves a colour alone when it already passes", () => {
    const dark = hexToHsl("#1A1A1A")!;
    expect(ensureContrast(dark, WHITE, AA_LARGE)).toEqual(dark);
  });

  it("darkens a too-light colour until it passes, keeping its hue", () => {
    const pale = hexToHsl("#9BE7FF")!;
    const fixed = ensureContrast(pale, WHITE, AA_LARGE);
    expect(contrastHsl(fixed, WHITE)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(fixed.l).toBeLessThan(pale.l);
    expect(fixed.h).toBe(pale.h); // identity preserved
  });

  it("gives up gracefully instead of looping on an impossible request", () => {
    // Pure yellow can never reach 21:1 against white. It must still return a
    // sane in-hue colour rather than hang or throw.
    const yellow = hexToHsl("#FFFF00")!;
    const best = ensureContrast(yellow, WHITE, 21);
    expect(best.h).toBe(yellow.h);
    expect(best.l).toBeGreaterThanOrEqual(0);
    expect(best.l).toBeLessThanOrEqual(100);
  });
});

describe("deriveBrand — the contract the whole theme rests on", () => {
  const BRANDS: Array<[string, string]> = [
    ["BRAND A black/yellow", "#111111"],
    ["BRAND B green/cream", "#2E7D32"],
    ["BRAND C red/white", "#C62828"],
    ["BRAND D blue/white", "#1565C0"],
    ["bright yellow (worst case)", "#FFE600"],
    ["pale sky (too light)", "#9BE7FF"],
    ["near-white (pathological)", "#FDFDFD"],
  ];

  it.each(BRANDS)("%s: primary always carries its own label text at AA-large", (_name, hex) => {
    const { tokens, contrast } = deriveBrand({ primary: hex });
    const primary = parseVar(tokens["--brand-primary"]);
    const onPrimary = parseVar(tokens["--brand-on-primary"]);
    expect(contrastHsl(primary, onPrimary)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrast).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it.each(BRANDS)("%s: the soft tint keeps charcoal body text above AA-normal", (_name, hex) => {
    // This is what makes it safe to put small text on brand-tinted surfaces
    // (selected rows, active nav) for ANY restaurant colour.
    const { tokens } = deriveBrand({ primary: hex });
    const soft = parseVar(tokens["--brand-primary-soft"]);
    expect(contrastHsl(soft, CHARCOAL)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each(BRANDS)("%s: the fill stays VISIBLE against a white card (WCAG 1.4.11)", (_name, hex) => {
    // The guarantee that actually bites. A pale brand is perfectly legible and
    // yet invisible as a button on a white surface -- the cashier cannot see
    // where to press. 3:1 is the non-text contrast floor.
    const { tokens } = deriveBrand({ primary: hex });
    const primary = parseVar(tokens["--brand-primary"]);
    expect(contrastHsl(primary, WHITE)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });

  it("adjusts a near-invisible brand and leaves a strong one untouched", () => {
    // #9BE7FF reads fine with charcoal text but is far too pale to be seen as
    // a button on white -- it must be darkened.
    const pale = deriveBrand({ primary: "#9BE7FF" });
    expect(pale.adjusted).toBe(true);
    expect(pale.rawWasSafe).toBe(false);
    expect(contrastHsl(parseVar(pale.tokens["--brand-primary"]), WHITE)).toBeGreaterThanOrEqual(
      NON_TEXT_MIN
    );

    const strong = deriveBrand({ primary: "#1565C0" });
    expect(strong.adjusted).toBe(false);
    expect(strong.rawWasSafe).toBe(true);
  });

  it("does NOT darken a brand merely to make its label text fit", () => {
    // Legibility is solved by choosing the text colour. A mid-tone brand that
    // is clearly visible on white must come through at its exact lightness,
    // or the product would look like it had overridden the restaurant.
    for (const hex of ["#C62828", "#2E7D32", "#1565C0", "#7B1FA2"]) {
      const { tokens, adjusted } = deriveBrand({ primary: hex });
      expect(adjusted).toBe(false);
      expect(parseVar(tokens["--brand-primary"]).l).toBe(hexToHsl(hex)!.l);
    }
  });

  it("preserves the restaurant's exact colour in --brand-raw even when it adjusts --brand-primary", () => {
    const hex = "#9BE7FF";
    const { tokens } = deriveBrand({ primary: hex });
    expect(tokens["--brand-raw"]).toBe(hslVar(hexToHsl(hex)!));
    expect(tokens["--brand-primary"]).not.toBe(tokens["--brand-raw"]);
  });

  it("falls back to the NextGen default for empty, null and malformed input", () => {
    const expected = deriveBrand({ primary: NEXTGEN_DEFAULT_BRAND }).tokens["--brand-primary"];
    for (const bad of ["", "   ", null, undefined, "rgb(1,2,3)", "#ZZZZZZ"]) {
      expect(deriveBrand({ primary: bad as string | null }).tokens["--brand-primary"]).toBe(expected);
    }
  });

  it("aliases the shadcn tokens so existing primitives follow the brand unedited", () => {
    const { tokens } = deriveBrand({ primary: "#C62828" });
    expect(tokens["--primary"]).toBe(tokens["--brand-primary"]);
    expect(tokens["--primary-foreground"]).toBe(tokens["--brand-on-primary"]);
    expect(tokens["--ring"]).toBe(tokens["--brand-primary"]);
  });

  it("derives hover and active as progressively darker, never lighter", () => {
    const { tokens } = deriveBrand({ primary: "#1565C0" });
    const p = parseVar(tokens["--brand-primary"]).l;
    const h = parseVar(tokens["--brand-primary-hover"]).l;
    const a = parseVar(tokens["--brand-primary-active"]).l;
    expect(h).toBeLessThan(p);
    expect(a).toBeLessThan(h);
    expect(a).toBeGreaterThanOrEqual(0);
  });

  it("produces three visually distinct chart series", () => {
    const { tokens } = deriveBrand({ primary: "#2E7D32" });
    const series = [tokens["--chart-1"], tokens["--chart-2"], tokens["--chart-3"]];
    expect(new Set(series).size).toBe(3);
  });
});

describe("applyBrandTokens", () => {
  it("writes every token and removes exactly those on cleanup", () => {
    const el = document.createElement("div");
    const { tokens } = deriveBrand({ primary: "#C62828" });
    el.style.setProperty("--unrelated", "keep-me");

    const cleanup = applyBrandTokens(el, tokens);
    expect(el.style.getPropertyValue("--brand-primary")).toBe(tokens["--brand-primary"]);
    expect(el.style.getPropertyValue("--primary")).toBe(tokens["--primary"]);

    cleanup();
    // Tenant colours must not survive a provider unmount or a tenant switch.
    expect(el.style.getPropertyValue("--brand-primary")).toBe("");
    expect(el.style.getPropertyValue("--primary")).toBe("");
    expect(el.style.getPropertyValue("--unrelated")).toBe("keep-me");
  });
});
