/**
 * Durable offline sale queue.
 *
 * Each entry's id IS the idempotency_key sent to POST /v1/business/pos/orders
 * (the till's checkout is a single call that creates and pays the order, so
 * one key covers the whole sale). Retrying under the same key is safe: the
 * backend returns the original order for a repeated (business_id, key).
 */
import type { SalePayload, QueueEntry, AuditLine } from "./types";
import { OfflineQueueError } from "./types";
import type { OfflineStore } from "./store";
import { isoWithOffset } from "./capture";
import { decryptJson, deleteDeviceKey, encryptJson, getOrCreateDeviceKey } from "./crypto";

const DEVICE_ID_META = "device_id";
const AUDIT_META = "audit_log";
const AUDIT_MAX = 200;

/** Synced entries (metadata only) are kept this long for the queue screen, then purged. */
export const SYNCED_RETENTION_MS = 24 * 60 * 60 * 1000;

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Only reachable where Web Crypto is missing, in which case enqueue fails anyway.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface EnqueueInput {
  businessId: string;
  staffId: string;
  payload: SalePayload;
}

export type Unsubscribe = () => void;

export class OfflineQueue {
  private listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly store: OfflineStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** Serialises read-modify-write sequences so concurrent calls cannot interleave. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private iso() {
    return new Date(this.now()).toISOString();
  }

  async getDeviceShort(): Promise<string> {
    let id = await this.store.getMeta<string>(DEVICE_ID_META);
    if (!id) {
      id = randomId().replace(/-/g, "");
      await this.store.setMeta(DEVICE_ID_META, id);
    }
    return id.slice(0, 4).toUpperCase();
  }

  /**
   * Persist a sale. Resolves only once it is durably stored (and encrypted).
   * The payload's request.idempotency_key becomes the entry id; a key that is
   * already queued returns the existing entry rather than a duplicate.
   */
  enqueueSale(input: EnqueueInput): Promise<QueueEntry> {
    return this.exclusive(async () => {
      const key = input.payload.request.idempotency_key || randomId();
      const existing = (await this.store.getAllEntries()).find((e) => e.id === key);
      if (existing) return existing;

      // Stamped HERE, at the moment of the sale, never at sync time. These are
      // sent unchanged on every replay. An entry already carrying them (should
      // not happen) keeps its originals.
      const base = input.payload.request;
      const request = {
        ...base,
        idempotency_key: key,
        offline_captured_at: base.offline_captured_at ?? isoWithOffset(this.now()),
        captured_by_user_id: base.captured_by_user_id ?? input.staffId,
        offline_client_total_cents: base.offline_client_total_cents ?? Math.max(0, Math.round(input.payload.snapshot.total_cents)),
      };
      const payload: SalePayload = { ...input.payload, request };

      const cryptoKey = await getOrCreateDeviceKey(this.store);
      const blob = await encryptJson(cryptoKey, payload);
      const seq = await this.store.nextSeq();
      const short = await this.getDeviceShort();
      const ts = this.iso();
      const entry: QueueEntry = {
        id: key,
        local_ref: `T${short}-${String(seq).padStart(4, "0")}`,
        seq,
        business_id: input.businessId,
        staff_id: input.staffId,
        created_at: ts,
        updated_at: ts,
        status: "pending",
        attempts: 0,
        last_error: null,
        last_error_code: null,
        next_attempt_at: null,
        total_cents: payload.snapshot.total_cents,
        item_count: payload.snapshot.lines.reduce((n, l) => n + l.quantity, 0),
        payload: blob,
      };
      try {
        await this.store.putEntry(entry);
      } catch (e) {
        throw new OfflineQueueError("Could not save the sale on this device (storage unavailable or full).", "STORAGE");
      }
      this.emit();
      return entry;
    });
  }

  async list(): Promise<QueueEntry[]> {
    return (await this.store.getAllEntries()).sort((a, b) => a.seq - b.seq);
  }

