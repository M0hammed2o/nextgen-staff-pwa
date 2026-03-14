import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { StaffUser, LoginRequest, LoginResponse } from "@/types";
import { apiClient } from "@/lib/api";
import {
  getStoredTokens,
  storeTokens,
  clearTokens,
  getStoredUser,
  storeUser,
} from "@/lib/token-storage";

interface AuthContextType {
  user: StaffUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(getStoredUser());
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
  }, []);

  const logout = useCallback(async () => {
    try {
      const tokens = getStoredTokens();
      if (tokens?.refresh_token) {
        await apiClient.post("/v1/auth/logout", { refresh_token: tokens.refresh_token });
      }
    } catch {}
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
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
