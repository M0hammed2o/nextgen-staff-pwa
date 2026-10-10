import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./api";
import type { ApiFetchError } from "./api";
import type { CustomerLoyaltyResponse, LoyaltyRewardResponse } from "@/types";
import { useAuth } from "@/lib/auth";

/**
 * True if this failure is the backend's 409 `LOYALTY_NOT_ENABLED` —
 * the `Business.loyalty_enabled` platform entitlement gate
 * (`_require_loyalty_enabled`, migration 0051, KNOWN_BUGS.md BUG-0107)
 * that now runs FIRST in every `routes_loyalty.py` route, ahead of any
 * other check. For a business without the Loyalty module (every POS-only
 * R899/Operations-only R1,499 tenant, i.e. most of the install base) this
 * is a completely normal, expected state — not a failure — so every call
 * site below treats it as a clean absence, matching the existing 404
 * (`LOYALTYPROGRAM_NOT_FOUND`, no programme configured) handling.
 *
 * Code-first with a text fallback, mirroring the manager dashboard's
 * `src/lib/entitlements.ts::isLoyaltyNotEnabledError` for consistency
 * across the two apps — `ApiFetchError.code` (populated from the backend's
 * `{ error: { code, message, details } }` shape, see src/lib/api.ts) is
 * the reliable signal; the message-text fallback only matters if some
 * intermediary ever strips the parsed `code` but leaves the message intact.
 * Deliberately does NOT match on `status === 409` alone — 409 is used for
 * other, unrelated conflicts in this app (e.g. "Till is closed" on
 * checkout), and treating every 409 as "loyalty not enabled" would swallow
 * a genuine failure instead of surfacing it (see KNOWN_BUGS.md BUG-0108).
 */
export function isLoyaltyNotEnabledError(err: unknown): boolean {
  const apiErr = err as ApiFetchError | null | undefined;
  if (!apiErr) return false;
  if (apiErr.code === "LOYALTY_NOT_ENABLED") return true;
  return typeof apiErr.message === "string" && apiErr.message.includes("LOYALTY_NOT_ENABLED");
}

/**
 * Look up a walk-in customer's loyalty points balance/tier by phone number,
 * for display at the till (backend/app/api/v1/routes_loyalty.py::lookup_customer_by_phone,
 * GET /v1/business/loyalty/customers/lookup?phone=).
 *
 * Backend quirks callers must handle, not just the happy path:
 *
 *  - It CREATES a customer as a side effect if none exists yet for this
 *    phone number (get_or_create_customer_by_phone) — so this must only be
 *    called for a phone number the cashier has actually finished typing,
 *    debounced and gated on `looksLikeSaPhoneNumber` (src/lib/phone.ts),
 *    never fired on every keystroke. See LoyaltyBalance.tsx.
 *  - It 404s with code LOYALTYPROGRAM_NOT_FOUND whenever the business
 *    hasn't enabled its loyalty programme. That is a clean "the feature
 *    isn't available for this business", not an error — this resolves to
 *    `null` for a 404 specifically, rather than throwing.
 *  - Since migration 0051 it also 409s with `LOYALTY_NOT_ENABLED` FIRST,
 *    ahead of the 404 check above, whenever the business lacks the
 *    platform entitlement (KNOWN_BUGS.md BUG-0107/BUG-0108) — this is the
 *    exact same "clean absence" signal as the 404 case and must resolve to
 *    `null` too, never throw.
 *  - Any other failure (network, validation, 5xx, or an unrecognised 409)
 *    still throws so the caller can show a real error.
 *
 * Reward SELECTION now lives in `listLoyaltyRewards()` below and
 * `src/components/pos/LoyaltyRewardPicker.tsx` (2026-09-23, closing
 * KNOWN_BUGS.md BUG-0104) — `LoyaltyRewardResponse.value_cents` is exposed
 * by the backend now, so a reward can honestly be shown as till-redeemable.
 * This function still only ever reads the balance; it never redeems
 * anything — redemption happens exclusively via
 * `POSOrderCreateRequest.loyalty_reward_id` at POS checkout
 * (`backend/app/api/v1/routes_pos.py::create_pos_order`), never via a
 * separate call from this frontend, so the backend's own
 * subtotal/points/idempotency validation is always the thing that decides
 * whether a redemption actually happens. That checkout path is itself
 * gated by the same entitlement check server-side, but deliberately is NOT
 * given the same "swallow to null" treatment anywhere in this app — a
 * rejected order creation is a genuine failed action that must stay a
 * visible error (see Pos.tsx's `handleSubmit`/`handleRecoverySubmit`).
 */
