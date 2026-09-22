import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { usePOSSettings } from "@/lib/pos-settings";
import type { StocktakeHistoryEntry, StocktakeLine, StocktakeSession } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";
import { ClipboardCheck, History, Loader2, Search } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { useTouchField } from "@/hooks/useTouchField";
import {
  buildCountsPayload,
  defaultUnitFor,
  seedCountEntries,
  unitOptionsFor,
  type CountEntry,
  type StocktakePayloadLine,
} from "@/lib/stocktake-units";

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

/**
 * One count-entry row, its own component so it can carry its own
 * useTouchField() hook — required since the parent renders a
 * variable-length, search-filtered list.
 *
 * KNOWN_BUGS BUG-0046 fix: every count now carries an explicit `unit`
 * chosen from `unitOptionsFor()` (kg/g, L/ml, or the ingredient's own
 * recognised count label) — the backend can no longer silently assume the
 * canonical unit for a bare number. The unit picker defaults to whatever
 * `defaultUnitFor()`/`seedCountEntries()` already showed before this fix
 * (the ingredient's canonical unit), so existing counting habits don't
 * change for staff who were already counting correctly.
 */
function StocktakeCountRow({
  line,
  entry,
  error,
  onChangeQuantity,
  onChangeUnit,
}: {
  line: StocktakeLine;
  entry: CountEntry;
  error?: string;
  onChangeQuantity: (v: string) => void;
  onChangeUnit: (v: string) => void;
}) {
  const touch = useTouchField({ value: entry.quantity, onChange: onChangeQuantity, layout: "NUMERIC" });
  const unitOptions = unitOptionsFor(line.canonical_unit, line.unit_label);

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{line.ingredient_name}</p>
          {unitOptions.length > 1 ? (
            <div className="mt-1.5 flex gap-1.5" role="group" aria-label={`Unit for ${line.ingredient_name}`}>
              {unitOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeUnit(opt.value)}
                  className={cn(
                    // Touch target: h-11 (44px) matches every other tappable
                    // control on this touch-first screen (see the quantity
                    // input beside it, and the Save/Submit buttons below).
                    "flex h-11 min-w-[44px] items-center justify-center rounded-md px-3 text-sm font-semibold",
                    entry.unit === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground active:bg-muted"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Count in {unitOptions[0]?.label ?? "units"}</p>
          )}
        </div>
        <input
          type="number"
          inputMode={touch.touchActive ? undefined : "decimal"}
          value={entry.quantity}
          onChange={(e) => onChangeQuantity(e.target.value)}
          placeholder="—"
          aria-label={`Quantity for ${line.ingredient_name}`}
          className={cn(
            "h-11 w-28 rounded-lg border bg-secondary px-3 text-right text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-primary",
            error ? "border-destructive" : "border-border"
          )}
          {...touch.fieldProps}
        />
      </div>
      {error && <p className="mt-1 text-right text-xs text-destructive">{error}</p>}
    </li>
  );
}

export default function Stocktake() {
  const queryClient = useQueryClient();
  const { data: settings } = usePOSSettings();
  const enabled = settings?.inventory_enabled ?? false;

  const [tab, setTab] = useState<Tab>("COUNT");
  const [counts, setCounts] = useState<Record<string, CountEntry>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const searchTouch = useTouchField({ value: search, onChange: setSearch, layout: "QWERTY" });
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
  // and never overwritten by a later refetch of the same session. Seeded via
  // seedCountEntries() so every entry — even one nobody has touched yet —
  // already carries the correct default unit (BUG-0046).
  useEffect(() => {
    if (!current) {
      setCounts({});
      return;
    }
    setCounts((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return seedCountEntries(
        current.lines.map((line) => ({
          ingredient_id: line.ingredient_id,
          canonical_unit: line.canonical_unit,
          unit_label: line.unit_label,
          counted_quantity_milli: line.counted_quantity_milli,
          entered_quantity: line.entered_quantity,
          entered_unit: line.entered_unit,
        }))
      );
    });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const startMutation = useMutation({
    mutationFn: () => apiClient.post<StocktakeSession>("/v1/business/stocktake/open", {}),
    onSuccess: () => {
      setCounts({});
      setFieldErrors({});
      setError(null);
      setNotice(null);
      queryClient.invalidateQueries({ queryKey: ["stocktake-current"] });
      queryClient.invalidateQueries({ queryKey: ["stocktake-history"] });
    },
    onError: (e: Error) => setError(e.message || "Could not start the count"),
  });

  // Every line always carries an explicit `unit` (BUG-0046) — see
  // src/lib/stocktake-units.ts::buildCountsPayload.
  const saveMutation = useMutation({
    mutationFn: (lines: StocktakePayloadLine[]) =>
      apiClient.post<StocktakeSession>(`/v1/business/stocktake/${current?.id}/counts`, { lines }),
    onSuccess: () => {
      setError(null);
      setFieldErrors({});
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
    () => Object.values(counts).filter((v) => v.quantity.trim() !== "").length,
    [counts]
  );

  // Validates and always attaches an explicit unit per line (BUG-0046) —
  // never sends a bare quantity the backend has to guess the meaning of.
  // An invalid entry (bad number, missing unit) is rejected inline and
  // never included in what gets sent.
  function handleSave() {
    const { lines: payload, errors } = buildCountsPayload(counts);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError("Fix the highlighted count(s) before saving.");
      return;
    }
    if (payload.length === 0) {
      setError("Enter at least one count first");
      return;
    }
    setError(null);
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
                className="mt-2 h-11 w-full rounded-full border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                {...searchTouch.fieldProps}
              />
            </div>

            <ul className="divide-y divide-border">
              {lines.map((line) => {
                const entry =
                  counts[line.ingredient_id] ?? {
                    quantity: "",
                    unit: defaultUnitFor(line.canonical_unit, line.unit_label),
                  };
                return (
                  <StocktakeCountRow
                    key={line.ingredient_id}
                    line={line}
                    entry={entry}
                    error={fieldErrors[line.ingredient_id]}
                    onChangeQuantity={(v) =>
                      setCounts((c) => ({ ...c, [line.ingredient_id]: { ...entry, quantity: v } }))
                    }
                    onChangeUnit={(v) =>
                      setCounts((c) => ({ ...c, [line.ingredient_id]: { ...entry, unit: v } }))
                    }
                  />
                );
              })}
              {lines.length === 0 && (
                <li>
                  <EmptyState icon={Search} title="No ingredients match that search" className="min-h-0 py-8" />
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
        <EmptyState icon={History} title="No counts have been taken yet" className="py-10" />
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