  async get(id: string): Promise<QueueEntry | undefined> {
    return (await this.store.getAllEntries()).find((e) => e.id === id);
  }

  async decryptPayload(entry: QueueEntry): Promise<SalePayload> {
    if (!entry.payload) throw new OfflineQueueError("This sale has no stored payload.", "BAD_STATE");
    const key = await getOrCreateDeviceKey(this.store);
    return decryptJson<SalePayload>(key, entry.payload);
  }

  private async update(id: string, fn: (e: QueueEntry) => QueueEntry): Promise<QueueEntry> {
    const current = await this.get(id);
    if (!current) throw new OfflineQueueError("Queued sale not found.", "NOT_FOUND");
    const next = { ...fn(current), updated_at: this.iso() };
    await this.store.putEntry(next);
    this.emit();
    return next;
  }

  /** An entry stuck in `syncing` after a closed tab goes back to pending. Safe: same key. */
  recoverInterrupted(): Promise<number> {
    return this.exclusive(async () => {
      let n = 0;
      for (const e of await this.store.getAllEntries()) {
        if (e.status === "syncing") {
          await this.store.putEntry({ ...e, status: "pending", updated_at: this.iso() });
          n++;
        }
      }
      if (n) this.emit();
      return n;
    });
  }

  /**
   * Oldest pending entry for this business, strictly FIFO: if the head is
   * still inside its backoff window nothing later is returned (we never jump
   * the queue). Conflict/failed entries are parked and skipped.
   */
  async nextDue(businessId: string, ignoreBackoff: boolean): Promise<QueueEntry | null> {
    const head = (await this.list()).find((e) => e.status === "pending" && e.business_id === businessId);
    if (!head) return null;
    if (!ignoreBackoff && head.next_attempt_at != null && head.next_attempt_at > this.now()) return null;
    return head;
  }

  markSyncing(id: string) {
    return this.exclusive(() => this.update(id, (e) => ({ ...e, status: "syncing" })));
  }

  markSynced(id: string, order: { id?: string; order_number?: string }) {
    return this.exclusive(() =>
      this.update(id, (e) => ({
        ...e,
        status: "synced",
        payload: null, // server has it; keep no cart/customer data locally
        last_error: null,
        last_error_code: null,
        next_attempt_at: null,
        server_order_id: order.id,
        server_order_number: order.order_number,
        synced_at: this.iso(),
      })),
    );
  }

  markRetry(id: string, error: string, nextAttemptAt: number) {
    return this.exclusive(() =>
      this.update(id, (e) => ({
        ...e,
        status: "pending",
        attempts: e.attempts + 1,
        last_error: error,
        next_attempt_at: nextAttemptAt,
      })),
    );
  }

  /** 401: keep it, do not count it as a failed attempt, wait for re-login. */
  markAuthWait(id: string, message = "Sign in again to upload this sale", code = "AUTH") {
    return this.exclusive(() =>
      this.update(id, (e) => ({ ...e, status: "pending", last_error: message, last_error_code: code })),
    );
  }

  markConflict(id: string, message: string, code: string | null, status: "conflict" | "failed" = "conflict") {
    return this.exclusive(() =>
      this.update(id, (e) => ({
        ...e,
        status,
        attempts: e.attempts + 1,
        last_error: message,
        last_error_code: code,
        next_attempt_at: null,
      })),
    );
  }

  /** Manager "retry": back to pending under the SAME key. */
  retry(id: string) {
    return this.exclusive(async () => {
      const e = await this.get(id);
      if (!e) throw new OfflineQueueError("Queued sale not found.", "NOT_FOUND");
      if (e.status !== "conflict" && e.status !== "failed") {
        throw new OfflineQueueError("Only sales that need attention can be retried.", "BAD_STATE");
      }
      return this.update(id, (x) => ({ ...x, status: "pending", next_attempt_at: null }));
    });
  }

