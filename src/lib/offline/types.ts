import type { POSOrderCreateRequest } from "@/types";

export type EntryStatus = "pending" | "syncing" | "synced" | "conflict" | "failed";

/** AES-GCM ciphertext + IV. Raw bytes, never a string of the plaintext. */
export interface EncryptedBlob {
  iv: Uint8Array;
  ct: Uint8Array;
}

/** One line as the cashier saw it. Display only; the server re-prices on sync. */
export interface SnapshotLine {
  name: string;
  quantity: number;
  detail: string | null;
  line_total_cents: number;
}

/** What is encrypted at rest. */
export interface SalePayload {
  /** The exact body POSTed to /v1/business/pos/orders (includes idempotency_key). */
  request: POSOrderCreateRequest;
  snapshot: {
    lines: SnapshotLine[];
    /** Client-computed, DISPLAY ONLY (no VAT/loyalty); server pricing wins on sync. */
    total_cents: number;
    cash_tendered_cents: number | null;
    change_due_cents: number | null;
  };
}

/**
 * One queued sale. Non-sensitive routing/display fields are plaintext so the
 * queue screen works without decrypting anything; everything that can hold
 * personal data (customer name/phone, cart contents) lives in `payload`.
 */
export interface QueueEntry {
  /** Client UUID. Also the idempotency_key of the server call. */
  id: string;
  local_ref: string;
  seq: number;
  business_id: string;
  staff_id: string;
  created_at: string;
  updated_at: string;
  status: EntryStatus;
  attempts: number;
  last_error: string | null;
  last_error_code: string | null;
  /** epoch ms; the engine will not retry before this (exponential backoff). */
  next_attempt_at: number | null;
  total_cents: number;
  item_count: number;
  /** null once synced (payload is dropped as soon as the server has the sale). */
  payload: EncryptedBlob | null;
  server_order_id?: string;
  server_order_number?: string;
  synced_at?: string;
}

export interface AuditLine {
  at: string;
  action: "discard";
  local_ref: string;
  staff_id: string | null;
  business_id: string;
  total_cents: number;
  last_error: string | null;
}

export class OfflineQueueError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_CRYPTO" | "NOT_CONFIRMED" | "NOT_FOUND" | "BAD_STATE" | "STORAGE",
  ) {
    super(message);
    this.name = "OfflineQueueError";
  }
}
