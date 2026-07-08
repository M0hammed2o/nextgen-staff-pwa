import type { AuthTokens, SavedBusiness } from "@/types";

const TOKEN_KEY = "nextgen_staff_tokens";
const USER_KEY = "nextgen_staff_user";
const BUSINESS_KEY = "nextgen_staff_business";

// ── Token & User (cleared on logout) ─────────────────────────────────────────

export function getStoredTokens(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeTokens(tokens: AuthTokens): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeUser(user: unknown): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// ── Business Context ──────────────────────────────────────────────────────────
// Persists across sessions; only cleared when the user selects "Change Store".
// This lets the PIN-only screen show the correct restaurant name on return visits
// without requiring the business code to be re-entered.

export function getSavedBusiness(): SavedBusiness | null {
  try {
    const raw = localStorage.getItem(BUSINESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveBusiness(business: SavedBusiness): void {
  localStorage.setItem(BUSINESS_KEY, JSON.stringify(business));
}

export function clearBusiness(): void {
  localStorage.removeItem(BUSINESS_KEY);
}

// Clears everything — used by "Change Store" to return to first-time setup.
export function clearAll(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(BUSINESS_KEY);
}
