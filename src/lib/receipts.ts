import { apiClient } from "./api";
import type { ReceiptDocument } from "@/types/receipt";

/**
 * The authoritative, tenant-configured receipt document for an order —
 * GET, not audited. Use for a normal (non-reprint) print.
 */
export function fetchReceiptDocument(orderId: string): Promise<ReceiptDocument> {
  return apiClient.get<ReceiptDocument>(`/v1/business/receipts/orders/${orderId}`);
}

/**
 * Record a reprint (audit event) and fetch the resulting document in one
 * call. The REPRINT banner and reprint_count/last_reprinted_at on the
 * returned document come from the audit trail this call just wrote —
 * printing this exact response is what keeps a reprinted slip from being
 * usable as evidence of a second sale. If this call fails, the caller must
 * NOT fall back to printing an unaudited document (see OrderDetail.tsx).
 */
export function reprintReceiptDocument(orderId: string): Promise<ReceiptDocument> {
  return apiClient.post<ReceiptDocument>(`/v1/business/receipts/orders/${orderId}/reprint`, {});
}
