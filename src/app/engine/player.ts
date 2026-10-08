// Timeline playback, compositing and export. Video frames go canvas -> Rust/WASM -> canvas;
// audio runs through a Web Audio graph (per-clip EQ, voice chain, fades, music ducking).
import { getFx, type Fx } from "./fx";
import { PersonSegmenter } from "./ai";
import { assetUrl, cachedAsset, loadAsset } from "./media";
import { EQ_BANDS, frameSize, layout, lookActive, lookParams, needsMask, clipLen } from "./presets";
import type { Clip, Project, TextItem } from "./types";

type Deck = {
  el: HTMLVideoElement;
  assetId: string | null;
  img: HTMLImageElement | null;
  pending: number | null;
  audioKey: string;
  src?: MediaElementAudioSourceNode;
  hp?: BiquadFilterNode;
  eq?: BiquadFilterNode[];
  comp?: DynamicsCompressorNode;
  gain?: GainNode;
};

type Music = { el: HTMLAudioElement; assetId: string; src?: MediaElementAudioSourceNode; gain?: GainNode; pending: number | null };

export type Box = { id: string; x: number; y: number; w: number; h: number };

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeBack = (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

export const PREVIEW_LONG = 854;

export class Player {
  ctx: CanvasRenderingContext2D;
  private work = document.createElement("canvas");
  private wctx = this.work.getContext("2d", { willReadFrequently: true })!;
  private workB = document.createElement("canvas");
  private bctx = this.workB.getContext("2d", { willReadFrequently: true })!;
  private tiny = document.createElement("canvas");
  private fx: Fx | null = null;
  seg = new PersonSegmenter();
  project!: Project;
  lay = { starts: [] as number[], trans: [] as number[], videoEnd: 0, end: 0 };
  time = 0;
  playing = false;
  exporting = false;
  w = 0;
  h = 0;
  long = PREVIEW_LONG;
  selectedText: string | null = null;
  showSafe = false;
  boxes: Box[] = [];
  onTime: (t: number) => void = () => {};
  onState: (playing: boolean) => void = () => {};
  onStatus: (s: string) => void = () => {};
  private decks: Deck[];
  private music = new Map<string, Music>();
  private images = new Map<string, HTMLImageElement>();
  private ac: AudioContext | null = null;
  private master?: GainNode;
  private monitor?: GainNode;
  private dest?: MediaStreamAudioDestinationNode;
  private raf = 0;
  private renderQueued = false;
  private t0 = 0;
  private T0 = 0;
  private bgKey = "";
  private fontWait = new Set<string>();
  private hadMask = false;
  private endResolve: (() => void) | null = null;
  private preroll = false;
  private blessed = new WeakSet<HTMLMediaElement>();

  canvas = document.createElement("canvas");
  private host = document.createElement("div");

  constructor() {
    this.ctx = this.canvas.getContext("2d")!;
    // Media elements live off-screen in the document (iOS won't decode detached videos).
    this.host.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;overflow:hidden;pointer-events:none";
    document.body.appendChild(this.host);
    this.decks = [0, 1].map(() => this.makeDeck());
    getFx().then((fx) => {
      this.fx = fx;
      if (this.w) fx.setup(this.w, this.h);
      this.requestRender();
    });
  }

  private makeDeck(): Deck {
    const el = document.createElement("video");
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.preload = "auto";
    this.host.appendChild(el);
    const d: Deck = { el, assetId: null, img: null, pending: null, audioKey: "" };
    el.addEventListener("seeked", () => {
      if (d.pending != null) {
        const t = d.pending;
        d.pending = null;
        el.currentTime = t;
      } else if (!this.playing) this.requestRender();
    });
    el.addEventListener("loadeddata", () => !this.playing && this.requestRender());
    return d;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.playing = false;
    for (const d of this.decks) { d.el.pause(); d.el.removeAttribute("src"); d.el.load(); d.el.remove(); }
    for (const m of this.music.values()) { m.el.pause(); m.el.remove(); }
    this.host.remove();
    this.ac?.close();
  }

  // ------------------------------------------------------------ project

  setProject(p: Project) {
    const aspectChanged = !this.project || this.project.aspect !== p.aspect;
    this.project = p;
    this.lay = layout(p);
    if (aspectChanged && !this.exporting) this.resize(PREVIEW_LONG);
    const ids = new Set<string>([...p.clips.map((c) => c.assetId), ...p.music.map((m) => m.assetId)]);
    p.clips.forEach((c) => c.look.bg.imageId && ids.add(c.look.bg.imageId));
    Promise.all([...ids].filter((id) => !cachedAsset(id)).map(loadAsset)).then((got) => got.length && this.requestRender());
    for (const [id, m] of this.music) if (!p.music.some((x) => x.id === id)) { m.el.pause(); m.el.remove(); this.music.delete(id); }
    for (const d of this.decks) d.audioKey = "";
    this.time = clamp(this.time, 0, this.lay.end);
    if (!this.playing) this.seek(this.time);
  }

  /** Binds the on-screen canvas. */
  attach(canvas: HTMLCanvasElement) {
    if (canvas === this.canvas) return;
    canvas.width = this.w || 300;
    canvas.height = this.h || 150;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.requestRender();
  }

  resize(long: number) {
    const [w, h] = frameSize(this.project?.aspect ?? "9:16", long);
    this.long = long;
    this.w = w;
    this.h = h;
    for (const c of [this.canvas, this.work, this.workB]) { c.width = w; c.height = h; }
    this.fx?.setup(w, h);
    this.bgKey = "";
    this.hadMask = false;
  }

  // ------------------------------------------------------------ audio

  ensureAudio() {
    if (this.ac) {
      if (this.ac.state !== "running") this.ac.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC({ latencyHint: "interactive" });
    this.ac = ac;
    this.master = ac.createGain();
    this.monitor = ac.createGain();
    this.dest = ac.createMediaStreamDestination();
    this.master.connect(this.monitor).connect(ac.destination);
    this.master.connect(this.dest);
    for (const d of this.decks) {
      d.src = ac.createMediaElementSource(d.el);
      d.hp = ac.createBiquadFilter();
      d.hp.type = "highpass";
      d.hp.frequency.value = 20;
      d.eq = EQ_BANDS.map((f, i) => {
        const b = ac.createBiquadFilter();
        b.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
        b.frequency.value = f;
        b.Q.value = 1;
        return b;
      });
      d.comp = ac.createDynamicsCompressor();
      d.gain = ac.createGain();
      d.gain.gain.value = 0;
      let node: AudioNode = d.src.connect(d.hp);
      for (const b of d.eq) node = node.connect(b);
      node.connect(d.comp).connect(d.gain).connect(this.master);
    }
    for (const m of this.music.values()) this.wireMusic(m);
  }

  private wireMusic(m: Music) {
    if (!this.ac || m.src) return;
    m.src = this.ac.createMediaElementSource(m.el);
    m.gain = this.ac.createGain();
    m.gain.gain.value = 0;
    m.src.connect(m.gain).connect(this.master!);
  }

  /** iOS only lets media play from a user gesture; touching every element once "blesses" it. */
  unlock() {
    this.ensureAudio();
    const els = [...this.decks.map((d) => d.el), ...[...this.music.values()].map((m) => m.el)];
    for (const el of els) {
      if (!el.src || !el.paused || this.blessed.has(el)) continue;
      this.blessed.add(el);
      el.play()
        .then(() => { if (!this.playing) { el.pause(); this.seek(this.time); } })
        .catch(() => this.blessed.delete(el));
    }
  }

  private applyDeckAudio(d: Deck, c: Clip) {
    if (!this.ac || !d.eq) return;
    const key = c.id + c.eq.join() + c.voice;
    if (d.audioKey === key) return;
    d.audioKey = key;
    c.eq.forEach((g, i) => (d.eq![i].gain.value = g + (c.voice && i === 3 ? 3 : 0)));
    d.hp!.frequency.value = c.voice ? 90 : 20;
    d.comp!.threshold.value = c.voice ? -26 : 0;
    d.comp!.ratio.value = c.voice ? 3.5 : 1;
    d.comp!.knee.value = c.voice ? 12 : 0;
  }

  // ------------------------------------------------------------ timeline lookup

  /** Active clip(s) at T: [outgoing?, current] with transition progress. */
  private active(T: number) {
    const { starts, trans } = this.lay;
    const n = this.project.clips.length;
    if (!n) return null;
    let i = 0;
    while (i + 1 < n && starts[i + 1] <= T) i++;
    if (i > 0 && T < starts[i] + trans[i - 1] && trans[i - 1] > 0) {
      return { a: i - 1, b: i, t: (T - starts[i]) / trans[i - 1] };
    }
    return { a: i, b: -1, t: 0 };
  }

  private localTime(k: number, T: number) {
    const c = this.project.clips[k];
    return clamp(c.in + (T - this.lay.starts[k]) * c.speed, c.in, Math.max(c.in, c.out - 0.03));
  }

  private image(assetId: string) {
    let img = this.images.get(assetId);
    if (!img) {
      const a = cachedAsset(assetId);
      if (!a) return null;
      img = new Image();
      img.src = assetUrl(a);
      img.onload = () => this.requestRender();
      this.images.set(assetId, img);
    }
    return img;
  }

  private prepare(d: Deck, k: number) {
    const c = this.project.clips[k];
    const a = cachedAsset(c.assetId);
    if (!a) return false;
    if (a.kind === "image") {
      d.img = this.image(a.id);
      if (d.assetId !== a.id) { d.el.pause(); d.assetId = a.id; }
      return true;
    }
    d.img = null;
    if (d.assetId !== a.id) {
      d.assetId = a.id;
      d.el.src = assetUrl(a);
      d.audioKey = "";
    }
    return true;
  }

  private seekEl(d: Deck | Music, t: number) {
    if (d.el.seeking) d.pending = t;
    else d.el.currentTime = t;
  }

  // ------------------------------------------------------------ transport

  seek(T: number) {
    this.time = clamp(T, 0, this.lay.end);
    if (this.playing) {
      this.T0 = this.time;
      this.t0 = performance.now();
      return;
    }
    const act = this.active(this.time);
    if (act) {
      for (const k of [act.a, act.b]) {
        if (k < 0) continue;
        const d = this.decks[k % 2];
        if (this.prepare(d, k) && !d.img) this.seekEl(d, this.localTime(k, this.time));
      }
    }
    this.requestRender();
    this.onTime(this.time);
  }

  play() {
    if (this.playing) return;
    if (this.time >= this.lay.end - 0.05) this.time = 0;
    this.unlock();
    this.playing = true;
    this.T0 = this.time;
    this.t0 = performance.now();
    this.onState(true);
    // Pre-roll: start the video elements now (inside the tap) but hold the clock until they are
    // really decoding frames, then start the clock from where the video actually is.
    // Otherwise the clock runs ahead of a cold decoder, causing a stutter and audio that trails.
    this.preroll = true;
    this.syncMedia(this.time);
    const startAt = performance.now();
    const startT = this.time;
    const loop = (now: number) => {
      if (!this.playing) return;
      if (this.preroll) {
        const act0 = this.active(startT);
        const d = act0 ? this.decks[act0.a % 2] : null;
        const c0 = act0 ? this.project.clips[act0.a] : null;
        const isVideo = !!d && !!c0 && !d.img && d.assetId === c0.assetId;
        const ready = !isVideo || (!d!.el.seeking && d!.el.readyState >= 3 && !d!.el.paused && d!.el.currentTime > c0!.in + 0.02) || (d!.el.readyState >= 3 && c0!.in <= 0.02 && d!.el.currentTime > 0.03);
        if (!ready && now - startAt < 1500) {
          if (isVideo && d!.el.paused && !d!.el.seeking) d!.el.play().catch(() => {});
          this.render(startT);
          this.raf = requestAnimationFrame(loop);
          return;
        }
        this.preroll = false;
        let T0 = startT;
        if (isVideo && ready && act0) T0 = this.lay.starts[act0.a] + (d!.el.currentTime - c0!.in) / c0!.speed;
        this.T0 = T0;
        this.t0 = now;
        this.time = T0;
        this.syncMedia(T0);
      }
      let T = this.T0 + (now - this.t0) / 1000;
      // Lock the clock to the playing video so captions stay on the words.
      const act = this.active(T);
      if (act && act.b < 0) {
        const c = this.project.clips[act.a];
        const d = this.decks[act.a % 2];
        if (!d.img && d.assetId === c.assetId && !d.el.paused && !d.el.seeking && d.el.readyState >= 3) {
          const tv = this.lay.starts[act.a] + (d.el.currentTime - c.in) / c.speed;
          if (Math.abs(tv - T) < 0.25 && tv < this.lay.starts[act.a] + clipLen(c) - 0.05) {
            T = tv;
            this.T0 = T;
            this.t0 = now;
          }
        }
      }
      if (T >= this.lay.end) {
        this.time = this.lay.end;
        this.render(this.time);
        this.pause();
        this.onTime(this.time);
        this.endResolve?.();
        return;
      }
      this.time = T;
      this.syncMedia(T);
      this.render(T);
      this.onTime(T);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    this.playing = false;
    this.preroll = false;
    cancelAnimationFrame(this.raf);
    for (const d of this.decks) { d.el.pause(); d.gain?.gain.setTargetAtTime(0, this.ac!.currentTime, 0.02); }
    for (const m of this.music.values()) m.el.pause();
    this.onState(false);
    this.seek(this.time);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  private syncMedia(T: number) {
    const p = this.project;
    const act = this.active(T);
    const live = new Map<number, number>(); // deck -> clip
    let voiceOn = false;
    if (act) {
      live.set(act.a % 2, act.a);
      if (act.b >= 0) live.set(act.b % 2, act.b);
    }
    this.decks.forEach((d, di) => {
      const k = live.get(di);
      if (k == null) {
        // Idle deck: park on the next clip it will play so the cut is instant.
        if (!d.el.paused) d.el.pause();
        d.gain?.gain.setTargetAtTime(0, this.ac?.currentTime ?? 0, 0.015);
        const cur = act ? Math.max(act.a, act.b) : 0;
        let next = cur + 1;
        while (next < p.clips.length && next % 2 !== di) next++;
        if (next < p.clips.length && this.prepare(d, next) && !d.img && !d.el.seeking) {
          const want = p.clips[next].in;
          if (Math.abs(d.el.currentTime - want) > 0.05) this.seekEl(d, want);
        }
        return;
      }
      const c = p.clips[k];
      if (!this.prepare(d, k) || d.img) return;
      const lt = this.localTime(k, T);
      if (Math.abs(d.el.playbackRate - c.speed) > 0.001) d.el.playbackRate = c.speed;
      (d.el as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch = true;
      if (Math.abs(d.el.currentTime - lt) > 0.3 && !d.el.seeking) this.seekEl(d, lt);
      if (d.el.paused && !d.el.seeking) d.el.play().catch(() => {});
      this.applyDeckAudio(d, c);
      if (d.gain && this.ac) {
        const into = T - this.lay.starts[k];
        const left = this.lay.starts[k] + clipLen(c) - T;
        let g = c.mute ? 0 : c.volume;
        if (c.fadeIn > 0) g *= clamp(into / c.fadeIn);
        if (c.fadeOut > 0) g *= clamp(left / c.fadeOut);
        if (act && act.b >= 0) g *= k === act.a ? 1 - act.t : act.t;
        if (g > 0.05) voiceOn = true;
        d.gain.gain.setTargetAtTime(g, this.ac.currentTime, 0.015);
      }
    });
    // Music
    for (const m of this.preroll ? [] : p.music) {
      let mm = this.music.get(m.id);
      const a = cachedAsset(m.assetId);
      if (!mm && a) {
        const el = document.createElement("audio");
        el.preload = "auto";
        el.src = assetUrl(a);
        this.host.appendChild(el);
        mm = { el, assetId: m.assetId, pending: null };
        el.addEventListener("seeked", () => { if (mm!.pending != null) { const t = mm!.pending; mm!.pending = null; el.currentTime = t; } });
        this.music.set(m.id, mm);
        this.wireMusic(mm);
      }
      if (!mm) continue;
      const len = m.out - m.in;
      const inside = T >= m.start && T < m.start + len;
      if (!inside) { if (!mm.el.paused) mm.el.pause(); continue; }
      const lt = m.in + (T - m.start);
      if (Math.abs(mm.el.currentTime - lt) > 0.3 && !mm.el.seeking) this.seekEl(mm, lt);
      if (mm.el.paused) mm.el.play().catch(() => {});
      if (mm.gain && this.ac) {
        let g = m.volume;
        if (m.fadeIn > 0) g *= clamp((T - m.start) / m.fadeIn);
        if (m.fadeOut > 0) g *= clamp((m.start + len - T) / m.fadeOut);
        if (p.duck && voiceOn && !m.vo) g *= 0.3;
        mm.gain.gain.setTargetAtTime(g, this.ac.currentTime, 0.08);
      }
    }
    if (this.master && this.ac) this.master.gain.setTargetAtTime(p.master, this.ac.currentTime, 0.02);
  }

  // ------------------------------------------------------------ rendering

  requestRender() {
    if (this.renderQueued || this.playing) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.playing) this.render(this.time);
    });
  }

  private drawClip(ctx: CanvasRenderingContext2D, k: number, T: number) {
    const p = this.project;
    const c = p.clips[k];
    const d = this.decks[k % 2];
    const src: HTMLVideoElement | HTMLImageElement | null = d.assetId === c.assetId ? d.img ?? d.el : null;
    const { w, h } = this;
    if (!src) return false;
    const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
    const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
    if (!sw || (src instanceof HTMLVideoElement && src.readyState < 2)) return false;
    const rot = ((c.rotate % 360) + 360) % 360;
    const [rw, rh] = rot === 90 || rot === 270 ? [sh, sw] : [sw, sh];
    const cover = Math.max(w / rw, h / rh);
    const contain = Math.min(w / rw, h / rh);
    if (p.fit === "blur") {
      const tw = Math.max(8, Math.round(w / 24)), th = Math.max(8, Math.round(h / 24));
      if (this.tiny.width !== tw || this.tiny.height !== th) { this.tiny.width = tw; this.tiny.height = th; }
      const tc = this.tiny.getContext("2d")!;
      tc.drawImage(src, (tw - rw * cover / 24) / 2, (th - rh * cover / 24) / 2, rw * cover / 24, rh * cover / 24);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.tiny, -w * 0.05, -h * 0.05, w * 1.1, h * 1.1);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, w, h);
    } else if (p.fit === "contain") {
      ctx.fillStyle = p.bgColor;
      ctx.fillRect(0, 0, w, h);
    }
    let s = p.fit === "cover" ? cover : contain;
    s *= c.zoom;
    if (c.kenBurns) s *= 1 + 0.12 * clamp((T - this.lay.starts[k]) / clipLen(c));
    ctx.save();
    ctx.translate(w / 2 + c.panX * w, h / 2 + c.panY * h);
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(src, (-sw * s) / 2, (-sh * s) / 2, sw * s, sh * s);
    ctx.restore();
    return true;
  }

  private loadBgImage(id: string | undefined) {
    if (!id || !this.fx) return false;
    const key = id + this.w + "x" + this.h;
    if (this.bgKey === key) return true;
    const img = this.image(id);
    if (!img || !img.complete || !img.naturalWidth) return false;
    const s = Math.max(this.w / img.naturalWidth, this.h / img.naturalHeight);
    this.wctx.drawImage(img, (this.w - img.naturalWidth * s) / 2, (this.h - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    this.fx.pixels(2).set(this.wctx.getImageData(0, 0, this.w, this.h).data);
    this.bgKey = key;
    return true;
  }

  render(T: number) {
    const { ctx, w, h } = this;
    if (!w || !this.project) return;
    const p = this.project;
    const act = T <= this.lay.videoEnd + 0.001 || !p.clips.length ? this.active(Math.min(T, this.lay.videoEnd - 0.001)) : null;
    ctx.fillStyle = p.bgColor;
    ctx.fillRect(0, 0, w, h);
    if (act) {
      const A = p.clips[act.a];
      const B = act.b >= 0 ? p.clips[act.b] : null;
      const kind = B ? A.transition.kind : 0;
      const fx = this.fx;
      if (fx && (lookActive(A.look) || (B && kind))) {
        this.wctx.fillStyle = p.bgColor;
        if (A.look.cutout && A.look.bg.mode === 3) this.loadBgImage(A.look.bg.imageId);
        this.wctx.fillRect(0, 0, w, h);
        this.drawClip(this.wctx, act.a, T);
        fx.pixels(0).set(this.wctx.getImageData(0, 0, w, h).data);
        let hasMask = false;
        if (needsMask(A.look)) {
          const r = this.seg.run(this.work, w, h);
          if (r) { fx.setMask(r.mask, r.w, r.h, this.playing ? 0.35 : 0); this.hadMask = true; }
          hasMask = this.hadMask;
          if (!r && !this.seg.ready) {
            this.onStatus(this.seg.failed ? "Cutout model failed to load" : "Loading cutout model…");
            this.seg.load().then(() => { this.onStatus(""); this.requestRender(); });
          }
        }
        const params = fx.params();
        lookParams(A.look, params, 0);
        if (lookActive(A.look)) fx.process(0, T, hasMask);
        if (B && kind) {
          this.bctx.fillStyle = p.bgColor;
          this.bctx.fillRect(0, 0, w, h);
          if (this.drawClip(this.bctx, act.b, T)) fx.pixels(1).set(this.bctx.getImageData(0, 0, w, h).data);
          else fx.copyAtoB();
          lookParams(B.look, fx.params(), 48);
          if (lookActive(B.look)) fx.process(1, T, false);
          fx.transition(kind, act.t);
        }
        ctx.putImageData(fx.imageData(), 0, 0);
      } else {
        this.drawClip(ctx, act.a, T);
      }
    }
    this.drawTexts(T);
    const pr = p.progress;
    if (pr?.on && this.lay.end > 0) {
      const bh = Math.max(4, Math.round(h * 0.008));
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(0, pr.top ? 0 : h - bh, w, bh);
      ctx.fillStyle = pr.color;
      ctx.fillRect(0, pr.top ? 0 : h - bh, (w * T) / this.lay.end, bh);
    }
    if (this.showSafe && !this.exporting) this.drawSafe();
  }

  /** Where TikTok / Reels / Shorts put their buttons and captions (approximate, 9:16). */
  private drawSafe() {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.fillStyle = "rgba(255,69,58,0.18)";
    ctx.strokeStyle = "rgba(255,69,58,0.8)";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    const zones: [number, number, number, number][] = [
      [0, 0, w, h * 0.1],
      [0, h * 0.78, w, h * 0.22],
      [w * 0.86, h * 0.35, w * 0.14, h * 0.43],
    ];
    for (const [x, y, zw, zh] of zones) { ctx.fillRect(x, y, zw, zh); ctx.strokeRect(x, y, zw, zh); }
    ctx.restore();
  }

  /** Silences the speakers (e.g. while recording a voiceover) without affecting exports. */
  setMonitor(on: boolean) {
    this.ensureAudio();
    if (this.monitor) this.monitor.gain.value = on ? 1 : 0;
  }

  // ------------------------------------------------------------ text

  private fontReady(font: string) {
    if (document.fonts.check(font)) return true;
    if (!this.fontWait.has(font)) {
      this.fontWait.add(font);
      document.fonts.load(font).then(() => this.requestRender()).catch(() => {});
    }
    return false;
  }

  private drawTexts(T: number) {
    const { ctx, w, h } = this;
    this.boxes = [];
    const base = Math.min(w, h);
    const items = this.project.texts.filter((t) => T >= t.start && T < t.end).sort((a, b) => Number(!!a.caption) - Number(!!b.caption));
    for (const t of items) this.drawText(ctx, t, T, w, h, base);
  }

  private drawText(ctx: CanvasRenderingContext2D, t: TextItem, T: number, w: number, h: number, base: number) {
    const px = (t.size * base) / 600;
    const font = `${t.weight} ${px}px "${t.font}", -apple-system, sans-serif`;
    this.fontReady(font);
    const age = T - t.start;
    const left = t.end - T;
    // While paused, show text fully so it can be edited; animate only in playback / export.
    const inP = this.playing || this.exporting ? clamp(age / 0.3) : 1;
    let alpha = 1, scale = 1, dy = 0;
    switch (t.anim) {
      case "fade": alpha = Math.min(easeOut(inP), clamp(left / 0.2)); break;
      case "pop": scale = 0.5 + 0.5 * easeBack(inP); alpha = clamp(inP * 3); break;
      case "slide": dy = (1 - easeOut(inP)) * h * 0.04; alpha = easeOut(inP); break;
      case "bounce": scale = 1 + 0.18 * Math.sin(inP * Math.PI) ; alpha = clamp(inP * 4); break;
      case "zoom": scale = 1.35 - 0.35 * easeOut(inP); alpha = easeOut(inP); break;
    }
    const raw = t.upper ? t.text.toUpperCase() : t.text;
    let visible = raw.length;
    if (t.anim === "typewriter" && (this.playing || this.exporting)) visible = Math.floor(raw.length * clamp(age / Math.max(0.3, (t.end - t.start) * 0.6)));
    ctx.save();
    ctx.font = font;
    ctx.textBaseline = "middle";
    // Word layout with wrapping.
    const maxW = w * 0.86;
    const space = ctx.measureText(" ").width;
    type W = { s: string; width: number; idx: number; start: number };
    const lines: { words: W[]; width: number }[] = [];
    let idx = 0, charPos = 0;
    for (const para of raw.split("\n")) {
      let line: { words: W[]; width: number } = { words: [], width: 0 };
      for (const s of para.split(/\s+/).filter(Boolean)) {
        const width = ctx.measureText(s).width;
        if (line.words.length && line.width + space + width > maxW) { lines.push(line); line = { words: [], width: 0 }; }
        line.width += (line.words.length ? space : 0) + width;
        line.words.push({ s, width, idx: idx++, start: charPos });
        charPos += s.length + 1;
      }
      lines.push(line);
    }
    const lh = px * 1.18;
    const totalH = lines.length * lh;
    const boxW = Math.max(...lines.map((l) => l.width), 1);
    const cx = t.x * w, cy = t.y * h + dy;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    const activeWord = t.words ? t.words.findIndex((wd) => T >= wd.s && T < wd.e) : -1;
    const padX = px * 0.28, padY = px * 0.1;
    lines.forEach((line, li) => {
      const y = -totalH / 2 + lh * (li + 0.5);
      let x = t.align === "left" ? -boxW / 2 : t.align === "right" ? boxW / 2 - line.width : -line.width / 2;
      if (t.bgOn && line.words.length) {
        ctx.fillStyle = t.bg;
        ctx.beginPath();
        ctx.roundRect(x - padX, y - lh / 2 - padY / 2, line.width + padX * 2, lh + padY, px * 0.18);
        ctx.fill();
      }
      for (const wd of line.words) {
        if (wd.start >= visible) break;
        const s = wd.s.slice(0, Math.max(0, visible - wd.start));
        const on = wd.idx === activeWord;
        ctx.save();
        if (on && (t.anim === "pop" || t.anim === "bounce")) {
          ctx.translate(x + wd.width / 2, y);
          ctx.scale(1.08, 1.08);
          ctx.translate(-(x + wd.width / 2), -y);
        }
        if (t.stroke > 0) {
          ctx.lineJoin = "round";
          ctx.lineWidth = (t.stroke * px) / 30;
          ctx.strokeStyle = t.strokeColor;
          ctx.strokeText(s, x, y);
        }
        if (t.shadow > 0) {
          ctx.shadowColor = "rgba(0,0,0,0.85)";
          ctx.shadowBlur = t.shadow * px * 0.35;
          ctx.shadowOffsetY = t.shadow * px * 0.06;
        }
        ctx.fillStyle = on ? t.highlight : t.color;
        ctx.fillText(s, x, y);
        ctx.restore();
        x += wd.width + space;
      }
    });
    ctx.restore();
    const bw = (boxW + padX * 2) * scale, bh = (totalH + padY) * scale;
    const box = { id: t.id, x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    this.boxes.push(box);
    if (this.selectedText === t.id && !this.exporting) {
      ctx.save();
      ctx.strokeStyle = "#2997ff";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }

  textAt(x: number, y: number) {
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  // ------------------------------------------------------------ export

  /** Renders the timeline in real time into an MP4 (or WebM) file. */
  async exportVideo(long: number, fps: number, onProgress: (f: number) => void, signal: { cancel: boolean }) {
    this.pause();
    this.ensureAudio();
    await this.ac!.resume();
    const prevSel = this.selectedText;
    this.selectedText = null;
    this.exporting = true;
    this.resize(long);
    const types = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const stream = new MediaStream([...this.canvas.captureStream(fps).getVideoTracks(), ...this.dest!.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: long >= 1900 ? 24e6 : long >= 1280 ? 12e6 : 6e6, audioBitsPerSecond: 192000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    this.monitor!.gain.value = 0;
    this.seek(0);
    await new Promise((r) => setTimeout(r, 400));
    const ended = new Promise<void>((r) => (this.endResolve = r));
    const prog = setInterval(() => {
      onProgress(this.time / Math.max(0.01, this.lay.end));
      if (signal.cancel) { this.pause(); this.endResolve?.(); }
    }, 200);
    rec.start(500);
    this.play();
    await ended;
    clearInterval(prog);
    this.endResolve = null;
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.kind === "video" && t.stop());
    this.monitor!.gain.value = 1;
    this.exporting = false;
    this.selectedText = prevSel;
    this.resize(PREVIEW_LONG);
    this.seek(0);
    const type = (mime || chunks[0]?.type || "video/mp4").split(";")[0];
    return signal.cancel ? null : new Blob(chunks, { type });
  }
}
