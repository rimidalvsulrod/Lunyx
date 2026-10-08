import type { AdjKey, Clip, Look, Project, TextStyle } from "./types";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const ASPECTS: Record<string, [number, number]> = {
  "9:16": [9, 16],
  "16:9": [16, 9],
  "1:1": [1, 1],
  "4:5": [4, 5],
  "3:4": [3, 4],
  "21:9": [21, 9],
};

/** Working size for an aspect with the long side at `long` px (even numbers for encoders). */
export function frameSize(aspect: string, long: number): [number, number] {
  const [a, b] = ASPECTS[aspect] ?? [9, 16];
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return a >= b ? [even(long), even((long * b) / a)] : [even((long * a) / b), even(long)];
}

type Grade = Partial<Record<AdjKey | "mono" | "gamma", number>> & { sTone?: number[]; hTone?: number[]; gain?: number[] };

/** Cinematic looks. Values are added on top of the clip's own adjustments, scaled by strength. */
export const FILTERS: { id: string; name: string; g: Grade }[] = [
  { id: "none", name: "Original", g: {} },
  { id: "teal", name: "Teal & Orange", g: { contrast: 0.25, saturation: 0.1, sTone: [-0.35, 0.05, 0.4], hTone: [0.4, 0.15, -0.3], vignette: 0.25 } },
  { id: "blade", name: "Blade Runner", g: { temperature: 0.5, contrast: 0.3, saturation: -0.1, sTone: [0.1, -0.1, 0.3], hTone: [0.6, 0.25, -0.4], vignette: 0.35, fade: 0.1 } },
  { id: "dune", name: "Dune", g: { temperature: 0.5, contrast: 0.2, saturation: -0.25, sTone: [0.15, 0.08, 0], hTone: [0.35, 0.2, 0], fade: 0.1 } },
  { id: "matrix", name: "Matrix", g: { gain: [0.88, 1.08, 0.9], sTone: [-0.1, 0.3, 0.05], contrast: 0.3, saturation: -0.3, vignette: 0.3 } },
  { id: "kodak", name: "Kodak 2383", g: { contrast: 0.35, saturation: 0.05, sTone: [0, 0.1, 0.25], hTone: [0.35, 0.2, -0.1], fade: 0.05, grain: 0.25 } },
  { id: "eterna", name: "Fuji Eterna", g: { contrast: -0.15, saturation: -0.25, sTone: [-0.05, 0.15, 0.1], hTone: [0.05, 0.05, -0.05], fade: 0.2, grain: 0.15 } },
  { id: "euphoria", name: "Euphoria", g: { tint: 0.35, saturation: 0.2, sTone: [0.25, 0, 0.5], hTone: [0.4, 0.1, 0.35], vignette: 0.25 } },
  { id: "cyber", name: "Cyberpunk", g: { tint: 0.5, saturation: 0.3, contrast: 0.35, sTone: [0.3, -0.2, 0.6], hTone: [0.5, -0.1, 0.4] } },
  { id: "moon", name: "Day for Night", g: { temperature: -0.6, exposure: -0.35, saturation: -0.35, contrast: 0.15, sTone: [-0.1, 0.05, 0.4], vignette: 0.4 } },
  { id: "moody", name: "Moody", g: { exposure: -0.2, contrast: 0.3, saturation: -0.3, highlights: -0.3, sTone: [0, 0.1, 0.15], vignette: 0.45 } },
  { id: "golden", name: "Golden Hour", g: { temperature: 0.55, tint: 0.1, saturation: 0.15, hTone: [0.4, 0.2, -0.1], vignette: 0.2 } },
  { id: "arctic", name: "Arctic", g: { temperature: -0.45, saturation: -0.1, exposure: 0.1, contrast: 0.1, hTone: [-0.1, 0.05, 0.3] } },
  { id: "pastel", name: "Pastel Dream", g: { saturation: -0.05, fade: 0.25, contrast: -0.1, exposure: 0.15, hTone: [0.25, 0.15, 0.2], sTone: [0.15, 0.05, 0.2] } },
  { id: "vintage", name: "Vintage 70s", g: { temperature: 0.35, fade: 0.35, saturation: -0.15, sTone: [0.2, 0.1, -0.1], hTone: [0.3, 0.2, 0], grain: 0.35, vignette: 0.3 } },
  { id: "bleach", name: "Bleach Bypass", g: { saturation: -0.5, contrast: 0.55, highlights: 0.1, vignette: 0.2 } },
  { id: "desert", name: "Desert", g: { temperature: 0.4, saturation: -0.2, contrast: 0.2, fade: 0.1, gain: [1.06, 1, 0.88] } },
  { id: "velvia", name: "Velvia", g: { saturation: 0.45, vibrance: 0.3, contrast: 0.25 } },
  { id: "clean", name: "Clean Pop", g: { exposure: 0.1, contrast: 0.15, vibrance: 0.35, highlights: -0.1, shadows: 0.1 } },
  { id: "noir", name: "Noir", g: { mono: 1, contrast: 0.5, vignette: 0.5, grain: 0.35 } },
  { id: "silver", name: "Silver", g: { mono: 1, contrast: 0.2, fade: 0.15, hTone: [0.1, 0.1, 0.15] } },
  { id: "sepia", name: "Sepia", g: { mono: 0.85, fade: 0.1, hTone: [0.4, 0.2, -0.1], sTone: [0.2, 0.05, -0.15] } },
];

