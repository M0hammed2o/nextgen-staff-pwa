import { getStoredTokens, storeTokens, clearTokens } from "./token-storage";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://api.nextgenintelligence.co.za";

// Default request timeout. Chosen to comfortably cover a slow mobile-data
// connection or a cold backend instance without leaving a cashier staring at
// a frozen "Complete sale" button for a minute+. Callers that need something
// different (a long-poll, an upload) can override per-call via `timeoutMs`.
const DEFAULT_TIMEOUT_MS = 18000;

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

/**
 * Thrown/attached when fetch() itself never produced an HTTP response —
 * timeout (AbortController) or a network-level failure (offline, DNS,
 * connection reset). In both cases we genuinely do not know whether the
 * server received and processed the request, which matters a great deal for
 * a checkout POST (see Pos.tsx's "outcome unknown" recovery flow) — a
 * `noResponse` error must NEVER be treated the same as a definite rejection
 * (an HTTP 4xx/5xx, which means the server DID respond).
 */
export interface ApiFetchError {
  message: string;
  status: number;
  /**
   * The backend's machine-readable error code (`{ error: { code, message,
   * details } }` — backend/app/core/errors.py's `AppError`/`ErrorDetail`),
   * when the response body was parseable JSON in that shape. Callers that
   * need to distinguish one specific failure from another same-status
   * failure (e.g. a 409 `LOYALTY_NOT_ENABLED` entitlement gate vs some
   * other unrelated 409 conflict) should match on this, not on `status`
   * alone or on `message` text — see src/lib/loyalty.ts.
   */
  code?: string;
  noResponse?: boolean;
}

async function refreshAccessToken(): Promise<boolean> {
  const tokens = getStoredTokens();
  if (!tokens?.refresh_token) return false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: tokens.refresh_token }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return false;
    const data = await res.json();
    // Backend /v1/auth/refresh returns flat TokenPair
    if (data.access_token) {
      storeTokens(data);
      return true;
    }
    // Fallback: wrapped format
    if (data.tokens) {
      storeTokens(data.tokens);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Per-call override. Pass `null` to disable the timeout entirely (SSE never uses apiFetch, so this is only for the rare long-running request). */
  timeoutMs?: number | null;
}

/**
 * fetch() wrapped with an AbortController-based timeout. Distinguishes a
 * "no HTTP response at all" failure (timeout, offline, connection reset —
 * flagged `noResponse: true`) from a normal fetch that DID get a response
 * (even a 4xx/5xx) — callers that care about "did this mutation definitely
 * not happen" (checkout) rely on that distinction.
 */
async function timedFetch(url: string, init: RequestInit, timeoutMs: number | null | undefined): Promise<Response> {
  const effectiveTimeout = timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : timeoutMs;
  if (effectiveTimeout == null) {
    return fetch(url, init);
  }
  const controller = new AbortController();
  // If the caller already passed a signal we can't easily compose them
  // without a helper (AbortSignal.any isn't available in every supported
  // browser yet) — none of this app's call sites pass their own signal
  // today, so we simply own the signal here.
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const timeoutError: ApiFetchError = { message: "The request timed out — the connection may be slow or down", status: 0, noResponse: true };
      throw timeoutError;
    }
    // Any other fetch-level rejection (offline, DNS, connection reset) also
    // never produced an HTTP response.
    const networkError: ApiFetchError = { message: "Could not reach the server — check your connection", status: 0, noResponse: true };
    throw networkError;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { timeoutMs, ...requestInit } = options;
  const tokens = getStoredTokens();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(requestInit.headers as Record<string, string>),
  };

  if (tokens?.access_token) {
    headers["Authorization"] = `Bearer ${tokens.access_token}`;
  }

  let res = await timedFetch(`${BASE_URL}${path}`, { ...requestInit, headers }, timeoutMs);

  if (res.status === 401 && tokens?.refresh_token) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = refreshAccessToken();
    }
    const success = await refreshPromise;
    isRefreshing = false;
    refreshPromise = null;

    if (success) {
      const newTokens = getStoredTokens();
      if (newTokens) {
        headers["Authorization"] = `Bearer ${newTokens.access_token}`;
      }
      res = await timedFetch(`${BASE_URL}${path}`, { ...requestInit, headers }, timeoutMs);
    } else {
      clearTokens();
      window.location.href = "/login";
      throw new Error("Session expired");
    }
  }

  if (!res.ok) {
    let message = "Request failed";
    let code: string | undefined;
    try {
      const body = await res.json();
      // Backend returns { error: { code, message, details } } — parse nested format
      message = body?.error?.message || body?.detail || body?.message || message;
      code = typeof body?.error?.code === "string" ? body.error.code : undefined;
      console.error(`API ${res.status}:`, body?.error || body);
    } catch (parseError) {
      // Response body is not JSON (e.g. empty 500 from a proxy). Log for Sentry.
      console.error(`API ${res.status}: non-JSON error body`, parseError);
    }
    // A response WAS received here (even if not `ok`) — this is a definite
    // rejection, never `noResponse`.
    throw { message, status: res.status, code } as ApiFetchError;
  }

  if (res.status === 204) return {} as T;
  return res.json();
}