  /** "Sync now" clears backoff on every pending entry so the next pass tries immediately. */
  clearBackoff() {
    return this.exclusive(async () => {
      for (const e of await this.store.getAllEntries()) {
        if (e.status === "pending" && e.next_attempt_at != null) {
          await this.store.putEntry({ ...e, next_attempt_at: null });
        }
      }
      this.emit();
    });
  }

  /**
   * Discard a sale that needs attention. NEVER automatic: requires an explicit
   * `confirmed: true` from a confirmation step. Leaves a local audit line.
   */
  discard(id: string, opts: { confirmed: boolean; actorId?: string | null }) {
    return this.exclusive(async () => {
      if (opts.confirmed !== true) {
        throw new OfflineQueueError("Discarding a sale needs explicit confirmation.", "NOT_CONFIRMED");
      }
      const e = await this.get(id);
      if (!e) throw new OfflineQueueError("Queued sale not found.", "NOT_FOUND");
      if (e.status !== "conflict" && e.status !== "failed") {
        throw new OfflineQueueError("Only sales that need attention can be discarded.", "BAD_STATE");
      }
      const audit = (await this.store.getMeta<AuditLine[]>(AUDIT_META)) ?? [];
      audit.push({
        at: this.iso(),
        action: "discard",
        local_ref: e.local_ref,
        staff_id: opts.actorId ?? null,
        business_id: e.business_id,
        total_cents: e.total_cents,
        last_error: e.last_error,
      });
      await this.store.setMeta(AUDIT_META, audit.slice(-AUDIT_MAX));
      await this.store.deleteEntry(id);
      this.emit();
    });
  }

  async getAudit(): Promise<AuditLine[]> {
    return (await this.store.getMeta<AuditLine[]>(AUDIT_META)) ?? [];
  }

  /** Remove synced entries older than the retention window. Never touches unsynced ones. */
  purgeSynced(olderThanMs: number = SYNCED_RETENTION_MS) {
    return this.exclusive(async () => {
      const cutoff = this.now() - olderThanMs;
      let n = 0;
      for (const e of await this.store.getAllEntries()) {
        if (e.status === "synced" && e.synced_at && Date.parse(e.synced_at) <= cutoff) {
          await this.store.deleteEntry(e.id);
          n++;
        }
      }
      if (n) this.emit();
      return n;
    });
  }

  async unsyncedCount(): Promise<number> {
    return (await this.store.getAllEntries()).filter((e) => e.status !== "synced").length;
  }

  /**
   * Logout wipe. Synced entries always go (the PII-free audit log stays so a
   * deliberately dropped sale can still be explained). Unsynced sales
   * are kept (still encrypted, key retained so they stay decryptable) unless
   * the caller passes discardUnsynced after an explicit confirmation. The
   * device id and sale counter are device identity, not sales data, and are
   * kept so local refs never repeat.
   */
  wipe(opts: { discardUnsynced: boolean }) {
    return this.exclusive(async () => {
      const all = await this.store.getAllEntries();
      const keep = opts.discardUnsynced ? [] : all.filter((e) => e.status !== "synced");
      if (opts.discardUnsynced) {
        // Deliberately dropped sales leave a (PII-free) audit line, same as a manual discard.
        const dropped = all.filter((e) => e.status !== "synced");
        if (dropped.length) {
          const audit = (await this.store.getMeta<AuditLine[]>(AUDIT_META)) ?? [];
          for (const e of dropped) {
            audit.push({
              at: this.iso(), action: "discard", local_ref: e.local_ref, staff_id: null,
              business_id: e.business_id, total_cents: e.total_cents, last_error: e.last_error,
            });
          }
          await this.store.setMeta(AUDIT_META, audit.slice(-AUDIT_MAX));
        }
      }
      await this.store.clearEntries();
      for (const e of keep) await this.store.putEntry(e);
      if (keep.length === 0) await deleteDeviceKey(this.store);
      this.emit();
    });
  }
}
