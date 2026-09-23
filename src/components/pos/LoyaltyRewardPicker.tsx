import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { lookupLoyaltyCustomer, listLoyaltyRewards } from "@/lib/loyalty";
import { looksLikeSaPhoneNumber } from "@/lib/phone";
import { cn, formatCurrency } from "@/lib/utils";
import type { LoyaltyRewardResponse } from "@/types";

const DEBOUNCE_MS = 500;

interface Props {
  phone: string;
  /** Cart subtotal in cents (before any discount/loyalty/delivery/VAT). */
  subtotalCents: number;
  /** The cashier's own staff-discount entry, in cents — see maxDiscountableCents below. */
  discountCents: number;
  selectedReward: LoyaltyRewardResponse | null;
  onSelect: (reward: LoyaltyRewardResponse | null) => void;
}

/**
 * Till reward picker — companion to LoyaltyBalance.tsx (which still owns
 * the plain balance/tier text; this component owns SELECTION only). Shown
 * once a phone number is attached and the business's loyalty programme is
 * enabled (same gate LoyaltyBalance already uses).
 *
 * THE FINANCIAL RULE: this component never applies a discount itself. It
 * only ever attaches a reward id to the till's in-progress sale — Pos.tsx
 * sends that id as `POSOrderCreateRequest.loyalty_reward_id` at checkout,
 * and the backend (`routes_pos.py::create_pos_order` ->
 * `loyalty/engine.py::redeem_reward_for_checkout`) is the only thing that
 * ever validates it, computes the actual discount, deducts points, and
 * commits — see DECISIONS.md DECISION-0036/0038. Every rand value shown
 * here (the reward's "worth Rxx.xx" line, and CartPanel/Pos.tsx's "preview"
 * total that factors this reward in) is a client-side estimate using the
 * exact same clamp formula the backend uses
 * (`maxDiscountableCents = subtotal - staff discount`), computed purely so
 * the cashier isn't flying blind before tapping Pay — never sent to the
 * backend as a number to trust, and never assumed to be what actually gets
 * applied. Only `reward.id` is ever sent.
 *
 * FILTERING — deliberately more conservative than the backend requires:
 *  - `value_cents` null or <= 0 -> "Not redeemable at the till" (matches
 *    the backend's own REWARD_NOT_REDEEMABLE_AT_TILL — see DECISION-0038;
 *    NULL means the reward is manual-handover-only by design).
 *  - `points_cost` > the customer's current balance -> "Not enough points".
 *  - `value_cents` > what this cart can currently absorb (subtotal minus
 *    any staff discount already entered) -> "Too high for this order".
 *    The backend would actually still ACCEPT this reward (DECISION-0036:
 *    clamp the discount and record a shortfall, rather than reject) — this
 *    extra restriction is a deliberate frontend-side safety margin on top
 *    of a more permissive backend, per this feature's spec: a cashier
 *    should never be offered a reward that can't be fully honoured, even
 *    though the backend itself would tolerate the shortfall.
 *  - `is_active === false` is defensive only — GET /loyalty/rewards
 *    already filters to active rewards server-side
 *    (routes_loyalty.py::list_rewards, verified from source).
 *
 * Selecting the already-selected reward again deselects it (radio-style,
 * at most one reward per sale — `POSOrderCreateRequest` has no field for
 * more than one).
 */
