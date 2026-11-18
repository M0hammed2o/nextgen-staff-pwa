import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { OfflineQueue } from "@/lib/offline/queue";
import { IndexedDbStore, MemoryStore, type OfflineStore } from "@/lib/offline/store";
import { SyncEngine, backoffDelayMs, classifyError, BACKOFF_CAP_MS } from "@/lib/offline/sync-engine";
import type { QueueEntry, SalePayload } from "@/lib/offline/types";
import type { POSOrderCreateRequest } from "@/types";

const PHONE = "0821234567";
const CUSTOMER = "Thandi Dlamini";

function payload(key: string, total = 5000): SalePayload {
  const request = {
    order_mode: "PICKUP",
    customer_name: CUSTOMER,
    customer_phone: PHONE,
    items: [{ menu_item_id: "item-1", quantity: 1, selected_option_ids: {}, add_on_selections: [], removed_ingredient_ids: [], special_instructions: null }],
    payment_method: "CASH",
    cash_tendered_cents: total,
    idempotency_key: key,
  } as unknown as POSOrderCreateRequest;
  return {
    request,
    snapshot: { lines: [{ name: "Burger", quantity: 1, detail: null, line_total_cents: total }], total_cents: total, cash_tendered_cents: total, change_due_cents: 0 },
  };
}

let clock = 1_000_000;
const now = () => clock;

function makeQueue(store: OfflineStore = new MemoryStore()) {
  return new OfflineQueue(store, now);
}

function makeEngine(queue: OfflineQueue, send: ReturnType<typeof vi.fn>, identity: { businessId: string } | null = { businessId: "biz-1" }) {
  return new SyncEngine({ queue, send, getIdentity: () => identity, isOnline: () => true, now });
}

const enqueue = (q: OfflineQueue, key: string, total = 5000) =>
  q.enqueueSale({ businessId: "biz-1", staffId: "staff-1", payload: payload(key, total) });

beforeEach(() => {
  clock = 1_000_000;
});

describe("classifyError", () => {
  it("classifies per the contract", () => {
    expect(classifyError({ noResponse: true, status: 0, message: "x" }).kind).toBe("retry");
    expect(classifyError(new TypeError("boom")).kind).toBe("retry");
    expect(classifyError({ status: 500, message: "x" }).kind).toBe("retry");
    expect(classifyError({ status: 429, message: "x" }).kind).toBe("retry");
    expect(classifyError({ status: 401, message: "x" }).kind).toBe("auth");
    expect(classifyError({ status: 403, code: "EVENT_TRADING_NOT_ALLOWED", message: "x" }).kind).toBe("conflict");
    expect(classifyError({ status: 409, message: "x" }).kind).toBe("conflict");
    expect(classifyError({ status: 422, message: "x" }).kind).toBe("conflict");
    expect(classifyError({ status: 400, message: "x" }).kind).toBe("failed");
  });

  it("backs off exponentially and caps at 5 minutes", () => {
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
    expect(backoffDelayMs(3)).toBe(8000);
    expect(backoffDelayMs(50)).toBe(BACKOFF_CAP_MS);
    expect(BACKOFF_CAP_MS).toBe(300_000);
  });
});

describe("queue durability and encryption", () => {
  it("survives a simulated restart (real IndexedDB adapter, fresh queue instance)", async () => {
    const q1 = makeQueue(new IndexedDbStore("restart-test-db"));
    const a = await enqueue(q1, "key-a");
    const b = await enqueue(q1, "key-b", 7000);
    expect(a.local_ref).toMatch(/^T[0-9A-F]{4}-0001$/);
    expect(b.local_ref).toMatch(/^T[0-9A-F]{4}-0002$/);

    // "Restart": brand new adapter + queue over the same database name.
    const q2 = makeQueue(new IndexedDbStore("restart-test-db"));
    const list = await q2.list();
    expect(list.map((e) => e.id)).toEqual(["key-a", "key-b"]);
    expect(list.every((e) => e.status === "pending")).toBe(true);
    // The device key survived too, so the payload is still readable.
    const p = await q2.decryptPayload(list[0]);
    expect(p.request.idempotency_key).toBe("key-a");
    expect(p.request.customer_phone).toBe(PHONE);
    // Counter continues; refs never repeat across restarts.
    const c = await enqueue(q2, "key-c");
    expect(c.local_ref).toMatch(/-0003$/);
  });

  it("never stores the payload in plaintext and round-trips through AES-GCM", async () => {
    const store = new MemoryStore();
    const q = makeQueue(store);
    const e = await enqueue(q, "key-enc");
    const raw = (await store.getAllEntries())[0];
    const flat = JSON.stringify({ ...raw, payload: { iv: Array.from(raw.payload!.iv), ct: Array.from(raw.payload!.ct) } });
    expect(flat).not.toContain(PHONE);
    expect(flat).not.toContain(CUSTOMER);
    expect(flat).not.toContain("Burger");
    // Bytes themselves do not contain the phone either.
    const ctText = new TextDecoder("latin1").decode(raw.payload!.ct);
    expect(ctText).not.toContain(PHONE);
    // The device key is non-extractable.
    const key = (await store.getMeta<CryptoKey>("device_key"))!;
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toBeTruthy();
    const back = await q.decryptPayload(e);
    expect(back.request.customer_name).toBe(CUSTOMER);
  });

  it("re-enqueueing the same key returns the existing entry (no duplicate)", async () => {
    const q = makeQueue();
    const a = await enqueue(q, "same");
    const b = await enqueue(q, "same");
    expect(b.id).toBe(a.id);
    expect(await q.list()).toHaveLength(1);
  });

  it("an entry stuck in `syncing` after a closed tab goes back to pending", async () => {
    const store = new MemoryStore();
    const q1 = makeQueue(store);
    await enqueue(q1, "k1");
    await q1.markSyncing("k1");
    const q2 = makeQueue(store); // restart
    expect(await q2.recoverInterrupted()).toBe(1);
    expect((await q2.get("k1"))!.status).toBe("pending");
  });
});

