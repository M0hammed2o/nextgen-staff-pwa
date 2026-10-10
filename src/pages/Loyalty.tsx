import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Gift, Loader2 } from "lucide-react";
import { lookupLoyaltyCustomer, listLoyaltyRewards } from "@/lib/loyalty";
import { looksLikeSaPhoneNumber } from "@/lib/phone";
import { useTouchField } from "@/hooks/useTouchField";
import EmptyState from "@/components/EmptyState";

/**
 * Staff Loyalty lookup (UI V2.1, B3).
 *
 * Read-only, on purpose. There is exactly ONE place a reward is actually
 * redeemed: Till checkout, via CartPanel/LoyaltyRewardPicker submitting
 * `loyalty_reward_id` on the order itself (backend/app/api/v1/routes_pos.py
 * ::create_pos_order) -- the backend's own subtotal/points/idempotency
 * validation is what makes that redemption real. This page exists purely so
 * a staff member can answer "does this customer have points, and what could
 * they redeem?" without starting a sale first. No manual point adjustment,
 * no redemption button here -- that would be a second, parallel path to the
 * one the backend actually trusts.
 *
 * Reuses the exact same API helpers CartPanel/LoyaltyBalance/
 * LoyaltyRewardPicker already use (lib/loyalty.ts) -- nothing here
 * duplicates a request shape or an entitlement check.
 */
export default function Loyalty() {
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState("");
  const phoneTouch = useTouchField({ value: phone, onChange: setPhone, layout: "NUMERIC" });

  // Deliberately NOT auto-searched on every keystroke/debounce, unlike
  // LoyaltyBalance's till-side use of this same lookup: that endpoint
  // CREATES a customer as a side effect for any number that merely "looks"
  // complete (get_or_create_customer_by_phone, see lib/loyalty.ts's own
  // docstring). A dedicated full-page lookup is exactly where a staff member
  // is most likely to pause mid-number, so this only fires on an explicit
  // Search action, never on typing alone.
  const canSearch = looksLikeSaPhoneNumber(submitted);

  const {
    data: customer,
    isFetching: loadingCustomer,
    isError: customerError,
  } = useQuery({
    queryKey: ["loyalty-page-lookup", submitted],
    queryFn: () => lookupLoyaltyCustomer(submitted),
    enabled: canSearch,
    staleTime: 30_000,
    retry: false,
  });

  const {
    data: rewards = [],
    isFetching: loadingRewards,
  } = useQuery({
    queryKey: ["loyalty-page-rewards"],
    queryFn: listLoyaltyRewards,
    // Only once a customer lookup has actually succeeded -- same gating
    // LoyaltyRewardPicker.tsx uses, so a non-entitled business never fires
    // this call needlessly (it would just 409 LOYALTY_NOT_ENABLED, but
    // there is no reason to ask).
    enabled: !!customer,
    staleTime: 60_000,
    retry: false,
  });

  function handleSearch() {
    setSubmitted(phone.trim());
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-28">
      <header className="safe-top">
        <h1 className="text-xl font-bold text-foreground">Loyalty</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Look up a customer's points balance and available rewards. Redemption happens at the till.
        </p>
      </header>

      <div className="mt-4 flex gap-2">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Customer phone number"
          inputMode={phoneTouch.touchActive ? undefined : "tel"}
          className="h-12 flex-1 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
          {...phoneTouch.fieldProps}
        />
        <button
          onClick={handleSearch}
          disabled={!looksLikeSaPhoneNumber(phone.trim())}
          className="flex h-12 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Search className="h-4 w-4" />
          Search
        </button>
      </div>

      {!submitted ? (
        <EmptyState icon={Search} title="Enter a customer's number to look them up" className="mt-10 py-10" />
      ) : !canSearch ? (
        <p className="mt-6 text-center text-sm text-destructive">That doesn't look like a complete number.</p>
      ) : loadingCustomer ? (
        <div className="mt-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : customerError ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">Couldn't check loyalty balance — try again.</p>
      ) : !customer ? (
        // A clean 404/409 — this business has no loyalty programme, or this
        // number has never earned any points. Not an error; nothing to show.
        <EmptyState icon={Gift} title="No loyalty record for this number" className="mt-10 py-10" />
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground">
              {customer.display_name ?? customer.phone_number ?? "Customer"}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {customer.loyalty_points_balance} pts
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{customer.loyalty_tier} tier</p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground">Available rewards</p>
            {loadingRewards ? (
              <div className="mt-3 flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : rewards.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No rewards configured yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {rewards.map((r) => {
                  const affordable = customer.loyalty_points_balance >= r.points_cost;
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{r.name}</p>
                        {r.description && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.description}</p>
                        )}
                      </div>
                      <span
                        className={
                          affordable
                            ? "shrink-0 rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success"
                            : "shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                        }
                      >
                        {r.points_cost} pts
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              To redeem, start the sale at the Till — the reward is applied there.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
