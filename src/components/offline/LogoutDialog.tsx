import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * Shown when someone logs out while offline sales have not reached the server.
 * Never silently loses sales: the default is to keep them (still encrypted) on
 * this device; deleting them needs a ticked acknowledgement and its own button.
 */
export default function LogoutDialog({
  open,
  unsyncedCount,
  onCancel,
  onLogoutKeep,
  onLogoutDiscard,
}: {
  open: boolean;
  unsyncedCount: number;
  onCancel: () => void;
  onLogoutKeep: () => void;
  onLogoutDiscard: () => void;
}) {
  const [ack, setAck] = useState(false);
  const plural = unsyncedCount === 1 ? "sale has" : "sales have";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {unsyncedCount} {plural} not reached the server
          </DialogTitle>
          <DialogDescription>
            These sales were taken offline and are still waiting to upload. Logging out does not need to lose them.
          </DialogDescription>
        </DialogHeader>
        <button
          type="button"
          onClick={onLogoutKeep}
          className="h-12 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        >
          Log out and keep them on this device
        </button>
        <p className="text-xs text-muted-foreground">
          They stay encrypted here and upload the next time someone from this business signs in with internet. Do not clear
          this browser's data in the meantime.
        </p>
        <div className="rounded-lg border border-destructive/40 p-3">
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
            <span>I understand these sales will be deleted and will never be recorded.</span>
          </label>
          <button
            type="button"
            disabled={!ack}
            onClick={onLogoutDiscard}
            className="mt-2 h-11 w-full rounded-lg bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-40"
          >
            Log out and delete them
          </button>
        </div>
        <button type="button" onClick={onCancel} className="h-11 w-full rounded-lg border border-border text-sm font-medium">
          Cancel
        </button>
      </DialogContent>
    </Dialog>
  );
}
