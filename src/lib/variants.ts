/**
 * Product variants (size / colour / SKU / barcode) for the till.
 *
 * Contract: backend PRODUCT_VARIANTS_CONTRACT.md. Online reads go through
 * apiClient; every successful variants read is remembered per menu item so the
 * picker and barcode/SKU entry keep working with no connection. Only a request
 * that produced NO HTTP RESPONSE falls back to the cache; a real HTTP error
 * (including a lookup 404) is never masked by stale data.
 *
 * The cache holds catalogue data (labels, SKUs, prices, stock counts), not
 * customer data, so it uses safe-storage like the menu snapshots and is wiped
 * with them on logout (snapshot-cache.clearSnapshots -> clearVariantCache).
 */
import { apiClient } from "@/lib/api";
import type { ApiFetchError } from "@/lib/api";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/safe-storage";

export interface ProductVariant {
  id: string;
  menu_item_id: string;
  sku: string;
  barcode: string | null;
  attributes: Record<string, string>;
  label: string;
  price_cents: number | null;
  effective_price_cents: number;
  is_active: boolean;
  /** Units; null when stock is not tracked for this variant. */
  stock_on_hand: number | null;
}

export interface VariantLookupResult {
  menu_item_id: string;
  menu_item_name: string;
  base_price_cents: number;
  variant: ProductVariant;
}

const ITEM_PREFIX = "nextgen_staff_variants_v1";
const k = (businessId: string, itemId: string) => `${ITEM_PREFIX}:${businessId}:item:${itemId}`;
const indexKey = (businessId: string) => `${ITEM_PREFIX}:${businessId}:index`;

interface CachedVariants {
  at: number;
  item_name: string | null;
  base_price_cents: number | null;
  variants: ProductVariant[];
}

