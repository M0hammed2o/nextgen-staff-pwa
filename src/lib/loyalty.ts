import { apiClient } from "./api";
import type { ApiFetchError } from "./api";
import type { CustomerLoyaltyResponse, LoyaltyRewardResponse } from "@/types";

/**
 * Look up a walk-in customer's loyalty points balance/tier by phone number,
 * for display at the till (backend/app/api/v1/routes_loyalty.py::lookup_customer_by_phone,
 * GET /v1/business/loyalty/customers/lookup?phone=).
 *
 * Two backend quirks callers must handle, not just the happy path:
 *
 *  - It CREATES a customer as a side effect if none exists yet for this
 *    phone number (get_or_create_customer_by_phone) — so this must only be
 *    called for a phone number the cashier has actually finished typing,
 *    debounced and gated on `looksLikeSaPhoneNumber` (src/lib/phone.ts),
 *    never fired on every keystroke. See LoyaltyBalance.tsx.
 *  - It 404s with code LOYALTYPROGRAM_NOT_FOUND whenever the business
 *    hasn't enabled its loyalty programme. That is a clean "the feature
 *    isn't available for this business", not an error — this resolves to
 *    `null` for a 404 specifically, rather than throwing. Any other
 *    failure (network, validation, 5xx) still throws so the caller can
 *    show a real error.
 *
 * Reward SELECTION now lives in `listLoyaltyRewards()` below and
 * `src/components/pos/LoyaltyRewardPicker.tsx` (2026-09-23, closing
 * KNOWN_BUGS.md BUG-0102) — `LoyaltyRewardResponse.value_cents` is exposed
 * by the backend now, so a reward can honestly be shown as till-redeemable.
 * This function still only ever reads the balance; it never redeems
 * anything — redemption happens exclusively via
 * `POSOrderCreateRequest.loyalty_reward_id` at POS checkout
 * (`backend/app/api/v1/routes_pos.py::create_pos_order`), never via a
 * separate call from this frontend, so the backend's own
 * subtotal/points/idempotency validation is always the thing that decides
 * whether a redemption actually happens.
 */
export async function lookupLoyaltyCustomer(phone: string): Promise<CustomerLoyaltyResponse | null> {
  try {
    return await apiClient.get<CustomerLoyaltyResponse>(
      `/v1/business/loyalty/customers/lookup?phone=${encodeURIComponent(phone)}`
    );
  } catch (err) {
    const apiErr = err as ApiFetchError;
    if (apiErr?.status === 404) return null;
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
 */
export function listLoyaltyRewards(): Promise<LoyaltyRewardResponse[]> {
  return apiClient.get<LoyaltyRewardResponse[]>("/v1/business/loyalty/rewards");
}
