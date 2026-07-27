import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { TillSession, TillOpenRequest, TillCloseRequest } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Cash-up (till open/close) — a dialog rather than its own bottom-nav tab,
 * since it's a till-adjacent action, not a separate destination (keeps the
 * nav from growing to 5 tabs on a phone-width screen).
 */
export default function CashupDialog({ open, onClose }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canClose = user?.role === "OWNER" || user?.role === "MANAGER";

  const [openingFloat, setOpeningFloat] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [result, setResult] = useState<TillSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: current, isLoading } = useQuery({
    queryKey: ["till-current"],
    queryFn: () => apiClient.get<TillSession | null>("/v1/business/pos/till/current"),
    enabled: open,
  });

  const openMutation = useMutation({
    mutationFn: (body: TillOpenRequest) => apiClient.post<TillSession>("/v1/business/pos/till/open", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["till-current"] });
      setOpeningFloat("");
      setError(null);
    },
    onError: (err) => setError((err as { message?: string })?.message ?? "Could not open the till"),
  });

  const closeMutation = useMutation({
    mutationFn: (body: TillCloseRequest) =>
      apiClient.post<TillSession>(`/v1/business/pos/till/${current?.id}/close`, body),
    onSuccess: (closed) => {
      queryClient.invalidateQueries({ queryKey: ["till-current"] });
      setCountedCash("");
      setError(null);
      setResult(closed);
    },
    onError: (err) => setError((err as { message?: string })?.message ?? "Could not close the till"),
  });

  function handleOpenSubmit() {
    const cents = Math.round(parseFloat(openingFloat || "0") * 100);
    if (isNaN(cents) || cents < 0) {
      setError("Enter a valid opening float");
      return;
    }
    setError(null);
    openMutation.mutate({ opening_float_cents: cents });
  }

  function handleCloseSubmit() {
    const cents = Math.round(parseFloat(countedCash || "0") * 100);
    if (isNaN(cents) || cents < 0) {
      setError("Enter a valid counted amount");
      return;
    }
    setError(null);
    closeMutation.mutate({ counted_cash_cents: cents });
  }

  function handleDialogClose() {
    setResult(null);
    setError(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleDialogClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cash-up</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : result ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Till closed.</p>
            <div className="flex justify-between text-sm">
              <span>Expected cash</span>
              <span className="font-medium">{formatCurrency(result.expected_cash_cents)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Counted cash</span>
              <span className="font-medium">{formatCurrency(result.counted_cash_cents)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
              <span>Variance</span>
              <span className={(result.variance_cents ?? 0) < 0 ? "text-destructive" : "text-primary"}>
                {(result.variance_cents ?? 0) >= 0 ? "+" : ""}
                {formatCurrency(result.variance_cents)}
              </span>
            </div>
          </div>
        ) : current ? (
          canClose ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Opened {new Date(current.opened_at).toLocaleString()} with {formatCurrency(current.opening_float_cents)} float.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="counted">Counted cash in drawer (R)</Label>
                <Input
                  id="counted"
                  type="number"
                  inputMode="decimal"
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              A till has been open since {new Date(current.opened_at).toLocaleString()}. Ask a manager or owner to close it.
            </p>
          )
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No till is open yet.</p>
            <div className="space-y-1.5">
              <Label htmlFor="float">Opening float (R)</Label>
              <Input
                id="float"
                type="number"
                inputMode="decimal"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
        )}

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={handleDialogClose} className="flex-1">
            Done
          </Button>
          {!isLoading && !result && (
            current ? (
              canClose && (
                <Button onClick={handleCloseSubmit} disabled={closeMutation.isPending} className="flex-1 gap-1.5">
                  {closeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Close till
                </Button>
              )
            ) : (
              <Button onClick={handleOpenSubmit} disabled={openMutation.isPending} className="flex-1 gap-1.5">
                {openMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Open till
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