export const ADJUST: { key: AdjKey; name: string; min: number; max: number }[] = [
  { key: "exposure", name: "Exposure", min: -2, max: 2 },
  { key: "contrast", name: "Contrast", min: -1, max: 1 },
  { key: "saturation", name: "Saturation", min: -1, max: 1 },
  { key: "vibrance", name: "Vibrance", min: -1, max: 1 },
  { key: "temperature", name: "Temperature", min: -1, max: 1 },
  { key: "tint", name: "Tint", min: -1, max: 1 },
  { key: "highlights", name: "Highlights", min: -1, max: 1 },
  { key: "shadows", name: "Shadows", min: -1, max: 1 },
  { key: "fade", name: "Fade", min: 0, max: 1 },
  { key: "vignette", name: "Vignette", min: 0, max: 1 },
  { key: "grain", name: "Grain", min: 0, max: 1 },
  { key: "sharpen", name: "Sharpen", min: 0, max: 1 },
];

/** Lighting overlays. `mode` matches the Rust light modes. */
export const LIGHTS: { id: string; name: string; mode: number; color: string; color2?: string; amount: number; soft: number; speed: number; pos: number }[] = [
  { id: "none", name: "None", mode: 0, color: "#ffffff", amount: 0, soft: 0.3, speed: 1, pos: 0.5 },
  { id: "window", name: "Morning Window", mode: 1, color: "#fff2d1", amount: 0.7, soft: 0.35, speed: 1, pos: 0.4 },
  { id: "sunsetwin", name: "Sunset Window", mode: 1, color: "#ff9a40", amount: 0.8, soft: 0.45, speed: 1, pos: 0.55 },
  { id: "moonwin", name: "Moon Window", mode: 1, color: "#8cb4ff", amount: 0.55, soft: 0.3, speed: 1, pos: 0.3 },
  { id: "trees", name: "Tree Shade", mode: 2, color: "#ffe6a6", amount: 0.7, soft: 0.4, speed: 1, pos: 0.5 },
  { id: "forest", name: "Forest Canopy", mode: 2, color: "#d9ff99", amount: 0.6, soft: 0.6, speed: 0.6, pos: 0.7 },
  { id: "blinds", name: "Blinds", mode: 3, color: "#ffe0b3", amount: 0.65, soft: 0.3, speed: 0, pos: 0.4 },
  { id: "noirblinds", name: "Noir Blinds", mode: 3, color: "#e6f0ff", amount: 0.85, soft: 0.15, speed: 0, pos: 0.5 },
  { id: "rays", name: "God Rays", mode: 4, color: "#ffedbf", amount: 0.7, soft: 0.4, speed: 1, pos: 0.3 },
  { id: "golden", name: "Golden Hour", mode: 5, color: "#ffa64d", amount: 0.7, soft: 0.4, speed: 1, pos: 0.9 },
  { id: "neon", name: "Neon Night", mode: 6, color: "#ff2e96", color2: "#2ee6ff", amount: 0.75, soft: 0.4, speed: 1, pos: 0.5 },
  { id: "synth", name: "Synthwave", mode: 6, color: "#8a2eff", color2: "#ff7a2e", amount: 0.75, soft: 0.5, speed: 0.5, pos: 0.5 },
  { id: "leak", name: "Light Leak", mode: 7, color: "#ffb366", amount: 0.7, soft: 0.5, speed: 1, pos: 0.5 },
  { id: "spot", name: "Spotlight", mode: 8, color: "#fff8e6", amount: 0.8, soft: 0.4, speed: 1, pos: 0.5 },
  { id: "pool", name: "Pool Caustics", mode: 9, color: "#99e6ff", amount: 0.5, soft: 0.4, speed: 1, pos: 0.5 },
];

