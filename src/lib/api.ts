import { getStoredTokens, storeTokens, clearTokens } from "./token-storage";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://api.nextgenintelligence.co.za";

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const tokens = getStoredTokens();
  if (!tokens?.refresh_token) return false;

  try {
    const res = await fetch(`${BASE_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
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

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const tokens = getStoredTokens();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (tokens?.access_token) {
    headers["Authorization"] = `Bearer ${tokens.access_token}`;
  }

  let res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

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
      res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    } else {
      clearTokens();
      window.location.href = "/login";
      throw new Error("Session expired");
    }
  }

  if (!res.ok) {
    let message = "Request failed";
    try {
      const body = await res.json();
      // Backend returns { error: { code, message, details } } — parse nested format
      message = body?.error?.message || body?.detail || body?.message || message;
      console.error(`API ${res.status}:`, body?.error || body);
    } catch (parseError) {
      // Response body is not JSON (e.g. empty 500 from a proxy). Log for Sentry.
      console.error(`API ${res.status}: non-JSON error body`, parseError);
    }
    throw { message, status: res.status };
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

    es.onmessage = (event) => {
      retries = 0; // reset back-off on successful message
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (parseError) {
        if (event.data) console.warn("SSE: failed to parse message", parseError);
      }
    };

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

export const apiClient = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),
};
