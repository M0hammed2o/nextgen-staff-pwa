import { useState } from "react";
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOffline } from "@/lib/offline/offline-context";
import OfflineQueueDialog from "./OfflineQueueDialog";

export function describeConnectivity(online: boolean, c: { pending: number; syncing: number; attention: number }) {
  const waiting = c.pending + c.syncing;
  if (c.attention > 0) return { tone: "bad" as const, label: `${c.attention} need attention` };
  if (online && waiting > 0) return { tone: "busy" as const, label: `Syncing ${waiting}` };
  if (!online) return { tone: "warn" as const, label: waiting > 0 ? `Offline · ${waiting} saved` : "Offline" };
  return { tone: "ok" as const, label: "Online" };
}

/** Persistent connectivity/sync badge for the till header; tap for the queue screen. */
export default function ConnectivityBadge() {
  const { online, counts } = useOffline();
  const [open, setOpen] = useState(false);
  const d = describeConnectivity(online, counts);
  const Icon = d.tone === "bad" ? AlertTriangle : d.tone === "busy" ? RefreshCw : d.tone === "ok" ? Wifi : WifiOff;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="connectivity-badge"
        aria-label={`Connection status: ${d.label}. Open offline sales`}
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
          d.tone === "ok" && "border-border bg-secondary text-muted-foreground",
          d.tone === "busy" && "border-primary/40 bg-primary/10 text-foreground",
          d.tone === "warn" && "border-warning/50 bg-warning/15 text-foreground",
          d.tone === "bad" && "border-destructive/50 bg-destructive/10 text-destructive",
        )}
      >
        <Icon className={cn("h-4 w-4", d.tone === "busy" && "animate-spin")} />
        <span>{d.label}</span>
      </button>
      <OfflineQueueDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
