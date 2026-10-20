import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type { ApiFetchError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { POSSettings } from "@/types";

/**
 * This tenant's till + navigation configuration.
 *
 * One query key shared by every caller, so the bottom bar, the welcome
 * redirect and the till page read the same cached response instead of each
 * refetching on navigation.
 */
export function usePOSSettings() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["pos-settings"],
    queryFn: () => apiClient.get<POSSettings>("/v1/business/pos/settings"),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Where a staff member should land after signing in.
 *
 * A tenant that does not take WhatsApp orders has nothing on Live Orders — a
 * POS sale is already paid and completed the moment it is rung up — so
 * sending them there would open the app on a permanently empty screen. While
 * settings are still loading we return null rather than guessing, so the
 * caller can wait instead of bouncing the user through two screens.
 */
export function landingPath(settings: POSSettings | null | undefined): string | null {
  if (!settings) return null;
  if (settings.staff_live_orders_tab_enabled) return "/";
  // A WhatsApp-only tenant (pos_enabled === false, no POS on this
  // subscription at all) has nothing at /pos either -- every POS-write
  // route 409s POS_NOT_ENABLED there (see BottomNav.tsx's Till gate and
  // isPosNotEnabledError below). Checked explicitly against `=== false`
  // (not falsy) so `undefined` -- an older/cached response that doesn't
  // carry this field yet -- falls through to the existing "/pos" default
  // below, unchanged for every tenant on a normal POS subscription.
  if (settings.pos_enabled === false) return "/";
  return "/pos";
}

/**
 * True if this failure is the backend's 409 `POS_NOT_ENABLED` -- the
 * `Business.pos_enabled` platform entitlement gate a WhatsApp-only
 * subscription trips on every POS-write route (till open/close, POS order
 * creation, payment intents, refund/void). This app has no reason to call
 * those for a WhatsApp-only tenant (Till is hidden -- see BottomNav.tsx --
 * and the landing redirect never sends them to /pos), but a staff member
 * could still reach /pos by typing the URL directly, so Pos.tsx checks this
 * to show a clear message instead of a generic/broken error state.
 *
 * Code-first with a text fallback, mirroring lib/loyalty.ts::isLoyaltyNotEnabledError's own code vs message-text
 * precedence. Deliberately does NOT match on `status === 409` alone -- 409
 * is used for other, unrelated conflicts in this app too (e.g. "Till is
 * closed" on checkout), and treating every 409 as "POS not enabled" would
 * misreport a genuine failure instead of surfacing it.
 */
export function isPosNotEnabledError(err: unknown): boolean {
  const apiErr = err as ApiFetchError | null | undefined;
  if (!apiErr) return false;
  if (apiErr.code === "POS_NOT_ENABLED") return true;
  return typeof apiErr.message === "string" && apiErr.message.includes("POS_NOT_ENABLED");
}
