import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { OfflineContext, countEntries, type OfflineContextValue } from "@/lib/offline/offline-context";
import { OfflineQueue } from "@/lib/offline/queue";
import { MemoryStore } from "@/lib/offline/store";
import { trainingStore } from "@/lib/offline/training";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";
import { cacheVariants } from "@/lib/variants";
import type { QueueEntry } from "@/lib/offline/types";

/** Till behaviour for product variants: picker, cart payload, barcode/SKU entry, exchange banner. */

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: { get: (...a: unknown[]) => getMock(...a), post: (...a: unknown[]) => postMock(...a) },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: null, staff_name: "Cashier", role: "STAFF", business_id: "biz-1", business_name: "Threads" },
  }),
}));

import Pos from "@/pages/Pos";

const TEE = {
  id: "item-tee", category_id: null, name: "Tee", description: null, price_cents: 19900, currency: "ZAR",
  options_json: null, add_ons: [], is_active: true, sort_order: 0, image_url: null, requires_preparation: false,
};
const BURGER = { ...TEE, id: "item-burger", name: "Burger", price_cents: 5000 };
const VAR_M = {
  id: "var-m", menu_item_id: "item-tee", sku: "TEE-M-BLK", barcode: "6001234567890", attributes: { size: "M" },
  label: "M / Black", price_cents: null, effective_price_cents: 19900, is_active: true, stock_on_hand: 5,
};
const VAR_L = { ...VAR_M, id: "var-l", sku: "TEE-L-BLK", barcode: "6001234567891", label: "L / Black", effective_price_cents: 21900, stock_on_hand: 0 };
const TILL = { id: "till-1", status: "OPEN", opening_float_cents: 0, expected_cash_cents: null, counted_cash_cents: null, variance_cents: null, opened_at: "2026-09-21T08:00:00Z", closed_at: null };
const SETTINGS = {
  cash_enabled: true, card_enabled: true, other_payment_enabled: false, table_number_required: false, delivery_fee_cents: 0,
  max_staff_discount_cents: 0, vat_registered: false, vat_rate_basis_points: 1500, vat_inclusive_pricing: true,
  receipt_paper_width_mm: 80, receipt_auto_print: false, receipt_copies: 1, print_kitchen_receipt: false,
  inventory_enabled: true, digital_receipts_enabled: false, staff_live_orders_tab_enabled: true,
  staff_wastage_tab_enabled: false, staff_stocktake_tab_enabled: false,
};

function installApi() {
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/menu/categories") return Promise.resolve([]);
    if (path === "/v1/business/menu/items") return Promise.resolve([TEE, BURGER]);
    if (path === "/v1/business/pos/till/current") return Promise.resolve(TILL);
    if (path === "/v1/business/pos/settings") return Promise.resolve(SETTINGS);
    if (path === "/v1/business/event-access") return Promise.reject({ status: 404, message: "Not found" });
    if (path === "/v1/business/menu/items/item-tee/variants") return Promise.resolve([VAR_M, VAR_L]);
    if (path === "/v1/business/menu/items/item-burger/variants") return Promise.resolve([]);
    if (path === "/v1/business/pos/lookup?barcode=6001234567890") {
      return Promise.resolve({ menu_item_id: "item-tee", menu_item_name: "Tee", base_price_cents: 19900, variant: VAR_M });
    }
    if (path.startsWith("/v1/business/pos/lookup")) return Promise.reject({ status: 404, message: "Not found", code: "NOT_FOUND" });
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
  postMock.mockResolvedValue({
    id: "order-1", order_number: "A-1", items: [], total_cents: 19900, payment_status: "PAID", status: "COMPLETED",
  });
}

function offlineValue(online: boolean, queue: OfflineQueue): OfflineContextValue {
  return {
    available: true, online, entries: [] as QueueEntry[], counts: countEntries([]), authRequired: false,
    syncNow: async () => undefined,
    enqueueSale: (payload) => queue.enqueueSale({ businessId: "biz-1", staffId: "user-1", payload }),
    retry: async () => undefined, discard: async () => undefined,
  };
}

function renderPos(online = true, url = "/pos", queue = new OfflineQueue(new MemoryStore())) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <OfflineContext.Provider value={offlineValue(online, queue)}>
      <MemoryRouter initialEntries={[url]}>
        <QueryClientProvider client={client}>
          <TouchKeyboardProvider>
            <Pos />
          </TouchKeyboardProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </OfflineContext.Provider>,
  );
  return { ...utils, queue };
}

