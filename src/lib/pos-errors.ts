/**
 * Plain-language messages for the variant / return / exchange error codes the
 * POS endpoints return (backend PRODUCT_VARIANTS_CONTRACT.md). Unknown codes
 * fall through to the server's own message.
 */
export const VARIANT_PERMANENT_CODES = ["VARIANT_REQUIRED", "VARIANT_INACTIVE"] as const;

export const STALL_STOPPED_MESSAGE =
  "This stall is no longer trading: the account has been suspended (for example the event was cancelled). The sale was not taken. Sales already saved on this device are kept.";

const MESSAGES: Record<string, string> = {
  VARIANT_REQUIRED: "This product comes in sizes or colours. Pick a variant for it before selling.",
  VARIANT_INACTIVE: "One of the selected variants is no longer sold. Remove it and choose another.",
  EXCHANGE_ORIGINAL_NOT_REFUNDED:
    "The original order has not been refunded yet. Return the items first, then ring up the exchange.",
  REFUND_EXCEEDS_RETURNED_VALUE:
    "The refund is more than the value of the returned items. Lower the amount or leave it blank.",
  RETURN_EXCEEDS_SOLD: "You are returning more than was sold (or already returned) on one of the lines.",
  OFFLINE_REFUND_REQUIRES_OWNER:
    "This sale was taken offline and could not be tied to a till session, so only the owner can refund its cash. Ask the owner to do the refund.",
  RETURN_ITEMS_REQUIRED:
    "Say which items came back before putting stock back. Choose the returned items and try again.",
  // The till must stop selling cleanly (no crash) when the server says this
  // stall can no longer trade, e.g. after the organiser cancels the event.
  BUSINESS_SUSPENDED: STALL_STOPPED_MESSAGE,
  ACCOUNT_DISABLED: "This staff account has been switched off. Ask the owner or manager.",
};

export function friendlyPosError(err: unknown, fallback: string): string {
  const e = (err ?? {}) as { code?: string; message?: string };
  if (typeof e.code === "string" && MESSAGES[e.code]) return MESSAGES[e.code];
  // Never hand React a non-string (an object here once crashed the till).
  return typeof e.message === "string" && e.message.trim() ? e.message : fallback;
}
