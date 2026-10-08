import { db } from "./db";
import { uid } from "./presets";
import type { Asset, AssetKind } from "./types";

const urls = new Map<string, string>();
const assets = new Map<string, Asset>();

export async function loadAsset(id: string) {
  let a = assets.get(id);
  if (!a) {
    a = await db.asset(id);
    if (a) assets.set(id, a);
  }
  return a;
}

export function assetUrl(a: Asset) {
  let u = urls.get(a.id);
  if (!u) {
    u = URL.createObjectURL(a.blob);
    urls.set(a.id, u);
  }
  return u;
}

export const cachedAsset = (id: string) => assets.get(id);

function waitFor(el: HTMLMediaElement, ev: string) {
  return new Promise<void>((resolve, reject) => {
    el.addEventListener(ev, () => resolve(), { once: true });
    el.addEventListener("error", () => reject(new Error("Unsupported media")), { once: true });
  });
}

async function thumbFrom(src: CanvasImageSource, w: number, h: number) {
  const c = document.createElement("canvas");
  const s = 160 / Math.max(w, h);
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return new Promise<Blob | undefined>((r) => c.toBlob((b) => r(b ?? undefined), "image/jpeg", 0.7));
}

/** Reads an imported file, captures a thumbnail and stores it in IndexedDB. */
export async function importFile(file: File): Promise<Asset> {
  const kind: AssetKind = file.type.startsWith("image") ? "image" : file.type.startsWith("audio") ? "audio" : "video";
  const a: Asset = { id: uid(), name: file.name, kind, blob: file, duration: 3, w: 0, h: 0, added: Date.now() };
  const url = URL.createObjectURL(file);
  try {
    if (kind === "image") {
      const img = new Image();
      img.src = url;
      await img.decode();
      a.w = img.naturalWidth;
      a.h = img.naturalHeight;
      a.duration = 3;
      a.thumb = await thumbFrom(img, a.w, a.h);
    } else if (kind === "audio") {
      const el = new Audio();
      el.preload = "metadata";
      el.src = url;
      await waitFor(el, "loadedmetadata");
      a.duration = el.duration;
    } else {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.src = url;
      await waitFor(v, "loadeddata");
      a.duration = v.duration;
      a.w = v.videoWidth;
      a.h = v.videoHeight;
      v.currentTime = Math.min(0.2, a.duration / 2);
      await waitFor(v, "seeked");
      a.thumb = await thumbFrom(v, a.w, a.h);
      v.removeAttribute("src");
      v.load();
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  if (!isFinite(a.duration) || a.duration <= 0) a.duration = 3;
  await db.saveAsset(a);
  assets.set(a.id, a);
  return a;
}

const pcmCache = new Map<string, Promise<Float32Array>>();
export const PCM_RATE = 16000;

/** Mono 16 kHz PCM of an asset's audio track (empty if it has none). Used by auto-cut and captions. */
export function pcm16k(id: string): Promise<Float32Array> {
  let p = pcmCache.get(id);
  if (!p) {
    p = (async () => {
      const a = await loadAsset(id);
      if (!a || a.kind === "image") return new Float32Array(0);
      const bytes = await a.blob.arrayBuffer();
      const ctx = new OfflineAudioContext(1, PCM_RATE, PCM_RATE);
      try {
        const buf = await ctx.decodeAudioData(bytes);
        if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
        const out = new Float32Array(buf.length);
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
        }
        return out;
      } catch {
        return new Float32Array(0);
      }
    })();
    pcmCache.set(id, p);
  }
  return p;
}

export async function thumbUrl(a: Asset) {
  if (!a.thumb) return "";
  const key = a.id + ":thumb";
  let u = urls.get(key);
  if (!u) {
    u = URL.createObjectURL(a.thumb);
    urls.set(key, u);
  }
  return u;
}
