import type { AuthTokens, SavedBusiness } from "@/types";
import { safeGetItem, safeSetItem, safeRemoveItem } from "@/lib/safe-storage";

const TOKEN_KEY = "nextgen_staff_tokens";
const USER_KEY = "nextgen_staff_user";
const BUSINESS_KEY = "nextgen_staff_business";

// ── Token & User (cleared on logout) ─────────────────────────────────────────
//
// Every access here routes through safe-storage.ts's localStorage ->
// sessionStorage -> in-memory fallback chain, so a storage throw (e.g.
// Safari on iPad under storage partitioning / private browsing) can never
// propagate up into the login flow and be mistaken for a wrong PIN.

export function getStoredTokens(): AuthTokens | null {
  try {
    const raw = safeGetItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeTokens(tokens: AuthTokens): void {
  safeSetItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearTokens(): void {
  safeRemoveItem(TOKEN_KEY);
  safeRemoveItem(USER_KEY);
}

export function getStoredUser() {
  try {
    const raw = safeGetItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeUser(user: unknown): void {
  safeSetItem(USER_KEY, JSON.stringify(user));
}

// ── Business Context ──────────────────────────────────────────────────────────
// Persists across sessions; only cleared when the user selects "Change Store".
// This lets the PIN-only screen show the correct restaurant name on return visits
// without requiring the business code to be re-entered.

export function getSavedBusiness(): SavedBusiness | null {
  try {
    const raw = safeGetItem(BUSINESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveBusiness(business: SavedBusiness): void {
  safeSetItem(BUSINESS_KEY, JSON.stringify(business));
}

export function clearBusiness(): void {
  safeRemoveItem(BUSINESS_KEY);
}

// Clears everything — used by "Change Store" to return to first-time setup.
export function clearAll(): void {
  safeRemoveItem(TOKEN_KEY);
  safeRemoveItem(USER_KEY);
  safeRemoveItem(BUSINESS_KEY);
}
