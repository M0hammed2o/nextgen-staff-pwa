/**
 * Delivery-marketplace orders (Uber Eats) that are still waiting on someone
 * before they can reach the kitchen — the staff view of
 * GET /v1/business/delivery/queue (backend routes_delivery.py::staff_queue).
 *
 * A pending delivery order has NO kitchen order yet: only an accepted one
 * ever appears in Live Orders, so nothing shown here can be prepared by
 * mistake. Staff may accept an order that is ready, decline one, or retry an
 * accept the platform never confirmed; matching unknown items to the menu is
 * a manager's job (Manager Dashboard -> Delivery -> Menu mapping).
 */

export interface DeliveryQueueLine {
  title: string | null;
  quantity: number | null;
  special_instructions?: string | null;
  modifiers: { title: string | null; quantity: number | null; removed: boolean | null }[];
}

export interface DeliveryQueueItem {
  id: string;
  provider: string;
  provider_label: string;
  display_id: string | null;
  status: string;
  placed_at: string | null;
  accept_deadline_at: string | null;
  customer_first_name: string | null;
  special_instructions: string | null;
  lines: DeliveryQueueLine[];
  unresolved: string[];
  can_accept: boolean;
  can_deny: boolean;
  can_retry_accept: boolean;
  waiting_for_manager: boolean;
  message: string | null;
}

/**
 * Plain-language decline reasons, each mapped to one of Uber's own
 * deny_pos_order codes (the backend validates the code). Kept short on
 * purpose — the full list lives in the Manager Dashboard.
 */
export const DECLINE_REASONS: { code: string; label: string }[] = [
  { code: "ITEM_AVAILABILITY", label: "An item is unavailable" },
  { code: "CAPACITY", label: "Too busy right now" },
  { code: "STORE_CLOSED", label: "We're closed" },
  { code: "OTHER", label: "Other reason" },
];

export interface DeadlineInfo {
  label: string;
  urgent: boolean;
  passed: boolean;
}

/**
 * Time left before this platform's own deadline (accept_deadline_at), after
 * which NextGen declines the order automatically so the customer is not left
 * waiting. Urgent inside the last two minutes.
 */
export function deadlineInfo(acceptDeadlineAt: string | null, now: number = Date.now()): DeadlineInfo | null {
  if (!acceptDeadlineAt) return null;
  const deadline = new Date(acceptDeadlineAt).getTime();
  if (Number.isNaN(deadline)) return null;
  const ms = deadline - now;
  if (ms <= 0) {
    return { label: "Time's up — this order will be declined automatically", urgent: true, passed: true };
  }
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return {
    label: `${minutes}:${seconds.toString().padStart(2, "0")} left to accept`,
    urgent: ms <= 2 * 60 * 1000,
    passed: false,
  };
}

/** Kitchen badge for an accepted marketplace order, or null for in-store orders. */
export function marketplaceLabel(source: string | null | undefined): string | null {
  if (source === "UBER_EATS") return "Uber Eats";
  if (source === "MR_D") return "Mr D";
  return null;
}
