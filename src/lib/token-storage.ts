import type { AuthTokens } from "@/types";

const TOKEN_KEY = "nextgen_staff_tokens";
const USER_KEY = "nextgen_staff_user";

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
