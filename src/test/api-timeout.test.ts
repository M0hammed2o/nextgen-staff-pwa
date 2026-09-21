import { describe, it, expect, afterEach } from "vitest";
import { apiFetch } from "@/lib/api";

const originalFetch = global.fetch;

function restoreFetch() {
  global.fetch = originalFetch;
}

describe("apiFetch request timeouts", () => {
  afterEach(() => {
    restoreFetch();
    localStorage.clear();
  });

  it("aborts a hanging request after the timeout and flags it as noResponse (outcome unknown), not a normal failure", async () => {
    // Simulate a request that never resolves on its own — only responds to
    // the AbortController's signal, exactly like a real stalled connection.
    global.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })) as unknown as typeof fetch;

    await expect(apiFetch("/v1/business/pos/orders", { method: "POST", timeoutMs: 25 })).rejects.toMatchObject({
      status: 0,
      noResponse: true,
    });
  });

  it("does NOT flag a definite HTTP error response (server replied) as noResponse", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ detail: "Till is closed" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await apiFetch("/v1/business/pos/orders", { method: "POST", timeoutMs: 1000 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 409, message: "Till is closed" });
    expect((caught as { noResponse?: boolean })?.noResponse).toBeUndefined();
  });

  it("a successful response is unaffected by the timeout plumbing", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(apiFetch("/v1/business/pos/settings", { timeoutMs: 1000 })).resolves.toEqual({ ok: true });
  });

  it("timeoutMs: null disables the timeout for a call that explicitly opts out", async () => {
    let sawSignal: AbortSignal | null | undefined;
    global.fetch = (async (_url: string, init?: RequestInit) => {
      sawSignal = init?.signal;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    await apiFetch("/v1/business/pos/settings", { timeoutMs: null });
    // No AbortController is wired in when the timeout is explicitly disabled.
    expect(sawSignal == null).toBe(true);
  });
});
