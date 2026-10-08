// Lunyx speech-to-text worker (Whisper via transformers.js). Same-origin so the
// offline service worker controls it and its downloads stay cached on the device.
const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
let asr = null, cur = "";

self.onmessage = async (e) => {
  const { id, model, pcm, multilingual, warm } = e.data;
  try {
    const T = await import(TRANSFORMERS);
    T.env.allowLocalModels = false;
    if (!asr || cur !== model) {
      asr = await T.pipeline("automatic-speech-recognition", model, {
        dtype: "q8", device: "wasm",
        progress_callback: (p) => { if (p.status === "progress") self.postMessage({ id, progress: p.progress, file: p.file }); },
      });
      cur = model;
    }
    if (warm) return self.postMessage({ id, result: [] });
    self.postMessage({ id, stage: "transcribing" });
    const base = { chunk_length_s: 30, stride_length_s: 5 };
    if (multilingual) base.task = "transcribe";
    let out;
    try { out = await asr(pcm, { ...base, return_timestamps: "word" }); }
    catch { out = await asr(pcm, { ...base, return_timestamps: true }); }
    self.postMessage({ id, result: out.chunks || [{ text: out.text, timestamp: [0, pcm.length / 16000] }] });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
