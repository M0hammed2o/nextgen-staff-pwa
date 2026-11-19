import { useEffect, useRef, useState } from "react";
import { Camera, ScanBarcode } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cameraScanSupported, emptyWedge, wedgeStep, type WedgeState } from "@/lib/scan-wedge";

function isEditable(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  const tag = n.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || n.isContentEditable === true;
}

/**
 * Window-level keyboard-wedge capture: a scanner "types" a code very fast and
 * presses Enter. When focus is not in some other field the burst is captured
 * here, so the cashier can scan without tapping the scan box first. Keystrokes
 * going into any input are left alone (the scan box handles its own Enter).
 */
export function useWedgeScanner(onScan: (code: string) => void, enabled: boolean) {
  const cb = useRef(onScan);
  cb.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    let state: WedgeState = emptyWedge();
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) {
        state = emptyWedge();
        return;
      }
      const r = wedgeStep(state, { key: e.key, t: e.timeStamp || Date.now() });
      state = r.state;
      if (r.scan) {
        e.preventDefault();
        cb.current(r.scan);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

interface Props {
  onScan: (code: string) => void;
  busy: boolean;
  message: { kind: "error" | "info"; text: string } | null;
  disabled?: boolean;
}

/** Focusable barcode/SKU box. Manual typing and wedge scanners both finish with Enter. */
export default function ScanField({ onScan, busy, message, disabled }: Props) {
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canCamera = cameraScanSupported();

  function submit(code: string) {
    const c = code.trim();
    if (!c || busy) return;
    setValue("");
    onScan(c);
    inputRef.current?.focus();
  }

  return (
    <div className="px-4 pb-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit(value);
              }
            }}
            disabled={disabled}
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Scan or type a barcode or SKU"
            placeholder="Scan or type barcode / SKU"
            className="h-11 w-full rounded-full border border-border bg-secondary pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
        </div>
        {canCamera && (
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            disabled={disabled}
            aria-label="Scan with camera"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground active:bg-muted disabled:opacity-50"
          >
            <Camera className="h-4 w-4" />
          </button>
        )}
      </div>
      {busy && <p className="mt-1 px-2 text-xs text-muted-foreground" role="status">Looking up…</p>}
      {!busy && message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={message.kind === "error" ? "mt-1 px-2 text-xs font-medium text-destructive" : "mt-1 px-2 text-xs text-muted-foreground"}
        >
          {message.text}
        </p>
      )}
      {canCamera && (
        <CameraScanDialog
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onCode={(c) => {
            setCameraOpen(false);
            submit(c);
          }}
        />
      )}
    </div>
  );
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/** Optional camera scanning. Only mounted when BarcodeDetector + getUserMedia exist. */
function CameraScanDialog({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (c: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(null);
    (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: new (o?: object) => BarcodeDetectorLike }).BarcodeDetector;
        const detector = new Ctor();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const found = await detector.detect(video);
            if (found[0]?.rawValue) {
              onCode(found[0].rawValue);
              return;
            }
          } catch {
            /* a frame that cannot be read is skipped */
          }
          timer = setTimeout(tick, 250);
        };
        void tick();
      } catch {
        setError("The camera could not be opened. Check the browser's camera permission, or type the code instead.");
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scan with camera</DialogTitle>
          <DialogDescription>Hold the barcode in view.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : (
          <video ref={videoRef} playsInline muted className="w-full rounded-lg bg-black" />
        )}
      </DialogContent>
    </Dialog>
  );
}