function readIndex(businessId: string): string[] {
  try {
    const raw = safeGetItem(indexKey(businessId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function readCachedVariants(businessId: string, itemId: string): CachedVariants | null {
  try {
    const raw = safeGetItem(k(businessId, itemId));
    return raw ? (JSON.parse(raw) as CachedVariants) : null;
  } catch {
    return null;
  }
}

export function cacheVariants(
  businessId: string | null | undefined,
  itemId: string,
  variants: ProductVariant[],
  meta: { item_name?: string | null; base_price_cents?: number | null } = {},
) {
  if (!businessId) return;
  try {
    const prev = readCachedVariants(businessId, itemId);
    const entry: CachedVariants = {
      at: Date.now(),
      item_name: meta.item_name ?? prev?.item_name ?? null,
      base_price_cents: meta.base_price_cents ?? prev?.base_price_cents ?? null,
      variants,
    };
    safeSetItem(k(businessId, itemId), JSON.stringify(entry));
    const idx = readIndex(businessId);
    if (!idx.includes(itemId)) safeSetItem(indexKey(businessId), JSON.stringify([...idx, itemId]));
  } catch {
    /* cache is best-effort */
  }
}

export function clearVariantCache(businessId: string | null | undefined) {
  if (!businessId) return;
  for (const id of readIndex(businessId)) safeRemoveItem(k(businessId, id));
  safeRemoveItem(indexKey(businessId));
}

/** Remove one item's remembered variants (and its index entry). */
export function forgetItemVariants(businessId: string | null | undefined, itemId: string) {
  if (!businessId) return;
  try {
    if (readCachedVariants(businessId, itemId) === null) return;
    safeRemoveItem(k(businessId, itemId));
    const idx = readIndex(businessId);
    if (idx.includes(itemId)) safeSetItem(indexKey(businessId), JSON.stringify(idx.filter((x) => x !== itemId)));
  } catch {
    /* cache is best-effort */
  }
}

/**
 * Whether asking the server for this item's variants can return anything.
 * The menu list carries `has_variants` (active variants exist). Only an
 * explicit `false` skips the request: `true`, or the field missing because the
 * backend predates it, still asks, so an older backend behaves as before.
 */
export function itemMayHaveVariants(item: { has_variants?: boolean | null }): boolean {
  return item.has_variants !== false;
}

/**
 * Active variants of one item. With no connection: the last remembered answer (or []).
 * An item the menu says has no active variants (`has_variants: false`) answers []
 * without a request.
 */
export async function fetchItemVariants(
  businessId: string | null | undefined,
  item: { id: string; name?: string; price_cents?: number; has_variants?: boolean | null },
): Promise<ProductVariant[]> {
  if (!itemMayHaveVariants(item)) return [];
  try {
    const data = await apiClient.get<ProductVariant[]>(`/v1/business/menu/items/${item.id}/variants`);
    const list = Array.isArray(data) ? data : [];
    cacheVariants(businessId, item.id, list, { item_name: item.name, base_price_cents: item.price_cents });
    return list;
  } catch (err) {
    if ((err as ApiFetchError | undefined)?.noResponse && businessId) {
      const hit = readCachedVariants(businessId, item.id);
      if (hit) return hit.variants;
      // Never cached and no connection: we cannot know. Treat as "no variants";
      // the server still refuses a variant item without one (VARIANT_REQUIRED).
      return [];
    }
    throw err;
  }
}

export type LookupKey = { barcode: string } | { sku: string };

/** Offline resolution from every cached variant set. Exact match, active only. */
export function lookupVariantLocal(businessId: string | null | undefined, key: LookupKey): VariantLookupResult | null {
  if (!businessId) return null;
  const wantBarcode = "barcode" in key ? key.barcode.trim() : null;
  const wantSku = "sku" in key ? key.sku.trim().toLowerCase() : null;
  for (const itemId of readIndex(businessId)) {
    const hit = readCachedVariants(businessId, itemId);
    if (!hit) continue;
    for (const v of hit.variants) {
      if (!v.is_active) continue;
      const match =
        wantBarcode !== null ? v.barcode !== null && v.barcode === wantBarcode : v.sku.toLowerCase() === wantSku;
      if (match) {
        return {
          menu_item_id: itemId,
          menu_item_name: hit.item_name ?? "",
          base_price_cents: hit.base_price_cents ?? v.effective_price_cents,
          variant: v,
        };
      }
    }
  }
  return null;
}

export type ScanResolution =
  | { kind: "found"; result: VariantLookupResult; offline: boolean }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/**
 * Resolve a scanned / typed code. Tried as barcode first, then SKU (staff type
 * either into the one field). Online uses the server; a request with no HTTP
 * response falls back to the cache. A 404 from the server is a definite miss.
 */
export async function resolveScan(
  businessId: string | null | undefined,
  rawCode: string,
  online: boolean,
): Promise<ScanResolution> {
  const code = rawCode.trim();
  if (!code) return { kind: "not_found" };
  const keys: LookupKey[] = [{ barcode: code }, { sku: code }];

  const local = (): ScanResolution => {
    for (const key of keys) {
      const r = lookupVariantLocal(businessId, key);
      if (r) return { kind: "found", result: r, offline: true };
    }
    return { kind: "not_found" };
  };

  if (!online) return local();

  for (const key of keys) {
    const qs = "barcode" in key ? `barcode=${encodeURIComponent(key.barcode)}` : `sku=${encodeURIComponent(key.sku)}`;
    try {
      const result = await apiClient.get<VariantLookupResult>(`/v1/business/pos/lookup?${qs}`);
      if (result?.variant) {
        cacheLookupHit(businessId, result);
        return { kind: "found", result, offline: false };
      }
    } catch (err) {
      const e = err as ApiFetchError | undefined;
      if (e?.status === 404) continue;
      if (e?.noResponse) return local();
      return { kind: "error", message: e?.message ?? "Could not look that code up" };
    }
  }
  return { kind: "not_found" };
}

function cacheLookupHit(businessId: string | null | undefined, r: VariantLookupResult) {
  if (!businessId) return;
  const prev = readCachedVariants(businessId, r.menu_item_id)?.variants ?? [];
  const merged = [...prev.filter((v) => v.id !== r.variant.id), r.variant];
  cacheVariants(businessId, r.menu_item_id, merged, {
    item_name: r.menu_item_name,
    base_price_cents: r.base_price_cents,
  });
}

/** Stock presentation: zero or less is still sellable, but warned. */
export function stockState(v: Pick<ProductVariant, "stock_on_hand">): "untracked" | "ok" | "low" | "out" {
  if (v.stock_on_hand === null || v.stock_on_hand === undefined) return "untracked";
  if (v.stock_on_hand <= 0) return "out";
  if (v.stock_on_hand <= 3) return "low";
  return "ok";
}

/**
 * Background warm-up so offline barcode/SKU entry has something to search.
 * Throttled (small concurrency) and skips items cached within `maxAgeMs`.
 */
export async function warmVariantCache(
  businessId: string | null | undefined,
  items: { id: string; name: string; price_cents: number; has_variants?: boolean | null }[],
  opts: { concurrency?: number; maxAgeMs?: number; isCancelled?: () => boolean } = {},
): Promise<void> {
  if (!businessId) return;
  const { concurrency = 3, maxAgeMs = 6 * 60 * 60 * 1000, isCancelled } = opts;
  // Items the (fresh, online) menu says have no active variants are never
  // requested; any variants remembered for them from before are dropped, so an
  // offline scan cannot sell a variant that has since been deactivated.
  const todo = items.filter((i) => {
    if (!itemMayHaveVariants(i)) {
      forgetItemVariants(businessId, i.id);
      return false;
    }
    const c = readCachedVariants(businessId, i.id);
    return !c || Date.now() - c.at > maxAgeMs;
  });
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !isCancelled?.()) {
      const item = todo[next++];
      try {
        await fetchItemVariants(businessId, item);
      } catch {
        /* a failed warm-up read is not an error to the cashier */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
}
