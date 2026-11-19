/**
 * Sync engine: drains the offline queue to the server.
 *
 * - Strictly sequential (one request in flight) and FIFO.
 * - Triggers: start(), the `online` event, a periodic tick, and syncNow().
 * - Retry cadence is per entry (exponential backoff, capped); a head entry
 *   still in backoff blocks later ones, so order is never jumped.
 * - Never drops a sale. Every outcome is either synced, retried later, parked
 *   as conflict/failed for a human, or (401) kept waiting for re-login.
 */
import type { QueueEntry, SalePayload } from "./types";
import type { OfflineQueue } from "./queue";

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_CAP_MS = 5 * 60 * 1000;
export const TICK_MS = 15_000;

export function backoffDelayMs(attempts: number): number {
  // attempts = failures so far including the one just recorded (>= 1)
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export type Outcome =
  | { kind: "retry"; message: string }
  | { kind: "auth"; message?: string; code?: string }
  | { kind: "conflict"; message: string; code: string | null }
  | { kind: "failed"; message: string; code: string | null };

interface ErrLike {
  status?: number;
  code?: string;
  message?: string;
  noResponse?: boolean;
}

/**
 * Codes that can never succeed on a replay of the same sale: the cart itself is
 * wrong (a variant item with no variant, or a variant withdrawn from sale
 * since the cashier saw it). Parked for a human; never retried automatically.
 */
export const PERMANENT_SALE_CODES: Record<string, string> = {
  VARIANT_REQUIRED:
    "A product in this sale needs a size or colour and none was chosen. Discard it and ring the sale up again.",
  VARIANT_INACTIVE:
    "A size or colour in this sale is no longer sold. Discard it and ring the sale up again with another variant.",
  // Offline capture codes (backend OFFLINE_POS_SYNC_CONTRACT.md section 6). None of
  // these can succeed on a retry of the same sale, so none is retried automatically.
  OFFLINE_CAPTURE_TOO_OLD:
    "This sale was taken too long ago (over 72 hours, or 36 hours for event vendors) and the server will no longer accept it. A manager must enter it by hand, then discard this one.",
  OFFLINE_CAPTURE_IN_FUTURE:
    "This device's clock was ahead when the sale was taken, so the server refused it. Fix the date and time on this device; a manager may need to enter the sale by hand.",
  OFFLINE_CAPTURE_NO_TIMEZONE:
    "This sale was saved without a time zone and the server refused it. A manager must enter it by hand.",
  USER_NOT_FOUND:
    "The cashier who took this sale is no longer an active user of this business. A manager must enter the sale by hand.",
  // EVENT_TRADING_NOT_ALLOWED is deliberately absent: it is a 403 (parked below) and the
  // server's own message names the reason (details.reason), which is more useful than ours.
  INSUFFICIENT_CASH_TENDERED:
    "The price went up while this device was offline, so the cash handed over no longer covers the sale. A manager must settle this one.",
  PAYMENT_TOTAL_MISMATCH:
    "The server's price for this sale no longer matches the payment recorded. A manager must settle this one.",
};

/** Codes that mean "the account/business is blocked right now": keep the sale and wait, never park or delete it. */
export const SUSPENDED_CODE = "BUSINESS_SUSPENDED";
const SUSPENDED_MESSAGE = "This business is suspended. The sale is safe on this device and will upload once access is restored.";

export function classifyError(err: unknown): Outcome {
  const e = (err ?? {}) as ErrLike;
  const message = e.message || "Could not upload this sale";
  const status = e.status;
  if (e.code === SUSPENDED_CODE && !e.noResponse && status !== 401) {
    return { kind: "auth", message: SUSPENDED_MESSAGE, code: SUSPENDED_CODE };
  }
  if (e.code && PERMANENT_SALE_CODES[e.code] && !e.noResponse && status !== 401) {
    return { kind: "conflict", message: PERMANENT_SALE_CODES[e.code], code: e.code };
  }
  if (e.noResponse || status === undefined || status === 0) return { kind: "retry", message };
  if (status === 401) return { kind: "auth" };
  if (status === 403 || status === 409 || status === 422) return { kind: "conflict", message, code: e.code ?? null };
  if (status === 408 || status === 425 || status === 429 || status >= 500) return { kind: "retry", message };
  return { kind: "failed", message, code: e.code ?? null };
}

export interface SyncedOrder {
  id?: string;
  order_number?: string;
}

export interface SyncEngineOptions {
  queue: OfflineQueue;
  /** Performs the one server call for a queued sale. Must send entry.id as the idempotency key. */
  send: (entry: QueueEntry, payload: SalePayload) => Promise<SyncedOrder>;
  /** Current signed-in business, or null when nobody is signed in (entries wait). */
  getIdentity: () => { businessId: string } | null;
  isOnline?: () => boolean;
  now?: () => number;
  onSynced?: (entry: QueueEntry) => void;
}

export interface EngineStatus {
  running: boolean;
  authRequired: boolean;
}

export class SyncEngine {
  private running = false;
  private authRequired = false;
  /** Set by a 401 the refresh could not fix; cleared by login/manual sync. */
  private blockedOn401 = false;
  private listeners = new Set<() => void>();
  private stopFns: Array<() => void> = [];

  constructor(private readonly opts: SyncEngineOptions) {}

  get status(): EngineStatus {
    return { running: this.running, authRequired: this.authRequired };
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  /** One drain pass. Returns when the queue is empty, blocked, or backing off. */
  async syncNow(opts: { manual?: boolean } = {}): Promise<void> {
    if (this.running) return;
    if (this.blockedOn401 && !opts.manual) return;
    const manual = opts.manual === true;
    this.running = true;
    this.emit();
    try {
      const { queue } = this.opts;
      if (manual) {
        this.blockedOn401 = false;
        await queue.clearBackoff();
      }
      while (true) {
        const identity = this.opts.getIdentity();
        if (!identity) {
          this.authRequired = (await queue.unsyncedCount()) > 0;
          return;
        }
        if (!manual && this.opts.isOnline && !this.opts.isOnline()) return;

        const entry = await queue.nextDue(identity.businessId, manual);
        if (!entry) return;

        await queue.markSyncing(entry.id);
        let payload: SalePayload;
        try {
          payload = await queue.decryptPayload(entry);
        } catch (err) {
          await queue.markConflict(
            entry.id,
            "This sale could not be read on this device (its storage key is gone). It needs a manager.",
            "UNREADABLE",
            "failed",
          );
          continue;
        }

        try {
          const order = await this.opts.send(entry, payload);
          // A dedupe response (the server already had this key) is a 2xx: success.
          const done = await queue.markSynced(entry.id, order ?? {});
          this.authRequired = false;
          this.opts.onSynced?.(done);
          continue;
        } catch (err) {
          const outcome = classifyError(err);
          if (outcome.kind === "retry") {
            const attempts = entry.attempts + 1;
            await queue.markRetry(entry.id, outcome.message, this.now() + backoffDelayMs(attempts));
            return; // network/server trouble: stop, the tick retries after backoff
          }
          if (outcome.kind === "auth") {
            await queue.markAuthWait(entry.id, outcome.message, outcome.code);
            this.authRequired = outcome.code !== SUSPENDED_CODE;
            this.blockedOn401 = true;
            return;
          }
          await queue.markConflict(entry.id, outcome.message, outcome.code, outcome.kind);
          continue; // parked for a human; later independent sales may still go
        }
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }

  /** Call after a successful login so waiting sales upload promptly. */
  notifyLogin() {
    this.blockedOn401 = false;
    void this.syncNow({ manual: true }).catch(() => undefined);
  }

  /** Start triggers. Returns a stop function. */
  start(): () => void {
    this.stop();
    void this.opts.queue
      .recoverInterrupted()
      .then(() => this.opts.queue.purgeSynced())
      .then(() => this.syncNow())
      .catch(() => undefined);
    const onOnline = () => void this.syncNow({ manual: true }).catch(() => undefined);
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => {
      void this.syncNow().catch(() => undefined);
      void this.opts.queue.purgeSynced().catch(() => undefined);
    }, TICK_MS);
    this.stopFns = [() => window.removeEventListener("online", onOnline), () => clearInterval(timer)];
    return () => this.stop();
  }

  stop() {
    this.stopFns.forEach((f) => f());
    this.stopFns = [];
  }
}
