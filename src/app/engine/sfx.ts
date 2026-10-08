// Built-in sound effects, synthesized on the device (offline, royalty free).

const SR = 44100;

type Build = (ctx: OfflineAudioContext, out: AudioNode) => void;

function noise(ctx: OfflineAudioContext, secs: number) {
  const b = ctx.createBuffer(1, Math.ceil(secs * SR), SR);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource();
  s.buffer = b;
  return s;
}

function env(ctx: OfflineAudioContext, at: number, attack: number, peak: number, decay: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

function tone(ctx: OfflineAudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak = 0.6, attack = 0.005) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
  const g = env(ctx, at, attack, peak, dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + attack + dur + 0.05);
}

function sweep(ctx: OfflineAudioContext, out: AudioNode, at: number, dur: number, f0: number, f1: number, peak = 0.8, q = 1.2, type: BiquadFilterType = "bandpass") {
  const n = noise(ctx, dur + 0.1);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, at);
  f.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  n.connect(f).connect(g).connect(out);
  n.start(at);
}

function click(ctx: OfflineAudioContext, out: AudioNode, at: number, peak = 0.7, freq = 3000, len = 0.02) {
  const n = noise(ctx, len + 0.02);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  const g = env(ctx, at, 0.001, peak, len);
  n.connect(f).connect(g).connect(out);
  n.start(at);
}

