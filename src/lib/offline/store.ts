/**
 * Storage adapter for the offline sale queue.
 *
 * Two implementations behind one interface:
 *  - IndexedDbStore: the real thing (native IndexedDB, no dependency).
 *  - MemoryStore: for tests and as the "restart" simulator (two queue
 *    instances over one MemoryStore behave like a reload over one database).
 *
 * localStorage is deliberately NOT used for queued sales: it is synchronous,
 * ~5 MB, string-only, and cannot hold a non-extractable CryptoKey.
 */
import type { QueueEntry } from "./types";

export interface OfflineStore {
  getAllEntries(): Promise<QueueEntry[]>;
  putEntry(entry: QueueEntry): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  clearEntries(): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  deleteMeta(key: string): Promise<void>;
  /** Atomically increments and returns the per-device sale counter. */
  nextSeq(): Promise<number>;
}

export const SEQ_META_KEY = "sale_seq";

// ── In-memory implementation ────────────────────────────────────────────────

export class MemoryStore implements OfflineStore {
  private entries = new Map<string, QueueEntry>();
  private meta = new Map<string, unknown>();

  async getAllEntries() {
    return Array.from(this.entries.values()).map((e) => ({ ...e }));
  }
  async putEntry(entry: QueueEntry) {
    this.entries.set(entry.id, { ...entry });
  }
  async deleteEntry(id: string) {
    this.entries.delete(id);
  }
  async clearEntries() {
    this.entries.clear();
  }
  async getMeta<T>(key: string) {
    return this.meta.get(key) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, value);
  }
  async deleteMeta(key: string) {
    this.meta.delete(key);
  }
  async nextSeq() {
    const next = ((this.meta.get(SEQ_META_KEY) as number | undefined) ?? 0) + 1;
    this.meta.set(SEQ_META_KEY, next);
    return next;
  }
}

// ── IndexedDB implementation ────────────────────────────────────────────────

const DB_NAME = "nextgen-staff-offline";
const DB_VERSION = 1;
const ENTRIES = "entries";
const META = "meta";

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class IndexedDbStore implements OfflineStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName: string = DB_NAME) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
          reject(new Error("IndexedDB is not available on this device"));
          return;
        }
        const open = indexedDB.open(this.dbName, DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: "id" });
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error("Could not open IndexedDB"));
      });
      // A failed open must be retryable later (e.g. after storage frees up).
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  async getAllEntries() {
    const db = await this.db();
    return reqToPromise<QueueEntry[]>(db.transaction(ENTRIES, "readonly").objectStore(ENTRIES).getAll());
  }
  async putEntry(entry: QueueEntry) {
    const db = await this.db();
    const tx = db.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).put(entry);
    await txDone(tx);
  }
  async deleteEntry(id: string) {
    const db = await this.db();
    const tx = db.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).delete(id);
    await txDone(tx);
  }
  async clearEntries() {
    const db = await this.db();
    const tx = db.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).clear();
    await txDone(tx);
  }
  async getMeta<T>(key: string) {
    const db = await this.db();
    return reqToPromise<T | undefined>(db.transaction(META, "readonly").objectStore(META).get(key));
  }
  async setMeta(key: string, value: unknown) {
    const db = await this.db();
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put(value, key);
    await txDone(tx);
  }
  async deleteMeta(key: string) {
    const db = await this.db();
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).delete(key);
    await txDone(tx);
  }
  async nextSeq() {
    const db = await this.db();
    const tx = db.transaction(META, "readwrite");
    const store = tx.objectStore(META);
    const current = (await reqToPromise<number | undefined>(store.get(SEQ_META_KEY))) ?? 0;
    const next = current + 1;
    store.put(next, SEQ_META_KEY);
    await txDone(tx);
    return next;
  }
}
