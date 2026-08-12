/**
 * Keeps the open build in IndexedDB so a reload, a crash or a stray Ctrl+W
 * doesn't cost an afternoon's editing.
 *
 * The blocks are stored raw rather than as a schematic file: writing one means
 * compacting the palette and gzipping a few megabytes, which is far too much to
 * do every few seconds. This is a scratch copy, not an export — saving a real
 * file is still an explicit act.
 *
 * It lives in its own database rather than beside the resource-pack cache so
 * the two never have to agree on a schema version.
 */

import { Build, type BlockState, type BuildMeta } from "./model";

const DB_NAME = "schematic-editor-session";
const DB_VERSION = 1;
const STORE = "session";
const KEY = "current";

export interface SessionSnapshot {
  fileName: string | null;
  width: number;
  height: number;
  length: number;
  palette: BlockState[];
  /** Palette indices, YZX order — `Build.data` verbatim. */
  data: ArrayBuffer;
  meta: BuildMeta;
  /** Non-air count, so the restore offer can describe the build without loading it. */
  blocks: number;
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

/**
 * Storage is a convenience, never a requirement: private windows and denied
 * quota both surface as a rejected request, and the editor carries on without
 * it. That is also why nothing here ever throws at the caller.
 */
export async function readSession(): Promise<SessionSnapshot | null> {
  try {
    return (await run<SessionSnapshot | undefined>("readonly", (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function writeSession(build: Build, fileName: string | null): Promise<void> {
  try {
    const snapshot: SessionSnapshot = {
      fileName,
      width: build.width,
      height: build.height,
      length: build.length,
      palette: build.palette.map((s) => ({
        name: s.name,
        properties: s.properties && { ...s.properties },
      })),
      data: build.data.slice().buffer as ArrayBuffer,
      meta: { ...build.meta },
      blocks: build.totalBlocks(),
      savedAt: Date.now(),
    };
    await run("readwrite", (store) => store.put(snapshot, KEY));
  } catch {
    // Out of quota or storage denied; this session just won't survive a reload.
  }
}

export async function clearSession(): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(KEY));
  } catch {
    // Nothing stored, or storage unavailable.
  }
}

export function buildFromSession(snapshot: SessionSnapshot): Build {
  return new Build(
    snapshot.width,
    snapshot.height,
    snapshot.length,
    snapshot.palette,
    new Uint16Array(snapshot.data),
    snapshot.meta,
  );
}

/** "3 minutes ago", for the restore offer. */
export function describeAge(savedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  if (seconds < 45) return "moments ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
