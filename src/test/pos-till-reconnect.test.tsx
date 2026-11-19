import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { OfflineContext, countEntries, type OfflineContextValue } from "@/lib/offline/offline-context";
import { trainingStore } from "@/lib/offline/training";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";
import { clearSnapshots } from "@/lib/offline/snapshot-cache";

/**
 * Souk e2e 6a: after an offline reload and reconnect the till said "The till
 * is closed" although the server session was OPEN, until a manual reload.
 *
 * Two causes, both covered here:
 *  1. Pos and CashupDialog observed ["till-current"] with different queryFns.
 *     The refetch after "Open till" ran CashupDialog's plain GET, so the
 *     offline snapshot kept the pre-open `null` and an offline reload showed
 *     the till closed.
 *  2. Nothing re-asked the server when connectivity came back, and a network
 *     failure with no device copy showed "closed" instead of "unknown".
 */

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: null, staff_name: "Cashier", role: "STAFF", business_id: "biz-1", business_name: "Stall" },
  }),
}));

import Pos from "@/pages/Pos";

const MENU_ITEM = {
  id: "item-1", category_id: null, name: "Wrap", description: null, price_cents: 5000, currency: "ZAR",
  options_json: null, add_ons: [], is_active: true, sort_order: 0, image_url: null, requires_preparation: false,
  has_variants: false,
};
const TILL_OPEN = {
  id: "till-1", status: "OPEN", opening_float_cents: 10000, expected_cash_cents: null, counted_cash_cents: null,
  variance_cents: null, opened_at: "2026-11-19T08:00:00Z", closed_at: null,
};
const NO_RESPONSE = { status: 0, noResponse: true, message: "Could not reach the server" };
const SNAPSHOT_TILL = "nextgen_staff_snapshot_v1:biz-1:till";

let tillAnswer: () => Promise<unknown>;

function installApi() {
  tillAnswer = () => Promise.resolve(null);
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/pos/till/current") return tillAnswer();
    if (path === "/v1/business/menu/categories") return Promise.resolve([]);
    if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
    if (path === "/v1/business/pos/settings") return Promise.resolve({ cash_enabled: true, receipt_auto_print: false });
    if (path === "/v1/business/event-access") return Promise.reject({ status: 404, message: "Not found" });
    if (path === "/v1/business/pos/payment-intents/unconsumed-paid") return Promise.resolve([]);
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
}

function offlineValue(online: boolean): OfflineContextValue {
  return {
    available: true, online, entries: [], counts: countEntries([]), authRequired: false,
    syncNow: async () => undefined, enqueueSale: vi.fn(), retry: vi.fn(), discard: vi.fn(),
  };
}

function renderPos(online: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (o: boolean) => (
    <OfflineContext.Provider value={offlineValue(o)}>
      <MemoryRouter initialEntries={["/pos"]}>
        <QueryClientProvider client={client}>
          <TouchKeyboardProvider>
            <Pos />
          </TouchKeyboardProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </OfflineContext.Provider>
  );
  const utils = render(tree(online));
  return { ...utils, goOnline: () => utils.rerender(tree(true)) };
}

beforeEach(() => {
  localStorage.clear();
  __resetSafeStorageForTests();
  clearSnapshots("biz-1");
  trainingStore.reset();
  installApi();
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("till status across offline and reconnect", () => {
  it("opening the till updates the offline snapshot, so an offline reload still knows it is open", async () => {
    postMock.mockImplementation(async (path: string) => {
      if (path === "/v1/business/pos/till/open") {
        tillAnswer = () => Promise.resolve(TILL_OPEN);
        return TILL_OPEN;
      }
      throw new Error(`unexpected POST ${path}`);
    });
    renderPos(true);
    await screen.findByText("The till is closed");
    fireEvent.click(screen.getByRole("button", { name: "Open the till" }));
    fireEvent.change(await screen.findByLabelText("Opening float (R)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Open till" }));
    await waitFor(() => expect(screen.queryByText("The till is closed")).toBeNull());
    await waitFor(() => {
      const snap = JSON.parse(localStorage.getItem(SNAPSHOT_TILL) ?? "null");
      expect(snap?.value?.id).toBe("till-1");
    });
  });

  it("a network failure with no device copy is 'can't check', not 'closed'; reconnect re-asks and shows it open", async () => {
    tillAnswer = () => Promise.reject(NO_RESPONSE);
    const { goOnline } = renderPos(false);
    expect(await screen.findByTestId("till-status-unknown")).toHaveTextContent("Can't check the till right now");
    expect(screen.queryByText("The till is closed")).toBeNull();

    tillAnswer = () => Promise.resolve(TILL_OPEN);
    goOnline();
    await waitFor(() => expect(screen.queryByTestId("till-status-unknown")).toBeNull());
    expect(screen.queryByText("The till is closed")).toBeNull();
    expect(screen.getByRole("button", { name: "Cash-up" })).toBeInTheDocument();
  });

  it("a stale closed device copy served offline is replaced by the server's OPEN answer on reconnect", async () => {
    localStorage.setItem(SNAPSHOT_TILL, JSON.stringify({ value: null }));
    tillAnswer = () => Promise.reject(NO_RESPONSE);
    const { goOnline } = renderPos(false);
    await screen.findByText("The till is closed"); // what the device last knew

    tillAnswer = () => Promise.resolve(TILL_OPEN);
    goOnline();
    await waitFor(() => expect(screen.queryByText("The till is closed")).toBeNull());
    expect(screen.getByRole("button", { name: "Cash-up" })).toBeInTheDocument();
  });

  it("'Check again' re-asks the server", async () => {
    tillAnswer = () => Promise.reject(NO_RESPONSE);
    renderPos(true);
    await screen.findByTestId("till-status-unknown");
    tillAnswer = () => Promise.resolve(TILL_OPEN);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByTestId("till-status-unknown")).toBeNull());
    expect(screen.getByRole("button", { name: "Cash-up" })).toBeInTheDocument();
  });
});
