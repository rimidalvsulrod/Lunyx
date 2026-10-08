// Install + offline support: service worker, "download for offline" pack, install prompt.
import { db } from "./db";
import { FONT_CSS } from "./presets";
import { PersonSegmenter, transcribe } from "./ai";

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let installEvent: InstallEvent | null = null;
const listeners = new Set<() => void>();

export function watchInstall(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as InstallEvent;
    listeners.forEach((f) => f());
  });
}

export const canPromptInstall = () => !!installEvent;
export async function promptInstall() {
  if (!installEvent) return false;
  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  return outcome === "accepted";
}

export const isStandalone = () =>
  typeof window !== "undefined" && (matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);

export const isIOS = () => typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Same-origin app files and fonts the page has already loaded. */
function loadedUrls() {
  const urls = new Set<string>(["/"]);
  for (const e of performance.getEntriesByType("resource")) {
    const u = new URL(e.name);
    if ((u.origin === location.origin && (u.pathname.startsWith("/_next/static/") || u.pathname.startsWith("/cut/"))) || u.hostname.startsWith("fonts.g")) urls.add(e.name);
  }
  return [...urls];
}

async function precache(urls: string[], onProgress?: (f: number) => void) {
  const reg = await navigator.serviceWorker?.ready;
  const sw = navigator.serviceWorker?.controller ?? reg?.active;
  if (!sw || !urls.length) return;
  await new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      if (e.data.progress != null) onProgress?.(e.data.progress);
      if (e.data.done) resolve();
    };
    sw.postMessage({ type: "precache", urls }, [ch.port2]);
    setTimeout(resolve, 120000);
  });
}

/** Registers the offline worker and keeps everything this visit loaded. */
export async function setupOffline() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.storage?.persist?.();
    await precache(loadedUrls());
  } catch {}
}

export type OfflinePack = { at: number; model: string };
export const offlineStatus = () => db.get<OfflinePack>("offlinePack");

/** Downloads everything the editor needs to run with no connection (fonts, cutout model, captions model). */
export async function downloadOfflinePack(model: string, onProgress: (f: number, label: string) => void) {
  onProgress(0.02, "App files");
  await precache(loadedUrls(), (f) => onProgress(0.02 + f * 0.08, "App files"));
  onProgress(0.1, "Fonts");
  const css = await (await fetch(FONT_CSS)).text();
  // Only the latin subsets: that's what captions and titles use.
  const fonts = [...css.matchAll(/\/\* latin \*\/[^}]*?url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
  await precache([FONT_CSS, ...new Set(fonts)], (f) => onProgress(0.1 + f * 0.3, "Fonts"));
  onProgress(0.4, "Background cutout");
  const seg = new PersonSegmenter();
  await seg.load();
  if (seg.failed) throw new Error("Couldn't download the cutout model");
  onProgress(0.5, "Captions model");
  await transcribe(new Float32Array(0), model, (s) => {
    const m = /(\d+)%/.exec(s);
    onProgress(0.5 + (m ? +m[1] / 100 : 0) * 0.5, "Captions model");
  });
  const pack = { at: Date.now(), model };
  await db.set("offlinePack", pack);
  onProgress(1, "Done");
  return pack;
}
