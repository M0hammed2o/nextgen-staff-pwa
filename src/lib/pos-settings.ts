import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
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
  return settings.staff_live_orders_tab_enabled ? "/" : "/pos";
}
