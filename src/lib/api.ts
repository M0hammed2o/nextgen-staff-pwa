import { getStoredTokens, storeTokens, clearTokens } from "./token-storage";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

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
    } catch {}
    throw { message, status: res.status };
  }

  if (res.status === 204) return {} as T;
  return res.json();
}

export function createSSEConnection(
  path: string,
  onMessage: (data: unknown) => void,
  onError?: () => void
): EventSource | null {
  const tokens = getStoredTokens();
  const url = `${BASE_URL}${path}`;

  try {
    const separator = url.includes("?") ? "&" : "?";
    const sseUrl = tokens?.access_token
      ? `${url}${separator}token=${tokens.access_token}`
      : url;

    const es = new EventSource(sseUrl);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch {}
    };
    es.onerror = () => {
      onError?.();
    };
    return es;
  } catch {
    return null;
  }
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
};
