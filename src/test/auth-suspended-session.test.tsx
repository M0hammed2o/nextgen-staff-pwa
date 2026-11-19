import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { storeTokens, storeUser, getStoredTokens } from "@/lib/token-storage";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";

/**
 * Souk e2e 8d, after "Reload App": /v1/auth/me answered 403 BUSINESS_SUSPENDED
 * and the app signed the cashier out to a PIN screen that the server refuses
 * too. A suspension is enforced by the server on every call; it is not a
 * rejected session. Only that case keeps the session — a disabled account or
 * any other definite rejection still signs out.
 */

const getMock = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: { get: (...a: unknown[]) => getMock(...a), post: vi.fn(async () => ({})) },
}));
vi.mock("@/lib/offline/runtime", () => ({ wipeLocalPosData: vi.fn(async () => undefined) }));

import { AuthProvider, useAuth } from "@/lib/auth";

function Probe() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p>loading</p>;
  return <p>{user ? `signed in as ${user.staff_name}` : "signed out"}</p>;
}

const TOKENS = { access_token: "a", refresh_token: "r", token_type: "Bearer", expires_in: 1800 };

beforeEach(() => {
  localStorage.clear();
  __resetSafeStorageForTests();
  storeTokens(TOKENS);
  storeUser({ id: "u1", staff_name: "Cashier", role: "STAFF", business_id: "biz-1", business_name: "Stall" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthProvider start-up check", () => {
  it("keeps the session when the business is suspended (403 BUSINESS_SUSPENDED)", async () => {
    getMock.mockRejectedValue({ status: 403, code: "BUSINESS_SUSPENDED", message: "suspended" });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText("signed in as Cashier")).toBeInTheDocument();
    expect(getStoredTokens()).toEqual(TOKENS);
  });

  it("still signs out a disabled account", async () => {
    getMock.mockRejectedValue({ status: 403, code: "ACCOUNT_DISABLED", message: "disabled" });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
    expect(getStoredTokens()).toBeNull();
  });
});