/**
 * SSE connection manager with automatic reconnect on token expiry.
 *
 * The browser's EventSource API cannot set custom headers, so the access
 * token is passed as a URL query parameter (?token=).  When the token
 * expires the server closes the connection with a 401-equivalent error.
 * This manager detects that, refreshes the access token, then opens a
 * fresh EventSource automatically.
 *
 * Reconnect strategy: up to MAX_RETRIES attempts with exponential back-off
 * (1 s, 2 s, 4 s).  After that, onError() is called and polling takes over.
 */
const _SSE_MAX_RETRIES = 3;
const _SSE_BASE_DELAY_MS = 1000;

function _buildSseUrl(baseUrl: string, path: string, token: string | null): string {
  const url = `${baseUrl}${path}`;
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export function createSSEConnection(
  path: string,
  onMessage: (data: unknown) => void,
  onError?: () => void
): { close: () => void } {
  let es: EventSource | null = null;
  let retries = 0;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function open() {
    if (stopped) return;
    const tokens = getStoredTokens();
    const url = _buildSseUrl(BASE_URL, path, tokens?.access_token ?? null);

    try {
      es = new EventSource(url);
    } catch {
      onError?.();
      return;
    }

    // The backend sends NAMED SSE events ("connected", "order_update",
    // "keepalive" — see backend/app/realtime/sse.py), never the unnamed
    // default "message" event. EventSource's onmessage only fires for the
    // unnamed type, so it silently never fires here — this connection must
    // use addEventListener for each named event instead.
    es.addEventListener("connected", () => {
      retries = 0; // reset back-off — proof the connection is alive
    });

    es.addEventListener("keepalive", () => {
      retries = 0; // periodic proof of life — keep the back-off reset
    });

    es.addEventListener("order_update", (event) => {
      retries = 0;
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (parseError) {
        if (event.data) console.warn("SSE: failed to parse message", parseError);
      }
    });

    es.onerror = () => {
      es?.close();
      es = null;
      if (stopped) return;

      if (retries >= _SSE_MAX_RETRIES) {
        console.warn("SSE: max retries reached, falling back to polling");
        onError?.();
        return;
      }

      const delay = _SSE_BASE_DELAY_MS * Math.pow(2, retries);
      retries += 1;

      retryTimer = setTimeout(async () => {
        if (stopped) return;
        // Attempt token refresh before reconnecting so the new URL carries a
        // valid token.  If refresh fails we still reconnect — the server will
        // return 401 again, triggering another retry until retries are exhausted.
        if (getStoredTokens()?.refresh_token) {
          if (!isRefreshing) {
            isRefreshing = true;
            refreshPromise = refreshAccessToken();
          }
          await refreshPromise;
          isRefreshing = false;
          refreshPromise = null;
        }
        open();
      }, delay);
    };
  }

  open();

  return {
    close() {
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      es?.close();
      es = null;
    },
  };
}

/**
 * Fetch the pick-your-name staff list for the PIN login screen.
 * Unauthenticated (pre-login) — fetched fresh every time, never cached.
 */
export async function fetchStaffDirectory(
  businessCode: string
): Promise<import("@/types").StaffDirectoryResponse> {
  const res = await fetch(`${BASE_URL}/v1/auth/pin/staff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ business_code: businessCode }),
  });
  if (!res.ok) {
    let message = "Store not found. Check the code and try again.";
    try {
      const body = await res.json();
      message = body?.error?.message || body?.detail || message;
    } catch {
      // non-JSON error body — keep the default message
    }
    throw { message, status: res.status };
  }
  return res.json();
}

export const apiClient = {
  get: <T>(path: string, opts?: { timeoutMs?: number | null }) => apiFetch<T>(path, opts),
  post: <T>(path: string, body?: unknown, opts?: { timeoutMs?: number | null }) =>
    apiFetch<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
      ...opts,
    }),
  put: <T>(path: string, body?: unknown, opts?: { timeoutMs?: number | null }) =>
    apiFetch<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
      ...opts,
    }),
  patch: <T>(path: string, body?: unknown, opts?: { timeoutMs?: number | null }) =>
    apiFetch<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
      ...opts,
    }),
};
