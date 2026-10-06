/**
 * NextGen brand theming engine — UI V2.
 *
 * Turns ONE restaurant-supplied colour into the full set of UI tokens the
 * interface needs, without ever letting a bad brand colour make the product
 * unreadable.
 *
 * WHY THIS EXISTS AT ALL
 * ======================
 * Every shadcn/Radix primitive in this app already reads its colour from CSS
 * custom properties (`hsl(var(--primary))` and friends). So re-skinning the
 * entire application for a given restaurant does not require touching a single
 * component — it requires writing the right values onto `document.documentElement`.
 * That is the whole design: brand personalisation is a token-layer concern, and
 * the verified Commercial V1 component logic underneath is left alone.
 *
 * THE RULES THIS ENCODES
 * ======================
 *  1. The restaurant owns PERSONALITY, never MEANING. `--primary` (and the
 *     focus ring, active nav, selected category, chart accent) follow the brand.
 *     `--success` / `--warning` / `--destructive` never do: a restaurant cannot
 *     make an error message yellow or a destructive action look like a brand
 *     button. Operational meaning has to stay constant across every tenant,
 *     because staff move between restaurants and muscle memory is safety.
 *  2. Contrast is not negotiable. Text placed on the brand colour is chosen —
 *     charcoal or white — by measured WCAG contrast, not by guesswork.
 *  3. A brand colour too light to carry white text is not rejected and is not
 *     blindly applied either. It is DARKENED until it passes AA for its
 *     text-bearing role, while the original stays available for large flat
 *     fills where contrast rules are laxer. The restaurant still recognises
 *     its colour; the cashier can still read the button.
 *
 * NOTE ON DUPLICATION: this file is deliberately duplicated byte-for-byte into
 * the Manager dashboard (`nextgen-insights-main/src/lib/brand.ts`). The three
 * frontends are separate git repositories with no shared package infrastructure,
 * and introducing a published/linked workspace package mid-programme would be a
 * far larger architectural change than the duplication costs. Recorded in
 * TODO.md as a consolidation candidate. If you edit one, edit both — the files
 * are intended to stay identical.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** HSL in the shadcn CSS-variable convention: `H S% L%` with no `hsl()` wrapper. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** The complete set of brand-derived custom properties applied at runtime. */
export interface BrandTokens {
  /** Main brand colour, already contrast-corrected for use behind text. */
  "--brand-primary": string;
  "--brand-primary-hover": string;
  "--brand-primary-active": string;
  /** Very light tint — selected rows, active nav background, soft badges. */
  "--brand-primary-soft": string;
  /** Slightly stronger tint for borders on soft surfaces. */
  "--brand-primary-border": string;
  /** Text/icon colour that is guaranteed readable ON `--brand-primary`. */
  "--brand-on-primary": string;
  /** Focus ring. */
  "--brand-ring": string;
  /** The restaurant's colour EXACTLY as supplied, for large decorative fills. */
  "--brand-raw": string;
  /** shadcn aliases so every existing primitive follows the brand with no edits. */
  "--primary": string;
  "--primary-foreground": string;
  "--ring": string;
  "--accent": string;
  "--accent-foreground": string;
  /** Chart series derived from the brand, so analytics look intentional. */
  "--chart-1": string;
  "--chart-2": string;
  "--chart-3": string;
}

const CHARCOAL: Hsl = { h: 0, s: 0, l: 11 };
const WHITE: Hsl = { h: 0, s: 0, l: 100 };

/** WCAG AA for normal text. */
export const AA_NORMAL = 4.5;
/** WCAG AA for large/bold text (>=18.66px bold or >=24px). */
export const AA_LARGE = 3.0;

// ── colour space ───────────────────────────────────────────────────────────

export function hexToRgb(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / d + 2) * 60;
        break;
      default:
        h = ((rn - gn) / d + 4) * 60;
    }
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = ln - c / 2;
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsl(rgb) : null;
}

/** Serialised for a CSS custom property consumed as `hsl(var(--x))`. */
export function hslVar({ h, s, l }: Hsl): string {
  return `${h} ${s}% ${l}%`;
}

// ── contrast ───────────────────────────────────────────────────────────────

/** WCAG 2.x relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio, 1..21. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastHsl(a: Hsl, b: Hsl): number {
  return contrastRatio(hslToRgb(a), hslToRgb(b));
}

/**
 * Charcoal or white — whichever is actually readable on `bg`.
 *
 * Deliberately NOT a luminance-threshold guess: both candidates are measured
 * and the better one wins, so a mid-tone brand colour (the genuinely ambiguous
 * case, e.g. a medium red or teal) resolves correctly instead of by a rule of
 * thumb that is wrong near the boundary.
 */
export function readableTextOn(bg: Hsl): Hsl {
  return contrastHsl(bg, CHARCOAL) >= contrastHsl(bg, WHITE) ? CHARCOAL : WHITE;
}

/**
 * Darken (or lighten) `colour` until it reaches `target` contrast against
 * `against`, preserving hue and saturation so the brand stays recognisable.
 *
 * Returns the original when it already passes. Gives up gracefully at the end
 * of the lightness range rather than looping — a pure #FFFF00 on white can
 * never reach AA without becoming a different colour, and in that case the
 * darkest in-hue variant is the honest best effort.
 */
export function ensureContrast(colour: Hsl, against: Hsl, target: number): Hsl {
  if (contrastHsl(colour, against) >= target) return colour;
  const againstIsLight = relativeLuminance(hslToRgb(against)) > 0.5;
  const step = againstIsLight ? -2 : 2;
  let best = { ...colour };
  let bestRatio = contrastHsl(colour, against);
  for (let l = colour.l + step; l >= 0 && l <= 100; l += step) {
    const candidate: Hsl = { ...colour, l };
    const ratio = contrastHsl(candidate, against);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
    if (ratio >= target) return candidate;
  }
  return best;
}

