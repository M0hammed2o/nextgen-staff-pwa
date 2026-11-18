/**
 * Pure helpers for the customer-facing collection board (/board).
 *
 * PRIVACY: the board is shown on a second screen facing customers. It may
 * show an order number and, only if the vendor turned it on locally, a first
 * name. It must never show a phone number, an address, items or totals -- so
 * these helpers only ever return those two fields.
 */
import type { Order } from "@/types";
import { safeGetItem, safeSetItem } from "@/lib/safe-storage";

export const BOARD_NAMES_KEY = "nextgen_board_show_names";
export const BOARD_CHIME_KEY = "nextgen_board_chime";

export interface BoardEntry {
  id: string;
  number: string;
  firstName: string | null;
}

const PREPARING = new Set(["ACCEPTED", "IN_PROGRESS"]);

function firstNameOf(raw: string | null | undefined): string | null {
  const first = (raw ?? "").trim().split(/\s+/)[0] ?? "";
  // "Guest" is the staff queue's placeholder, never a real name.
  if (!first || first.toLowerCase() === "guest") return null;
  // A phone number typed into the name field must not reach the screen.
  if (/\d{4,}/.test(first)) return null;
  return first.slice(0, 20);
}

function toEntry(o: Order): BoardEntry {
  return { id: o.id, number: o.order_number ?? "", firstName: firstNameOf(o.customer_name) };
}

/** Oldest first, so the longest-waiting order is at the top of each column. */
function byCreated(a: Order, b: Order): number {
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

export function splitBoardOrders(orders: Order[]): { preparing: BoardEntry[]; ready: BoardEntry[] } {
  const sorted = [...orders].sort(byCreated);
  return {
    preparing: sorted.filter((o) => PREPARING.has(o.status)).map(toEntry),
    ready: sorted.filter((o) => o.status === "READY").map(toEntry),
  };
}

/** Ids present in `current` ready list but not in the previous snapshot. */
export function newlyReadyIds(previous: ReadonlySet<string> | null, current: BoardEntry[]): string[] {
  if (previous === null) return []; // first load never counts as "new"
  return current.filter((e) => !previous.has(e.id)).map((e) => e.id);
}

export function loadBoardFlag(key: string): boolean {
  return safeGetItem(key) === "1"; // default OFF
}

export function saveBoardFlag(key: string, on: boolean): void {
  safeSetItem(key, on ? "1" : "0");
}
