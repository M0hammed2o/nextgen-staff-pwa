/**
 * Offline capture helpers (docs/OFFLINE_POS_SYNC_CONTRACT.md in the backend repo).
 *
 * - isoWithOffset: the capture instant as an ISO-8601 string WITH a UTC offset
 *   (the server rejects a naive timestamp with OFFLINE_CAPTURE_NO_TIMEZONE).
 * - stale-queue and clock-skew thresholds, as pure functions so they are testable.
 */
import type { QueueEntry } from "./types";

export const HOUR_MS = 60 * 60 * 1000;
/** The server refuses an offline sale captured more than this long ago (standard plans). */
export const CAPTURE_MAX_AGE_MS = 72 * HOUR_MS;
/** Warn staff to reconnect once the oldest unsynced sale is older than this (standard plans). */
export const STALE_WARN_MS = 48 * HOUR_MS;
/** Event-plan businesses: the server's capture window is shorter (backend security fix H-2). */
export const EVENT_CAPTURE_MAX_AGE_MS = 36 * HOUR_MS;
export const EVENT_STALE_WARN_MS = 24 * HOUR_MS;

export interface StaleThresholds {
  warnMs: number;
  maxAgeMs: number;
}
export const STANDARD_THRESHOLDS: StaleThresholds = { warnMs: STALE_WARN_MS, maxAgeMs: CAPTURE_MAX_AGE_MS };
export const EVENT_THRESHOLDS: StaleThresholds = { warnMs: EVENT_STALE_WARN_MS, maxAgeMs: EVENT_CAPTURE_MAX_AGE_MS };
export function thresholdsFor(isEventVendor: boolean): StaleThresholds {
  return isEventVendor ? EVENT_THRESHOLDS : STANDARD_THRESHOLDS;
}

/** The server also refuses a capture more than 5 minutes in its future. */
export const CLOCK_SKEW_WARN_MS = 5 * 60 * 1000;

function pad(n: number, w = 2): string {
  return String(Math.abs(n)).padStart(w, "0");
}

/** e.g. 2026-11-19T14:03:05.123+02:00 (device-local wall time plus its offset). */
export function isoWithOffset(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

export interface StaleQueueState {
  level: "none" | "warn" | "expired";
  oldestAt: string | null;
  ageMs: number;
  /** Whole hours left before the server refuses the oldest sale (0 once past). */
  hoursLeft: number;
  /** The server's refuse-after age used for this evaluation, in hours. */
  maxAgeHours: number;
}

/**
 * Looks only at sales still waiting to upload (pending/syncing). Parked and
 * uploaded ones are not affected by the 72h window any more.
 */
export function staleQueueState(entries: Pick<QueueEntry, "status" | "created_at">[], nowMs: number, t: StaleThresholds = STANDARD_THRESHOLDS): StaleQueueState {
  let oldest: number | null = null;
  let oldestAt: string | null = null;
  for (const e of entries) {
    if (e.status !== "pending" && e.status !== "syncing") continue;
    const t = Date.parse(e.created_at);
    if (Number.isNaN(t)) continue;
    if (oldest === null || t < oldest) {
      oldest = t;
      oldestAt = e.created_at;
    }
  }
  if (oldest === null) return { level: "none", oldestAt: null, ageMs: 0, hoursLeft: 0, maxAgeHours: t.maxAgeMs / HOUR_MS };
  const ageMs = Math.max(0, nowMs - oldest);
  const hoursLeft = Math.max(0, Math.floor((t.maxAgeMs - ageMs) / HOUR_MS));
  const level = ageMs >= t.maxAgeMs ? "expired" : ageMs > t.warnMs ? "warn" : "none";
  return { level, oldestAt, ageMs, hoursLeft, maxAgeHours: t.maxAgeMs / HOUR_MS };
}

/** Device clock minus server clock, from an HTTP Date header; null if absent/unparseable. */
export function clockSkewMs(dateHeader: string | null | undefined, deviceNowMs: number): number | null {
  if (!dateHeader) return null;
  const server = Date.parse(dateHeader);
  if (Number.isNaN(server)) return null;
  return deviceNowMs - server;
}

export function isClockSkewed(skewMs: number | null): boolean {
  return skewMs !== null && Math.abs(skewMs) > CLOCK_SKEW_WARN_MS;
}

// Tiny observable so the till can show a warning. Never used to alter captured_at.
let skew: number | null = null;
const listeners = new Set<() => void>();
export const clockSkewStore = {
  get: () => skew,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(next: number | null) {
    if (next === skew) return;
    skew = next;
    listeners.forEach((l) => l());
  },
};
