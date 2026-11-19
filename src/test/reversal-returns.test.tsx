import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Order, OrderItem } from "@/types";

const postMock = vi.fn();
vi.mock("@/lib/api", () => ({ apiClient: { post: (...a: unknown[]) => postMock(...a) } }));

import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import ReversalPanel from "@/components/ReversalPanel";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const line = (over: Partial<OrderItem>): OrderItem => ({
  id: "oi-1", name_snapshot: "Tee", unit_price_cents: 20000, quantity: 3, line_total_cents: 60000,
  options_snapshot: null, add_ons_snapshot: null, selected_options_snapshot: null, removed_ingredients_snapshot: null,
  special_instructions: null, variant_id: "var-m", variant_label_snapshot: "M / Black", returned_quantity: 0, ...over,
});
const mkOrder = (over: Partial<Order> = {}, items: OrderItem[] = [line({})]): Order =>
  ({
    id: ORDER_ID, order_number: "A-0042", source: "POS", payment_status: "PAID", items,
    total_cents: items.reduce((s, i) => s + i.line_total_cents, 0), refund_amount_cents: null, refund_reference: null, ...over,
  }) as Order;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function renderPanel(order: Order, role = "MANAGER", onDone = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/orders/x"]}>
      <TouchKeyboardProvider>
        <Routes>
          <Route path="/orders/x" element={<ReversalPanel order={order} role={role} inventoryEnabled onDone={onDone} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </TouchKeyboardProvider>
    </MemoryRouter>,
  );
  return onDone;
}

const openRefund = () => fireEvent.click(screen.getByRole("button", { name: "Refund" }));
const more = (name = "Tee") => fireEvent.click(screen.getByRole("button", { name: `Return more ${name}` }));
const reason = (v = "Wrong size") => fireEvent.change(screen.getByPlaceholderText(/Customer unhappy/), { target: { value: v } });
const submit = () => fireEvent.click(screen.getAllByRole("button", { name: "Refund" }).at(-1)!);

beforeEach(() => {
  postMock.mockReset();
});
afterEach(cleanup);

describe("return flow on a variant sale", () => {
  it("defaults to line-by-line return with restock ON, previews the refund, and refunds in ONE call", async () => {
    postMock.mockResolvedValue({});
    const onDone = renderPanel(mkOrder());
    openRefund();

    expect(screen.getByTestId("return-lines")).toHaveTextContent("M / Black");
    expect(screen.getByRole("checkbox")).toBeChecked(); // restock default ON for variant lines

    more();
    more();
    expect(screen.getByTestId("refund-estimate")).toHaveTextContent("R 400.00");
    reason();
    submit();

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith(`/v1/business/pos/orders/${ORDER_ID}/refund`, {
      reason: "Wrong size", restore_stock: true, return_items: [{ order_item_id: "oi-1", quantity: 2 }],
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("the stepper cannot go above sold minus already returned", () => {
    renderPanel(mkOrder({}, [line({ quantity: 3, returned_quantity: 2 })]));
    openRefund();
    more();
    expect(screen.getByTestId("return-qty-oi-1")).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Return more Tee" })).toBeDisabled();
    expect(screen.getByText(/already returned 2/)).toBeInTheDocument();
  });

  it("staff can lower the refund (amount sent) but a raise is refused client-side and nothing is posted", async () => {
    postMock.mockResolvedValue({});
    renderPanel(mkOrder());
    openRefund();
    more();
    reason();

    const amount = screen.getByLabelText("Refund amount in rand");
    fireEvent.change(amount, { target: { value: "250" } }); // estimate is R 200.00
    expect(screen.getByText(/lowered but not raised/)).toBeInTheDocument();
    submit();
    expect(postMock).not.toHaveBeenCalled();

    fireEvent.change(amount, { target: { value: "150" } });
    submit();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0][1]).toMatchObject({ amount_cents: 15000, return_items: [{ order_item_id: "oi-1", quantity: 1 }] });
  });

  it("refuses to submit with no items chosen", () => {
    renderPanel(mkOrder());
    openRefund();
    reason();
    submit();
    expect(screen.getByText("Choose at least one item to return.")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  const CODE_MESSAGES: Array<[string, RegExp]> = [
    ["REFUND_EXCEEDS_RETURNED_VALUE", /more than the value of the returned items/],
    ["RETURN_EXCEEDS_SOLD", /returning more than was sold/],
    ["RETURN_ITEMS_REQUIRED", /Say which items came back/],
  ];
  for (const [code, pattern] of CODE_MESSAGES) it(`maps server code ${code} to a clear message`, async () => {
    postMock.mockRejectedValue(Object.assign(new Error("raw"), { status: 422, code }));
    renderPanel(mkOrder());
    openRefund();
    more();
    reason();
    submit();
    expect(await screen.findByText(pattern)).toBeInTheDocument();
  });

  it("restock can be switched off", async () => {
    postMock.mockResolvedValue({});
    renderPanel(mkOrder());
    openRefund();
    more();
    reason();
    fireEvent.click(screen.getByRole("checkbox"));
    submit();
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][1]).toMatchObject({ restore_stock: false });
  });
});

describe("restaurant (non-variant) sale is unchanged", () => {
  it("keeps the whole-sale refund with restock OFF and sends no return_items", async () => {
    postMock.mockResolvedValue({});
    renderPanel(mkOrder({}, [line({ variant_id: null, variant_label_snapshot: null, sku_snapshot: null })]));
    openRefund();
    expect(screen.queryByTestId("return-lines")).toBeNull();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    reason("Unhappy");
    submit();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0][1]).toEqual({ reason: "Unhappy", restore_stock: false });
  });
});

describe("exchange and roles", () => {
  it("a refunded order with returned lines offers Exchange, which opens the till with exchange_of set", () => {
    renderPanel(mkOrder({ payment_status: "PARTIALLY_REFUNDED", refund_amount_cents: 20000 }, [line({ returned_quantity: 1 })]), "STAFF");
    fireEvent.click(screen.getByRole("button", { name: /Exchange/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/pos?exchange_of=${ORDER_ID}&exchange_no=A-0042`);
  });

  it("no Exchange button before a return", () => {
    renderPanel(mkOrder({ payment_status: "REFUNDED" }, [line({ returned_quantity: 0 })]));
    expect(screen.queryByRole("button", { name: /Exchange/ })).toBeNull();
  });

  it("refund controls stay manager-only: a STAFF user is sent to a manager", () => {
    renderPanel(mkOrder(), "STAFF");
    expect(screen.queryByRole("button", { name: "Refund" })).toBeNull();
    expect(screen.getByText(/Ask a manager or the owner/)).toBeInTheDocument();
  });
});
