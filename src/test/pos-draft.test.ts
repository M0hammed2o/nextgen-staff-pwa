import { describe, it, expect, beforeEach } from "vitest";
import { loadPosDraft, savePosDraft, clearPosDraft, DRAFT_MAX_AGE_MS, type PosDraftFields } from "@/lib/pos-draft";
import type { CartLine, POSOrderCreateRequest } from "@/types";

const BUSINESS_ID = "biz-1";
const USER_ID = "user-1";
const STORAGE_KEY = `nextgen_staff_pos_draft_v1:${BUSINESS_ID}:${USER_ID}`;

const SAMPLE_LINE: CartLine = {
  key: "item-1",
  menuItemId: "item-1",
  name: "Burger",
  basePriceCents: 5000,
  quantity: 1,
  requiresPreparation: true,
  selectedOptionIds: {},
  selectedOptionsDisplay: [],
  addOnSelections: [],
  removedIngredientIds: [],
  removedIngredientsDisplay: [],
  specialInstructions: null,
};

function baseFields(overrides: Partial<PosDraftFields> = {}): PosDraftFields {
  return {
    cart: [SAMPLE_LINE],
    orderMode: "PICKUP",
    tableNumber: "",
    customerName: "",
    customerPhone: "",
    discountRand: "",
    discountReason: "",
    idempotencyKey: "key-abc",
    submission: { status: "idle" },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("pos draft storage", () => {
  it("returns null when nothing is stored", () => {
    expect(loadPosDraft(BUSINESS_ID, USER_ID)).toBeNull();
  });

  it("round-trips a draft through localStorage", () => {
    savePosDraft(BUSINESS_ID, USER_ID, baseFields());
    const loaded = loadPosDraft(BUSINESS_ID, USER_ID);
    expect(loaded?.cart).toEqual([SAMPLE_LINE]);
    expect(loaded?.idempotencyKey).toBe("key-abc");
    expect(loaded?.version).toBe(1);
  });

  it("keeps drafts isolated per staff user on the same business — no silent inheritance of another cashier's cart", () => {
    savePosDraft(BUSINESS_ID, "user-A", baseFields({ idempotencyKey: "key-A" }));
    savePosDraft(BUSINESS_ID, "user-B", baseFields({ idempotencyKey: "key-B" }));
    expect(loadPosDraft(BUSINESS_ID, "user-A")?.idempotencyKey).toBe("key-A");
    expect(loadPosDraft(BUSINESS_ID, "user-B")?.idempotencyKey).toBe("key-B");
  });

  it("keeps drafts isolated per business for the same user id", () => {
    savePosDraft("biz-A", USER_ID, baseFields({ idempotencyKey: "key-biz-A" }));
    savePosDraft("biz-B", USER_ID, baseFields({ idempotencyKey: "key-biz-B" }));
    expect(loadPosDraft("biz-A", USER_ID)?.idempotencyKey).toBe("key-biz-A");
    expect(loadPosDraft("biz-B", USER_ID)?.idempotencyKey).toBe("key-biz-B");
  });

  it("discards a draft older than the 12h max age (never resurfaces a stale cart the next day)", () => {
    savePosDraft(BUSINESS_ID, USER_ID, baseFields());
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.savedAt = Date.now() - DRAFT_MAX_AGE_MS - 1000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(loadPosDraft(BUSINESS_ID, USER_ID)).toBeNull();
  });

  it("keeps a draft saved well within the max age", () => {
    savePosDraft(BUSINESS_ID, USER_ID, baseFields());
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.savedAt = Date.now() - (DRAFT_MAX_AGE_MS - 60_000);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(loadPosDraft(BUSINESS_ID, USER_ID)).not.toBeNull();
  });

  it("tolerates corrupted (non-JSON) storage instead of throwing", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => loadPosDraft(BUSINESS_ID, USER_ID)).not.toThrow();
    expect(loadPosDraft(BUSINESS_ID, USER_ID)).toBeNull();
  });

  it("tolerates a structurally-wrong stored value instead of throwing", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    expect(loadPosDraft(BUSINESS_ID, USER_ID)).toBeNull();
  });

  it("tolerates an unknown schema version (future-proofing / downgrade safety)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...baseFields(), version: 2, savedAt: Date.now() }));
    expect(loadPosDraft(BUSINESS_ID, USER_ID)).toBeNull();
  });

  it("clearPosDraft removes the draft", () => {
    savePosDraft(BUSINESS_ID, USER_ID, baseFields());
    clearPosDraft(BUSINESS_ID, USER_ID);
    expect(loadPosDraft(BUSINESS_ID, USER_ID)).toBeNull();
  });

  it("retains the same idempotency key across repeated loads (simulated reload) until explicitly rotated", () => {
    savePosDraft(BUSINESS_ID, USER_ID, baseFields({ idempotencyKey: "stable-key" }));
    expect(loadPosDraft(BUSINESS_ID, USER_ID)?.idempotencyKey).toBe("stable-key");
    // "Reload" again — nothing in the load path itself ever changes the key.
    expect(loadPosDraft(BUSINESS_ID, USER_ID)?.idempotencyKey).toBe("stable-key");
    // Only an explicit clear (equivalent to Pos.tsx's resetForNextSale, which
    // rotates the key AND clears the draft together) removes it.
    clearPosDraft(BUSINESS_ID, USER_ID);
    expect(loadPosDraft(BUSINESS_ID, USER_ID)).toBeNull();
  });

  it("persists an in-flight submission's exact payload and key, unchanged, for same-key recovery", () => {
    const payload: POSOrderCreateRequest = {
      items: [{ menu_item_id: "item-1", quantity: 1, selected_option_ids: {}, add_on_selections: [], removed_ingredient_ids: [] }],
      order_mode: "PICKUP",
      payment_method: "CASH",
      cash_tendered_cents: 5000,
      idempotency_key: "in-flight-key",
    };
    savePosDraft(BUSINESS_ID, USER_ID, baseFields({
      idempotencyKey: "in-flight-key",
      submission: { status: "in_flight", payload, idempotencyKey: "in-flight-key", startedAt: Date.now() },
    }));
    const loaded = loadPosDraft(BUSINESS_ID, USER_ID);
    expect(loaded?.submission.status).toBe("in_flight");
    if (loaded?.submission.status === "in_flight") {
      // Deep-equal, not just key equality — the recovery flow resends this
      // exact object, so any drift here would resend a different order.
      expect(loaded.submission.payload).toEqual(payload);
      expect(loaded.submission.idempotencyKey).toBe("in-flight-key");
    }
  });

  it("a missing businessId or userId is a safe no-op, never throws", () => {
    expect(() => savePosDraft(null, USER_ID, baseFields())).not.toThrow();
    expect(loadPosDraft(null, USER_ID)).toBeNull();
    expect(loadPosDraft(BUSINESS_ID, undefined)).toBeNull();
    expect(() => clearPosDraft(BUSINESS_ID, undefined)).not.toThrow();
  });
});
