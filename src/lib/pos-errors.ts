/**
 * Plain-language messages for the variant / return / exchange error codes the
 * POS endpoints return (backend PRODUCT_VARIANTS_CONTRACT.md). Unknown codes
 * fall through to the server's own message.
 */
export const VARIANT_PERMANENT_CODES = ["VARIANT_REQUIRED", "VARIANT_INACTIVE"] as const;

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
};

export function friendlyPosError(err: unknown, fallback: string): string {
  const e = (err ?? {}) as { code?: string; message?: string };
  if (e.code && MESSAGES[e.code]) return MESSAGES[e.code];
  return e.message || fallback;
}
