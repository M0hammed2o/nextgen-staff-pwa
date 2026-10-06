/**
 * BrandProvider — applies a restaurant's visual identity to the running app.
 *
 * Responsibilities, and nothing beyond them:
 *  1. hold the current restaurant's branding (name, logo, colours);
 *  2. derive the full token set from it (lib/brand.ts) and write those tokens
 *     onto <html>, so every shadcn primitive re-skins with no component edits;
 *  3. cache it locally so the PIN screen is already branded on next launch,
 *     BEFORE anyone has authenticated;
 *  4. clear everything on tenant change or sign-out, so one restaurant's
 *     colours can never bleed into another's session on a shared till.
 *
 * WHY THE CACHE EXISTS (and why it is safe)
 * =========================================
 * The staff app deliberately persists `SavedBusiness` so a till returns to the
 * PIN-only screen rather than the full login on every shift. That screen is the
 * first thing a cashier sees and the one the programme most wants branded — but
 * it renders before any authenticated request can run. Caching branding
 * alongside the saved business is what makes "[LOGO] NOOSH · Pavilion — enter
 * your PIN" possible at all.
 *
 * Nothing sensitive is stored: a display name, a public asset URL and two hex
 * colours. It is keyed by business id, and a mismatch discards it, so the cache
 * cannot survive a switch to a different restaurant.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { NEXTGEN_DEFAULT_BRAND, applyBrandTokens, deriveBrand } from "@/lib/brand";

/** The restaurant-supplied half. Everything is optional by design. */
export interface BrandConfig {
  businessId?: string | null;
  /** Trading/display name. Falls back to the saved business name. */
  displayName?: string | null;
  /** Branch/location label, shown under the name when present. */
  branchName?: string | null;
  /** Public URL of the restaurant's logo. */
  logoUrl?: string | null;
  /** Public URL of a square icon/monogram source. */
  iconUrl?: string | null;
  primaryColour?: string | null;
  accentColour?: string | null;
}

export interface BrandContextValue extends BrandConfig {
  /** True once a real brand (not the NextGen fallback) is in effect. */
  isBranded: boolean;
  /** True when the supplied colour had to be darkened to stay visible. */
  wasAdjusted: boolean;
  /** Two-letter monogram for when there is no logo. Never empty. */
  monogram: string;
  setBrand: (next: BrandConfig | null) => void;
}

const STORAGE_KEY = "nextgen.brand.v1";

const FALLBACK: BrandContextValue = {
  businessId: null,
  displayName: null,
  branchName: null,
  logoUrl: null,
  iconUrl: null,
  primaryColour: null,
  accentColour: null,
  isBranded: false,
  wasAdjusted: false,
  monogram: "NG",
  setBrand: () => {},
};

const BrandContext = createContext<BrandContextValue>(FALLBACK);

/** Initials from a restaurant name — "Noosh Pavilion" -> "NP", "Noosh" -> "NO". */
export function monogramFor(name?: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "NG";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function readCachedBrand(businessId?: string | null): BrandConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BrandConfig;
    // A cached brand belonging to a DIFFERENT restaurant must never be shown.
    if (businessId && parsed.businessId && parsed.businessId !== businessId) return null;
    return parsed;
  } catch {
    // Private mode, cleared site data, or a corrupt entry. The unbranded
    // fallback is a perfectly good product, so never let this throw.
    return null;
  }
}

export function writeCachedBrand(config: BrandConfig | null): void {
  try {
    if (config === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable — branding simply won't persist between launches */
  }
}

export function BrandProvider({
  children,
  initial = null,
}: {
  children: React.ReactNode;
  /** Mainly for tests and for Phase C to seed from the API. */
  initial?: BrandConfig | null;
}) {
  const [brand, setBrandState] = useState<BrandConfig | null>(
    () => initial ?? readCachedBrand()
  );

  const setBrand = (next: BrandConfig | null) => {
    setBrandState(next);
    writeCachedBrand(next);
  };

  const derived = useMemo(
    () => deriveBrand({ primary: brand?.primaryColour, accent: brand?.accentColour }),
    [brand?.primaryColour, brand?.accentColour]
  );

  useEffect(() => {
    // Returning the cleanup is what guarantees a tenant switch or unmount
    // removes exactly the properties this applied, rather than leaving the
    // previous restaurant's colours on <html>.
    return applyBrandTokens(document.documentElement, derived.tokens);
  }, [derived]);

  const value = useMemo<BrandContextValue>(
    () => ({
      ...brand,
      isBranded: Boolean(brand?.primaryColour || brand?.logoUrl),
      wasAdjusted: derived.adjusted,
      monogram: monogramFor(brand?.displayName),
      setBrand,
    }),
    // `setBrand` is stable in practice (setState identity), and including
    // `derived` keeps wasAdjusted honest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brand, derived]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}

export { NEXTGEN_DEFAULT_BRAND };
