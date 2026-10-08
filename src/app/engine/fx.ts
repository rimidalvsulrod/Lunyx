// Thin wrapper around the Rust effects engine (editor-fx/, built to public/cut/fx.wasm).

type Exports = {
  memory: WebAssembly.Memory;
  setup(w: number, h: number): void;
  ptr_a(): number;
  ptr_b(): number;
  ptr_bg(): number;
  ptr_mask(): number;
  ptr_params(): number;
  ptr_smask(n: number): number;
  ptr_audio(n: number): number;
  ptr_out(): number;
  set_mask(sw: number, sh: number, smooth: number): void;
  process(layer: number, time: number, hasMask: number): void;
  transition(kind: number, t: number): void;
  copy_a_to_b(): void;
  blur_a(r: number): void;
  silence(n: number, sr: number, thresh: number, minSil: number, pad: number, minKeep: number): number;
  peaks(n: number, buckets: number): void;
  rms_db(n: number): number;
};

export class Fx {
  w = 0;
  h = 0;
  constructor(private ex: Exports) {}

  static async load() {
    const res = await fetch("/cut/fx.wasm");
    const bytes = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new Fx(instance.exports as unknown as Exports);
  }

  private get buf() {
    return this.ex.memory.buffer;
  }

  setup(w: number, h: number) {
    this.ex.setup(w, h);
    this.w = w;
    this.h = h;
  }

  /** RGBA view over buffer A (or B). Re-created each call because memory can grow. */
  pixels(layer: 0 | 1 | 2) {
    const p = layer === 0 ? this.ex.ptr_a() : layer === 1 ? this.ex.ptr_b() : this.ex.ptr_bg();
    return new Uint8ClampedArray(this.buf, p, this.w * this.h * 4);
  }

  imageData() {
    return new ImageData(this.pixels(0), this.w, this.h);
  }

  params() {
    return new Float32Array(this.buf, this.ex.ptr_params(), 96);
  }

  setMask(small: Float32Array | Uint8Array, sw: number, sh: number, smooth = 0.35) {
    const p = this.ex.ptr_smask(sw * sh);
    const dst = new Uint8Array(this.buf, p, sw * sh);
    if (small instanceof Uint8Array) dst.set(small);
    else for (let i = 0; i < small.length; i++) dst[i] = small[i] * 255;
    this.ex.set_mask(sw, sh, smooth);
  }

  clearMask() {
    new Uint8Array(this.buf, this.ex.ptr_mask(), this.w * this.h).fill(255);
  }

  process(layer: 0 | 1, time: number, hasMask: boolean) {
    this.ex.process(layer, time, hasMask ? 1 : 0);
  }

  transition(kind: number, t: number) {
    this.ex.transition(kind, t);
  }

  copyAtoB() {
    this.ex.copy_a_to_b();
  }

  private loadAudio(pcm: Float32Array) {
    const p = this.ex.ptr_audio(pcm.length);
    new Float32Array(this.buf, p, pcm.length).set(pcm);
  }

  /** Keep-ranges (seconds, relative to the PCM start) with silences removed. */
  silence(pcm: Float32Array, sr: number, threshDb: number, minSil: number, pad: number, minKeep: number) {
    this.loadAudio(pcm);
    const n = this.ex.silence(pcm.length, sr, threshDb, minSil, pad, minKeep);
    const out = new Float32Array(this.buf, this.ex.ptr_out(), 1 + n * 2);
    const ranges: [number, number][] = [];
    for (let i = 0; i < n; i++) ranges.push([out[1 + i * 2], out[2 + i * 2]]);
    return { thresh: out[0], ranges };
  }

  peaks(pcm: Float32Array, buckets: number) {
    this.loadAudio(pcm);
    this.ex.peaks(pcm.length, buckets);
    return Array.from(new Float32Array(this.buf, this.ex.ptr_out(), buckets));
  }

  rmsDb(pcm: Float32Array) {
    this.loadAudio(pcm);
    return this.ex.rms_db(pcm.length);
  }
}

let shared: Promise<Fx> | null = null;
export const getFx = () => (shared ??= Fx.load());
