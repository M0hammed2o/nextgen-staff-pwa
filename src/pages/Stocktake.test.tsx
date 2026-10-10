import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";

/**
 * UI V2.1 (B1/B4): Wastage is now a tab inside Stocktake, reusing the real
 * Wastage component/API rather than a second implementation. These tests
 * prove the reuse is genuine -- the Wastage tab renders the actual
 * ingredient-search-and-submit workflow and posts to the real endpoint --
 * not just that a tab button with the right label exists.
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
    isAuthenticated: true,
    user: { id: "u1", staff_name: "Cashier", role: "STAFF", business_id: "biz-1", business_name: "Barn Owl" },
  }),
}));

import Stocktake from "@/pages/Stocktake";

const SETTINGS = { inventory_enabled: true, staff_stocktake_tab_enabled: true, staff_wastage_tab_enabled: true };

const INGREDIENTS = [
  { id: "ing-1", name: "Full Cream Milk", canonical_unit: "MILLILITRE", count_method: "VOLUME", on_hand_milli: 4_000_000, on_hand_display: "4 L", below_par: false },
];
const REASONS = [{ value: "DROPPED", label: "Dropped", requires_note: false }];

function mockGets() {
  getMock.mockReset();
  getMock.mockImplementation((url: string) => {
    if (url === "/v1/business/pos/settings") return Promise.resolve(SETTINGS);
    if (url === "/v1/business/stocktake/current") return Promise.resolve(null);
    if (url === "/v1/business/stocktake") return Promise.resolve([]);
    if (url === "/v1/business/inventory/ingredients") return Promise.resolve(INGREDIENTS);
    if (url === "/v1/business/wastage/reasons") return Promise.resolve(REASONS);
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <TouchKeyboardProvider>
          <Stocktake />
        </TouchKeyboardProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Stocktake — Wastage tab (B1 merge)", () => {
  it("shows a Wastage tab alongside Count and Previous counts", async () => {
    mockGets();
    renderAt("/stocktake");
    await waitFor(() => expect(screen.getByText("No count in progress")).toBeInTheDocument());
    expect(screen.getByText("Wastage")).toBeInTheDocument();
    expect(screen.getByText("Count")).toBeInTheDocument();
    expect(screen.getByText("Previous counts")).toBeInTheDocument();
  });

  it("the old /wastage URL lands directly on the Wastage tab (App.tsx redirects to ?tab=WASTAGE)", async () => {
    mockGets();
    renderAt("/stocktake?tab=WASTAGE");
    // The real Wastage UI's own heading for ingredient search, not Stocktake's.
    await waitFor(() => expect(screen.getByPlaceholderText("Search ingredients…")).toBeInTheDocument());
  });

  it("the Wastage tab runs the REAL workflow end-to-end: search, pick, reason, submit posts to /v1/business/wastage", async () => {
    mockGets();
    postMock.mockResolvedValue({});
    renderAt("/stocktake?tab=WASTAGE");

    const ingredientButton = await screen.findByText("Full Cream Milk");
    fireEvent.click(ingredientButton);

    const reasonButton = await screen.findByText("Dropped");
    fireEvent.click(reasonButton);

    // Quick-amount buttons are rendered from the ingredient's canonical unit;
    // typing an amount directly is the more deterministic path for a test.
    const amountInput = screen.getByPlaceholderText(/Or type an amount/);
    fireEvent.change(amountInput, { target: { value: "250" } });

    const recordButton = screen.getByRole("button", { name: /Record/i });
    fireEvent.click(recordButton);

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/v1/business/wastage",
        expect.objectContaining({ ingredient_id: "ing-1", reason: "DROPPED", unit: "ML" })
      )
    );
  });

  it("switching tabs does not re-fetch ingredients/reasons twice (one shared query, not a duplicated implementation)", async () => {
    mockGets();
    renderAt("/stocktake");

    await screen.findByText("Wastage");
    fireEvent.click(screen.getByText("Wastage"));
    await screen.findByPlaceholderText("Search ingredients…");
    fireEvent.click(screen.getByText("Count"));
    fireEvent.click(screen.getByText("Wastage"));
    await screen.findByPlaceholderText("Search ingredients…");

    const ingredientCalls = getMock.mock.calls.filter((c) => c[0] === "/v1/business/inventory/ingredients");
    expect(ingredientCalls.length).toBe(1);
  });
});

describe("Stocktake — Wastage tab keeps its own admin-controlled visibility (staff_wastage_tab_enabled)", () => {
  it("hides the Wastage tab when staff_wastage_tab_enabled is off, even though inventory/stocktake are on", async () => {
    getMock.mockReset();
    getMock.mockImplementation((url: string) => {
      if (url === "/v1/business/pos/settings") {
        return Promise.resolve({ inventory_enabled: true, staff_stocktake_tab_enabled: true, staff_wastage_tab_enabled: false });
      }
      if (url === "/v1/business/stocktake/current") return Promise.resolve(null);
      if (url === "/v1/business/stocktake") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    renderAt("/stocktake");

    await waitFor(() => expect(screen.getByText("No count in progress")).toBeInTheDocument());
    expect(screen.queryByText("Wastage")).not.toBeInTheDocument();
  });

  it("falls back to Count when the ?tab=WASTAGE deep link is used but staff_wastage_tab_enabled is off", async () => {
    getMock.mockReset();
    getMock.mockImplementation((url: string) => {
      if (url === "/v1/business/pos/settings") {
        return Promise.resolve({ inventory_enabled: true, staff_stocktake_tab_enabled: true, staff_wastage_tab_enabled: false });
      }
      if (url === "/v1/business/stocktake/current") return Promise.resolve(null);
      if (url === "/v1/business/stocktake") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    renderAt("/stocktake?tab=WASTAGE");

    await waitFor(() => expect(screen.getByText("No count in progress")).toBeInTheDocument());
    expect(screen.queryByPlaceholderText("Search ingredients…")).not.toBeInTheDocument();
  });
});
