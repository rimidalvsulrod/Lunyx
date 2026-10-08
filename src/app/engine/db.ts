// IndexedDB storage: every project, media file and transcript lives in this browser only.
import type { Asset, Project } from "./types";

const DB = "lunyx";
let dbp: Promise<IDBDatabase> | null = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("projects", { keyPath: "id" });
        db.createObjectStore("assets", { keyPath: "id" });
        db.createObjectStore("kv");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  projects: () => run<Project[]>("projects", "readonly", (s) => s.getAll()),
  project: (id: string) => run<Project | undefined>("projects", "readonly", (s) => s.get(id)),
  saveProject: (p: Project) => run("projects", "readwrite", (s) => s.put(p)),
  deleteProject: (id: string) => run("projects", "readwrite", (s) => s.delete(id)),
  asset: (id: string) => run<Asset | undefined>("assets", "readonly", (s) => s.get(id)),
  saveAsset: (a: Asset) => run("assets", "readwrite", (s) => s.put(a)),
  deleteAsset: (id: string) => run("assets", "readwrite", (s) => s.delete(id)),
  assetIds: () => run<string[]>("assets", "readonly", (s) => s.getAllKeys()),
  get: <T>(k: string) => run<T | undefined>("kv", "readonly", (s) => s.get(k)),
  set: (k: string, v: unknown) => run("kv", "readwrite", (s) => s.put(v, k)),
};

/** Asks the browser not to evict our data, and reports usage. */
export async function storageInfo() {
  try {
    await navigator.storage?.persist?.();
    const est = await navigator.storage?.estimate?.();
    return { used: est?.usage ?? 0, quota: est?.quota ?? 0 };
  } catch {
    return { used: 0, quota: 0 };
  }
}

/** Removes media no project references any more. */
export async function collectGarbage() {
  const [projects, ids] = await Promise.all([db.projects(), db.assetIds()]);
  const used = new Set<string>();
  for (const p of projects) {
    p.clips.forEach((c) => { used.add(c.assetId); if (c.look.bg.imageId) used.add(c.look.bg.imageId); });
    p.music.forEach((m) => used.add(m.assetId));
  }
  await Promise.all(ids.filter((id) => !used.has(id)).map((id) => db.deleteAsset(id)));
}