async function payCashExact() {
  fireEvent.click(await screen.findByRole("button", { name: /Checkout/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Cash/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Exact" }));
  fireEvent.click(await screen.findByRole("button", { name: "Complete sale" }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  __resetSafeStorageForTests();
  trainingStore.reset();
  getMock.mockReset();
  postMock.mockReset();
  installApi();
  window.print = vi.fn();
});
afterEach(() => {
  cleanup();
  trainingStore.reset();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("variant picker", () => {
  it("tapping a product with variants opens the grid with label, price and stock; zero stock is warned but sellable", async () => {
    renderPos();
    fireEvent.click(await screen.findByText("Tee"));

    const grid = await screen.findByTestId("variant-grid");
    expect(grid).toHaveTextContent("M / Black");
    expect(grid).toHaveTextContent("R 199.00");
    expect(grid).toHaveTextContent("5 left");
    expect(screen.getByTestId("variant-TEE-L-BLK")).toHaveTextContent("Out of stock");
    expect(screen.getByTestId("variant-TEE-L-BLK")).toHaveTextContent(/sell anyway/i);
    expect(screen.getByTestId("variant-TEE-L-BLK")).not.toBeDisabled();
  });

  it("choosing a variant puts its label in the cart and the sale payload carries variant_id", async () => {
    renderPos();
    fireEvent.click(await screen.findByText("Tee"));
    fireEvent.click(await screen.findByTestId("variant-TEE-L-BLK")); // out of stock, still sellable

    expect(await screen.findByTestId("cart-variant-label")).toHaveTextContent("L / Black");
    await payCashExact();

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [path, body] = postMock.mock.calls[0] as [string, { items: Array<Record<string, unknown>>; exchange_of_order_id?: string }];
    expect(path).toBe("/v1/business/pos/orders");
    expect(body.items[0]).toMatchObject({ menu_item_id: "item-tee", variant_id: "var-l", quantity: 1 });
    expect("exchange_of_order_id" in body).toBe(false);
  });

  it("a product with no variants adds straight to the cart as before, with no variant_id", async () => {
    renderPos();
    fireEvent.click(await screen.findByText("Burger"));
    await payCashExact();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const body = postMock.mock.calls[0][1] as { items: Array<Record<string, unknown>> };
    expect(screen.queryByTestId("variant-grid")).toBeNull();
    expect("variant_id" in body.items[0]).toBe(false);
  });

  it("if the variants lookup fails the item is treated as a plain item (the server still guards VARIANT_REQUIRED)", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/variants")) return Promise.reject({ status: 500, message: "boom" });
      return installAndGet(path);
    });
    renderPos();
    fireEvent.click(await screen.findByText("Tee"));
    await payCashExact();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
  });

  it("VARIANT_REQUIRED from the server is shown as a clear message", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/variants")) return Promise.resolve([]);
      return installAndGet(path);
    });
    postMock.mockRejectedValue({ status: 422, code: "VARIANT_REQUIRED", message: "raw" });
    renderPos();
    fireEvent.click(await screen.findByText("Tee"));
    await payCashExact();
    expect(await screen.findByText(/comes in sizes or colours/i)).toBeInTheDocument();
  });
});

describe("has_variants from the menu list", () => {
  const variantCalls = () =>
    getMock.mock.calls.map((c) => c[0] as string).filter((p) => p.endsWith("/variants"));

  function withItems(items: unknown[]) {
    const base = getMock.getMockImplementation()!;
    getMock.mockImplementation((path: string) =>
      path === "/v1/business/menu/items" ? Promise.resolve(items) : base(path),
    );
  }

  it("has_variants:false makes no variants request (tap or warm-up) and adds straight to the cart", async () => {
    withItems([{ ...TEE, has_variants: true }, { ...BURGER, has_variants: false }]);
    renderPos();
    fireEvent.click(await screen.findByText("Burger"));
    await payCashExact();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const body = postMock.mock.calls[0][1] as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).toMatchObject({ menu_item_id: "item-burger", quantity: 1 });
    expect(screen.queryByTestId("variant-grid")).toBeNull();
    // The warm-up still asks for the variant item, never for the plain one.
    await waitFor(() => expect(variantCalls()).toContain("/v1/business/menu/items/item-tee/variants"));
    expect(variantCalls()).not.toContain("/v1/business/menu/items/item-burger/variants");
  });

  it("has_variants:true still requests the variants and opens the picker", async () => {
    withItems([{ ...TEE, has_variants: true }, { ...BURGER, has_variants: false }]);
    renderPos();
    fireEvent.click(await screen.findByText("Tee"));
    expect(await screen.findByTestId("variant-grid")).toHaveTextContent("M / Black");
    expect(variantCalls()).toContain("/v1/business/menu/items/item-tee/variants");
  });

  it("an older backend without the field: every item is still asked (compatibility)", async () => {
    renderPos(); // TEE / BURGER fixtures carry no has_variants
    fireEvent.click(await screen.findByText("Burger"));
    await waitFor(() => expect(variantCalls()).toContain("/v1/business/menu/items/item-burger/variants"));
    expect(screen.queryByTestId("variant-grid")).toBeNull();
  });
});