export default function LoyaltyRewardPicker({ phone, subtotalCents, discountCents, selectedReward, onSelect }: Props) {
  const [debounced, setDebounced] = useState(phone);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(phone), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [phone]);

  const trimmed = debounced.trim();
  const enabled = looksLikeSaPhoneNumber(trimmed);

  // Same queryKey as LoyaltyBalance.tsx's own lookup — TanStack Query
  // dedupes identical in-flight/cached queries, so mounting both
  // components never doubles the get-or-create-customer network call.
  const customerQuery = useQuery({
    queryKey: ["loyalty-customer-lookup", trimmed],
    queryFn: () => lookupLoyaltyCustomer(trimmed),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

  const rewardsQuery = useQuery({
    queryKey: ["loyalty-rewards"],
    queryFn: listLoyaltyRewards,
    // Only fetch once we know loyalty is enabled AND a customer resolved —
    // no point fetching a catalogue to redeem against nobody.
    enabled: enabled && !!customerQuery.data,
    staleTime: 60_000,
    retry: false,
  });

  if (!enabled) return null;
  // LoyaltyBalance already renders "Checking…"/an error/nothing (404 = not
  // enabled) for these same states — this component stays silent rather
  // than duplicating that messaging.
  if (customerQuery.isFetching || !customerQuery.data) return null;

  const customer = customerQuery.data;

  if (rewardsQuery.isLoading) {
    return <p className="text-xs text-muted-foreground">Loading rewards…</p>;
  }
  if (rewardsQuery.isError) {
    return <p className="text-xs text-muted-foreground">Couldn't load rewards.</p>;
  }

  const rewards = rewardsQuery.data ?? [];
  if (rewards.length === 0) {
    return <p className="text-xs text-muted-foreground">No rewards set up for this business yet.</p>;
  }

  // Mirrors routes_pos.py::create_pos_order's
  // `max_discountable_cents = max(0, subtotal_cents - body.discount_cents)`
  // exactly — a reward discounts the food, not the delivery fee, computed
  // BEFORE delivery fee/VAT, same as the backend.
  const maxDiscountableCents = Math.max(0, subtotalCents - discountCents);

  return (
    <div className="space-y-1.5" data-testid="loyalty-reward-picker">
      <span className="text-xs font-medium text-muted-foreground">Redeem a reward (optional)</span>
      <div className="space-y-1.5">
        {rewards.map((reward) => {
          const reasons: string[] = [];
          if (!reward.is_active) reasons.push("No longer available");
          if (reward.value_cents == null || reward.value_cents <= 0) {
            reasons.push("Not redeemable at the till");
          } else if (reward.value_cents > maxDiscountableCents) {
            reasons.push("Too high for this order");
          }
          if (customer.loyalty_points_balance < reward.points_cost) reasons.push("Not enough points");

          const disabled = reasons.length > 0;
          const isSelected = selectedReward?.id === reward.id;

          return (
            <button
              key={reward.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(isSelected ? null : reward)}
              aria-pressed={isSelected}
              data-testid={`loyalty-reward-${reward.id}`}
              className={cn(
                "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border p-2.5 text-left transition-colors",
                disabled
                  ? "cursor-not-allowed border-border bg-secondary/40 opacity-60"
                  : isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card active:bg-muted"
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{reward.name}</p>
                <p className="text-xs text-muted-foreground">
                  {reward.points_cost} pts
                  {reward.value_cents != null && reward.value_cents > 0
                    ? ` · worth ${formatCurrency(reward.value_cents)}`
                    : ""}
                </p>
                {disabled && <p className="text-xs text-destructive">{reasons[0]}</p>}
              </div>
              {isSelected && <span className="flex-shrink-0 text-xs font-semibold text-primary">Selected</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Same clamp formula as the backend's `max_discountable_cents` (see the
 * component docstring above) — exported so CartPanel/Pos.tsx can compute
 * the SAME preview discount for their own totals/PaymentDialog display
 * without duplicating the formula (and risking the two drifting apart).
 * This is, and must stay, a PREVIEW ONLY — the committed order's own
 * `loyalty_discount_cents` (returned by the backend) is the only real
 * figure ever printed on a receipt or a "Sale complete" screen.
 */
export function previewLoyaltyDiscountCents(
  reward: LoyaltyRewardResponse | null,
  subtotalCents: number,
  discountCents: number
): number {
  if (!reward || reward.value_cents == null || reward.value_cents <= 0) return 0;
  const maxDiscountableCents = Math.max(0, subtotalCents - discountCents);
  return Math.min(reward.value_cents, maxDiscountableCents);
}
