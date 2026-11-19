import { describe, it, expect, vi } from "vitest";
import { OfflineQueue } from "@/lib/offline/queue";
import { MemoryStore } from "@/lib/offline/store";
import { SyncEngine, classifyError } from "@/lib/offline/sync-engine";
import type { SalePayload } from "@/lib/offline/types";
import type { POSOrderCreateRequest } from "@/types";

const payload = (key: string): SalePayload => ({
  request: {
    items: [{ menu_item_id: "item-tee", quantity: 1, variant_id: "var-m", selected_option_ids: {}, add_on_selections: [], removed_ingredient_ids: [] }],
    order_mode: "PICKUP", payment_method: "CASH", idempotency_key: key,
  } as unknown as POSOrderCreateRequest,
  snapshot: { lines: [{ name: "Tee", quantity: 1, detail: "M / Black", line_total_cents: 19900 }], total_cents: 19900, cash_tendered_cents: 19900, change_due_cents: 0 },
});

describe("variant error codes are permanent (never retried)", () => {
  it.each(["VARIANT_REQUIRED", "VARIANT_INACTIVE"])("%s is a conflict with a plain-language message", (code) => {
    const o = classifyError({ status: 422, code, message: "raw" });
    expect(o.kind).toBe("conflict");
    if (o.kind === "conflict") {
      expect(o.code).toBe(code);
      expect(o.message).not.toBe("raw");
      expect(o.message).toMatch(/discard/i);
    }
  });

  it("the code wins over a status that would otherwise retry, but a missing response still retries", () => {
    expect(classifyError({ status: 500, code: "VARIANT_INACTIVE", message: "x" }).kind).toBe("conflict");
    expect(classifyError({ noResponse: true, status: 0, code: "VARIANT_INACTIVE", message: "x" }).kind).toBe("retry");
    expect(classifyError({ status: 401, code: "VARIANT_INACTIVE", message: "x" }).kind).toBe("auth");
  });

  it("other 422s keep their existing classification", () => {
    expect(classifyError({ status: 422, code: "SOMETHING_ELSE", message: "m" })).toEqual({ kind: "conflict", message: "m", code: "SOMETHING_ELSE" });
  });

  it("a queued variant sale rejected with VARIANT_INACTIVE is parked once, surfaced as needing attention, and not re-sent", async () => {
    let clock = 1_000_000;
    const queue = new OfflineQueue(new MemoryStore(), () => clock);
    const send = vi.fn().mockRejectedValue({ status: 422, code: "VARIANT_INACTIVE", message: "raw" });
    const engine = new SyncEngine({ queue, send, getIdentity: () => ({ businessId: "biz-1" }), isOnline: () => true, now: () => clock });

    const entry = await queue.enqueueSale({ businessId: "biz-1", staffId: "s", payload: payload("key-1") });
    // the stored request carries variant_id through encryption
    expect((await queue.decryptPayload(entry)).request.items[0].variant_id).toBe("var-m");

    await engine.syncNow();
    clock += 10 * 60 * 1000;
    await engine.syncNow();
    await engine.syncNow({ manual: false });

    expect(send).toHaveBeenCalledTimes(1);
    const [after] = await queue.list();
    expect(after.status).toBe("conflict");
    expect(after.last_error_code).toBe("VARIANT_INACTIVE");
    expect(after.last_error).toMatch(/no longer sold/i);
  });
});
