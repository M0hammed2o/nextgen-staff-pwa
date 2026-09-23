import type { CartLine, POSOrderCreateRequest } from "@/types";
import type { OrderMode } from "@/components/pos/CartPanel";

// ── POS draft persistence ────────────────────────────────────────────────
//
// The till's cart used to live only in React state. If a checkout request
// succeeded server-side but the response never made it back (slow network,
// forced token-refresh reload, cashier closes the tab), the cashier had no
// way to know that — reloading gave them a blank cart and a brand-new
// idempotency key, and re-ringing the same order created a genuine duplicate
// sale (the backend only de-dupes on a REPEATED (business_id, key) pair).
//
// This module persists exactly one in-progress draft per (business, staff
// user) pair, keyed in localStorage — deliberately per-user, not shared per
// device/terminal, so a second cashier logging into the same till never
// silently inherits the first cashier's half-built cart. If a business
// genuinely wants a shared terminal cart (e.g. one shared login), that is a
// product decision for later, not something to default to silently.
//
// Follows the same defensive pattern as token-storage.ts: try/catch on every
// access, since localStorage can throw (private browsing, storage full,
// disabled) and a draft is a convenience, never something a sale should
// depend on to complete.

const DRAFT_KEY_PREFIX = "nextgen_staff_pos_draft_v1";

// A draft older than this is treated as stale and discarded rather than
// resurfacing a half-finished cart from a previous day/shift.
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * A checkout submission's persisted state, tracked alongside the cart it was
 * built from.
 *
 * - "idle": no request is in flight; the cart is freely editable.
 * - "in_flight": a checkout POST was sent with `payload`/`idempotencyKey`
 *   and its outcome is unknown (the response never arrived — timeout,
 *   reload, tab close). The cart must NOT be edited or re-submitted under a
 *   NEW key while in this state: the backend returns the ORIGINAL order for
 *   a repeated key, so silently changing the cart and resending under the
 *   same key would get back stale/wrong order data. The only safe recovery
 *   is resending the exact same payload under the exact same key (the
 *   backend either returns the order it already created, or creates it for
 *   the first time — never a duplicate).
 */
export type PosDraftSubmission =
  | { status: "idle" }
  | { status: "in_flight"; payload: POSOrderCreateRequest; idempotencyKey: string; startedAt: number };

// DELIBERATELY NO loyaltyReward field here (2026-09-23, till reward
// redemption feature). A pending reward SELECTION (as opposed to one
// already embedded in a frozen `submission.payload` below, which is fine —
// that is a request that was already sent, not a live pick) is a live UI
// convenience, not a committed fact worth surviving a reload: restoring a
// stale pick risks silently re-attaching a reward to a DIFFERENT cart or
// customer than it was originally checked against hours earlier (see
// DRAFT_MAX_AGE_MS), which is exactly the hazard this feature's spec
// warns against. Safety over convenience — Pos.tsx always starts a
// restored draft with no reward selected and requires the cashier to
// re-pick. Do not add this field without re-reading that reasoning.
export interface PosDraftV1 {
  version: 1;
  savedAt: number;
  cart: CartLine[];
  orderMode: OrderMode;
  tableNumber: string;
  customerName: string;
  customerPhone: string;
  discountRand: string;
  discountReason: string;
  idempotencyKey: string;
  submission: PosDraftSubmission;
}

export type PosDraftFields = Omit<PosDraftV1, "version" | "savedAt">;

function draftKey(businessId: string, userId: string): string {
  return `${DRAFT_KEY_PREFIX}:${businessId}:${userId}`;
}

function isWellFormed(value: unknown): value is PosDraftV1 {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<PosDraftV1>;
  return (
    d.version === 1 &&
    typeof d.savedAt === "number" &&
    Array.isArray(d.cart) &&
    typeof d.idempotencyKey === "string" &&
    typeof d.orderMode === "string" &&
    !!d.submission &&
    typeof (d.submission as { status?: unknown }).status === "string"
  );
}

/** Loads the draft for this (business, user) pair, if any, not expired, and structurally valid. */
export function loadPosDraft(
  businessId: string | null | undefined,
  userId: string | null | undefined
): PosDraftV1 | null {
  if (!businessId || !userId) return null;
  try {
    const raw = localStorage.getItem(draftKey(businessId, userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isWellFormed(parsed)) return null;
    if (Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    // Corrupted JSON, storage disabled, etc. — behave as if there were no
    // draft rather than throwing and blocking the till from loading.
    return null;
  }
}

/** Persists the current draft. Failures are swallowed — the live sale in progress is never blocked by storage issues. */
export function savePosDraft(
  businessId: string | null | undefined,
  userId: string | null | undefined,
  fields: PosDraftFields
): void {
  if (!businessId || !userId) return;
  try {
    const full: PosDraftV1 = { ...fields, version: 1, savedAt: Date.now() };
    localStorage.setItem(draftKey(businessId, userId), JSON.stringify(full));
  } catch {
    // Storage full/unavailable — nothing to do; the in-memory cart still works.
  }
}

export function clearPosDraft(businessId: string | null | undefined, userId: string | null | undefined): void {
  if (!businessId || !userId) return;
  try {
    localStorage.removeItem(draftKey(businessId, userId));
  } catch {
    // ignore
  }
}
