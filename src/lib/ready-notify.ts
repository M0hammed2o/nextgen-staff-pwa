/**
 * "Notify customer when ready (WhatsApp)" opt-in at the till.
 *
 * The frontend never sends a message: it only decides whether a phone number
 * is attached to the sale. The backend sends the READY message if the order is
 * linked to a customer and the stall has its own WhatsApp number connected.
 */
import { looksLikeSaPhoneNumber } from "@/lib/phone";

export interface ReadyNotifyInput {
  /** The existing "Phone (for loyalty)" field. */
  loyaltyPhone: string;
  /** The phone typed into the notify section. */
  notifyPhone: string;
  /** The explicit consent checkbox. */
  consent: boolean;
  /** False offline or in training mode: WhatsApp needs internet. */
  available: boolean;
  /** A loyalty reward is bound to the loyalty phone and must keep it. */
  rewardApplied: boolean;
}

/** The customer_phone to put on the sale body (null = none). */
export function resolveSaleCustomerPhone(i: ReadyNotifyInput): string | null {
  const loyalty = i.loyaltyPhone.trim();
  if (!i.rewardApplied && i.available && i.consent && looksLikeSaPhoneNumber(i.notifyPhone)) {
    return i.notifyPhone.trim();
  }
  return loyalty || null;
}

/** Inline problem with the opt-in, or null when it is fine (or not active). */
export function notifyProblem(i: Pick<ReadyNotifyInput, "notifyPhone" | "consent" | "available">): string | null {
  if (!i.available || !i.consent) return null;
  if (!i.notifyPhone.trim()) return "Enter the customer's WhatsApp number, or untick the box.";
  if (!looksLikeSaPhoneNumber(i.notifyPhone)) return "That does not look like a valid SA mobile number.";
  return null;
}
