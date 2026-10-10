import { apiClient } from "./api";
import type { PaymentIntent, PaymentIntentCreateRequest } from "@/types";

/**
 * Pay by Link (WhatsApp payment-link) payment-intent API client —
 * backend/app/api/v1/routes_pos.py's payment-intents routes (new, built in
 * parallel with this UI — see KNOWN_BUGS.md/WORKLOG.md if the shape below
 * ever stops matching reality).
 *
 * Every function here returns ONLY the safe, client-facing intent state
 * (id/status/whatsapp_status/amount_cents/expires_at) — the backend never
 * returns the raw payment link URL to this endpoint family, and this app
 * must never try to construct, display, copy, or open one itself (hard
 * product constraint: WhatsApp-delivery-only, status-only UI). See
 * PaymentDialog.tsx's split-payment Pay-by-Link sub-flow, the only caller.
 */

/** Create a new payment intent and (server-side) trigger the WhatsApp send. */
export function createPaymentIntent(body: PaymentIntentCreateRequest): Promise<PaymentIntent> {
  return apiClient.post<PaymentIntent>("/v1/business/pos/payment-intents", body);
}

/** Poll for the current state — call every 2-3s while the dialog is open. */
export function getPaymentIntent(id: string): Promise<PaymentIntent> {
  return apiClient.get<PaymentIntent>(`/v1/business/pos/payment-intents/${id}`);
}

/**
 * Re-send WhatsApp for the SAME link (never creates a second billable link).
 * Rate-limited server-side — callers must also debounce/disable the button
 * client-side while a request is in flight (see PaymentDialog.tsx's
 * `resendingId` guard) so a double-tap can't even reach the network race
 * the server-side limiter is there to catch.
 */
export function resendPaymentIntent(id: string): Promise<PaymentIntent> {
  return apiClient.post<PaymentIntent>(`/v1/business/pos/payment-intents/${id}/resend`);
}

/** Only works while the intent is PENDING — a terminal intent 4xxs. */
export function cancelPaymentIntent(id: string): Promise<PaymentIntent> {
  return apiClient.post<PaymentIntent>(`/v1/business/pos/payment-intents/${id}/cancel`);
}

/**
 * Mask a phone number for status UI (e.g. "+27 •• ••• 1234") — the cashier
 * must never see the full number once a link has been sent, and it must
 * never be logged anywhere (hard product constraint #7). Accepts the same
 * broad SA shapes `looksLikeSaPhoneNumber` (lib/phone.ts) validates
 * ("0XXXXXXXXX", "+27...", "27...", with separators) and always returns a
 * masked string, never the input verbatim, even if the shape is
 * unrecognised.
 */
export function maskPhoneForStatus(raw: string): string {
  const cleaned = raw.replace(/[\s\-()]/g, "");
  let national = cleaned;
  if (cleaned.startsWith("+27")) national = cleaned.slice(3);
  else if (cleaned.startsWith("27") && cleaned.length >= 11) national = cleaned.slice(2);
  else if (cleaned.startsWith("0")) national = cleaned.slice(1);

  const digitsOnly = national.replace(/\D/g, "");
  const last4 = digitsOnly.slice(-4);
  if (last4.length !== 4) return "+27 •• ••• ••••";
  return `+27 •• ••• ${last4}`;
}