export const SFX: { id: string; name: string; secs: number; build: Build }[] = [
  { id: "whoosh", name: "Whoosh", secs: 0.9, build: (c, o) => sweep(c, o, 0, 0.8, 300, 2400, 0.9, 1.5) },
  { id: "swoosh", name: "Quick Swoosh", secs: 0.45, build: (c, o) => sweep(c, o, 0, 0.35, 900, 5000, 0.8, 2) },
  { id: "swipe", name: "Swipe Up", secs: 0.4, build: (c, o) => sweep(c, o, 0, 0.3, 2000, 9000, 0.6, 3, "highpass") },
  { id: "pop", name: "Pop", secs: 0.2, build: (c, o) => tone(c, o, "sine", 900, 180, 0, 0.12, 0.8) },
  { id: "click", name: "Click", secs: 0.1, build: (c, o) => click(c, o, 0, 0.9, 2500, 0.03) },
  { id: "ding", name: "Ding", secs: 1.6, build: (c, o) => { tone(c, o, "sine", 1320, 1320, 0, 1.4, 0.5); tone(c, o, "sine", 2640, 2640, 0, 0.8, 0.15); } },
  { id: "chime", name: "Success", secs: 1.2, build: (c, o) => [523, 659, 784, 1047].forEach((f, i) => tone(c, o, "triangle", f, f, i * 0.09, 0.7, 0.35)) },
  { id: "notify", name: "Notification", secs: 0.7, build: (c, o) => { tone(c, o, "sine", 880, 880, 0, 0.25, 0.5); tone(c, o, "sine", 1175, 1175, 0.14, 0.4, 0.5); } },
  { id: "error", name: "Error Buzz", secs: 0.7, build: (c, o) => { tone(c, o, "square", 140, 140, 0, 0.18, 0.3); tone(c, o, "square", 140, 140, 0.25, 0.25, 0.3); } },
  { id: "coin", name: "Coin", secs: 0.6, build: (c, o) => { tone(c, o, "square", 988, 988, 0, 0.08, 0.25); tone(c, o, "square", 1319, 1319, 0.08, 0.4, 0.25); } },
  { id: "laser", name: "Laser", secs: 0.4, build: (c, o) => tone(c, o, "sawtooth", 1800, 160, 0, 0.3, 0.35) },
  {
    id: "boom", name: "Impact Boom", secs: 1.8, build: (c, o) => {
      tone(c, o, "sine", 110, 32, 0, 1.4, 1);
      const n = noise(c, 1.2); const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 400;
      const g = env(c, 0, 0.003, 0.9, 1); n.connect(f).connect(g).connect(o); n.start(0);
    },
  },
  { id: "drop", name: "Bass Drop", secs: 2, build: (c, o) => tone(c, o, "sine", 140, 30, 0, 1.8, 1, 0.02) },
  {
    id: "riser", name: "Riser", secs: 2.4, build: (c, o) => {
      const n = noise(c, 2.3); const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 4;
      f.frequency.setValueAtTime(200, 0); f.frequency.exponentialRampToValueAtTime(8000, 2.2);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.9, 2.15); g.gain.linearRampToValueAtTime(0, 2.25);
      n.connect(f).connect(g).connect(o); n.start(0);
      const s = c.createOscillator(); s.type = "sawtooth"; s.frequency.setValueAtTime(110, 0); s.frequency.exponentialRampToValueAtTime(880, 2.2);
      const sg = c.createGain(); sg.gain.setValueAtTime(0.0001, 0); sg.gain.exponentialRampToValueAtTime(0.18, 2.15); sg.gain.linearRampToValueAtTime(0, 2.25);
      s.connect(sg).connect(o); s.start(0); s.stop(2.3);
    },
  },
  { id: "glitch", name: "Glitch", secs: 0.7, build: (c, o) => { for (let i = 0; i < 9; i++) tone(c, o, "square", 200 + Math.random() * 2400, 100 + Math.random() * 3000, i * 0.07, 0.05, 0.25, 0.001); } },
  { id: "shutter", name: "Camera Shutter", secs: 0.35, build: (c, o) => { click(c, o, 0, 0.9, 4000, 0.04); click(c, o, 0.11, 0.7, 2500, 0.05); } },
  { id: "typing", name: "Keyboard Typing", secs: 2, build: (c, o) => { let t = 0; while (t < 1.85) { click(c, o, t, 0.4 + Math.random() * 0.4, 1800 + Math.random() * 2500, 0.025); t += 0.07 + Math.random() * 0.12; } } },
  { id: "tick", name: "Clock Tick", secs: 2.1, build: (c, o) => { for (let i = 0; i < 4; i++) click(c, o, i * 0.5, 0.8, i % 2 ? 2200 : 3200, 0.02); } },
  { id: "heart", name: "Heartbeat", secs: 1.3, build: (c, o) => { tone(c, o, "sine", 70, 45, 0, 0.18, 1); tone(c, o, "sine", 70, 45, 0.28, 0.22, 0.8); } },
  { id: "scratch", name: "Record Scratch", secs: 0.6, build: (c, o) => { sweep(c, o, 0, 0.25, 600, 3000, 0.8, 6); sweep(c, o, 0.25, 0.3, 3000, 400, 0.7, 6); } },
  { id: "rewind", name: "Rewind", secs: 1.1, build: (c, o) => { for (let i = 0; i < 10; i++) tone(c, o, "triangle", 2000 - i * 140, 1400 - i * 100, i * 0.09, 0.07, 0.25, 0.002); } },
];

function wav(buf: AudioBuffer) {
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const norm = peak > 0 ? 0.89 / peak : 1;
  const out = new DataView(new ArrayBuffer(44 + d.length * 2));
  const w = (o: number, s: string) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF"); out.setUint32(4, 36 + d.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, SR, true); out.setUint32(28, SR * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, "data"); out.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i] * norm)) * 0x7fff, true);
  return new Blob([out.buffer], { type: "audio/wav" });
}

const made = new Map<string, Promise<Blob>>();

/** Renders a built-in effect to a WAV file. */
export function renderSfx(id: string) {
  let p = made.get(id);
  if (!p) {
    const fx = SFX.find((x) => x.id === id)!;
    p = (async () => {
      const ctx = new OfflineAudioContext(1, Math.ceil(fx.secs * SR), SR);
      const master = ctx.createGain();
      master.connect(ctx.destination);
      fx.build(ctx, master);
      return wav(await ctx.startRendering());
    })();
    made.set(id, p);
  }
  return p;
}
