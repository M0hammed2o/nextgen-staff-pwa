import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";

const getMock = vi.fn();
vi.mock("@/lib/api", () => ({ apiClient: { get: (...a: unknown[]) => getMock(...a) } }));

import {
  cacheVariants, clearVariantCache, fetchItemVariants, lookupVariantLocal, resolveScan, stockState, warmVariantCache,
  type ProductVariant,
} from "@/lib/variants";
import { addLineToCart, buildVariantLine, cartLineToSaleItem } from "@/lib/cart-variant";
import { clearSnapshots } from "@/lib/offline/snapshot-cache";

const BIZ = "biz-1";
const v = (over: Partial<ProductVariant>): ProductVariant => ({
  id: "var-m", menu_item_id: "item-tee", sku: "TEE-M-BLK", barcode: "6001234567890", attributes: { size: "M" },
  label: "M / Black", price_cents: null, effective_price_cents: 19900, is_active: true, stock_on_hand: 5, ...over,
});
const ITEM = { id: "item-tee", name: "Tee", price_cents: 19900, requires_preparation: false };
const noResponse = { message: "offline", status: 0, noResponse: true };

beforeEach(() => {
  localStorage.clear();
  __resetSafeStorageForTests();
  getMock.mockReset();
});

describe("picker selection -> cart line -> sale payload", () => {
  it("a selected variant becomes a cart line with its label, SKU and price, and the payload carries variant_id", () => {
    const line = buildVariantLine(ITEM, v({ id: "var-l", sku: "TEE-L-BLK", label: "L / Black", effective_price_cents: 21900 }));
    expect(line).toMatchObject({
      menuItemId: "item-tee", variantId: "var-l", variantLabel: "L / Black", sku: "TEE-L-BLK", basePriceCents: 21900, quantity: 1,
    });
    expect(cartLineToSaleItem(line)).toMatchObject({ menu_item_id: "item-tee", quantity: 1, variant_id: "var-l" });
  });

  it("a plain (non-variant) line sends no variant_id key at all", () => {
    const body = cartLineToSaleItem({
      key: "k", menuItemId: "i", name: "Burger", basePriceCents: 5000, quantity: 2, requiresPreparation: true,
      selectedOptionIds: {}, selectedOptionsDisplay: [], addOnSelections: [], removedIngredientIds: [],
      removedIngredientsDisplay: [], specialInstructions: null,
    });
    expect("variant_id" in body).toBe(false);
  });

  it("scanning the same variant twice raises the quantity; a different variant is its own line", () => {
    let cart = addLineToCart([], buildVariantLine(ITEM, v({})));
    cart = addLineToCart(cart, buildVariantLine(ITEM, v({})));
    cart = addLineToCart(cart, buildVariantLine(ITEM, v({ id: "var-l", sku: "TEE-L-BLK" })));
    expect(cart).toHaveLength(2);
    expect(cart[0].quantity).toBe(2);
  });
});

describe("stock presentation", () => {
  it("zero or negative is out (greyed, still sellable); null is untracked", () => {
    expect(stockState({ stock_on_hand: 0 })).toBe("out");
    expect(stockState({ stock_on_hand: -2 })).toBe("out");
    expect(stockState({ stock_on_hand: 2 })).toBe("low");
    expect(stockState({ stock_on_hand: 9 })).toBe("ok");
    expect(stockState({ stock_on_hand: null })).toBe("untracked");
  });
});

