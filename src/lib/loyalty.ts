import { apiClient } from "./api";
import type { ApiFetchError } from "./api";
import type { CustomerLoyaltyResponse } from "@/types";

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
 * Reward redemption is NOT wired here — see KNOWN_BUGS.md BUG-0102. The
 * reward catalogue's `value_cents` (which determines whether a reward is
 * redeemable at the till and for how much) is not exposed by
 * LoyaltyRewardResponse and cannot be set via LoyaltyRewardCreate/Update
 * either, so no reward can honestly be shown as till-redeemable from this
 * frontend today.
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
