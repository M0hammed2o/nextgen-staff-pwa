import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Maximize2, Minimize2, Volume2, VolumeX, WifiOff, ArrowLeft } from "lucide-react";
import { useLiveOrdersFeed } from "@/hooks/useLiveOrdersFeed";
import {
  BOARD_CHIME_KEY,
  BOARD_NAMES_KEY,
  loadBoardFlag,
  newlyReadyIds,
  saveBoardFlag,
  splitBoardOrders,
  type BoardEntry,
} from "@/lib/board";
import { cn } from "@/lib/utils";

const HIGHLIGHT_MS = 8000;

type AudioCtxCtor = typeof AudioContext;

function chime(ctx: AudioContext | null): void {
  // Autoplay policy: only play if the context was unlocked by a user gesture
  // (the toggle click). A suspended context stays silent rather than throwing.
  if (!ctx || ctx.state !== "running") return;
  try {
    [880, 1318].forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.4, t + 0.02);
      gain.gain.linearRampToValueAtTime(0, t + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  } catch {
    // ignore: a missing chime must never break the board
  }
}

function Column({
  title,
  entries,
  tone,
  showNames,
  highlighted,
  testId,
}: {
  title: string;
  entries: BoardEntry[];
  tone: "preparing" | "ready";
  showNames: boolean;
  highlighted: ReadonlySet<string>;
  testId: string;
}) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className={cn(
        "flex min-h-0 flex-1 flex-col rounded-3xl border-4 p-4 sm:p-6",
        tone === "ready" ? "border-green-400 bg-green-950" : "border-amber-400 bg-neutral-900",
      )}
    >
      <h2
        className={cn(
          "mb-4 text-center font-black uppercase tracking-wide text-[clamp(1.5rem,4vw,3.5rem)]",
          tone === "ready" ? "text-green-300" : "text-amber-300",
        )}
      >
        {title}
      </h2>
      <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] content-start gap-3 overflow-hidden">
        {entries.map((e) => (
          <li
            key={e.id}
            data-highlight={highlighted.has(e.id) ? "true" : "false"}
            className={cn(
              "rounded-2xl px-3 py-4 text-center font-black leading-none transition-all",
              tone === "ready" ? "bg-green-500 text-black" : "bg-neutral-800 text-white",
              highlighted.has(e.id) && "animate-pulse bg-white text-black ring-8 ring-yellow-300",
            )}
          >
            <span className="block text-[clamp(2rem,6vw,5rem)]">{e.number}</span>
            {showNames && e.firstName && (
              <span className="mt-2 block text-[clamp(1rem,2.5vw,2rem)] font-bold">{e.firstName}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Read-only customer-facing collection board. Contains NO order actions and
 * never renders phone numbers: see src/lib/board.ts. Data comes from the same
 * business-scoped live-orders endpoints the kitchen queue uses.
 */
export default function CollectionBoard() {
  const { orders, isLoading, hasData, connectionLost } = useLiveOrdersFeed();
  const [showNames, setShowNames] = useState(() => loadBoardFlag(BOARD_NAMES_KEY));
  const [chimeOn, setChimeOn] = useState(() => loadBoardFlag(BOARD_CHIME_KEY));
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(new Set());
  const [fullscreen, setFullscreen] = useState(false);
  const prevReadyRef = useRef<Set<string> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { preparing, ready } = useMemo(() => splitBoardOrders(orders), [orders]);

  // Only start comparing once real data has arrived, so the first load (or a
  // reload of the TV) never flashes / chimes every ready order.
  useEffect(() => {
    if (!hasData) return;
    const fresh = newlyReadyIds(prevReadyRef.current, ready);
    prevReadyRef.current = new Set(ready.map((e) => e.id));
    if (fresh.length === 0) return;
    setHighlighted((prev) => new Set([...prev, ...fresh]));
    if (chimeOn) chime(audioRef.current);
    const t = setTimeout(() => {
      setHighlighted((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.delete(id));
        return next;
      });
    }, HIGHLIGHT_MS);
    timersRef.current.push(t);
  }, [ready, hasData, chimeOn]);

  useEffect(() => {
    const timers = timersRef;
    return () => {
      timers.current.forEach(clearTimeout);
      audioRef.current?.close().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void document.documentElement.requestFullscreen?.();
    } catch {
      // Fullscreen refused (e.g. iOS Safari): the board still works windowed.
    }
  }, []);

  const toggleChime = useCallback(() => {
    const next = !chimeOn;
    setChimeOn(next);
    saveBoardFlag(BOARD_CHIME_KEY, next);
    if (next) {
      // This click is the user gesture that lets audio start later.
      try {
        const Ctor: AudioCtxCtor | undefined =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext;
        if (Ctor && !audioRef.current) audioRef.current = new Ctor();
        void audioRef.current?.resume();
      } catch {
        // no audio available: the visual highlight still works
      }
    }
  }, [chimeOn]);

  const toggleNames = useCallback(() => {
    const next = !showNames;
    setShowNames(next);
    saveBoardFlag(BOARD_NAMES_KEY, next);
  }, [showNames]);

  const ctl =
    "inline-flex h-10 items-center gap-2 rounded-full border border-neutral-600 bg-neutral-800 px-4 text-sm font-medium text-neutral-200";

  return (
    <div
      data-testid="collection-board"
      className="fixed inset-0 z-[60] flex flex-col gap-3 bg-black p-3 text-white sm:p-5"
      style={{ paddingTop: "max(0.75rem, var(--safe-area-top))" }}
    >
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className={cn(ctl, "opacity-60")} aria-label="Back to live orders">
          <ArrowLeft className="h-4 w-4" /> Staff
        </Link>
        {connectionLost && (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-full bg-red-600 px-6 py-2 text-[clamp(1rem,2.5vw,1.75rem)] font-black text-white"
          >
            <WifiOff className="h-6 w-6" /> Connection lost - numbers may be out of date
          </div>
        )}
        <div className="flex items-center gap-2 opacity-60">
          <button type="button" onClick={toggleNames} aria-pressed={showNames} className={ctl}>
            {showNames ? "Names on" : "Names off"}
          </button>
          <button type="button" onClick={toggleChime} aria-pressed={chimeOn} className={ctl}>
            {chimeOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            {chimeOn ? "Chime on" : "Chime off"}
          </button>
          <button type="button" onClick={toggleFullscreen} className={ctl}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {fullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      {isLoading && !hasData ? (
        <div className="flex flex-1 items-center justify-center text-3xl font-bold text-neutral-400">
          Loading orders...
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 landscape:flex-row sm:gap-5">
          <Column title="Preparing" entries={preparing} tone="preparing" showNames={showNames} highlighted={highlighted} testId="board-preparing" />
          <Column title="Ready for collection" entries={ready} tone="ready" showNames={showNames} highlighted={highlighted} testId="board-ready" />
        </div>
      )}
    </div>
  );
}
