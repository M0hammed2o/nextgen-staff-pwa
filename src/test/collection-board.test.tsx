import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The customer-facing collection board (/board): read-only, order numbers
 * only (first name only if the vendor opts in locally), never a phone number.
 * The network is mocked; the SSE callback is captured so a "live" update can
 * be simulated without a real EventSource.
 */

const getMock = vi.fn();
let sseOnMessage: ((d: unknown) => void) | null = null;
const sseClose = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: { get: (...a: unknown[]) => getMock(...a) },
  createSSEConnection: (_path: string, onMessage: (d: unknown) => void) => {
    sseOnMessage = onMessage;
    return { close: sseClose };
  },
}));

import CollectionBoard from "@/pages/CollectionBoard";
import { splitBoardOrders, newlyReadyIds } from "@/lib/board";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";

function order(id: string, number: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    order_number: number,
    status,
    customer_name: null,
    phone_number: "+27821234567",
    created_at: `2026-11-18T10:0${id.length}:00Z`,
    items: [{ name_snapshot: "Secret burger", quantity: 1 }],
    total_cents: 9999,
    ...extra,
  };
}

let current: unknown[] = [];

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/board"]}>
      <QueryClientProvider client={client}>
        <CollectionBoard />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  __resetSafeStorageForTests();
  sseOnMessage = null;
  current = [];
  getMock.mockImplementation((path: string) => {
    if (path.startsWith("/v1/business/orders?live=true")) {
      return Promise.resolve({ data: current, pagination: { per_page: 50, next_cursor: null, has_more: false } });
    }
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("collection board", () => {
  it("shows preparing and ready columns from live orders, order numbers only", async () => {
    current = [
      order("a", "A-0001", "ACCEPTED"),
      order("bb", "A-0002", "IN_PROGRESS"),
      order("ccc", "A-0003", "READY"),
      order("dddd", "A-0004", "NEW"), // not accepted yet: on neither column
      order("eeeee", "A-0005", "COLLECTED"), // finished: not shown
    ];
    renderBoard();
    const preparing = await screen.findByTestId("board-preparing");
    const ready = screen.getByTestId("board-ready");
    expect(within(preparing).getByText("Preparing")).toBeInTheDocument();
    expect(within(ready).getByText("Ready for collection")).toBeInTheDocument();
    await within(preparing).findByText("A-0001");
    expect(within(preparing).getByText("A-0002")).toBeInTheDocument();
    expect(within(ready).getByText("A-0003")).toBeInTheDocument();
    expect(screen.queryByText("A-0004")).toBeNull();
    expect(screen.queryByText("A-0005")).toBeNull();
  });

  it("never renders phone numbers, items or totals, even when a name is entered as a number", async () => {
    current = [
      order("a", "A-0001", "READY", { customer_name: "+27821234567" }),
      order("bb", "A-0002", "READY", { customer_name: "Thabo Mokoena" }),
    ];
    localStorage.setItem("nextgen_board_show_names", "1");
    const { container } = renderBoard();
    await screen.findByText("A-0001");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/27821234567|082 ?123|\+27/);
    expect(text).not.toContain("Secret burger");
    expect(text).not.toContain("99.99");
    // A real name is shown (first name only) once the vendor turned names on.
    expect(screen.getByText("Thabo")).toBeInTheDocument();
    expect(text).not.toContain("Mokoena");
  });

  it("hides names by default", async () => {
    current = [order("a", "A-0001", "READY", { customer_name: "Thabo" })];
    renderBoard();
    await screen.findByText("A-0001");
    expect(screen.queryByText("Thabo")).toBeNull();
  });

  it("is read-only: no order action buttons, only display controls", async () => {
    current = [order("a", "A-0001", "IN_PROGRESS"), order("bb", "A-0002", "READY")];
    renderBoard();
    await screen.findByText("A-0002");
    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(n).not.toMatch(/accept|start|mark|collected|complete|cancel|deliver|ready/i);
    }
    expect(screen.getByRole("button", { name: /full screen/i })).toBeInTheDocument();
  });

  it("highlights a number that newly becomes ready, then clears the highlight", async () => {
    current = [order("a", "A-0001", "IN_PROGRESS")];
    renderBoard();
    await screen.findByText("A-0001");
    expect(screen.queryAllByText("A-0001")).toHaveLength(1);
    // First load never highlights.
    expect(document.querySelector('[data-highlight="true"]')).toBeNull();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    current = [order("a", "A-0001", "READY")];
    await act(async () => {
      sseOnMessage?.({});
      await vi.advanceTimersByTimeAsync(50);
    });
    const ready = screen.getByTestId("board-ready");
    const li = within(ready).getByText("A-0001").closest("li");
    expect(li).toHaveAttribute("data-highlight", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(within(screen.getByTestId("board-ready")).getByText("A-0001").closest("li")).toHaveAttribute("data-highlight", "false");
  });

  it("shows a connection-lost indicator when the live data cannot be fetched", async () => {
    getMock.mockRejectedValue({ message: "down", status: 0, noResponse: true });
    renderBoard();
    expect(await screen.findByRole("alert")).toHaveTextContent(/connection lost/i);
  });

  it("chime and names settings default OFF and persist when toggled", async () => {
    renderBoard();
    const chime = await screen.findByRole("button", { name: /chime off/i });
    expect(chime).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chime);
    expect(localStorage.getItem("nextgen_board_chime")).toBe("1");
    expect(screen.getByRole("button", { name: /chime on/i })).toBeInTheDocument();
  });
});

describe("board helpers", () => {
  it("first load (no previous snapshot) yields no newly-ready ids", () => {
    const { ready } = splitBoardOrders([order("a", "A-1", "READY")] as never);
    expect(newlyReadyIds(null, ready)).toEqual([]);
    expect(newlyReadyIds(new Set(["a"]), ready)).toEqual([]);
    expect(newlyReadyIds(new Set(), ready)).toEqual(["a"]);
  });
});