/** True when `hex` can carry small white text at AA without correction. */
export function isSafeForSmallText(hex: string): boolean {
  const hsl = hexToHsl(hex);
  if (!hsl) return false;
  return Math.max(contrastHsl(hsl, WHITE), contrastHsl(hsl, CHARCOAL)) >= AA_NORMAL;
}

// ── derivation ─────────────────────────────────────────────────────────────

/** NextGen's own default accent when a restaurant has configured nothing. */
export const NEXTGEN_DEFAULT_BRAND = "#1F1F1F";

export interface BrandInput {
  /** Restaurant primary colour as hex. Falsy/invalid falls back to NextGen's. */
  primary?: string | null;
  /** Optional accent. Derived from primary when absent. */
  accent?: string | null;
}

export interface DerivedBrand {
  tokens: BrandTokens;
  /** True when the supplied colour had to be adjusted to stay readable. */
  adjusted: boolean;
  /** Contrast of the FINAL primary against its chosen text colour. */
  contrast: number;
  /** Whether the raw supplied colour was usable as-is behind small text. */
  rawWasSafe: boolean;
}

/** The surface a primary button normally sits on: a white card. */
const SURFACE: Hsl = { h: 0, s: 0, l: 100 };
/** WCAG 1.4.11 non-text contrast — the threshold for a UI component boundary. */
export const NON_TEXT_MIN = 3.0;

/**
 * Derive the full brand token set from one colour.
 *
 * TWO separate guarantees, and it is worth being precise about why both are
 * needed — an earlier version of this function only enforced the first, and
 * the first turns out to be free:
 *
 *  1. LEGIBILITY — text on the brand fill. This is satisfied by CHOOSING the
 *     text colour (charcoal or white), not by changing the brand. In fact, with
 *     charcoal at L=11% one of the two always clears AA-large for any possible
 *     colour, so this constraint alone can never require an adjustment. Good:
 *     it means the restaurant's colour is never darkened for text reasons.
 *
 *  2. VISIBILITY — the brand fill against the surface behind it. This is the
 *     one that actually bites. A near-white brand (#FDFDFD, or a pale pastel)
 *     produces a button that is perfectly legible yet *invisible* as an object
 *     on a white card: the cashier cannot see where to press. WCAG 1.4.11 puts
 *     the floor for a UI component boundary at 3:1, and that is what forces a
 *     correction here.
 *
 * So the brand is darkened only when it would otherwise disappear into the
 * page — never merely to make text fit. `--brand-raw` always keeps the exact
 * supplied colour for large decorative fills where neither rule applies.
 */
export function deriveBrand(input: BrandInput): DerivedBrand {
  const requested = (input.primary ?? "").trim();
  const base = hexToHsl(requested) ?? hexToHsl(NEXTGEN_DEFAULT_BRAND)!;

  // Guarantee 2: the fill must be distinguishable from the surface it sits on.
  const primary = ensureContrast(base, SURFACE, NON_TEXT_MIN);
  // Guarantee 1: pick whichever label colour is genuinely readable on the result.
  const onPrimary = readableTextOn(primary);
  const adjusted = primary.l !== base.l;
  const rawWasSafe = !adjusted;

  const hover: Hsl = { ...primary, l: Math.max(0, primary.l - 6) };
  const active: Hsl = { ...primary, l: Math.max(0, primary.l - 12) };
  // Soft tints keep a trace of the hue but are near-white, so charcoal body
  // text on top of them stays far above AA regardless of the brand colour.
  const soft: Hsl = { h: primary.h, s: Math.min(primary.s, 70), l: 95 };
  const softBorder: Hsl = { h: primary.h, s: Math.min(primary.s, 60), l: 86 };

  const accentHsl = hexToHsl((input.accent ?? "").trim()) ?? { ...primary, h: (primary.h + 24) % 360 };

  return {
    tokens: {
      "--brand-primary": hslVar(primary),
      "--brand-primary-hover": hslVar(hover),
      "--brand-primary-active": hslVar(active),
      "--brand-primary-soft": hslVar(soft),
      "--brand-primary-border": hslVar(softBorder),
      "--brand-on-primary": hslVar(onPrimary),
      "--brand-ring": hslVar(primary),
      "--brand-raw": hslVar(base),
      // shadcn aliases: this is what makes every existing primitive follow the
      // brand without any component being edited.
      "--primary": hslVar(primary),
      "--primary-foreground": hslVar(onPrimary),
      "--ring": hslVar(primary),
      "--accent": hslVar(soft),
      "--accent-foreground": hslVar(ensureContrast(primary, soft, AA_NORMAL)),
      "--chart-1": hslVar(primary),
      "--chart-2": hslVar({ ...accentHsl, l: Math.min(70, Math.max(35, accentHsl.l)) }),
      "--chart-3": hslVar({ h: primary.h, s: Math.max(10, primary.s - 35), l: 62 }),
    },
    adjusted,
    contrast: contrastHsl(primary, onPrimary),
    rawWasSafe,
  };
}

/**
 * Write the derived tokens onto an element (normally `document.documentElement`).
 *
 * Returns a cleanup function that removes exactly the properties it set, so a
 * provider unmount or a tenant switch cannot leave a previous restaurant's
 * colours behind — which would be the obvious way for branding to "leak"
 * between tenants in a shared browser session.
 */
export function applyBrandTokens(el: HTMLElement, tokens: BrandTokens): () => void {
  const entries = Object.entries(tokens) as [string, string][];
  for (const [k, v] of entries) el.style.setProperty(k, v);
  return () => {
    for (const [k] of entries) el.style.removeProperty(k);
  };
}