function installAndGet(path: string) {
  const table: Record<string, unknown> = {
    "/v1/business/menu/categories": [],
    "/v1/business/menu/items": [TEE, BURGER],
    "/v1/business/pos/till/current": TILL,
    "/v1/business/pos/settings": SETTINGS,
  };
  if (path in table) return Promise.resolve(table[path]);
  if (path === "/v1/business/event-access") return Promise.reject({ status: 404, message: "Not found" });
  return Promise.reject(new Error(`Unmocked GET ${path}`));
}

describe("barcode / SKU entry", () => {
  // The box is disabled until the till session has loaded.
  const scanBox = async () => {
    const box = await screen.findByLabelText("Scan or type a barcode or SKU");
    await waitFor(() => expect(box).not.toBeDisabled());
    return box;
  };

  it("typing a barcode and pressing Enter looks it up online and adds the variant", async () => {
    renderPos();
    const box = await scanBox();
    fireEvent.change(box, { target: { value: "6001234567890" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(await screen.findByTestId("cart-variant-label")).toHaveTextContent("M / Black");
    expect(getMock).toHaveBeenCalledWith("/v1/business/pos/lookup?barcode=6001234567890");
    expect((box as HTMLInputElement).value).toBe("");
  });

  it("an unknown code shows a clear not-found message and adds nothing", async () => {
    renderPos();
    const box = await scanBox();
    fireEvent.change(box, { target: { value: "NOPE-123" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText(/"NOPE-123" was not found/)).toBeInTheDocument();
    expect(screen.queryByTestId("cart-variant-label")).toBeNull();
  });

  it("a wedge-speed burst of keystrokes ending in Enter, with focus outside any field, adds the item", async () => {
    renderPos();
    await screen.findByText("Tee");
    // Synthetic events dispatched back to back are, by construction, scanner-fast.
    [..."6001234567890"].forEach((key) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(await screen.findByTestId("cart-variant-label")).toHaveTextContent("M / Black");
  });

  it("offline, a code resolves from the cached variants with no network call", async () => {
    cacheVariants("biz-1", "item-tee", [VAR_M, VAR_L], { item_name: "Tee", base_price_cents: 19900 });
    getMock.mockClear();
    renderPos(false);
    const box = await scanBox();
    fireEvent.change(box, { target: { value: "TEE-L-BLK" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByTestId("cart-variant-label")).toHaveTextContent("L / Black");
    expect(getMock.mock.calls.some((c) => String(c[0]).includes("/pos/lookup"))).toBe(false);
  });

  it("offline, an uncached code says so", async () => {
    renderPos(false);
    const box = await scanBox();
    fireEvent.change(box, { target: { value: "ZZZZ" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText(/"ZZZZ" was not found on this device/)).toBeInTheDocument();
  });
});

describe("exchange", () => {
  const ID = "11111111-1111-4111-8111-111111111111";

  it("shows the Exchange banner and the sale payload carries exchange_of_order_id", async () => {
    renderPos(true, `/pos?exchange_of=${ID}&exchange_no=A-0042`);
    expect(await screen.findByTestId("exchange-banner")).toHaveTextContent("Exchange for order #A-0042");

    fireEvent.click(await screen.findByText("Burger"));
    await payCashExact();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect((postMock.mock.calls[0][1] as { exchange_of_order_id?: string }).exchange_of_order_id).toBe(ID);
    // the banner is gone once the exchange sale is done
    await waitFor(() => expect(screen.queryByTestId("exchange-banner")).toBeNull());
  });

  it("EXCHANGE_ORIGINAL_NOT_REFUNDED is explained, and the banner can be dismissed", async () => {
    postMock.mockRejectedValue({ status: 422, code: "EXCHANGE_ORIGINAL_NOT_REFUNDED", message: "raw" });
    renderPos(true, `/pos?exchange_of=${ID}&exchange_no=A-0042`);
    fireEvent.click(await screen.findByText("Burger"));
    await payCashExact();
    expect(await screen.findByText(/has not been refunded yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not an exchange", hidden: true }));
    expect(screen.queryByTestId("exchange-banner")).toBeNull();
  });

  it("no banner without a valid exchange link", async () => {
    renderPos(true, "/pos?exchange_of=garbage");
    await screen.findByText("Tee");
    expect(screen.queryByTestId("exchange-banner")).toBeNull();
  });
});