describe("sync engine", () => {
  it("syncs FIFO, strictly one request in flight, with the entry id as idempotency key", async () => {
    const q = makeQueue();
    await enqueue(q, "k1");
    await enqueue(q, "k2");
    await enqueue(q, "k3");
    let inFlight = 0;
    let maxInFlight = 0;
    const seen: string[] = [];
    const send = vi.fn(async (entry: QueueEntry, p: SalePayload) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(entry.id);
      expect(p.request.idempotency_key).toBe(entry.id);
      inFlight--;
      return { id: `order-${entry.id}`, order_number: `A-${entry.id}` };
    });
    const engine = makeEngine(q, send);
    await Promise.all([engine.syncNow(), engine.syncNow()]); // concurrent trigger is a no-op
    expect(seen).toEqual(["k1", "k2", "k3"]);
    expect(maxInFlight).toBe(1);
    const all = await q.list();
    expect(all.every((e) => e.status === "synced" && e.payload === null)).toBe(true);
    expect(all[0].server_order_number).toBe("A-k1");
  });

  it("a replay after a lost response never creates a duplicate and reuses the identical key", async () => {
    const q = makeQueue();
    await enqueue(q, "dup-key");
    // Fake server: dedupes on key, like the real unique index.
    const orders = new Map<string, { id: string; order_number: string }>();
    const keysSent: string[] = [];
    let first = true;
    const send = vi.fn(async (entry: QueueEntry) => {
      keysSent.push(entry.id);
      if (!orders.has(entry.id)) orders.set(entry.id, { id: "o1", order_number: "A-1" });
      if (first) {
        first = false;
        throw { noResponse: true, status: 0, message: "Could not reach the server" }; // server got it, response lost
      }
      return orders.get(entry.id)!; // dedupe response = a normal 2xx
    });
    const engine = makeEngine(q, send);
    await engine.syncNow();
    expect((await q.get("dup-key"))!.status).toBe("pending");
    clock += 2_000;
    await engine.syncNow();
    expect(keysSent).toEqual(["dup-key", "dup-key"]);
    expect(orders.size).toBe(1);
    const all = await q.list();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("synced");
    expect(all[0].attempts).toBe(1);
  });

  it("backs off exponentially after a network error and honours the delay (strict FIFO)", async () => {
    const q = makeQueue();
    await enqueue(q, "b1");
    await enqueue(q, "b2");
    const send = vi.fn().mockRejectedValue({ noResponse: true, status: 0, message: "down" });
    const engine = makeEngine(q, send);
    await engine.syncNow();
    expect(send).toHaveBeenCalledTimes(1); // stopped at the head; b2 not attempted
    expect((await q.get("b1"))!.next_attempt_at).toBe(clock + 2_000);
    await engine.syncNow(); // still inside the window
    expect(send).toHaveBeenCalledTimes(1);
    clock += 2_000;
    await engine.syncNow();
    expect(send).toHaveBeenCalledTimes(2);
    expect((await q.get("b1"))!.next_attempt_at).toBe(clock + 4_000);
    expect((await q.get("b2"))!.attempts).toBe(0);
    // Manual "sync now" ignores the backoff window.
    await engine.syncNow({ manual: true });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("5xx and 429 retry, they never become conflicts", async () => {
    const q = makeQueue();
    await enqueue(q, "r1");
    const send = vi.fn().mockRejectedValue({ status: 503, message: "unavailable" });
    await makeEngine(q, send).syncNow();
    expect((await q.get("r1"))!.status).toBe("pending");
  });

  it("401 keeps the entry queued, does not count an attempt, and waits for re-login", async () => {
    const q = makeQueue();
    await enqueue(q, "a1");
    const send = vi.fn().mockRejectedValueOnce({ status: 401, message: "Session expired" }).mockResolvedValue({ id: "o", order_number: "A-1" });
    const engine = makeEngine(q, send);
    await engine.syncNow();
    const e = (await q.get("a1"))!;
    expect(e.status).toBe("pending");
    expect(e.attempts).toBe(0);
    expect(engine.status.authRequired).toBe(true);
    await engine.syncNow(); // blocked until login
    expect(send).toHaveBeenCalledTimes(1);
    engine.notifyLogin();
    await vi.waitFor(async () => expect((await q.get("a1"))!.status).toBe("synced"));
  });

  it("with nobody signed in, entries just wait (nothing sent, nothing dropped)", async () => {
    const q = makeQueue();
    await enqueue(q, "w1");
    const send = vi.fn();
    const engine = makeEngine(q, send, null);
    await engine.syncNow();
    expect(send).not.toHaveBeenCalled();
    expect((await q.get("w1"))!.status).toBe("pending");
    expect(engine.status.authRequired).toBe(true);
  });

  it("never sends another business's sales", async () => {
    const q = makeQueue();
    await enqueue(q, "x1");
    const send = vi.fn();
    await makeEngine(q, send, { businessId: "other-biz" }).syncNow();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [403, "EVENT_TRADING_NOT_ALLOWED", "Trading is not allowed: no paid event day today."],
    [409, "TILL_NOT_OPEN", "Open the till before ringing up a sale"],
    [422, "MENU_ITEM_UNAVAILABLE", "Item no longer on the menu"],
  ])("HTTP %i is a conflict: kept with the server message, later sales still sync", async (status, code, message) => {
    const q = makeQueue();
    await enqueue(q, "c1");
    await enqueue(q, "c2");
    const send = vi.fn(async (entry: QueueEntry) => {
      if (entry.id === "c1") throw { status, code, message };
      return { id: "o2", order_number: "A-2" };
    });
    await makeEngine(q, send).syncNow();
    const c1 = (await q.get("c1"))!;
    expect(c1.status).toBe("conflict");
    expect(c1.last_error).toBe(message);
    expect(c1.last_error_code).toBe(code);
    expect(c1.payload).not.toBeNull(); // never auto-deleted
    expect((await q.get("c2"))!.status).toBe("synced");
  });

  it("discarding requires explicit confirmation, then leaves an audit line", async () => {
    const q = makeQueue();
    await enqueue(q, "d1");
    await q.markConflict("d1", "Item no longer on the menu", "MENU_ITEM_UNAVAILABLE");
    await expect(q.discard("d1", { confirmed: false })).rejects.toMatchObject({ code: "NOT_CONFIRMED" });
    expect(await q.get("d1")).toBeDefined();
    await q.discard("d1", { confirmed: true, actorId: "mgr-1" });
    expect(await q.get("d1")).toBeUndefined();
    const audit = await q.getAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "discard", staff_id: "mgr-1", total_cents: 5000 });
    expect(JSON.stringify(audit)).not.toContain(PHONE);
  });

  it("cannot discard a sale that is still pending or retry one that is not parked", async () => {
    const q = makeQueue();
    await enqueue(q, "p1");
    await expect(q.discard("p1", { confirmed: true })).rejects.toMatchObject({ code: "BAD_STATE" });
    await expect(q.retry("p1")).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("a manager retry puts a conflict back to pending under the same key", async () => {
    const q = makeQueue();
    await enqueue(q, "m1");
    await q.markConflict("m1", "Insufficient stock", null);
    const e = await q.retry("m1");
    expect(e.status).toBe("pending");
    expect(e.id).toBe("m1");
  });
});

describe("local data protection", () => {
  it("purges old synced entries on schedule but never unsynced ones", async () => {
    const q = makeQueue();
    await enqueue(q, "s1");
    await enqueue(q, "s2");
    await q.markSynced("s1", { id: "o1", order_number: "A-1" });
    expect(await q.purgeSynced(60_000)).toBe(0); // too fresh
    clock += 120_000;
    expect(await q.purgeSynced(60_000)).toBe(1);
    expect((await q.list()).map((e) => e.id)).toEqual(["s2"]);
  });

  it("logout wipe removes synced data but keeps unsynced sales unless explicitly discarded", async () => {
    const q = makeQueue();
    await enqueue(q, "l1");
    await enqueue(q, "l2");
    await q.markSynced("l1", {});
    expect(await q.unsyncedCount()).toBe(1);
    await q.wipe({ discardUnsynced: false });
    expect((await q.list()).map((e) => e.id)).toEqual(["l2"]);
    expect(await q.decryptPayload((await q.get("l2"))!)).toBeTruthy(); // key retained, still readable
    await q.wipe({ discardUnsynced: true });
    expect(await q.list()).toEqual([]);
    expect((await q.getAudit()).some((a) => a.action === "discard")).toBe(true);
    // Refs keep counting after a wipe (device counter is identity, not sales data).
    const next = await enqueue(q, "l3");
    expect(next.local_ref).toMatch(/-0003$/);
  });
});
