// On-device AI: person segmentation (MediaPipe) and speech-to-text (Whisper via transformers.js).
// Both libraries load from a CDN at runtime, then the service worker / browser cache keeps them offline.

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/";
const SEG_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";

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

const WORKER = `
let asr = null, cur = "";
self.onmessage = async (e) => {
  const { id, model, pcm, multilingual } = e.data;
  try {
    const T = await import("${TRANSFORMERS}");
    T.env.allowLocalModels = false;
    if (!asr || cur !== model) {
      asr = await T.pipeline("automatic-speech-recognition", model, {
        dtype: "q8", device: "wasm",
        progress_callback: (p) => { if (p.status === "progress") self.postMessage({ id, progress: p.progress, file: p.file }); },
      });
      cur = model;
    }
    self.postMessage({ id, stage: "transcribing" });
    const base = { chunk_length_s: 30, stride_length_s: 5 };
    if (multilingual) base.task = "transcribe";
    let out;
    try { out = await asr(pcm, { ...base, return_timestamps: "word" }); }
    catch { out = await asr(pcm, { ...base, return_timestamps: true }); }
    self.postMessage({ id, result: out.chunks || [{ text: out.text, timestamp: [0, pcm.length / 16000] }] });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};`;

let worker: Worker | null = null;
let seq = 0;

export const ASR_MODELS = [
  { id: "Xenova/whisper-tiny.en", name: "English · fast (40 MB)", multi: false },
  { id: "Xenova/whisper-base.en", name: "English · accurate (80 MB)", multi: false },
  { id: "Xenova/whisper-tiny", name: "Any language (40 MB)", multi: true },
];

export type AsrChunk = { text: string; timestamp: [number, number | null] };

/** Transcribes 16 kHz mono PCM in a worker. `onStatus` gets download / progress text. */
export function transcribe(pcm: Float32Array, modelId: string, onStatus: (s: string) => void): Promise<AsrChunk[]> {
  if (!worker) worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" })), { type: "module" });
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
    w.postMessage({ id, model: model.id, multilingual: model.multi, pcm });
  });
}