export const BG_MODES = ["Off", "Blur", "Color", "Image", "Gradient", "Color Pop"];

export const TRANSITIONS: { id: number; name: string }[] = [
  { id: 0, name: "None" }, { id: 1, name: "Dissolve" }, { id: 2, name: "Dip Black" }, { id: 3, name: "Dip White" },
  { id: 4, name: "Wipe Left" }, { id: 5, name: "Wipe Right" }, { id: 6, name: "Wipe Up" }, { id: 7, name: "Wipe Down" },
  { id: 16, name: "Diagonal" }, { id: 8, name: "Push" }, { id: 9, name: "Push Up" }, { id: 17, name: "Whip Pan" },
  { id: 10, name: "Zoom" }, { id: 11, name: "Circle" }, { id: 12, name: "Blur" }, { id: 13, name: "Glitch" },
  { id: 14, name: "Flash" }, { id: 15, name: "Luma Fade" }, { id: 18, name: "Film Burn" },
];

export const EQ_BANDS = [60, 250, 1000, 4000, 12000];
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0],
  Voice: [-3, -1, 1, 3, 2],
  Podcast: [-4, 0, 2, 3, 1],
  "Bass Boost": [6, 3, 0, 0, 0],
  Treble: [0, 0, 0, 3, 6],
  Warm: [3, 2, 0, -1, -2],
  Bright: [-1, 0, 1, 3, 4],
  Phone: [-12, -3, 3, 2, -12],
};

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Premium display + text faces (Google Fonts, cached offline by the service worker). */
export const FONTS: { name: string; w: number[] }[] = [
  { name: "Inter", w: [400, 700, 900] }, { name: "Montserrat", w: [400, 700, 900] }, { name: "Poppins", w: [400, 700, 900] },
  { name: "Bebas Neue", w: [400] }, { name: "Anton", w: [400] }, { name: "Oswald", w: [400, 700] }, { name: "Archivo Black", w: [400] },
  { name: "Archivo", w: [400, 900] }, { name: "Unbounded", w: [400, 900] }, { name: "Syne", w: [400, 800] },
  { name: "Space Grotesk", w: [400, 700] }, { name: "Bricolage Grotesque", w: [400, 800] }, { name: "Outfit", w: [400, 800] },
  { name: "Sora", w: [400, 800] }, { name: "Manrope", w: [400, 800] }, { name: "Plus Jakarta Sans", w: [400, 800] },
  { name: "Kanit", w: [400, 800] }, { name: "Raleway", w: [400, 800] }, { name: "Barlow Condensed", w: [400, 800] },
  { name: "Teko", w: [400, 700] }, { name: "Josefin Sans", w: [400, 700] }, { name: "Playfair Display", w: [400, 900] },
  { name: "DM Serif Display", w: [400] }, { name: "Instrument Serif", w: [400] }, { name: "Fraunces", w: [400, 900] },
  { name: "Cormorant Garamond", w: [400, 700] }, { name: "Cinzel", w: [400, 900] }, { name: "Abril Fatface", w: [400] },
  { name: "Righteous", w: [400] }, { name: "Bangers", w: [400] }, { name: "Luckiest Guy", w: [400] }, { name: "Titan One", w: [400] },
  { name: "Rubik Mono One", w: [400] }, { name: "Bungee", w: [400] }, { name: "Black Ops One", w: [400] }, { name: "Shrikhand", w: [400] },
  { name: "Monoton", w: [400] }, { name: "Rye", w: [400] }, { name: "Press Start 2P", w: [400] }, { name: "VT323", w: [400] },
  { name: "Special Elite", w: [400] }, { name: "Permanent Marker", w: [400] }, { name: "Caveat", w: [400] }, { name: "Lobster", w: [400] },
  { name: "Pacifico", w: [400] }, { name: "Dancing Script", w: [400] }, { name: "Great Vibes", w: [400] }, { name: "Satisfy", w: [400] },
];

