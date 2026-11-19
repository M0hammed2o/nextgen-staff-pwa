/**
 * Keyboard-wedge scanner detection. USB/Bluetooth scanners type the code as
 * very fast keystrokes terminated by Enter; a person types slower. Pure so it
 * is unit-testable; Pos wires it to a window keydown listener.
 */
export const WEDGE_MAX_GAP_MS = 50;
export const WEDGE_MIN_LENGTH = 4;

export interface KeyEvt {
  key: string;
  t: number;
}

export interface WedgeState {
  buffer: string;
  lastT: number | null;
  /** true while every gap so far was scanner-fast */
  fast: boolean;
}

export const emptyWedge = (): WedgeState => ({ buffer: "", lastT: null, fast: true });

export type WedgeStep = { state: WedgeState; scan?: string };

/** Feed one keydown. Returns the next state and, on Enter, a scan if one was detected. */
export function wedgeStep(
  state: WedgeState,
  e: KeyEvt,
  maxGapMs = WEDGE_MAX_GAP_MS,
  minLength = WEDGE_MIN_LENGTH,
): WedgeStep {
  if (e.key === "Enter") {
    const scan = state.fast && state.buffer.length >= minLength ? state.buffer : undefined;
    return { state: emptyWedge(), scan };
  }
  if (e.key.length !== 1) return { state }; // Shift, Tab, arrows...: ignore
  const gap = state.lastT === null ? 0 : e.t - state.lastT;
  if (state.lastT !== null && gap > maxGapMs) {
    // A slow gap restarts the buffer: this key may begin a burst.
    return { state: { buffer: e.key, lastT: e.t, fast: true } };
  }
  return { state: { buffer: state.buffer + e.key, lastT: e.t, fast: state.fast } };
}

/** Convenience for tests: run a whole sequence, return every scan produced. */
export function detectScans(events: KeyEvt[], maxGapMs = WEDGE_MAX_GAP_MS, minLength = WEDGE_MIN_LENGTH): string[] {
  let s = emptyWedge();
  const out: string[] = [];
  for (const e of events) {
    const r = wedgeStep(s, e, maxGapMs, minLength);
    s = r.state;
    if (r.scan) out.push(r.scan);
  }
  return out;
}

/** BarcodeDetector exists only in some Chromium builds; always feature-detect. */
export function cameraScanSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
}
