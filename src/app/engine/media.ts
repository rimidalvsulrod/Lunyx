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

/** Resolves on `ev`, rejects on error, and never hangs (iOS often skips events). */
function waitFor(el: HTMLMediaElement, ev: string, ms = 8000) {
  return new Promise<boolean>((resolve, reject) => {
    const t = setTimeout(() => resolve(false), ms);
    el.addEventListener(ev, () => { clearTimeout(t); resolve(true); }, { once: true });
    el.addEventListener("error", () => { clearTimeout(t); reject(new Error("This format can't be played on this device")); }, { once: true });
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

const VIDEO_EXT = /\.(mp4|m4v|mov|qt|webm|mkv|avi|3gp|hevc)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aif|aiff|caf|ogg|oga|opus|flac|weba)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i;

export function kindOf(file: File): AssetKind {
  const t = file.type;
  if (t.startsWith("image") || (!t && IMAGE_EXT.test(file.name))) return "image";
  if (t.startsWith("audio") || (!t && AUDIO_EXT.test(file.name))) return "audio";
  if (t.startsWith("video") || VIDEO_EXT.test(file.name)) return "video";
  return AUDIO_EXT.test(file.name) ? "audio" : IMAGE_EXT.test(file.name) ? "image" : "video";
}

/** Reads metadata + a thumbnail from a video without needing it to fully load. */
async function probeVideo(url: string, a: Asset) {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.preload = "metadata";
  // iOS only decodes videos that are in the document.
  v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none";
  document.body.appendChild(v);
  try {
    v.src = url;
    v.load();
    if (!(await waitFor(v, "loadedmetadata", 15000)) && !v.duration) throw new Error("Couldn't read this video");
    a.duration = v.duration;
    a.w = v.videoWidth;
    a.h = v.videoHeight;
    // Thumbnail is best effort: seek a little in, nudge iOS with a muted play if needed.
    v.currentTime = Math.min(0.15, (a.duration || 1) / 2);
    await waitFor(v, "seeked", 3000).catch(() => false);
    if (v.readyState < 2) {
      await v.play().catch(() => {});
      await waitFor(v, "timeupdate", 2000).catch(() => false);
      v.pause();
    }
    if (v.readyState >= 2 && v.videoWidth) a.thumb = await thumbFrom(v, v.videoWidth, v.videoHeight);
  } finally {
    v.removeAttribute("src");
    v.load();
    v.remove();
  }
}

/** Reads an imported file, captures a thumbnail and stores it on the device (IndexedDB). */
export async function importFile(file: File, extra?: Partial<Asset>): Promise<Asset> {
  const kind = kindOf(file);
  const a: Asset = { id: uid(), name: file.name, kind, blob: file, duration: 3, w: 0, h: 0, added: Date.now(), ...extra };
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
      if (!(await waitFor(el, "loadedmetadata", 15000))) throw new Error("Couldn't read this audio file");
      a.duration = el.duration;
    } else {
      await probeVideo(url, a);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  if (!isFinite(a.duration) || a.duration <= 0) a.duration = 3;
  try {
    await db.saveAsset(a);
  } catch (e) {
    const name = (e as DOMException)?.name;
    throw new Error(name === "QuotaExceededError" ? "Not enough storage on this device for this file" : "Couldn't save this file on the device");
  }
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