export const FONT_CSS =
  "https://fonts.googleapis.com/css2?" +
  FONTS.map((f) => "family=" + f.name.replace(/ /g, "+") + (f.w.length > 1 ? ":wght@" + f.w.join(";") : "")).join("&") +
  "&display=swap";

export const TEXT_ANIMS = ["none", "fade", "pop", "slide", "bounce", "typewriter", "zoom"];

export const CAPTION_STYLES: { name: string; s: Partial<TextStyle> }[] = [
  { name: "Bold Pop", s: { font: "Montserrat", weight: 900, size: 62, color: "#ffffff", stroke: 8, strokeColor: "#000000", highlight: "#ffe14d", bgOn: false, upper: true, anim: "pop", shadow: 0 } },
  { name: "Hormozi", s: { font: "Anton", weight: 400, size: 74, color: "#ffffff", stroke: 10, strokeColor: "#000000", highlight: "#3dff6e", bgOn: false, upper: true, anim: "bounce", shadow: 0.5 } },
  { name: "Clean", s: { font: "Inter", weight: 700, size: 48, color: "#ffffff", stroke: 0, strokeColor: "#000000", highlight: "#2997ff", bgOn: false, upper: false, anim: "fade", shadow: 0.7 } },
  { name: "Boxed", s: { font: "Poppins", weight: 700, size: 46, color: "#ffffff", stroke: 0, strokeColor: "#000000", highlight: "#ffcc00", bgOn: true, bg: "#000000b3", upper: false, anim: "none", shadow: 0 } },
  { name: "Cinema", s: { font: "Instrument Serif", weight: 400, size: 56, color: "#fff6e0", stroke: 0, strokeColor: "#000000", highlight: "#fff6e0", bgOn: false, upper: false, anim: "fade", shadow: 0.8 } },
  { name: "Neon", s: { font: "Unbounded", weight: 900, size: 50, color: "#ffffff", stroke: 4, strokeColor: "#ff2e96", highlight: "#2ee6ff", bgOn: false, upper: true, anim: "zoom", shadow: 1 } },
  { name: "Typewriter", s: { font: "Special Elite", weight: 400, size: 46, color: "#ffffff", stroke: 0, strokeColor: "#000000", highlight: "#ffffff", bgOn: true, bg: "#00000099", upper: false, anim: "typewriter", shadow: 0 } },
];

export const defaultStyle = (): TextStyle => ({
  font: "Montserrat", weight: 900, size: 62, color: "#ffffff", stroke: 8, strokeColor: "#000000", shadow: 0,
  bg: "#000000b3", bgOn: false, highlight: "#ffe14d", anim: "pop", upper: true, align: "center",
});

export const zeroAdj = (): Record<AdjKey, number> => Object.fromEntries(ADJUST.map((a) => [a.key, 0])) as Record<AdjKey, number>;

export const defaultLook = (): Look => ({
  filter: "none",
  filterAmt: 1,
  adj: zeroAdj(),
  bg: { mode: 0, blur: 24, color: "#101014", color2: "#2a1a5e", dim: 0 },
  light: { preset: "none", amount: 0, pos: 0.5, soft: 0.3, speed: 1, subject: 0.25, color: "#ffffff", color2: "#2ee6ff" },
  cutout: false,
});

export function newClip(assetId: string, duration: number): Clip {
  return {
    id: uid(), assetId, in: 0, out: duration, speed: 1, volume: 1, mute: false, fadeIn: 0, fadeOut: 0,
    look: defaultLook(), eq: [0, 0, 0, 0, 0], voice: false, transition: { kind: 0, dur: 0.5 },
    zoom: 1, panX: 0, panY: 0, rotate: 0, kenBurns: false,
  };
}

export function newProject(n: number): Project {
  const now = Date.now();
  return {
    id: uid(), name: `Project ${n}`, aspect: "9:16", fit: "cover", bgColor: "#000000", created: now, updated: now,
    clips: [], texts: [], music: [], captionStyle: defaultStyle(), master: 1, duck: true,
  };
}

