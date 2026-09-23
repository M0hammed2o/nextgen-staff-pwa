import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { lookupLoyaltyCustomer } from "@/lib/loyalty";
import { looksLikeSaPhoneNumber } from "@/lib/phone";

const DEBOUNCE_MS = 500;

interface Props {
  phone: string;
}

/**
 * Shows a walk-in customer's loyalty points balance/tier at the till, once
 * a complete-looking phone number has been entered in CartPanel's existing
 * "Phone (for loyalty)" field.
 *
 * Debounced AND gated on `looksLikeSaPhoneNumber` (the same client-side
 * completeness check ReceiptSendDialog already uses) rather than firing on
 * every keystroke — the backend lookup endpoint CREATES a customer as a
 * side effect (get_or_create_customer_by_phone, see src/lib/loyalty.ts),
 * so calling it for every partially-typed digit would write spurious
 * customer rows for numbers the cashier never finished entering.
 *
 * Reward redemption is deliberately NOT built here or anywhere else in this
 * app yet — see KNOWN_BUGS.md BUG-0102 and WORKLOG.md 2026-09-23. The
 * reward catalogue's `value_cents` (which decides whether a reward is
 * redeemable at the till at all, and for how much) is never exposed by
 * `GET /v1/business/loyalty/rewards` and cannot be set through any
 * create/update endpoint either — every reward in every seeded/real
 * business has `value_cents = NULL` today, meaning the backend would
 * reject a redemption attempt for ANY reward with
 * REWARD_NOT_REDEEMABLE_AT_TILL. Building a reward picker against that gap
 * would let a cashier select a reward and be rejected every single time —
 * exactly the "shipped a control for a backend field that was never
 * exposed" mistake this feature was explicitly built to avoid repeating.
 * This component only ever displays the balance; it makes no write call.
 */
export default function LoyaltyBalance({ phone }: Props) {
  const [debounced, setDebounced] = useState(phone);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(phone), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [phone]);

  const trimmed = debounced.trim();
  const enabled = looksLikeSaPhoneNumber(trimmed);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["loyalty-customer-lookup", trimmed],
    queryFn: () => lookupLoyaltyCustomer(trimmed),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

  if (!enabled) return null;

  if (isFetching) {
    return <p className="text-xs text-muted-foreground">Checking loyalty balance…</p>;
  }

  if (isError) {
    return <p className="text-xs text-muted-foreground">Couldn't check loyalty balance.</p>;
  }

  if (!data) {
    // A clean 404 (LOYALTYPROGRAM_NOT_FOUND) — this business hasn't
    // enabled loyalty. Not every business runs the programme, so this is
    // an absence, not an error; nothing is shown.
    return null;
  }

  return (
    <p className="text-xs font-medium text-foreground" data-testid="loyalty-balance">
      {data.loyalty_points_balance} pts · {data.loyalty_tier}
      {data.display_name ? ` · ${data.display_name}` : ""}
    </p>
  );
}
