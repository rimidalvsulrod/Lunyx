// On-device AI: person segmentation (MediaPipe) and speech-to-text (Whisper via transformers.js).
// Both libraries load from a CDN at runtime, then the service worker / browser cache keeps them offline.

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/";
const SEG_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

// Bypass the bundler: these are plain ES modules from the CDN.
const dynImport = new Function("u", "return import(u)") as (u: string) => Promise<Record<string, unknown>>;

export type SegMask = { mask: Uint8Array; w: number; h: number };

/** Finds the person in a frame. Runs in a worker; `run` never blocks, it hands back the
 *  newest finished mask (once) and queues the next frame when the worker is free. */
export class PersonSegmenter {
  private w: Worker | null = null;
  private starting: Promise<void> | null = null;
  private busy = false;
  private fresh: SegMask | null = null;
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d", { willReadFrequently: false })!;
  failed = false;
  ready = false;
  private lastKey = -2;
  /** Called when a new mask arrives (so a paused preview can redraw). */
  onMask: () => void = () => {};

  load() {
    this.starting ??= new Promise<void>((resolve) => {
      try {
        const w = new Worker("/seg-worker.js");
        this.w = w;
        w.onmessage = (e) => {
          const d = e.data;
          if (d.type === "ready") { this.ready = true; resolve(); }
          else if (d.type === "mask") {
            this.busy = false;
            if (!d.empty) { this.fresh = { mask: d.mask, w: d.w, h: d.h }; this.onMask(); }
          } else if (d.type === "error") {
            this.busy = false;
            if (!this.ready) { this.failed = true; resolve(); }
            console.warn("Segmentation:", d.error);
          }
        };
        w.onerror = () => { this.failed = true; resolve(); };
        w.postMessage({ type: "init" });
      } catch {
        this.failed = true;
        resolve();
      }
    });
    return this.starting;
  }

  /** Sends this frame for analysis if the worker is free; returns a finished mask if one arrived. */
  run(src: CanvasImageSource, w: number, h: number, key = -1): SegMask | null {
    if (!this.w) { this.load(); return null; }
    // key >= 0 (paused preview): analyse each moment once, so a redraw doesn't loop.
    if (this.ready && !this.busy && (key < 0 || key !== this.lastKey)) {
      this.lastKey = key;
      const s = 256 / Math.max(w, h);
      const sw = Math.max(16, Math.round(w * s));
      const sh = Math.max(16, Math.round(h * s));
      if (this.canvas.width !== sw || this.canvas.height !== sh) { this.canvas.width = sw; this.canvas.height = sh; }
      this.ctx.drawImage(src, 0, 0, sw, sh);
      this.busy = true;
      createImageBitmap(this.canvas)
        .then((bitmap) => this.w!.postMessage({ type: "frame", bitmap, w: sw, h: sh, t: performance.now() }, [bitmap]))
        .catch(() => { this.busy = false; });
    }
    const f = this.fresh;
    this.fresh = null;
    return f;
  }
}

let worker: Worker | null = null;
let seq = 0;

export const ASR_MODELS = [
  { id: "Xenova/whisper-tiny.en", name: "English · fast (40 MB)", multi: false },
  { id: "Xenova/whisper-base.en", name: "English · accurate (80 MB)", multi: false },
  { id: "Xenova/whisper-tiny", name: "Any language (40 MB)", multi: true },
];

export type AsrChunk = { text: string; timestamp: [number, number | null] };

/** Transcribes 16 kHz mono PCM in a worker. `onStatus` gets download / progress text.
 *  With an empty `pcm` it only downloads + caches the model (offline pack). */
export function transcribe(pcm: Float32Array, modelId: string, onStatus: (s: string) => void): Promise<AsrChunk[]> {
  if (!worker) worker = new Worker("/asr-worker.js", { type: "module" });
  const id = ++seq;
  const model = ASR_MODELS.find((m) => m.id === modelId) ?? ASR_MODELS[0];
  return new Promise((resolve, reject) => {
    const w = worker!;
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d.id !== id) return;
      if (d.progress != null) onStatus(`Downloading model ${Math.round(d.progress)}%`);
      else if (d.stage) onStatus("Transcribing…");
      else {
        w.removeEventListener("message", onMsg);
        if (d.error) reject(new Error(d.error));
        else resolve(d.result);
      }
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ id, model: model.id, multilingual: model.multi, pcm, warm: !pcm.length });
  });
}
