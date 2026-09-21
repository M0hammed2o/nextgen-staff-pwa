/**
 * Stocktake count-entry units — the fix for a silent unit-mismatch bug
 * (KNOWN_BUGS BUG-0046).
 *
 * DUPLICATION NOTE: this module is a deliberate, near-verbatim copy of
 * nextgen-insights-main/src/lib/stocktake-units.ts (the manager dashboard).
 * The two frontend repos have no shared package today, so the logic is
 * duplicated rather than imported — see WORKLOG.md/TODO.md for the
 * consolidation recommendation (a shared `@nextgen/inventory-units` package
 * would be the correct long-term fix; not done here, out of scope for a
 * launch-hardening pass). Keep any future change to the unit rules in sync
 * between both copies.
 *
 * The backend (backend/app/inventory/units.py) stores every stock quantity
 * as an integer count of thousandths of the ingredient's CANONICAL unit
 * (grams, millilitres, or "unit"). `POST /business/stocktake/{id}/counts`
 * takes an optional `unit` per line and, when it is missing, silently
 * assumes the ingredient's canonical unit (routes_stocktake.py:
 * `unit = entry.unit or ingredient.canonical_unit`). Staff who count a mass
 * ingredient in kilograms but never send a unit therefore have "2" (kg)
 * read back as 2 grams — a 1000x error. The backend is being changed to
 * REQUIRE `unit` on every line (422 otherwise) — this module makes the
 * staff PWA always send one regardless of whether the backend currently
 * enforces it.
 *
 * This module is the single source of truth, on this app's side, for:
 *   - which unit tokens we offer staff for a given ingredient, and
 *   - what we send the backend for a typed quantity, so the two always agree.
 *
 * Every token here is a key backend/app/inventory/units.py's `UNIT_DEFS`
 * actually accepts (verified against that file) — never invent a token the
 * backend doesn't know, since it rejects unknown/incompatible units with a
 * 4xx (see AppError("INVALID_UNIT", ...) in routes_stocktake.py).
 */

import type { CanonicalUnit } from "@/types";

export interface UnitOption {
  /** Token sent to the backend as `unit` — must be a UNIT_DEFS key. */
  value: string;
  /** What staff see in the selector. */
  label: string;
}

// COUNT-family tokens backend/app/inventory/units.py's UNIT_DEFS recognises
// (mass and volume tokens are handled directly in unitOptionsFor below).
// An ingredient's own `unit_label` (e.g. "portion", "sachet") is only ever
// offered as an entry unit when it appears here — anything else falls back
// to "each" rather than risking a token the backend will reject, or worse,
// silently accept with meaning we didn't intend.
const KNOWN_COUNT_UNIT_LABELS = new Set([
  "UNIT", "UNITS", "EACH", "EA",
  "PORTION", "PORTIONS", "SACHET", "SACHETS",
  "BOTTLE", "BOTTLES", "BOX", "BOXES", "BALL", "BALLS",
  "TUB", "SLICE", "SLICES", "CAN", "CANS",
]);

/**
 * The unit choices to offer for an ingredient, largest-appropriate-first.
 * Always returns at least one option, and the first option is the default.
 */
export function unitOptionsFor(
  canonicalUnit: CanonicalUnit,
  unitLabel: string | null | undefined
): UnitOption[] {
  switch (canonicalUnit) {
    case "GRAM":
      return [
        { value: "G", label: "g" },
        { value: "KG", label: "kg" },
      ];
    case "MILLILITRE":
      return [
        { value: "ML", label: "ml" },
        { value: "L", label: "L" },
      ];
    case "UNIT": {
      const trimmed = (unitLabel || "").trim();
      const token = trimmed.toUpperCase();
      if (trimmed && KNOWN_COUNT_UNIT_LABELS.has(token)) {
        return [{ value: token, label: trimmed.toLowerCase() }];
      }
      return [{ value: "EACH", label: "each" }];
    }
    default:
      return [{ value: "EACH", label: "each" }];
  }
}

/** The unit a fresh count input should default to for this ingredient. */
export function defaultUnitFor(
  canonicalUnit: CanonicalUnit,
  unitLabel: string | null | undefined
): string {
  return unitOptionsFor(canonicalUnit, unitLabel)[0].value;
}

export interface CountEntry {
  quantity: string;
  unit: string;
}

export interface StocktakePayloadLine {
  ingredient_id: string;
  quantity: string;
  unit: string;
}

export interface BuildCountsPayloadResult {
  lines: StocktakePayloadLine[];
  /** ingredient_id -> inline validation message, for entries typed but invalid. */
  errors: Record<string, string>;
}

/**
 * Validate and shape the counts staff have typed into the payload the
 * backend expects. Every line that is submitted always carries an explicit
 * `unit` — never a bare number the backend has to guess the meaning of.
 *
 * An entry with an empty quantity is treated as "not entered yet" and
 * silently skipped (matches the existing save-partial-progress behaviour).
 * An entry with a non-empty but invalid quantity (not a finite, non-negative
 * number) is rejected and reported in `errors` instead of being sent.
 */
export function buildCountsPayload(
  counts: Record<string, CountEntry>
): BuildCountsPayloadResult {
  const lines: StocktakePayloadLine[] = [];
  const errors: Record<string, string> = {};

  for (const [ingredientId, entry] of Object.entries(counts)) {
    const raw = (entry.quantity ?? "").trim();
    if (raw === "") continue;

    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      errors[ingredientId] = "Enter a number that is zero or greater";
      continue;
    }

    if (!entry.unit) {
      errors[ingredientId] = "Choose a unit";
      continue;
    }

    lines.push({ ingredient_id: ingredientId, quantity: raw, unit: entry.unit });
  }

  return { lines, errors };
}

export interface StocktakeLineForSeed {
  ingredient_id: string;
  canonical_unit: CanonicalUnit;
  unit_label: string | null | undefined;
  counted_quantity_milli: number | null;
  /** What staff actually typed/chose, when the backend has it (see StocktakeLine in types/index.ts). */
  entered_quantity?: string | null;
  entered_unit?: string | null;
}

/**
 * Seed the editable count entries for a (re)opened draft.
 *
 * Preferred path: the backend now returns `entered_quantity`/`entered_unit`
 * — exactly what staff typed and which unit token they typed it in — so
 * seeding from those is an exact, lossless round-trip regardless of which
 * unit was chosen (e.g. "2 kg" reloads as "2 kg", not "2000 g").
 *
 * Fallback: for a line with no `entered_quantity`/`entered_unit` (no count
 * yet, or one saved before these fields existed), seed in this ingredient's
 * DEFAULT unit instead — the same unit its canonical storage is already in
 * (g / ml / each-or-its recognised count label) — converting the stored
 * canonical quantity into that unit is itself an exact, lossless
 * conversion, just not necessarily in the unit that was originally typed.
 */
export function seedCountEntries(
  lines: StocktakeLineForSeed[]
): Record<string, CountEntry> {
  const seeded: Record<string, CountEntry> = {};
  for (const line of lines) {
    if (line.entered_quantity != null && line.entered_quantity !== "" && line.entered_unit) {
      seeded[line.ingredient_id] = { quantity: line.entered_quantity, unit: line.entered_unit };
      continue;
    }
    const unit = defaultUnitFor(line.canonical_unit, line.unit_label);
    const quantity =
      line.counted_quantity_milli != null ? String(line.counted_quantity_milli / 1000) : "";
    seeded[line.ingredient_id] = { quantity, unit };
  }
  return seeded;
}
