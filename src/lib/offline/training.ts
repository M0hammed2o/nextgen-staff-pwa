/**
 * Training ("demo") mode: the till runs entirely locally.
 *
 * Training sales live in memory only (never IndexedDB, never localStorage,
 * never the network). Only the on/off flag is remembered (sessionStorage via
 * safe-storage) so an accidental refresh does not silently drop the cashier
 * back into real trading while a trainee thinks they are practising... or
 * the reverse. Exiting clears every training sale.
 */
import { useSyncExternalStore } from "react";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/safe-storage";
import type { SnapshotLine } from "./types";

const FLAG_KEY = "nextgen_staff_training_mode";

export interface TrainingSale {
  ref: string;
  created_at: string;
  total_cents: number;
  cash_tendered_cents: number | null;
  change_due_cents: number | null;
  lines: SnapshotLine[];
}

interface State {
  active: boolean;
  sales: TrainingSale[];
}

let state: State = { active: safeGetItem(FLAG_KEY) === "1", sales: [] };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export const trainingStore = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setActive(active: boolean) {
    if (active) safeSetItem(FLAG_KEY, "1");
    else safeRemoveItem(FLAG_KEY);
    // Entering OR leaving starts from a clean slate: no training data survives either way.
    set({ active, sales: [] });
  },
  addSale(input: Omit<TrainingSale, "ref" | "created_at">): TrainingSale {
    const sale: TrainingSale = {
      ...input,
      ref: `TRAIN-${String(state.sales.length + 1).padStart(3, "0")}`,
      created_at: new Date().toISOString(),
    };
    set({ ...state, sales: [...state.sales, sale] });
    return sale;
  },
  reset() {
    safeRemoveItem(FLAG_KEY);
    set({ active: false, sales: [] });
  },
};

export function useTrainingMode() {
  const s = useSyncExternalStore(trainingStore.subscribe, trainingStore.get, trainingStore.get);
  return {
    active: s.active,
    sales: s.sales,
    setActive: trainingStore.setActive,
    addSale: trainingStore.addSale,
  };
}

export function canToggleTraining(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "MANAGER";
}