describe("offline lookup from the variant cache", () => {
  it("fetching online remembers the variants; with no response the cached answer is used", async () => {
    getMock.mockResolvedValueOnce([v({})]);
    expect(await fetchItemVariants(BIZ, ITEM)).toHaveLength(1);
    getMock.mockRejectedValueOnce(noResponse);
    const offline = await fetchItemVariants(BIZ, ITEM);
    expect(offline.map((x) => x.sku)).toEqual(["TEE-M-BLK"]);
  });

  it("a real HTTP error is never masked by the cache", async () => {
    cacheVariants(BIZ, ITEM.id, [v({})]);
    getMock.mockRejectedValueOnce({ message: "boom", status: 500 });
    await expect(fetchItemVariants(BIZ, ITEM)).rejects.toMatchObject({ status: 500 });
  });

  it("resolves barcode and SKU (case-insensitive) offline without any network call", async () => {
    cacheVariants(BIZ, ITEM.id, [v({}), v({ id: "var-x", sku: "TEE-XS", barcode: null, is_active: false })], {
      item_name: "Tee", base_price_cents: 19900,
    });
    const byBarcode = await resolveScan(BIZ, "6001234567890", false);
    expect(byBarcode).toMatchObject({ kind: "found", offline: true });
    if (byBarcode.kind === "found") {
      expect(byBarcode.result.variant.id).toBe("var-m");
      expect(byBarcode.result.menu_item_name).toBe("Tee");
    }
    expect((await resolveScan(BIZ, "tee-m-blk", false)).kind).toBe("found");
    // inactive variants never resolve; unknown codes are a clear miss
    expect((await resolveScan(BIZ, "TEE-XS", false)).kind).toBe("not_found");
    expect((await resolveScan(BIZ, "0000", false)).kind).toBe("not_found");
    expect(getMock).not.toHaveBeenCalled();
  });

  it("online uses the server lookup; 404 on both keys is not_found; no response falls back to the cache", async () => {
    const hit = { menu_item_id: "item-tee", menu_item_name: "Tee", base_price_cents: 19900, variant: v({}) };
    getMock.mockResolvedValueOnce(hit);
    const found = await resolveScan(BIZ, "6001234567890", true);
    expect(getMock.mock.calls[0][0]).toBe("/v1/business/pos/lookup?barcode=6001234567890");
    expect(found).toMatchObject({ kind: "found", offline: false });

    getMock.mockReset();
    getMock.mockRejectedValue({ message: "nf", status: 404 });
    expect((await resolveScan(BIZ, "NOPE", true)).kind).toBe("not_found");
    expect(getMock.mock.calls.map((c) => c[0])).toEqual([
      "/v1/business/pos/lookup?barcode=NOPE",
      "/v1/business/pos/lookup?sku=NOPE",
    ]);

    getMock.mockReset();
    getMock.mockRejectedValue(noResponse);
    // the earlier online hit was cached, so a dropped connection still resolves it
    expect(await resolveScan(BIZ, "6001234567890", true)).toMatchObject({ kind: "found", offline: true });
  });

  it("a server error surfaces as an error, not as 'not found'", async () => {
    getMock.mockRejectedValue({ message: "Server exploded", status: 500 });
    expect(await resolveScan(BIZ, "123456", true)).toEqual({ kind: "error", message: "Server exploded" });
  });

  it("the cache is per business and is wiped by clearSnapshots (logout)", () => {
    cacheVariants(BIZ, ITEM.id, [v({})]);
    expect(lookupVariantLocal("biz-2", { sku: "TEE-M-BLK" })).toBeNull();
    expect(lookupVariantLocal(BIZ, { sku: "TEE-M-BLK" })).not.toBeNull();
    clearSnapshots(BIZ);
    expect(lookupVariantLocal(BIZ, { sku: "TEE-M-BLK" })).toBeNull();
    clearVariantCache(BIZ);
  });

  it("warm-up fetches each item once and skips ones cached recently", async () => {
    getMock.mockResolvedValue([]);
    const items = [
      { id: "a", name: "A", price_cents: 1 },
      { id: "b", name: "B", price_cents: 1 },
    ];
    await warmVariantCache(BIZ, items);
    expect(getMock).toHaveBeenCalledTimes(2);
    await warmVariantCache(BIZ, items);
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});

describe("has_variants on the menu item skips needless variant requests", () => {
  it("has_variants:false answers [] with no request; true and absent still ask", async () => {
    expect(await fetchItemVariants(BIZ, { ...ITEM, has_variants: false })).toEqual([]);
    expect(getMock).not.toHaveBeenCalled();

    getMock.mockResolvedValueOnce([v({})]);
    expect(await fetchItemVariants(BIZ, { ...ITEM, has_variants: true })).toHaveLength(1);
    getMock.mockResolvedValueOnce([v({})]);
    expect(await fetchItemVariants(BIZ, ITEM)).toHaveLength(1); // older backend: field absent
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenCalledWith("/v1/business/menu/items/item-tee/variants");
  });

  it("warm-up skips has_variants:false items and forgets their stale variants, so offline scans cannot sell them", async () => {
    cacheVariants(BIZ, "item-old", [v({ id: "var-old", menu_item_id: "item-old", sku: "OLD-1", barcode: "999" })], {
      item_name: "Old", base_price_cents: 100,
    });
    expect(lookupVariantLocal(BIZ, { sku: "OLD-1" })).not.toBeNull();
    getMock.mockResolvedValue([v({})]);
    await warmVariantCache(BIZ, [
      { id: "item-tee", name: "Tee", price_cents: 19900, has_variants: true },
      { id: "item-old", name: "Old", price_cents: 100, has_variants: false },
      { id: "item-burger", name: "Burger", price_cents: 5000, has_variants: false },
    ]);
    expect(getMock.mock.calls.map((c) => c[0])).toEqual(["/v1/business/menu/items/item-tee/variants"]);
    expect(lookupVariantLocal(BIZ, { sku: "OLD-1" })).toBeNull();
    expect(lookupVariantLocal(BIZ, { barcode: "999" })).toBeNull();
    // the variant item is still searchable offline
    expect(lookupVariantLocal(BIZ, { sku: "TEE-M-BLK" })).not.toBeNull();
  });
});
