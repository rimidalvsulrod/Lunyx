// On-device AI: person segmentation (MediaPipe) and speech-to-text (Whisper via transformers.js).
// Both libraries load from a CDN at runtime, then the service worker / browser cache keeps them offline.

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/";
const SEG_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

// Bypass the bundler: these are plain ES modules from the CDN.
const dynImport = new Function("u", "return import(u)") as (u: string) => Promise<Record<string, unknown>>;

type Mask = { getAsFloat32Array(): Float32Array; close(): void };
type SegResult = { confidenceMasks?: Mask[]; close?: () => void };
type Segmenter = { segmentForVideo(src: CanvasImageSource, ts: number): SegResult };

export class PersonSegmenter {
  private seg: Segmenter | null = null;
  private loading: Promise<void> | null = null;
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  private lastTs = 0;
  failed = false;

  load() {
    this.loading ??= (async () => {
      try {
        const vision = (await dynImport(VISION + "vision_bundle.mjs")) as {
          FilesetResolver: { forVisionTasks(p: string): Promise<unknown> };
          ImageSegmenter: { createFromOptions(f: unknown, o: unknown): Promise<Segmenter> };
        };
        const files = await vision.FilesetResolver.forVisionTasks(VISION + "wasm");
        const make = (delegate: "GPU" | "CPU") =>
          vision.ImageSegmenter.createFromOptions(files, {
            baseOptions: { modelAssetPath: SEG_MODEL, delegate },
            runningMode: "VIDEO",
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          });
        try {
          this.seg = await make("GPU");
        } catch {
          this.seg = await make("CPU");
        }
      } catch (e) {
        this.failed = true;
        console.warn("Segmentation unavailable", e);
      }
    })();
    return this.loading;
  }

  get ready() {
    return !!this.seg;
  }

  /** Returns a small person-confidence mask for the frame, or null if not ready. */
  run(src: CanvasImageSource, w: number, h: number): { mask: Float32Array; w: number; h: number } | null {
    if (!this.seg) {
      if (!this.failed) this.load();
      return null;
    }
    const s = 256 / Math.max(w, h);
    const sw = Math.max(16, Math.round(w * s));
    const sh = Math.max(16, Math.round(h * s));
    if (this.canvas.width !== sw || this.canvas.height !== sh) {
      this.canvas.width = sw;
      this.canvas.height = sh;
    }
    this.ctx.drawImage(src, 0, 0, sw, sh);
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    try {
      const r = this.seg.segmentForVideo(this.canvas, ts);
      const m = r.confidenceMasks?.[0];
      if (!m) return null;
      const mask = m.getAsFloat32Array().slice();
      r.close?.();
      return { mask, w: sw, h: sh };
    } catch {
      return null;
    }
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
