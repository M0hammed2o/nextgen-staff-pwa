import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";

/**
 * UI V2.1 (B1/B2/B3/B4): BottomNav's entitlement gating.
 *
 *  - Wastage is no longer its own nav item (merged into Stocktake as a tab).
 *  - Stocktake requires BOTH staff_stocktake_tab_enabled AND
 *    inventory_enabled -- closing the exact gap named in the brief (Wastage
 *    used to be able to appear with inventory off; Stocktake itself was
 *    already correctly gated server-side, this just makes that explicit and
 *    consistent on the frontend side too).
 *  - Loyalty follow-up (Part B2): gated directly on
 *    `POSSettings.loyalty_enabled`, a real field mirroring
 *    `Business.loyalty_enabled` -- replacing the earlier
 *    `lib/loyalty.ts::useLoyaltyEnabled` probe that inferred entitlement
 *    from a `LOYALTY_NOT_ENABLED` API error on an unrelated endpoint.
 */

const getMock = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: "u1", staff_name: "Cashier", role: "STAFF", business_id: "biz-1", business_name: "Barn Owl" },
  }),
}));

import BottomNav from "@/components/BottomNav";

const BASE_SETTINGS = {
  cash_enabled: true,
  card_enabled: true,
  other_payment_enabled: false,
  table_number_required: false,
  delivery_fee_cents: 0,
  max_staff_discount_cents: 0,
  vat_registered: false,
  vat_rate_basis_points: 0,
  vat_inclusive_pricing: false,
  receipt_paper_width_mm: 58,
  receipt_auto_print: false,
  receipt_copies: 1,
  print_kitchen_receipt: false,
  inventory_enabled: false,
  loyalty_enabled: false,
  staff_live_orders_tab_enabled: true,
  staff_wastage_tab_enabled: true,
  staff_stocktake_tab_enabled: false,
};

function mockApi(opts: { inventoryEnabled: boolean; stocktakeTab: boolean; loyaltyEnabled: boolean }) {
  getMock.mockReset();
  getMock.mockImplementation((url: string) => {
    if (url === "/v1/business/pos/settings") {
      return Promise.resolve({
        ...BASE_SETTINGS,
        inventory_enabled: opts.inventoryEnabled,
        staff_stocktake_tab_enabled: opts.stocktakeTab,
        loyalty_enabled: opts.loyaltyEnabled,
      });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderBottomNav() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TouchKeyboardProvider>
          <BottomNav />
        </TouchKeyboardProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BottomNav — Stocktake/Wastage/Loyalty entitlement gating", () => {
  it("inventory off: Stocktake absent, and Wastage is never its own nav item at all", async () => {
    mockApi({ inventoryEnabled: false, stocktakeTab: true, loyaltyEnabled: false });
    renderBottomNav();
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/v1/business/pos/settings"));
    expect(screen.queryByText("Stocktake")).not.toBeInTheDocument();
    expect(screen.queryByText("Wastage")).not.toBeInTheDocument();
  });

  it("inventory on, stocktake tab on: Stocktake is present", async () => {
    mockApi({ inventoryEnabled: true, stocktakeTab: true, loyaltyEnabled: false });
    renderBottomNav();
    await waitFor(() => expect(screen.getByText("Stocktake")).toBeInTheDocument());
  });

  it("inventory on, but the stocktake tab is OFF: Stocktake still absent (both flags must hold)", async () => {
    mockApi({ inventoryEnabled: true, stocktakeTab: false, loyaltyEnabled: false });
    renderBottomNav();
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/v1/business/pos/settings"));
    expect(screen.queryByText("Stocktake")).not.toBeInTheDocument();
  });

  it("loyalty not entitled: Loyalty nav entry absent, and the loyalty rewards endpoint is never called just to find out", async () => {
    mockApi({ inventoryEnabled: false, stocktakeTab: false, loyaltyEnabled: false });
    renderBottomNav();
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/v1/business/pos/settings"));
    expect(screen.queryByText("Loyalty")).not.toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalledWith("/v1/business/loyalty/rewards");
  });

  it("loyalty entitled: Loyalty nav entry present", async () => {
    mockApi({ inventoryEnabled: false, stocktakeTab: false, loyaltyEnabled: true });
    renderBottomNav();
    await waitFor(() => expect(screen.getByText("Loyalty")).toBeInTheDocument());
  });

  it("every entitlement on: Live Orders, Till, Stocktake, Loyalty, Completed, Profile all present", async () => {
    mockApi({ inventoryEnabled: true, stocktakeTab: true, loyaltyEnabled: true });
    renderBottomNav();
    await waitFor(() => expect(screen.getByText("Loyalty")).toBeInTheDocument());
    for (const label of ["Live Orders", "Till", "Stocktake", "Loyalty", "Completed", "Profile"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText("Wastage")).not.toBeInTheDocument();
  });
});

/**
 * Mobile/PWA viewport hardening: --bottom-nav-height must be the nav's real
 * on-screen (border-box) height. It used to come from contentRect, which
 * excludes the bar's own `safe-bottom` padding (the iPhone home-indicator
 * inset) and border-t, so pages reserved ~35px too little on a notched phone.
 * Same fake-ResizeObserver technique as src/test/TouchKeyboard.test.tsx.
 */
describe("BottomNav — --bottom-nav-height measurement", () => {
  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    callback: ResizeObserverCallback;
    target: Element | null = null;
    constructor(cb: ResizeObserverCallback) {
      this.callback = cb;
      FakeResizeObserver.instances.push(this);
    }
    observe(el: Element) {
      this.target = el;
    }
    unobserve() {}
    disconnect() {}
  }
  let original: typeof window.ResizeObserver;

  beforeEach(() => {
    original = window.ResizeObserver;
    FakeResizeObserver.instances = [];
    window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    document.documentElement.style.removeProperty("--bottom-nav-height");
  });
  afterEach(() => {
    window.ResizeObserver = original;
  });

  function fire(entry: Partial<ResizeObserverEntry>) {
    const observer = FakeResizeObserver.instances.at(-1)!;
    act(() => {
      observer.callback([entry as ResizeObserverEntry], observer as unknown as ResizeObserver);
    });
  }

  it("publishes the border-box height (safe-area padding + border included), not contentRect", () => {
    mockApi({ inventoryEnabled: false, stocktakeTab: false, loyaltyEnabled: false });
    renderBottomNav();
    // 66px of content, 34px home-indicator padding, 1px border-t.
    fire({
      contentRect: { height: 66 } as DOMRectReadOnly,
      borderBoxSize: [{ blockSize: 101, inlineSize: 390 }] as unknown as ResizeObserverSize[],
    });
    expect(document.documentElement.style.getPropertyValue("--bottom-nav-height")).toBe("101px");
  });

  it("falls back to offsetHeight when borderBoxSize isn't populated (some WebKit versions)", () => {
    mockApi({ inventoryEnabled: false, stocktakeTab: false, loyaltyEnabled: false });
    renderBottomNav();
    const nav = screen.getByRole("navigation");
    Object.defineProperty(nav, "offsetHeight", { configurable: true, value: 101 });
    fire({ contentRect: { height: 66 } as DOMRectReadOnly, borderBoxSize: undefined });
    expect(document.documentElement.style.getPropertyValue("--bottom-nav-height")).toBe("101px");
  });
});