export async function lookupLoyaltyCustomer(phone: string): Promise<CustomerLoyaltyResponse | null> {
  try {
    return await apiClient.get<CustomerLoyaltyResponse>(
      `/v1/business/loyalty/customers/lookup?phone=${encodeURIComponent(phone)}`
    );
  } catch (err) {
    const apiErr = err as ApiFetchError;
    if (apiErr?.status === 404) return null;
    if (apiErr?.status === 409 && isLoyaltyNotEnabledError(apiErr)) return null;
    throw err;
  }
}

/**
 * The reward catalogue available for till redemption
 * (backend/app/api/v1/routes_loyalty.py::list_rewards, STAFF-or-above).
 * The route already filters to `is_active == true` server-side — this
 * function does no additional filtering; see LoyaltyRewardPicker.tsx for
 * the affordability/value filtering that decides which of these a cashier
 * may actually select.
 *
 * In normal operation this is only ever fetched once `lookupLoyaltyCustomer`
 * has already succeeded (`LoyaltyRewardPicker.tsx` gates `enabled` on
 * `!!customerQuery.data`), so a non-entitled business's 409 is caught
 * upstream and this never fires. It is left throwing (not swallowed here)
 * so `LoyaltyRewardPicker.tsx` can distinguish "not entitled" from "backend
 * genuinely unreachable" via `isLoyaltyNotEnabledError` — the same 409 that
 * must render as nothing must not be conflated with a real fetch failure
 * that should show "Couldn't load rewards.".
 */
export function listLoyaltyRewards(): Promise<LoyaltyRewardResponse[]> {
  return apiClient.get<LoyaltyRewardResponse[]>("/v1/business/loyalty/rewards");
}

/**
 * Is the Loyalty module actually entitled for this business? (UI V2.1, B3 --
 * gates the bottom-nav "Loyalty" entry, shown only when true.)
 *
 * There is no `loyalty_enabled` field on `POSSettings`/`GET /v1/business/
 * pos/settings` today (unlike `inventory_enabled`, which IS exposed there --
 * see types/index.ts). Rather than add a new backend field for this one nav
 * decision, this reuses `listLoyaltyRewards()` -- an existing, side-effect-
 * free GET already built for LoyaltyRewardPicker.tsx, whose 409
 * `LOYALTY_NOT_ENABLED` is the exact same entitlement signal, already
 * handled by `isLoyaltyNotEnabledError`. A real empty reward list (entitled,
 * nothing configured yet) still resolves to "entitled" -- an empty array is
 * a valid, successful response, not an error.
 *
 * Deliberately does NOT reuse `lookupLoyaltyCustomer` for this probe: that
 * endpoint creates a customer record as a side effect for the phone number
 * it's given (see that function's own docstring) and has no side-effect-free
 * equivalent, so it is the wrong tool for a background "is this feature on"
 * check that fires on every app load.
 *
 * NOTE for a future session: if another caller ever needs this same boolean,
 * the cleaner long-term fix is adding `loyalty_enabled` to
 * `POSSettingsResponse` server-side, mirroring `inventory_enabled` exactly --
 * flagged here rather than done speculatively, since this probe-based
 * approach already satisfies the one real caller today without a backend
 * change.
 */
export function useLoyaltyEnabled() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["loyalty-entitlement-probe"],
    queryFn: async () => {
      try {
        await listLoyaltyRewards();
        return true;
      } catch (err) {
        if (isLoyaltyNotEnabledError(err)) return false;
        throw err;
      }
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
