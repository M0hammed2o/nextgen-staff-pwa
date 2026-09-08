import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { usePOSSettings } from "@/lib/pos-settings";
import type { StocktakeHistoryEntry, StocktakeSession } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";
import { ClipboardCheck, History, Loader2 } from "lucide-react";

/**
 * Staff stocktake — start a count, enter what is physically on the shelf,
 * submit it, and read back what previous counts found.
 *
 * Two deliberate choices carried over from the API's design:
 *
 * 1. Staff enter ONLY what they counted. The expected figure is not shown
 *    while counting. A count taken against a number you can already see is
 *    not a count, and the whole point of the exercise is to find the gap
 *    between the ledger and the shelf.
 *
 * 2. Nothing here overwrites a previous count. Each session is its own
 *    record with its own cut-off, and an approved one is immutable — so the
 *    history below is an audit trail rather than a current-state view.
 */

type Tab = "COUNT" | "HISTORY";

export default function Stocktake() {
  const queryClient = useQueryClient();
  const { data: settings } = usePOSSettings();
  const enabled = settings?.inventory_enabled ?? false;

  const [tab, setTab] = useState<Tab>("COUNT");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: current, isLoading } = useQuery<StocktakeSession | null>({
    queryKey: ["stocktake-current"],
    queryFn: () => apiClient.get<StocktakeSession | null>("/v1/business/stocktake/current"),
    enabled,
  });

  const { data: history = [], isLoading: loadingHistory } = useQuery<StocktakeHistoryEntry[]>({
    queryKey: ["stocktake-history"],
    queryFn: () => apiClient.get<StocktakeHistoryEntry[]>("/v1/business/stocktake"),
    enabled,
  });

  // Counting is a long screen on a phone; losing typed numbers to a refetch
  // would be worse than a stale total, so entries are seeded once per session
  // and never overwritten by a later refetch of the same session.
  useEffect(() => {
    if (!current) {
      setCounts({});
      return;
    }
    setCounts((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const seeded: Record<string, string> = {};
      for (const line of current.lines) {
        seeded[line.ingredient_id] =
          line.counted_quantity_milli != null ? String(line.counted_quantity_milli / 1000) : "";
      }
      return seeded;
    });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const startMutation = useMutation({
    mutationFn: () => apiClient.post<StocktakeSession>("/v1/business/stocktake/open", {}),
    onSuccess: () => {
      setCounts({});
      setError(null);
      setNotice(null);
      queryClient.invalidateQueries({ queryKey: ["stocktake-current"] });
      queryClient.invalidateQueries({ queryKey: ["stocktake-history"] });
    },
    onError: (e: Error) => setError(e.message || "Could not start the count"),
  });

  const saveMutation = useMutation({
    mutationFn: (lines: { ingredient_id: string; quantity: string }[]) =>
      apiClient.post<StocktakeSession>(`/v1/business/stocktake/${current?.id}/counts`, { lines }),
    onSuccess: () => {
      setError(null);
      setNotice("Counts saved.");
      queryClient.invalidateQueries({ queryKey: ["stocktake-current"] });
    },
    onError: (e: Error) => setError(e.message || "Could not save the counts"),
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiClient.post<StocktakeSession>(`/v1/business/stocktake/${current?.id}/complete`, {}),
    onSuccess: () => {
      setError(null);
      setNotice("Count submitted. A manager reviews and approves it.");
      queryClient.invalidateQueries({ queryKey: ["stocktake-current"] });
      queryClient.invalidateQueries({ queryKey: ["stocktake-history"] });
    },
    onError: (e: Error) => setError(e.message || "Could not submit the count"),
  });

  const lines = useMemo(() => {
    if (!current) return [];
    const term = search.trim().toLowerCase();
    if (!term) return current.lines;
    return current.lines.filter((l) => l.ingredient_name.toLowerCase().includes(term));
  }, [current, search]);

  const enteredCount = useMemo(
    () => Object.values(counts).filter((v) => v.trim() !== "").length,
    [counts]
  );

  function unitFor(unit: string, label: string | null): string {
    if (unit === "GRAM") return "g";
    if (unit === "MILLILITRE") return "ml";
    return label || "units";
  }

  function handleSave() {
    const payload = Object.entries(counts)
      .filter(([, v]) => v.trim() !== "")
      .map(([ingredient_id, quantity]) => ({ ingredient_id, quantity: quantity.trim() }));
    if (payload.length === 0) {
      setError("Enter at least one count first");
      return;
    }
    saveMutation.mutate(payload);
  }

  if (!enabled) {
    return (
      <div className="min-h-screen bg-background pb-28">
        <header className="border-b border-border bg-card px-4 py-4 safe-top">
          <h1 className="text-xl font-bold text-foreground">Stocktake</h1>
        </header>
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Stock tracking is not switched on for this restaurant yet.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 px-4 py-4 backdrop-blur-sm safe-top">
        <h1 className="text-xl font-bold text-foreground">Stocktake</h1>
        <div className="mt-3 flex gap-2">
          {(["COUNT", "HISTORY"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                tab === t ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
              )}
            >
              {t === "COUNT" ? <ClipboardCheck className="h-4 w-4" /> : <History className="h-4 w-4" />}
              {t === "COUNT" ? "Count" : "Previous counts"}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p className="mx-4 mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      {notice && !error && (
        <p className="mx-4 mt-4 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>
      )}

      {tab === "COUNT" ? (
        isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !current || current.status !== "DRAFT" ? (
          <div className="px-4 py-8">
            <div className="rounded-xl border border-border bg-card p-5 text-center">
              <ClipboardCheck className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 text-base font-semibold text-foreground">No count in progress</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Starting a count fixes a cut-off time straight away. Anything rung up
                after that moment belongs to the next period, so you can keep selling
                while you count.
              </p>
              <button
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground active:opacity-90 disabled:opacity-50"
              >
                {startMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Start a stocktake
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Counting to {new Date(current.cutoff_at).toLocaleString()} · {enteredCount} of{" "}
                {current.lines.length} entered
              </p>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ingredients…"
                className="mt-2 h-10 w-full rounded-full border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <ul className="divide-y divide-border">
              {lines.map((line) => (
                <li key={line.ingredient_id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{line.ingredient_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Count in {unitFor(line.canonical_unit, line.unit_label)}
                    </p>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={counts[line.ingredient_id] ?? ""}
                    onChange={(e) =>
                      setCounts((c) => ({ ...c, [line.ingredient_id]: e.target.value }))
                    }
                    placeholder="—"
                    className="h-11 w-28 rounded-lg border border-border bg-secondary px-3 text-right text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </li>
              ))}
              {lines.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No ingredients match that search.
                </li>
              )}
            </ul>

            <div className="sticky bottom-24 mt-4 flex gap-2 px-4">
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="h-12 flex-1 rounded-lg bg-secondary text-sm font-semibold text-foreground active:bg-muted disabled:opacity-50"
              >
                {saveMutation.isPending ? "Saving…" : "Save progress"}
              </button>
              <button
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending || enteredCount === 0}
                className="h-12 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground active:opacity-90 disabled:opacity-50"
              >
                {completeMutation.isPending ? "Submitting…" : "Submit count"}
              </button>
            </div>
          </>
        )
      ) : loadingHistory ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : history.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          No counts have been taken yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {history.map((h) => (
            <li key={h.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {h.cutoff_at ? new Date(h.cutoff_at).toLocaleString() : "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {h.opened_by_name ?? "Unknown"}
                    {h.completed_by_name && h.completed_by_name !== h.opened_by_name
                      ? ` · submitted by ${h.completed_by_name}`
                      : ""}
                    {" · "}
                    {h.counted_line_count} of {h.line_count} counted
                  </p>
                  {h.notes && (
                    <p className="mt-1 text-xs italic text-muted-foreground">{h.notes}</p>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      h.status === "APPROVED"
                        ? "bg-primary/10 text-primary"
                        : h.status === "DRAFT"
                        ? "bg-secondary text-muted-foreground"
                        : h.status === "CANCELLED"
                        ? "bg-muted text-muted-foreground"
                        : "bg-secondary text-foreground"
                    )}
                  >
                    {h.status}
                  </span>
                  {h.status !== "DRAFT" && (
                    <p
                      className={cn(
                        "mt-1 text-sm font-semibold tabular-nums",
                        h.total_variance_value_cents < 0 ? "text-destructive" : "text-foreground"
                      )}
                    >
                      {formatCurrency(h.total_variance_value_cents)}
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
