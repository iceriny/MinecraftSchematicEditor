/**
 * Remembers the last resource pack in IndexedDB.
 *
 * The raw zip bytes are stored rather than the unpacked assets: re-reading a
 * zip is fast, and it keeps one blob to invalidate instead of three maps to
 * keep in sync. Nothing leaves the browser.
 */

const DB_NAME = "schematic-editor";
const DB_VERSION = 1;
const STORE = "packs";
const KEY = "current";

export interface CachedPack {
  name: string;
  bytes: ArrayBuffer;
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

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
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
 * Storage is a convenience, never a requirement — private windows and denied
 * quota both surface as a rejected request, and the app carries on without it.
 */
export async function readCachedPack(): Promise<CachedPack | null> {
  try {
    return (await run<CachedPack | undefined>("readonly", (store) => store.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function writeCachedPack(name: string, bytes: Uint8Array): Promise<void> {
  try {
    const copy = bytes.slice().buffer as ArrayBuffer;
    await run("readwrite", (store) =>
      store.put({ name, bytes: copy, savedAt: Date.now() } satisfies CachedPack, KEY),
    );
  } catch {
    // Out of quota or storage denied; the pack still works for this session.
  }
}

export async function clearCachedPack(): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(KEY));
  } catch {
    // Nothing cached, or storage unavailable.
  }
}

/* ---------------------------------------------------------------- mod jars */

/**
 * Mod jars live in the same store under a `mod:` prefix, one record each.
 * Separate records rather than one bundle: mods are added and dropped one at a
 * time, and rewriting a 200 MB blob to remove a 20 MB jar would be absurd.
 */
const MOD_PREFIX = "mod:";

export async function readCachedMods(): Promise<CachedPack[]> {
  try {
    const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
    const modKeys = keys.filter(
      (key): key is string => typeof key === "string" && key.startsWith(MOD_PREFIX),
    );
    const mods: CachedPack[] = [];
    for (const key of modKeys) {
      const entry = await run<CachedPack | undefined>("readonly", (store) => store.get(key));
      if (entry) mods.push(entry);
    }
    // Oldest first, so re-layering reproduces the order they were added in.
    return mods.sort((a, b) => a.savedAt - b.savedAt);
  } catch {
    return [];
  }
}

export async function writeCachedMod(name: string, bytes: Uint8Array): Promise<void> {
  try {
    const copy = bytes.slice().buffer as ArrayBuffer;
    await run("readwrite", (store) =>
      store.put({ name, bytes: copy, savedAt: Date.now() } satisfies CachedPack, MOD_PREFIX + name),
    );
  } catch {
    // Out of quota; the mod still works for this session.
  }
}

export async function deleteCachedMod(name: string): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(MOD_PREFIX + name));
  } catch {
    // Nothing cached, or storage unavailable.
  }
}

export async function clearCachedMods(): Promise<void> {
  try {
    const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
    for (const key of keys) {
      if (typeof key === "string" && key.startsWith(MOD_PREFIX)) {
        await run("readwrite", (store) => store.delete(key));
      }
    }
  } catch {
    // Nothing cached, or storage unavailable.
  }
}

/* -------------------------------------------------------------- opt-out */

const OPT_OUT = "schematic-editor:no-auto-pack";

/**
 * Unloading a pack has to survive a reload, or the startup probe would just
 * find the same install again and undo it.
 */
export function isAutoLoadDisabled(): boolean {
  try {
    return localStorage.getItem(OPT_OUT) === "1";
  } catch {
    return false;
  }
}

export function setAutoLoadDisabled(disabled: boolean): void {
  try {
    if (disabled) localStorage.setItem(OPT_OUT, "1");
    else localStorage.removeItem(OPT_OUT);
  } catch {
    // Storage denied; the choice just won't outlive this session.
  }
}