const hex = (h: string) => {
  const v = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255 || 0);
};
export { hex as hexToRgb };

/** Packs a clip look into the 48-float Rust parameter block. */
export function lookParams(look: Look, out: Float32Array, off: number) {
  out.fill(0, off, off + 48);
  const f = FILTERS.find((x) => x.id === look.filter)?.g ?? {};
  const k = look.filterAmt;
  const a = look.adj;
  const g = (key: AdjKey | "mono" | "gamma") => (f[key] ?? 0) * k;
  out[off + 0] = a.exposure + g("exposure");
  out[off + 1] = a.contrast + g("contrast");
  out[off + 2] = a.saturation + g("saturation");
  out[off + 3] = a.temperature + g("temperature");
  out[off + 4] = a.tint + g("tint");
  out[off + 5] = a.highlights + g("highlights");
  out[off + 6] = a.shadows + g("shadows");
  out[off + 7] = a.fade + g("fade");
  out[off + 8] = a.vignette + g("vignette");
  out[off + 9] = a.grain + g("grain");
  for (let i = 0; i < 3; i++) {
    out[off + 10 + i] = (f.sTone?.[i] ?? 0) * k;
    out[off + 13 + i] = (f.hTone?.[i] ?? 0) * k;
    out[off + 19 + i] = 1 + ((f.gain?.[i] ?? 1) - 1) * k;
  }
  out[off + 16] = g("mono");
  out[off + 17] = a.vibrance + g("vibrance");
  out[off + 18] = 1 + ((f.gamma ?? 1) - 1) * k;
  const bg = look.bg;
  out[off + 24] = look.cutout ? bg.mode : 0;
  out[off + 25] = bg.blur;
  const c1 = hex(bg.color), c2 = hex(bg.color2);
  out.set(c1, off + 26);
  out.set(c2, off + 29);
  const L = look.light;
  const preset = LIGHTS.find((x) => x.id === L.preset);
  out[off + 32] = preset?.mode ?? 0;
  out[off + 33] = L.amount;
  out[off + 34] = L.pos;
  out.set(hex(L.color), off + 35);
  out[off + 38] = L.soft;
  out[off + 39] = L.speed;
  out[off + 40] = L.subject;
  out[off + 41] = look.cutout ? bg.dim : 0;
  out[off + 42] = a.sharpen;
  out.set(hex(L.color2), off + 43);
}

/** True when the clip needs the WASM pipeline (anything beyond a plain draw). */
export function lookActive(look: Look) {
  return (
    look.filter !== "none" ||
    Object.values(look.adj).some((v) => Math.abs(v) > 0.001) ||
    (look.light.preset !== "none" && look.light.amount > 0) ||
    (look.cutout && (look.bg.mode !== 0 || look.bg.dim !== 0))
  );
}

export const needsMask = (look: Look) =>
  look.cutout && (look.bg.mode !== 0 || look.bg.dim !== 0 || (look.light.preset !== "none" && look.light.subject < 0.999));

export const clipLen = (c: Clip) => Math.max(0.05, (c.out - c.in) / c.speed);

/** Timeline start of every clip (transitions overlap neighbours) and the total duration. */
export function layout(p: Project) {
  const starts: number[] = [];
  const trans: number[] = [];
  let t = 0;
  p.clips.forEach((c, i) => {
    starts.push(t);
    const next = p.clips[i + 1];
    const d = next && c.transition.kind ? Math.min(c.transition.dur, clipLen(c) / 2, clipLen(next) / 2) : 0;
    trans.push(d);
    t += clipLen(c) - d;
  });
  const videoEnd = t + (trans.length ? trans[trans.length - 1] : 0);
  // With clips, the video sets the length (longer music is cut at the end, like any editor).
  const end = p.clips.length ? videoEnd : Math.max(...p.texts.map((x) => x.end), ...p.music.map((m) => m.start + (m.out - m.in)), 0);
  return { starts, trans, videoEnd, end };
}

export const fmt = (t: number) => {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${f}`;
};

/** Short lengths as "0.9s", longer as "2:03". */
export const fmtLen = (t: number) => (t < 10 ? `${t.toFixed(1)}s` : fmt(t).replace(/\.\d$/, ""));
