/**
 * Light, client-side "is this obviously enough of a phone number to submit"
 * check for the POS digital-receipt flow — NOT the real SA-specific
 * normalisation. The backend (backend/app/utils/phone.py::normalize_sa_mobile)
 * is the actual authority: it also validates the SA mobile digit range
 * (6/7/8 after the trunk/country code) and returns a 422 with a clear
 * message for anything it rejects. This only exists so a till cashier
 * doesn't round-trip an obviously empty/too-short/garbled number to the
 * server and back before finding out it's wrong — it deliberately accepts
 * the same broad shapes the backend accepts (local "0XXXXXXXXX", "+27...",
 * "27...", with spaces/hyphens/parens as separators) without re-checking
 * the mobile-range digit itself.
 */
export function looksLikeSaPhoneNumber(raw: string): boolean {
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (!cleaned) return false;

  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    return /^27\d{9}$/.test(digits);
  }

  if (!/^\d+$/.test(cleaned)) return false;

  if (cleaned.startsWith("27") && cleaned.length === 11) return true;
  if (cleaned.startsWith("0") && cleaned.length === 10) return true;
  return false;
}
