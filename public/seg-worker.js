// Lunyx person-cutout worker. Runs MediaPipe segmentation off the main thread so the
// preview never waits for it. Classic worker (MediaPipe needs importScripts here).
const BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/";
const MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
let seg = null, ts = 0;

async function init() {
  // The CDN serves .cjs as application/node, which importScripts refuses: fetch and evaluate it.
  const code = await (await fetch(BASE + "vision_bundle.cjs")).text();
  const v = {};
  new Function("exports", "module", code)(v, { exports: v });
  const files = await v.FilesetResolver.forVisionTasks(BASE + "wasm");
  const make = (delegate) => v.ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: "VIDEO", outputCategoryMask: false, outputConfidenceMasks: true,
  });
  try { seg = await make("GPU"); } catch { seg = await make("CPU"); }
}

self.onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.type === "init") {
      await init();
      self.postMessage({ type: "ready" });
    } else if (d.type === "frame") {
      ts = Math.max(ts + 1, Math.round(d.t));
      const r = seg.segmentForVideo(d.bitmap, ts);
      d.bitmap.close();
      const m = r.confidenceMasks && r.confidenceMasks[0];
      if (!m) return self.postMessage({ type: "mask", empty: true });
      const f = m.getAsFloat32Array();
      const u8 = new Uint8Array(f.length);
      for (let i = 0; i < f.length; i++) u8[i] = f[i] * 255;
      if (r.close) r.close();
      self.postMessage({ type: "mask", mask: u8, w: d.w, h: d.h }, [u8.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", error: String((err && err.message) || err) });
  }
};
