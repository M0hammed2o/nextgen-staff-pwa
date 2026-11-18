import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { StaffUser, LoginRequest, LoginResponse, SavedBusiness } from "@/types";
import { apiClient } from "@/lib/api";
import type { ApiFetchError } from "@/lib/api";
import { wipeLocalPosData } from "@/lib/offline/runtime";
import {
  getStoredTokens,
  storeTokens,
  clearTokens,
  getStoredUser,
  storeUser,
  getSavedBusiness,
  saveBusiness,
  clearAll,
} from "@/lib/token-storage";

interface AuthContextType {
  user: StaffUser | null;
  savedBusiness: SavedBusiness | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (data: LoginRequest) => Promise<void>;
  /**
   * Local POS data (synced queue entries, cached menu, training state) is
   * wiped. Unsynced offline sales are KEPT unless `discardUnsynced` is true;
   * callers must have asked for explicit confirmation before passing it.
   */
  logout: (opts?: { discardUnsynced?: boolean }) => Promise<void>;
  changeStore: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(getStoredUser());
  const [savedBusiness, setSavedBusiness] = useState<SavedBusiness | null>(getSavedBusiness());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const tokens = getStoredTokens();
    if (tokens?.access_token) {
      apiClient
        .get<StaffUser>("/v1/auth/me")
        .then((u) => {
          setUser(u);
          storeUser(u);
        })
        .catch((err: ApiFetchError | undefined) => {
          // No HTTP response at all = we are offline (or the server is
          // unreachable), NOT that the session is invalid. Keep the stored
          // session so the till can still capture offline sales after a
          // reload; the first real response will re-validate it.
          if (err?.noResponse) return;
          clearTokens();
          setUser(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (data: LoginRequest) => {
    const res = await apiClient.post<LoginResponse>("/v1/auth/pin", data);
    storeTokens(res.tokens);
    storeUser(res.user);
    setUser(res.user);
    // Persist business context so the PIN-only screen shows on future sessions
    if (res.user.business_id && res.user.business_name) {
      const biz: SavedBusiness = {
        business_id: res.user.business_id,
        business_code: data.business_code,
        business_name: res.user.business_name,
      };
      saveBusiness(biz);
      setSavedBusiness(biz);
    }
  }, []);

  const logout = useCallback(async (opts?: { discardUnsynced?: boolean }) => {
    // Clear client-side session state first, then best-effort notify the
    // server -- apiClient has no request timeout anywhere, so awaiting the
    // revocation call before clearing local state risked a slow/hanging
    // request blocking logout entirely (found via a real, if rare, browser
    // test flake in the sibling Manager Dashboard app's identical pattern;
    // fixed there and here together).
    const tokens = getStoredTokens();
    // Wipe local POS data while the stored user is still readable (it is
    // keyed by business/user). Best-effort: never blocks logout.
    // Capped at 2s so a wedged IndexedDB can never trap someone logged in.
    await Promise.race([
      wipeLocalPosData({ discardUnsynced: opts?.discardUnsynced === true }).catch(() => undefined),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    clearTokens(); // clears tokens + cached user; business context is preserved
    setUser(null);
    if (tokens?.refresh_token) {
      apiClient.post("/v1/auth/logout", { refresh_token: tokens.refresh_token }).catch((e) => {
        console.error("Logout API call failed (non-fatal, already logged out locally):", e);
      });
    }
  }, []);

  const changeStore = useCallback(() => {
    clearAll(); // clears tokens, user, and business context
    setUser(null);
    setSavedBusiness(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        savedBusiness,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        changeStore,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
