// Sound library: saved sounds live on the device; search finds Creative Commons
// music and effects (Openverse: Jamendo + Freesound) that can be downloaded straight into the app.
import { db } from "./db";

export type LibItem = { id: string; name: string; kind: "music" | "sfx"; duration: number; credit?: string; license?: string; added: number };

export const library = {
  list: async () => (await db.get<LibItem[]>("library")) ?? [],
  async add(item: LibItem) {
    const all = await library.list();
    await db.set("library", [item, ...all.filter((x) => x.id !== item.id)]);
  },
  async remove(id: string) {
    await db.set("library", (await library.list()).filter((x) => x.id !== id));
  },
};

export type Hit = { id: string; title: string; creator: string; license: string; duration: number; url: string; source: string };

export async function searchSounds(q: string, category: "music" | "sound_effect", page = 1): Promise<Hit[]> {
  const u = new URL("https://api.openverse.org/v1/audio/");
  u.searchParams.set("q", q);
  u.searchParams.set("page_size", "20");
  u.searchParams.set("page", String(page));
  u.searchParams.set("license_type", "commercial");
  u.searchParams.set("source", category === "music" ? "jamendo,freesound" : "freesound");
  if (category === "music") u.searchParams.set("category", "music");
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = (await res.json()) as { results: { id: string; title: string; creator: string; license: string; duration: number | null; url: string; source: string }[] };
  return data.results
    .filter((r) => r.url)
    .map((r) => ({ id: r.id, title: r.title, creator: r.creator, license: r.license, duration: (r.duration ?? 0) / 1000, url: r.url, source: r.source }));
}

/** Downloads a search result into a File the importer can store on the device. */
export async function downloadHit(h: Hit): Promise<File> {
  let res: Response;
  try {
    res = await fetch(h.url);
    if (!res.ok) throw new Error();
  } catch {
    // Some hosts block direct browser downloads; go through our small proxy instead.
    res = await fetch(`/api/audio?u=${encodeURIComponent(h.url)}`);
  }
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const type = blob.type.startsWith("audio") ? blob.type : "audio/mpeg";
  const ext = type.includes("wav") ? "wav" : type.includes("ogg") ? "ogg" : type.includes("mp4") || type.includes("m4a") ? "m4a" : "mp3";
  return new File([blob], `${h.title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 60)}.${ext}`, { type });
}

export const licenseName = (l: string) => (l === "cc0" ? "CC0 · no credit needed" : l === "pdm" ? "Public domain" : `CC ${l.toUpperCase()} · credit the creator`);
