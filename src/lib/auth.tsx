import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { StaffUser, LoginRequest, LoginResponse, SavedBusiness } from "@/types";
import { apiClient } from "@/lib/api";
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
  logout: () => Promise<void>;
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
        .catch(() => {
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

  const logout = useCallback(async () => {
    try {
      const tokens = getStoredTokens();
      if (tokens?.refresh_token) {
        await apiClient.post("/v1/auth/logout", { refresh_token: tokens.refresh_token });
      }
    } catch (e) {
      // Logout API failure is non-fatal — user is cleared locally regardless.
      console.error("Logout API call failed:", e);
    }
    clearTokens(); // clears tokens + cached user; business context is preserved
    setUser(null);
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
