import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type { IngredientSummary, POSSettings, WastageReasonOption } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Quick wastage capture.
 *
 * The design constraint is speed, not completeness. Unrecorded wastage is
 * mathematically indistinguishable from theft in a variance report, and if
 * logging a dropped dough ball takes longer than throwing it away, it will
 * not get logged. So: search, tap the ingredient, tap a reason, tap a
 * quantity, done — no dropdowns, no modal stack, no navigation.
 */
export default function Wastage() {
  const [search, setSearch] = useState("");
  const [ingredient, setIngredient] = useState<IngredientSummary | null>(null);
  const [reason, setReason] = useState<WastageReasonOption | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const { data: settings } = useQuery<POSSettings>({
    queryKey: ["pos-settings"],
    queryFn: () => apiClient.get<POSSettings>("/v1/business/pos/settings"),
    staleTime: 5 * 60 * 1000,
  });

  const enabled = settings?.inventory_enabled ?? false;

  const { data: ingredients = [], isLoading } = useQuery<IngredientSummary[]>({
    queryKey: ["ingredients"],
    queryFn: () => apiClient.get<IngredientSummary[]>("/v1/business/inventory/ingredients"),
    enabled,
    staleTime: 60 * 1000,
  });

  const { data: reasons = [] } = useQuery<WastageReasonOption[]>({
    queryKey: ["wastage-reasons"],
    queryFn: () => apiClient.get<WastageReasonOption[]>("/v1/business/wastage/reasons"),
    enabled,
    staleTime: 60 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return ingredients;
    return ingredients.filter((i) => i.name.toLowerCase().includes(term));
  }, [ingredients, search]);

  // The unit staff type in is the ingredient's own canonical unit, so there
  // is no unit picker to get wrong under pressure.
  const unitLabel =
    ingredient?.canonical_unit === "GRAM"
      ? "g"
      : ingredient?.canonical_unit === "MILLILITRE"
      ? "ml"
      : "units";
  const unitCode =
    ingredient?.canonical_unit === "GRAM"
      ? "G"
      : ingredient?.canonical_unit === "MILLILITRE"
      ? "ML"
      : "UNIT";

  const quickAmounts =
    ingredient?.canonical_unit === "UNIT" ? [1, 2, 3, 5, 10] : [50, 100, 150, 250, 500];

  function reset() {
    setIngredient(null);
    setReason(null);
    setQuantity("");
    setNote("");
    setError(null);
  }

  async function submit() {
    if (!ingredient || !reason) return;
    const amount = parseFloat(quantity);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter how much was wasted.");
      return;
    }
    if (reason.requires_note && !note.trim()) {
      setError("This reason needs a short note.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.post("/v1/business/wastage", {
        ingredient_id: ingredient.id,
        quantity: String(amount),
        unit: unitCode,
        reason: reason.value,
        note: note.trim() || null,
      });
      setDone(`${amount} ${unitLabel} of ${ingredient.name} recorded`);
      reset();
      setTimeout(() => setDone(null), 3500);
    } catch (err) {
      setError((err as { message?: string })?.message ?? "Could not record that — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (settings && !enabled) {
    return (
      <div className="min-h-screen bg-background p-4 pb-24">
        <h1 className="text-lg font-bold text-foreground">Wastage</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Stock tracking is not switched on for this restaurant.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-24">
      <h1 className="text-lg font-bold text-foreground">Record wastage</h1>

      {done && (
        <div className="mt-3 rounded-lg border border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/10 p-3">
          <p className="text-sm font-medium text-foreground">{done}</p>
        </div>
      )}

      {/* Step 1 — which ingredient */}
      {!ingredient && (
        <>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ingredients…"
            className="mt-4 h-12 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
          />
          {isLoading ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {ingredients.length === 0
                ? "No ingredients set up yet."
                : "Nothing matches that search."}
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setIngredient(item)}
                  className="flex min-h-[72px] flex-col justify-center rounded-xl border border-border bg-card p-3 text-left active:bg-muted"
                >
                  <span className="text-sm font-medium text-foreground">{item.name}</span>
                  <span
                    className={cn(
                      "mt-1 text-xs",
                      item.below_par ? "font-medium text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {item.on_hand_display} on hand
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Step 2 — reason and amount */}
      {ingredient && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{ingredient.name}</p>
              <p className="text-xs text-muted-foreground">{ingredient.on_hand_display} on hand</p>
            </div>
            <button onClick={reset} className="text-xs font-medium text-primary">
              Change
            </button>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground">What happened?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {reasons.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setReason(r)}
                  className={cn(
                    "h-11 rounded-lg border px-3 text-sm font-medium",
                    reason?.value === r.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground active:bg-muted"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground">How much ({unitLabel})?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {quickAmounts.map((amount) => (
                <button
                  key={amount}
                  onClick={() => setQuantity(String(amount))}
                  className={cn(
                    "h-11 min-w-[64px] rounded-lg border px-3 text-sm font-medium",
                    quantity === String(amount)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground active:bg-muted"
                  )}
                >
                  {amount}
                </button>
              ))}
            </div>
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              placeholder={`Or type an amount in ${unitLabel}`}
              className="mt-2 h-12 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
            />
          </div>

          {reason?.requires_note && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Say what happened (required)"
              className="h-12 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
            />
          )}

          {error && <p className="text-sm font-medium text-destructive">{error}</p>}

          <button
            onClick={submit}
            disabled={busy || !reason || !quantity}
            className="h-14 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground active:bg-primary/90 disabled:opacity-40"
          >
            {busy ? "Recording…" : "Record wastage"}
          </button>
        </div>
      )}
    </div>
  );
}
