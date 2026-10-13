import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStoredTokens,
  storeTokens,
  clearTokens,
  getStoredUser,
  storeUser,
  getSavedBusiness,
  saveBusiness,
  clearBusiness,
  clearAll,
} from "@/lib/token-storage";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";
import type { SavedBusiness } from "@/types";

const MOCK_TOKENS = {
  access_token: "acc.token",
  refresh_token: "ref.token",
  token_type: "Bearer",
  expires_in: 1800,
};

const MOCK_BUSINESS: SavedBusiness = {
  business_id: "biz-uuid-1",
  business_code: "ONU9XE",
  business_name: "The Burger Joint",
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  __resetSafeStorageForTests();
});

describe("token storage", () => {
  it("returns null when nothing is stored", () => {
    expect(getStoredTokens()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it("round-trips tokens through localStorage", () => {
    storeTokens(MOCK_TOKENS);
    expect(getStoredTokens()).toEqual(MOCK_TOKENS);
  });

  it("clearTokens removes tokens and user but not business", () => {
    storeTokens(MOCK_TOKENS);
    storeUser({ id: "u1", staff_name: "Alice" });
    saveBusiness(MOCK_BUSINESS);

    clearTokens();

    expect(getStoredTokens()).toBeNull();
    expect(getStoredUser()).toBeNull();
    // Business context MUST survive logout
    expect(getSavedBusiness()).toEqual(MOCK_BUSINESS);
  });
});

describe("business context storage", () => {
  it("returns null when nothing is stored", () => {
    expect(getSavedBusiness()).toBeNull();
  });

  it("round-trips business through localStorage", () => {
    saveBusiness(MOCK_BUSINESS);
    expect(getSavedBusiness()).toEqual(MOCK_BUSINESS);
  });

  it("clearBusiness removes only the business entry", () => {
    storeTokens(MOCK_TOKENS);
    saveBusiness(MOCK_BUSINESS);

    clearBusiness();

    expect(getSavedBusiness()).toBeNull();
    expect(getStoredTokens()).toEqual(MOCK_TOKENS);
  });

  it("clearAll removes tokens, user, and business context", () => {
    storeTokens(MOCK_TOKENS);
    storeUser({ id: "u1" });
    saveBusiness(MOCK_BUSINESS);

    clearAll();

    expect(getStoredTokens()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(getSavedBusiness()).toBeNull();
  });
});

describe("first-time vs returning device logic", () => {
  it("no saved business → device is in first-time setup mode", () => {
    expect(getSavedBusiness()).toBeNull();
  });

  it("saved business → device skips code entry on return", () => {
    saveBusiness(MOCK_BUSINESS);
    const stored = getSavedBusiness();
    expect(stored?.business_code).toBe("ONU9XE");
    expect(stored?.business_name).toBe("The Burger Joint");
  });

  it("after changeStore (clearAll) device resets to setup mode", () => {
    storeTokens(MOCK_TOKENS);
    saveBusiness(MOCK_BUSINESS);

    clearAll(); // simulates changeStore()

    expect(getSavedBusiness()).toBeNull();
    expect(getStoredTokens()).toBeNull();
  });
});

describe("token-storage routes writes/removes through safe-storage's fallback chain", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("storeTokens survives a localStorage.setItem throw by falling back to sessionStorage, and getStoredTokens still reads it back", () => {
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (this === localStorage) throw new DOMException("QuotaExceededError");
      realSetItem.call(this, key, value);
    });

    // Previously this call hit localStorage.setItem directly with no
    // try/catch, so the throw above would have propagated straight out of
    // storeTokens() into auth.tsx's login() and then Login.tsx's catch
    // block. It must not throw at all now.
    expect(() => storeTokens(MOCK_TOKENS)).not.toThrow();

    expect(sessionStorage.getItem("nextgen_staff_tokens")).toBe(JSON.stringify(MOCK_TOKENS));
    expect(getStoredTokens()).toEqual(MOCK_TOKENS);
  });

  it("storeUser and saveBusiness also survive a localStorage throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    expect(() => storeUser({ id: "u1", staff_name: "Alice" })).not.toThrow();
    expect(() => saveBusiness(MOCK_BUSINESS)).not.toThrow();

    expect(getStoredUser()).toEqual({ id: "u1", staff_name: "Alice" });
    expect(getSavedBusiness()).toEqual(MOCK_BUSINESS);
  });

  it("clearTokens/clearAll survive a localStorage.removeItem throw and still clear the in-use tier", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("SecurityError"); // force the memory tier
    });
    storeTokens(MOCK_TOKENS);
    storeUser({ id: "u1" });
    expect(getStoredTokens()).toEqual(MOCK_TOKENS);

    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    expect(() => clearAll()).not.toThrow();
    expect(getStoredTokens()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });
});
