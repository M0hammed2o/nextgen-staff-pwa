import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(cents: number | null | undefined): string {
  if (cents == null || isNaN(cents)) return "R 0.00";
  return `R ${(cents / 100).toFixed(2)}`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleTimeString("en-ZA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return `${formatDate(dateStr)} ${formatTime(dateStr)}`;
}

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return "";
  }
}

// Status colors — matches backend OrderStatus enum
export function getStatusColor(status: string): string {
  switch (status) {
    case "PENDING_DELIVERY_FEE":
      return "bg-amber-100 text-amber-800";
    case "FEE_SENT":
      return "bg-amber-200 text-amber-900";
    case "NEW":
      return "bg-warning/20 text-warning";
    case "ACCEPTED":
      return "bg-primary/20 text-primary";
    case "IN_PROGRESS":
      return "bg-primary/30 text-primary";
    case "READY":
      return "bg-success/20 text-success";
    case "COLLECTED":
    case "DELIVERED":
      return "bg-success/10 text-success";
    case "CANCELLED":
      return "bg-destructive/20 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}
