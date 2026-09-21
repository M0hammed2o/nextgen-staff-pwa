import { describe, it, expect } from "vitest";
import {
  unitOptionsFor,
  defaultUnitFor,
  buildCountsPayload,
  seedCountEntries,
} from "@/lib/stocktake-units";

describe("unitOptionsFor / defaultUnitFor", () => {
  it("offers g and kg for a mass ingredient, defaulting to g", () => {
    const options = unitOptionsFor("GRAM", null);
    expect(options.map((o) => o.value)).toEqual(["G", "KG"]);
    expect(defaultUnitFor("GRAM", null)).toBe("G");
  });

  it("offers ml and L for a volume ingredient, defaulting to ml", () => {
    const options = unitOptionsFor("MILLILITRE", null);
    expect(options.map((o) => o.value)).toEqual(["ML", "L"]);
    expect(defaultUnitFor("MILLILITRE", null)).toBe("ML");
  });

  it("defaults a countable ingredient with no label to EACH", () => {
    expect(defaultUnitFor("UNIT", null)).toBe("EACH");
    expect(unitOptionsFor("UNIT", null)).toEqual([{ value: "EACH", label: "each" }]);
  });

  it("honours a recognised unit_label the backend can actually convert", () => {
    expect(defaultUnitFor("UNIT", "portion")).toBe("PORTION");
    expect(unitOptionsFor("UNIT", "Sachet")).toEqual([{ value: "SACHET", label: "sachet" }]);
  });

  it("falls back to EACH for an unrecognised unit_label instead of inventing a token", () => {
    // "wings" is not a key in backend/app/inventory/units.py's UNIT_DEFS.
    expect(defaultUnitFor("UNIT", "wings")).toBe("EACH");
  });
});

describe("buildCountsPayload", () => {
  it("always includes an explicit unit, never a bare quantity", () => {
    const { lines, errors } = buildCountsPayload({
      "ing-1": { quantity: "2", unit: "KG" },
    });
    expect(errors).toEqual({});
    expect(lines).toEqual([{ ingredient_id: "ing-1", quantity: "2", unit: "KG" }]);
  });

  it('sends 2 kg as quantity "2" + unit "KG" — never 2000 g and never unit-less', () => {
    const { lines } = buildCountsPayload({ "ing-1": { quantity: "2", unit: "KG" } });
    expect(lines[0]).toEqual({ ingredient_id: "ing-1", quantity: "2", unit: "KG" });
    expect(lines[0].quantity).not.toBe("2000");
  });

  it("maps kg/g, l/ml and each correctly, one line per ingredient", () => {
    const { lines } = buildCountsPayload({
      "mass-kg": { quantity: "2", unit: "KG" },
      "mass-g": { quantity: "150", unit: "G" },
      "vol-l": { quantity: "1.5", unit: "L" },
      "vol-ml": { quantity: "250", unit: "ML" },
      "count-each": { quantity: "12", unit: "EACH" },
      "count-portion": { quantity: "4", unit: "PORTION" },
    });
    expect(lines).toHaveLength(6);
    expect(lines).toContainEqual({ ingredient_id: "mass-kg", quantity: "2", unit: "KG" });
    expect(lines).toContainEqual({ ingredient_id: "mass-g", quantity: "150", unit: "G" });
    expect(lines).toContainEqual({ ingredient_id: "vol-l", quantity: "1.5", unit: "L" });
    expect(lines).toContainEqual({ ingredient_id: "vol-ml", quantity: "250", unit: "ML" });
    expect(lines).toContainEqual({ ingredient_id: "count-each", quantity: "12", unit: "EACH" });
    expect(lines).toContainEqual({ ingredient_id: "count-portion", quantity: "4", unit: "PORTION" });
  });

  it("skips entries with an empty quantity (not yet counted)", () => {
    const { lines, errors } = buildCountsPayload({ "ing-1": { quantity: "   ", unit: "G" } });
    expect(lines).toEqual([]);
    expect(errors).toEqual({});
  });

  it("rejects a negative quantity instead of sending it", () => {
    const { lines, errors } = buildCountsPayload({ "ing-1": { quantity: "-5", unit: "G" } });
    expect(lines).toEqual([]);
    expect(errors["ing-1"]).toMatch(/zero or greater/);
  });

  it("rejects a non-numeric quantity instead of sending it", () => {
    const { lines, errors } = buildCountsPayload({ "ing-1": { quantity: "abc", unit: "G" } });
    expect(lines).toEqual([]);
    expect(errors["ing-1"]).toBeTruthy();
  });

  it("rejects a non-finite quantity (Infinity/NaN) instead of sending it", () => {
    const { lines, errors } = buildCountsPayload({ "ing-1": { quantity: "Infinity", unit: "G" } });
    expect(lines).toEqual([]);
    expect(errors["ing-1"]).toBeTruthy();
  });

  it("rejects a typed quantity with no unit chosen", () => {
    const { lines, errors } = buildCountsPayload({ "ing-1": { quantity: "3", unit: "" } });
    expect(lines).toEqual([]);
    expect(errors["ing-1"]).toMatch(/unit/i);
  });
});

describe("seedCountEntries — reopening a saved draft", () => {
  it("keeps the entered unit by seeding in the same unit canonical storage already is", () => {
    const seeded = seedCountEntries([
      {
        ingredient_id: "ing-1",
        canonical_unit: "GRAM",
        unit_label: null,
        counted_quantity_milli: 2_000_000, // 2000 g, stored canonically
      },
    ]);
    expect(seeded["ing-1"]).toEqual({ quantity: "2000", unit: "G" });
  });

  it("round-trips exactly: re-submitting the seeded value reproduces the stored quantity", () => {
    const countedMilli = 1_500_000; // 1500 ml
    const seeded = seedCountEntries([
      {
        ingredient_id: "ing-1",
        canonical_unit: "MILLILITRE",
        unit_label: null,
        counted_quantity_milli: countedMilli,
      },
    ]);
    const { lines } = buildCountsPayload(seeded);
    expect(lines[0]).toEqual({ ingredient_id: "ing-1", quantity: "1500", unit: "ML" });
  });

  it('leaves an uncounted line blank rather than seeding "0"', () => {
    const seeded = seedCountEntries([
      {
        ingredient_id: "ing-1",
        canonical_unit: "UNIT",
        unit_label: "portion",
        counted_quantity_milli: null,
      },
    ]);
    expect(seeded["ing-1"]).toEqual({ quantity: "", unit: "PORTION" });
  });
});
