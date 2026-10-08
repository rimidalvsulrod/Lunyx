"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, AudioWaveform, Blend, Captions, ChevronLeft, Copy, Crop, Download, Film, Gauge, ImagePlus,
  Lamp, LayoutTemplate, Mic, Move, Music, Smartphone, Video, Palette, Pause, Play, Plus, Redo2, RectangleHorizontal, ScanFace, Scissors, Share2,
  SlidersHorizontal, Sparkles, Trash2, Type, Undo2, Volume2, WandSparkles, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { RibbonHero } from "@/components/ribbon/RibbonBackground";
import { collectGarbage, db, storageInfo } from "./engine/db";
import { importFile, loadAsset, pcm16k, PCM_RATE, thumbUrl } from "./engine/media";
import { Player } from "./engine/player";
import { getFx } from "./engine/fx";
import { ASR_MODELS, transcribe, type AsrChunk } from "./engine/ai";
import * as P from "./engine/presets";
import { Recorder } from "./recorder";
import type { Asset, Clip, Look, Project, TextItem, TextStyle, Word } from "./engine/types";

const ACCENT = "#2997ff";

// ================================================================ root

export default function EditorApp() {
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const fromHash = location.hash.slice(1);
    if (fromHash) Promise.resolve().then(() => setOpenId(fromHash));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    if (!document.getElementById("ed-fonts")) {
      const l = document.createElement("link");
      l.id = "ed-fonts";
      l.rel = "stylesheet";
      l.href = P.FONT_CSS;
      document.head.appendChild(l);
    }
    const onHash = () => setOpenId(location.hash.slice(1) || null);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const open = (id: string | null) => {
    if (id) location.hash = id;
    else history.replaceState(null, "", location.pathname);
    setOpenId(id);
  };

  return openId ? <Editor key={openId} id={openId} onBack={() => open(null)} /> : <Home onOpen={open} />;
}

// ================================================================ home

function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<{ p: Project; thumb: string; dur: number }[] | null>(null);
  const [info, setInfo] = useState({ used: 0, quota: 0 });
  const [tip, setTip] = useState(false);

  const refresh = useCallback(async () => {
    const ps = (await db.projects()).sort((a, b) => b.updated - a.updated);
    const out = await Promise.all(
      ps.map(async (p) => {
        const a = p.clips[0] && (await loadAsset(p.clips[0].assetId));
        return { p, thumb: a ? await thumbUrl(a) : "", dur: P.layout(p).end };
      }),
    );
    setRows(out);
    setInfo(await storageInfo());
  }, []);

  useEffect(() => {
    Promise.resolve().then(refresh);
    const nav = navigator as Navigator & { standalone?: boolean };
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (ios && !nav.standalone) Promise.resolve().then(() => setTip(true));
  }, [refresh]);

  const create = async () => {
    const p = P.newProject((rows?.length ?? 0) + 1);
    await db.saveProject(p);
    onOpen(p.id);
  };

  const remove = async (p: Project) => {
    if (!confirm(`Delete "${p.name}"? This removes it from this device.`)) return;
    await db.deleteProject(p.id);
    await collectGarbage();
    refresh();
  };

  const mb = (b: number) => (b / 1e6 < 1000 ? `${Math.round(b / 1e6)} MB` : `${(b / 1e9).toFixed(1)} GB`);

  return (
    <div className="ed home">
      <div className="hero">
        <RibbonHero accent={ACCENT} />
        <h1 className="brand">
          <img src="/cut/logo.svg" alt="" width={36} height={36} />
          Lunyx
        </h1>
        <p>Cut, grade, caption and light your videos. Everything stays on this device.</p>
        <button className="newbtn" onClick={create}>
          <Plus size={22} /> New project
        </button>
      </div>
      {tip && (
        <div className="tip">
          <b>Install the app:</b> tap the Share button in Safari, then <b>Add to Home Screen</b>. It opens full screen and works offline.
        </div>
      )}
      <div className="sectionh">
        <span>projects · {rows?.length ?? 0}</span>
        {info.quota > 0 && <span>{mb(info.used)} of {mb(info.quota)}</span>}
      </div>
      <div className="plist">
        {rows?.map(({ p, thumb, dur }) => (
          <div key={p.id} className="pcard" onClick={() => onOpen(p.id)}>
            <div className="th" style={{ backgroundImage: thumb ? `url(${thumb})` : undefined }} />
            <div className="meta">
              {p.name}
              <small>
                {P.fmt(dur)} · {p.aspect} · {new Date(p.updated).toLocaleDateString()}
              </small>
            </div>
            <button className="del" aria-label="Delete project" onClick={(e) => { e.stopPropagation(); remove(p); }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================================================================ small controls

function Slider({ label, value, min, max, step = 0.01, onChange, show }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; show?: (v: number) => string }) {
  return (
    <div className="row">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} onDoubleClick={() => onChange(min < 0 ? 0 : min)} />
      <span className="v">{show ? show(value) : Math.abs(max) <= 2 ? Math.round(value * 100) : value.toFixed(1)}</span>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span>{label}</span>
      <button className={"switch" + (on ? " on" : "")} aria-pressed={on} onClick={() => onChange(!on)} />
    </div>
  );
}

function Chips<T extends string | number>({ items, value, onChange, scroll }: { items: { k: T; label: string }[]; value: T; onChange: (v: T) => void; scroll?: boolean }) {
  return (
    <div className={"chips" + (scroll ? " scroll" : "")}>
      {items.map((it) => (
        <button key={String(it.k)} className={"chip" + (it.k === value ? " on" : "")} onClick={() => onChange(it.k)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const swatches = ["#ffffff", "#000000", "#ffe14d", "#3dff6e", "#2997ff", "#ff2e96", "#ff453a", "#bf5af2"];
  return (
    <div className="row">
      <label>{label}</label>
      <div className="chips scroll" style={{ flex: 1, padding: 0 }}>
        {swatches.map((s) => (
          <button key={s} aria-label={s} onClick={() => onChange(s)} style={{ width: 28, height: 28, flex: "none", borderRadius: 14, background: s, boxShadow: value.slice(0, 7) === s ? `0 0 0 2px ${ACCENT}` : "inset 0 0 0 1px #555" }} />
        ))}
      </div>
      <input type="color" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet">
      <div className="sheet-h">
        <span>{title}</span>
        <button onClick={onClose}>Done</button>
      </div>
      <div className="sheet-b">{children}</div>
    </div>
  );
}

function Tool({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={"tool" + (danger ? " danger" : "")} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ================================================================ editor

type Sel = { type: "clip" | "text" | "music"; id: string } | null;
type Drag = { kind: string; id: string; x0: number; y0: number; orig: Record<string, number> } | null;

function chunksToWords(chunks: AsrChunk[], total: number): Word[] {
  const words: Word[] = [];
  chunks.forEach((c, i) => {
    const s = c.timestamp[0] ?? 0;
    const e = c.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? Math.min(total, s + 3);
    const toks = c.text.trim().split(/\s+/).filter(Boolean);
    const chars = toks.reduce((n, t) => n + t.length + 1, 0) || 1;
    let t = s;
    for (const tok of toks) {
      const d = ((e - s) * (tok.length + 1)) / chars;
      words.push({ w: tok, s: t, e: t + d });
      t += d;
    }
  });
  return words;
}

function Editor({ id, onBack }: { id: string; onBack: () => void }) {
  const [p, setP] = useState<Project | null>(null);
  const pRef = useRef<Project | null>(null);
  const undoS = useRef<Project[]>([]);
  const redoS = useRef<Project[]>([]);
  const lastMerge = useRef({ key: "", at: 0 });
  const saveTimer = useRef(0);
  const player = useRef<Player | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tlRef = useRef<HTMLDivElement>(null);
  const timeLbl = useRef<HTMLSpanElement>(null);
  const progScroll = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const musicRef = useRef<HTMLInputElement>(null);
  const bgImgRef = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag>(null);
  const exportSignal = useRef({ cancel: false });
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [pps, setPps] = useState(50);
  const [assets, setAssets] = useState<Record<string, { kind: Asset["kind"]; duration: number; name: string; thumb: string }>>({});
  const [hist, setHist] = useState({ u: 0, r: 0 });
  const [exp, setExp] = useState<{ phase: "setup" | "running" | "done"; progress: number; url?: string; blob?: Blob; res: number }>({ phase: "setup", progress: 0, res: 1280 });
  const [cut, setCut] = useState({ scope: "all", auto: true, thresh: -40, minSil: 0.45, pad: 0.12 });
  const [cap, setCap] = useState({ model: ASR_MODELS[0].id, words: 3 });
  const [recMode, setRecMode] = useState<"camera" | "voice" | null>(null);
  const [safe, setSafe] = useState(false);
  const [fillerExtra, setFillerExtra] = useState(false);
  const voStart = useRef(0);

  // ---------------------------------------------------------------- project state

  const apply = useCallback((next: Project) => {
    pRef.current = next;
    setP(next);
    player.current?.setProject(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => db.saveProject(next), 350);
  }, []);

  const commit = useCallback((fn: (d: Project) => void, merge?: string) => {
    const cur = pRef.current;
    if (!cur) return;
    const next = structuredClone(cur);
    fn(next);
    next.updated = Date.now();
    const now = Date.now();
    if (!(merge && lastMerge.current.key === merge && now - lastMerge.current.at < 1500)) {
      undoS.current.push(cur);
      if (undoS.current.length > 80) undoS.current.shift();
      redoS.current = [];
      setHist({ u: undoS.current.length, r: redoS.current.length });
    }
    lastMerge.current = { key: merge ?? "", at: now };
    apply(next);
  }, [apply]);

  const undo = () => {
    const prev = undoS.current.pop();
    if (!prev || !pRef.current) return;
    redoS.current.push(pRef.current);
    lastMerge.current.key = "";
    apply(prev);
    setHist({ u: undoS.current.length, r: redoS.current.length });
  };
  const redo = () => {
    const next = redoS.current.pop();
    if (!next || !pRef.current) return;
    undoS.current.push(pRef.current);
    apply(next);
    setHist({ u: undoS.current.length, r: redoS.current.length });
  };

  // ---------------------------------------------------------------- setup

  useEffect(() => {
    const pl = new Player();
    player.current = pl;
    pl.onState = setPlaying;
    pl.onStatus = setStatus;
    pl.onTime = (t) => {
      const end = pl.lay.end;
      if (timeLbl.current) timeLbl.current.textContent = `${P.fmt(t)} / ${P.fmt(end)}`;
      const tl = tlRef.current;
      if (tl) {
        const want = t * (Number(tl.dataset.pps) || 50);
        if (Math.abs(tl.scrollLeft - want) > 1) {
          progScroll.current = true;
          tl.scrollLeft = want;
        }
      }
    };
    db.project(id).then((proj) => {
      if (!proj) return onBack();
      pRef.current = proj;
      setP(proj);
      pl.setProject(proj);
    });
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.code === "Space") { e.preventDefault(); pl.toggle(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      pl.destroy();
      if (pRef.current) db.saveProject(pRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Asset metadata + thumbnails for the timeline.
  useEffect(() => {
    if (!p) return;
    const ids = new Set([...p.clips.map((c) => c.assetId), ...p.music.map((m) => m.assetId)]);
    const missing = [...ids].filter((x) => !assets[x]);
    if (!missing.length) return;
    Promise.all(missing.map(async (aid) => {
      const a = await loadAsset(aid);
      return a ? [aid, { kind: a.kind, duration: a.duration, name: a.name, thumb: await thumbUrl(a) }] as const : null;
    })).then((got) => setAssets((s) => ({ ...s, ...Object.fromEntries(got.filter((x) => !!x)) })));
  }, [p, assets]);

  useEffect(() => {
    const tl = tlRef.current;
    if (tl && player.current) {
      progScroll.current = true;
      tl.scrollLeft = player.current.time * pps;
    }
  }, [pps]);

  useEffect(() => {
    if (p && canvasRef.current) player.current?.attach(canvasRef.current);
  }, [p]);

  useEffect(() => {
    if (player.current) player.current.showSafe = safe;
    player.current?.requestRender();
  }, [safe]);

  useEffect(() => {
    if (player.current) player.current.selectedText = sel?.type === "text" ? sel.id : null;
    player.current?.requestRender();
  }, [sel]);

  if (!p) {
    return (
      <div className="ed" />
    );
  }

  // ---------------------------------------------------------------- derived

  const lay = P.layout(p);
  const T = () => player.current?.time ?? 0;
  const selClip = sel?.type === "clip" ? p.clips.find((c) => c.id === sel.id) : undefined;
  const selClipIdx = selClip ? p.clips.indexOf(selClip) : -1;
  const selText = sel?.type === "text" ? p.texts.find((t) => t.id === sel.id) : undefined;
  const selMusic = sel?.type === "music" ? p.music.find((m) => m.id === sel.id) : undefined;
  const clipAt = (t: number) => {
    let k = -1;
    p.clips.forEach((_, i) => { if (lay.starts[i] <= t) k = i; });
    return k;
  };
  const updClip = (fn: (c: Clip, d: Project) => void, merge?: string) =>
    commit((d) => { const c = d.clips.find((x) => x.id === selClip?.id); if (c) fn(c, d); }, merge);
  const updLook = (fn: (l: Look) => void, merge?: string) => updClip((c) => fn(c.look), merge);
  const updText = (fn: (t: TextItem) => void, merge?: string) =>
    commit((d) => { const t = d.texts.find((x) => x.id === selText?.id); if (t) fn(t); }, merge);

  const flash = (s: string) => { setStatus(s); setTimeout(() => setStatus((cur) => (cur === s ? "" : cur)), 2200); };

  // ---------------------------------------------------------------- media

  const addMedia = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setBusy(true);
    const added: Asset[] = [];
    for (const f of Array.from(files)) {
      setStatus(`Importing ${f.name}…`);
      try { added.push(await importFile(f)); } catch { flash(`Can't open ${f.name}`); }
    }
    setStatus("");
    setBusy(false);
    if (!added.length) return;
    commit((d) => {
      const at = selClipIdx >= 0 ? selClipIdx + 1 : d.clips.length;
      d.clips.splice(at, 0, ...added.map((a) => P.newClip(a.id, a.kind === "image" ? 3 : a.duration)));
      if (d.clips.length === added.length && added[0].w && added[0].h) {
        const r = added[0].w / added[0].h;
        d.aspect = r > 1.5 ? "16:9" : r > 1.1 ? "4:5" : r > 0.9 ? "1:1" : "9:16";
        if (r > 0.9 && r < 1.1) d.aspect = "1:1";
      }
    });
  };

  const addMusic = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setStatus("Importing audio…");
    try {
      const a = await importFile(f);
      commit((d) => d.music.push({ id: P.uid(), assetId: a.id, start: T(), in: 0, out: a.duration, volume: 0.6, fadeIn: 0.5, fadeOut: 1 }));
      flash("Music added");
    } catch {
      flash("Can't open that file");
    }
  };

  const setBgImage = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const a = await importFile(f);
    updLook((l) => { l.cutout = true; l.bg.mode = 3; l.bg.imageId = a.id; });
  };

  // ---------------------------------------------------------------- edit actions

  const split = () => {
    const t = T();
    if (selText) {
      if (t <= selText.start + 0.05 || t >= selText.end - 0.05) return flash("Move the playhead inside the text");
      return commit((d) => {
        const x = d.texts.find((q) => q.id === selText.id)!;
        const y = { ...structuredClone(x), id: P.uid(), start: t };
        x.end = t;
        d.texts.splice(d.texts.indexOf(x) + 1, 0, y);
      });
    }
    let k = selClipIdx;
    if (k < 0 || t < lay.starts[k] || t > lay.starts[k] + P.clipLen(p.clips[k])) k = clipAt(t);
    if (k < 0) return;
    const c = p.clips[k];
    const local = c.in + (t - lay.starts[k]) * c.speed;
    if (local - c.in < 0.1 || c.out - local < 0.1) return flash("Too close to the edge");
    commit((d) => {
      const a = d.clips[k];
      const b = { ...structuredClone(a), id: P.uid(), in: local };
      a.out = local;
      a.transition = { kind: 0, dur: a.transition.dur };
      d.clips.splice(k + 1, 0, b);
    });
  };

  const del = () => {
    if (!sel) return;
    commit((d) => {
      if (sel.type === "clip") d.clips = d.clips.filter((c) => c.id !== sel.id);
      if (sel.type === "text") d.texts = d.texts.filter((c) => c.id !== sel.id);
      if (sel.type === "music") d.music = d.music.filter((c) => c.id !== sel.id);
    });
    setSel(null);
    setPanel(null);
  };

  const duplicate = () => {
    if (selClip) commit((d) => d.clips.splice(selClipIdx + 1, 0, { ...structuredClone(selClip), id: P.uid() }));
    if (selText) {
      const len = selText.end - selText.start;
      commit((d) => d.texts.push({ ...structuredClone(selText), id: P.uid(), start: selText.end, end: selText.end + len }));
    }
  };

  const move = (dir: -1 | 1) => {
    const j = selClipIdx + dir;
    if (selClipIdx < 0 || j < 0 || j >= p.clips.length) return;
    commit((d) => { [d.clips[selClipIdx], d.clips[j]] = [d.clips[j], d.clips[selClipIdx]]; });
  };

  const addText = () => {
    const t = T();
    const item: TextItem = { ...P.defaultStyle(), size: 70, id: P.uid(), start: t, end: Math.max(t + 3, t + 0.5), text: "Your text", x: 0.5, y: 0.4 };
    commit((d) => d.texts.push(item));
    setSel({ type: "text", id: item.id });
    setPanel("textEdit");
  };

  // ---------------------------------------------------------------- AI tools

  const autoCut = async () => {
    const fx = await getFx();
    setBusy(true);
    let removed = 0, pieces = 0;
    try {
      const cur = pRef.current!;
      const next: Clip[] = [];
      for (const c of cur.clips) {
        const target = cut.scope === "all" || c.id === selClip?.id;
        const kind = assets[c.assetId]?.kind;
        if (!target || kind === "image") { next.push(c); continue; }
        setStatus("Listening for silence…");
        const pcm = await pcm16k(c.assetId);
        if (!pcm.length) { next.push(c); continue; }
        const part = pcm.subarray(Math.floor(c.in * PCM_RATE), Math.floor(c.out * PCM_RATE));
        const { ranges } = fx.silence(part, PCM_RATE, cut.auto ? 1 : cut.thresh, cut.minSil, cut.pad, 0.15);
        const kept = ranges.reduce((n, [a, b]) => n + b - a, 0);
        removed += c.out - c.in - kept;
        if (!ranges.length) { next.push(c); continue; }
        ranges.forEach(([a, b], i) => {
          pieces++;
          next.push({
            ...structuredClone(c), id: P.uid(), in: c.in + a, out: c.in + b,
            transition: i === ranges.length - 1 ? c.transition : { kind: 0, dur: c.transition.dur },
          });
        });
      }
      commit((d) => { d.clips = next; });
      setSel(null);
      flash(removed > 0.05 ? `Removed ${removed.toFixed(1)}s of silence · ${pieces} clips` : "No silence found");
    } catch (e) {
      flash("Auto cut failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Word timings for an asset's speech (cached per asset + model). */
  const getWords = async (aid: string) => {
    const key = `tr2:${aid}:${cap.model}`;
    let words = await db.get<Word[]>(key);
    if (!words) {
      setStatus("Reading audio…");
      const pcm = await pcm16k(aid);
      if (!pcm.length) return null;
      const chunks = await transcribe(pcm, cap.model, setStatus);
      words = chunksToWords(chunks, pcm.length / PCM_RATE);
      await db.set(key, words);
    }
    return words;
  };

  /** Cuts filler words ("um", "uh", repeated words…) out of every clip using the transcript. */
  const removeFillers = async () => {
    setBusy(true);
    try {
      const cur = pRef.current!;
      const fill = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "hmm", "mm", "eh"]);
      if (fillerExtra) ["like", "basically", "literally", "actually", "so", "right", "okay"].forEach((w) => fill.add(w));
      const norm = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "");
      const next: Clip[] = [];
      let count = 0;
      for (const c of cur.clips) {
        const words = assets[c.assetId]?.kind === "image" ? null : await getWords(c.assetId);
        if (!words) { next.push(c); continue; }
        const inClip = words.filter((w) => w.s >= c.in - 0.05 && w.e <= c.out + 0.05);
        const cuts: [number, number][] = [];
        inClip.forEach((w, i) => {
          const n = norm(w.w);
          const repeat = i > 0 && n.length > 0 && n === norm(inClip[i - 1].w) && w.s - inClip[i - 1].e < 0.4;
          if (fill.has(n) || repeat) cuts.push([Math.max(c.in, w.s - 0.02), Math.min(c.out, w.e + 0.02)]);
        });
        if (!cuts.length) { next.push(c); continue; }
        count += cuts.length;
        let a = c.in;
        const pieces: [number, number][] = [];
        for (const [s0, e0] of cuts) { if (s0 - a > 0.08) pieces.push([a, s0]); a = Math.max(a, e0); }
        if (c.out - a > 0.08) pieces.push([a, c.out]);
        pieces.forEach(([s0, e0], i) => next.push({ ...structuredClone(c), id: P.uid(), in: s0, out: e0, transition: i === pieces.length - 1 ? c.transition : { kind: 0, dur: c.transition.dur } }));
      }
      commit((d) => { d.clips = next; });
      setSel(null);
      flash(count ? `Removed ${count} filler word${count > 1 ? "s" : ""}` : "No filler words found");
    } catch (e) {
      flash("Filler removal failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Alternating punch-in zooms on jump cuts (consecutive clips from the same take). */
  const punchIn = () =>
    commit((d) => {
      let flip = false;
      d.clips.forEach((c, i) => {
        const prev = d.clips[i - 1];
        flip = prev && prev.assetId === c.assetId ? !flip : false;
        c.zoom = flip ? 1.15 : 1;
      });
    });

  const addTemplate = (text: string, kind: "hook" | "cta" | "label") => {
    const t = kind === "cta" ? Math.max(0, lay.end - 3) : T();
    const style: Partial<TextItem> =
      kind === "hook" ? { font: "Montserrat", weight: 900, size: 58, color: "#000000", bgOn: true, bg: "#ffffff", stroke: 0, anim: "pop", upper: false, y: 0.2 }
      : kind === "cta" ? { font: "Poppins", weight: 900, size: 54, color: "#ffffff", bgOn: true, bg: "#ff2e96", stroke: 0, anim: "bounce", upper: false, y: 0.7 }
      : { font: "Anton", weight: 400, size: 66, color: "#ffffff", bgOn: false, stroke: 8, strokeColor: "#000000", anim: "zoom", upper: true, y: 0.3 };
    const item: TextItem = { ...P.defaultStyle(), x: 0.5, y: 0.2, ...style, id: P.uid(), start: t, end: t + 3, text };
    commit((d) => d.texts.push(item));
    setSel({ type: "text", id: item.id });
    setPanel("textEdit");
  };

  const onRecorded = async (f: File) => {
    if (recMode === "camera") {
      setRecMode(null);
      await addMedia([f]);
    } else {
      const a = await importFile(f);
      commit((d) => d.music.push({ id: P.uid(), assetId: a.id, start: voStart.current, in: 0, out: a.duration, volume: 1, fadeIn: 0, fadeOut: 0, vo: true }));
      flash("Voiceover added");
    }
  };

  const genCaptions = async () => {
    setBusy(true);
    try {
      const cur = pRef.current!;
      const ids = [...new Set(cur.clips.map((c) => c.assetId))].filter((a) => assets[a]?.kind !== "image");
      const byAsset: Record<string, Word[]> = {};
      for (const aid of ids) {
        const words = await getWords(aid);
        if (words) byAsset[aid] = words;
      }
      const style = cur.captionStyle;
      const items: TextItem[] = [];
      const L = P.layout(cur);
      cur.clips.forEach((c, i) => {
        const ws = (byAsset[c.assetId] ?? [])
          .filter((w) => (w.s + w.e) / 2 >= c.in && (w.s + w.e) / 2 < c.out)
          .map((w) => ({ w: w.w, s: L.starts[i] + (Math.max(w.s, c.in) - c.in) / c.speed, e: L.starts[i] + (Math.min(w.e, c.out) - c.in) / c.speed }));
        let group: Word[] = [];
        const flush = () => {
          if (!group.length) return;
          items.push({ ...structuredClone(style), id: P.uid(), start: group[0].s, end: group[group.length - 1].e, text: group.map((g) => g.w).join(" "), x: 0.5, y: 0.72, caption: true, words: group });
          group = [];
        };
        for (const w of ws) {
          const prev = group[group.length - 1];
          if (prev && (group.length >= cap.words || w.s - prev.e > 0.5 || /[.?!,]$/.test(prev.w))) flush();
          group.push(w);
        }
        flush();
      });
      // Close tiny gaps so captions don't flicker.
      items.forEach((it, i) => { const n = items[i + 1]; if (n && n.start - it.end < 0.3) it.end = n.start; });
      commit((d) => { d.texts = [...d.texts.filter((t) => !t.caption), ...items]; });
      flash(items.length ? `Added ${items.length} captions` : "No speech found");
    } catch (e) {
      flash("Captions failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setCaptionStyle = (s: Partial<TextStyle>) =>
    commit((d) => {
      d.captionStyle = { ...d.captionStyle, ...s };
      d.texts.forEach((t) => t.caption && Object.assign(t, s));
    }, "capstyle");

  const normalize = async () => {
    if (!selClip) return;
    const fx = await getFx();
    const pcm = await pcm16k(selClip.assetId);
    if (!pcm.length) return flash("No audio in this clip");
    const db_ = fx.rmsDb(pcm.subarray(Math.floor(selClip.in * PCM_RATE), Math.floor(selClip.out * PCM_RATE)));
    const g = Math.min(4, Math.max(0.25, Math.pow(10, (-20 - db_) / 20)));
    updClip((c) => (c.volume = +g.toFixed(2)));
    flash(`Loudness ${db_.toFixed(1)} dB → volume ${Math.round(g * 100)}%`);
  };

  // ---------------------------------------------------------------- export

  const runExport = async () => {
    const pl = player.current;
    if (!pl || !p.clips.length) return;
    exportSignal.current = { cancel: false };
    setExp((e) => ({ ...e, phase: "running", progress: 0 }));
    try {
      const blob = await pl.exportVideo(exp.res, 30, (f) => setExp((e) => ({ ...e, progress: f })), exportSignal.current);
      if (!blob) return setExp((e) => ({ ...e, phase: "setup" }));
      setExp((e) => ({ ...e, phase: "done", blob, url: URL.createObjectURL(blob) }));
    } catch (e) {
      flash("Export failed: " + (e as Error).message);
      setExp((x) => ({ ...x, phase: "setup" }));
    }
  };

  const fileName = () => `${p.name.replace(/[^\w-]+/g, "_")}.${exp.blob?.type.includes("webm") ? "webm" : "mp4"}`;
  const share = async () => {
    if (!exp.blob) return;
    const file = new File([exp.blob], fileName(), { type: exp.blob.type });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] }).catch(() => {});
    else flash("Sharing not supported here, use Download");
  };

  // ---------------------------------------------------------------- pointer handling

  const startDrag = (e: React.PointerEvent, kind: string, itemId: string, orig: Record<string, number>) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind, id: itemId, x0: e.clientX, y0: e.clientY, orig };
    player.current?.pause();
  };

  const onDragMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const ds = (e.clientX - g.x0) / pps;
    const o = g.orig;
    commit((d) => {
      if (g.kind === "trimL" || g.kind === "trimR") {
        const c = d.clips.find((x) => x.id === g.id);
        if (!c) return;
        const a = assets[c.assetId];
        const max = a?.kind === "image" ? 60 : a?.duration ?? c.out;
        if (g.kind === "trimL") c.in = Math.min(Math.max(0, o.in + ds * c.speed), c.out - 0.1);
        else c.out = Math.max(Math.min(max, o.out + ds * c.speed), c.in + 0.1);
      } else if (g.kind.startsWith("t")) {
        const t = d.texts.find((x) => x.id === g.id);
        if (!t) return;
        if (g.kind === "tMove") { t.start = Math.max(0, o.start + ds); t.end = t.start + (o.end - o.start); }
        if (g.kind === "tL") t.start = Math.min(Math.max(0, o.start + ds), t.end - 0.1);
        if (g.kind === "tR") t.end = Math.max(o.end + ds, t.start + 0.1);
      } else if (g.kind.startsWith("m")) {
        const m = d.music.find((x) => x.id === g.id);
        if (!m) return;
        const a = assets[m.assetId];
        if (g.kind === "mMove") m.start = Math.max(0, o.start + ds);
        if (g.kind === "mL") { const nIn = Math.min(Math.max(0, o.in + ds), m.out - 0.5); m.start = o.start + (nIn - o.in); m.in = nIn; }
        if (g.kind === "mR") m.out = Math.max(Math.min(a?.duration ?? m.out, o.out + ds), m.in + 0.5);
      } else if (g.kind === "pos") {
        const t = d.texts.find((x) => x.id === g.id);
        const cv = canvasRef.current!.getBoundingClientRect();
        if (t) { t.x = Math.min(1, Math.max(0, o.x + (e.clientX - g.x0) / cv.width)); t.y = Math.min(1, Math.max(0, o.y + (e.clientY - g.y0) / cv.height)); }
      }
    }, "drag" + g.kind + g.id);
  };

  const endDrag = () => {
    const g = drag.current;
    drag.current = null;
    // Caption words move with their block.
    if (g?.kind === "tMove") {
      commit((d) => {
        const t = d.texts.find((x) => x.id === g.id);
        if (t?.words) { const shift = t.start - g.orig.start; t.words = t.words.map((w) => ({ ...w, s: w.s + shift, e: w.e + shift })); }
      }, "drag" + g.kind + g.id);
    }
  };

  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = e.currentTarget;
    const r = cv.getBoundingClientRect();
    const hit = player.current?.textAt(((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height);
    if (hit) {
      const t = p.texts.find((x) => x.id === hit)!;
      if (sel?.type === "text" && sel.id === hit) setPanel("textEdit");
      setSel({ type: "text", id: hit });
      startDrag(e, "pos", hit, { x: t.x, y: t.y });
    } else {
      if (sel?.type === "text") setSel(null);
      player.current?.toggle();
    }
  };

  const onTlScroll = () => {
    if (progScroll.current) { progScroll.current = false; return; }
    const pl = player.current;
    const tl = tlRef.current;
    if (!pl || !tl) return;
    if (pl.playing) pl.pause();
    pl.seek(tl.scrollLeft / pps);
  };

  // ---------------------------------------------------------------- panels

  const L = selClip?.look;
  const panels: Record<string, () => ReactNode> = {
    filters: () => L && (
      <Sheet title="Filters" onClose={() => setPanel(null)}>
        <div className="grid">
          {P.FILTERS.map((f) => {
            const g = f.g;
            const hue = `linear-gradient(135deg, rgb(${120 + (g.sTone?.[0] ?? 0) * 200},${120 + (g.sTone?.[1] ?? 0) * 200},${120 + (g.sTone?.[2] ?? 0) * 200}), rgb(${180 + (g.hTone?.[0] ?? 0) * 150},${180 + (g.hTone?.[1] ?? 0) * 150},${180 + (g.hTone?.[2] ?? 0) * 150}))`;
            return (
              <button key={f.id} className={"tile" + (L.filter === f.id ? " on" : "")} style={{ background: g.mono ? "linear-gradient(135deg,#222,#bbb)" : f.id === "none" ? undefined : hue, color: "#fff", textShadow: "0 1px 3px #000" }} onClick={() => updLook((l) => { l.filter = f.id; })}>
                {f.name}
              </button>
            );
          })}
        </div>
        <Slider label="Strength" value={L.filterAmt} min={0} max={1.5} onChange={(v) => updLook((l) => (l.filterAmt = v), "famt")} />
        <button className="btn gray" onClick={() => commit((d) => d.clips.forEach((c) => { c.look.filter = L.filter; c.look.filterAmt = L.filterAmt; }))}>Apply to all clips</button>
      </Sheet>
    ),
    adjust: () => L && (
      <Sheet title="Adjust" onClose={() => setPanel(null)}>
        {P.ADJUST.map((a) => (
          <Slider key={a.key} label={a.name} value={L.adj[a.key]} min={a.min} max={a.max} onChange={(v) => updLook((l) => (l.adj[a.key] = v), "adj" + a.key)} />
        ))}
        <button className="btn gray" onClick={() => updLook((l) => (l.adj = P.zeroAdj()))}>Reset</button>
        <button className="btn gray" onClick={() => commit((d) => d.clips.forEach((c) => (c.look.adj = { ...L.adj })))}>Apply to all clips</button>
      </Sheet>
    ),
    cutout: () => L && (
      <Sheet title="Background" onClose={() => setPanel(null)}>
        <Toggle label="Cut out person (AI)" on={L.cutout} onChange={(v) => updLook((l) => { l.cutout = v; if (v && !l.bg.mode) l.bg.mode = 1; })} />
        <p className="note">Finds you in every frame on-device and lets you swap what&apos;s behind. The model downloads once (~250 KB).</p>
        {L.cutout && (
          <>
            <Chips items={P.BG_MODES.map((n, i) => ({ k: i, label: n }))} value={L.bg.mode} onChange={(v) => { if (v === 3 && !L.bg.imageId) bgImgRef.current?.click(); else updLook((l) => (l.bg.mode = v)); }} />
            {(L.bg.mode === 1 || L.bg.mode === 3) && <Slider label="Blur" value={L.bg.blur} min={0} max={80} step={1} onChange={(v) => updLook((l) => (l.bg.blur = v), "bgblur")} />}
            {(L.bg.mode === 2 || L.bg.mode === 4) && <ColorRow label="Color" value={L.bg.color} onChange={(v) => updLook((l) => (l.bg.color = v), "bgc")} />}
            {L.bg.mode === 4 && <ColorRow label="Color 2" value={L.bg.color2} onChange={(v) => updLook((l) => (l.bg.color2 = v), "bgc2")} />}
            {L.bg.mode === 3 && <button className="btn gray" onClick={() => bgImgRef.current?.click()}>Choose image</button>}
            <Slider label="Darken bg" value={L.bg.dim} min={-1} max={1} onChange={(v) => updLook((l) => (l.bg.dim = v), "bgdim")} />
          </>
        )}
        <button className="btn gray" onClick={() => commit((d) => d.clips.forEach((c) => { c.look.cutout = L.cutout; c.look.bg = { ...L.bg }; }))}>Apply to all clips</button>
      </Sheet>
    ),
    light: () => L && (
      <Sheet title="Lighting" onClose={() => setPanel(null)}>
        <div className="grid">
          {P.LIGHTS.map((li) => (
            <button key={li.id} className={"tile" + (L.light.preset === li.id ? " on" : "")} style={{ background: li.mode ? `radial-gradient(circle at ${li.pos * 100}% 20%, ${li.color}, #1c1c1e 75%)` : undefined, color: "#fff", textShadow: "0 1px 3px #000" }}
              onClick={() => updLook((l) => { l.light = { ...l.light, preset: li.id, color: li.color, color2: li.color2 ?? l.light.color2, amount: li.amount, soft: li.soft, speed: li.speed, pos: li.pos }; })}>
              {li.name}
            </button>
          ))}
        </div>
        {L.light.preset !== "none" && (
          <>
            <Slider label="Intensity" value={L.light.amount} min={0} max={1.5} onChange={(v) => updLook((l) => (l.light.amount = v), "la")} />
            <Slider label="Position" value={L.light.pos} min={0} max={1} onChange={(v) => updLook((l) => (l.light.pos = v), "lp")} />
            <Slider label="Softness" value={L.light.soft} min={0} max={1} onChange={(v) => updLook((l) => (l.light.soft = v), "ls")} />
            <Slider label="Motion" value={L.light.speed} min={0} max={3} onChange={(v) => updLook((l) => (l.light.speed = v), "lsp")} />
            <ColorRow label="Color" value={L.light.color} onChange={(v) => updLook((l) => (l.light.color = v), "lc")} />
            {P.LIGHTS.find((x) => x.id === L.light.preset)?.mode === 6 && <ColorRow label="Color 2" value={L.light.color2} onChange={(v) => updLook((l) => (l.light.color2 = v), "lc2")} />}
            <Toggle label="Only light the background (uses cutout)" on={L.cutout} onChange={(v) => updLook((l) => (l.cutout = v))} />
            {L.cutout && <Slider label="Light on you" value={L.light.subject} min={0} max={1} onChange={(v) => updLook((l) => (l.light.subject = v), "lsub")} />}
          </>
        )}
        <button className="btn gray" onClick={() => commit((d) => d.clips.forEach((c) => { c.look.light = { ...L.light }; c.look.cutout = c.look.cutout || L.cutout; }))}>Apply to all clips</button>
      </Sheet>
    ),
    speed: () => selClip && (
      <Sheet title="Speed" onClose={() => setPanel(null)}>
        <Chips items={P.SPEEDS.map((s) => ({ k: s, label: s + "×" }))} value={selClip.speed} onChange={(v) => updClip((c) => (c.speed = v))} />
        <Slider label="Custom" value={selClip.speed} min={0.25} max={4} step={0.05} show={(v) => v.toFixed(2) + "×"} onChange={(v) => updClip((c) => (c.speed = v), "speed")} />
        <p className="note">Pitch is preserved. Clip length becomes {P.fmt(P.clipLen(selClip))}.</p>
      </Sheet>
    ),
    audio: () => selClip && (
      <Sheet title="Audio" onClose={() => setPanel(null)}>
        <Slider label="Volume" value={selClip.volume} min={0} max={2} show={(v) => Math.round(v * 100) + "%"} onChange={(v) => updClip((c) => (c.volume = v), "vol")} />
        <Toggle label="Mute" on={selClip.mute} onChange={(v) => updClip((c) => (c.mute = v))} />
        <Slider label="Fade in" value={selClip.fadeIn} min={0} max={3} show={(v) => v.toFixed(1) + "s"} onChange={(v) => updClip((c) => (c.fadeIn = v), "fi")} />
        <Slider label="Fade out" value={selClip.fadeOut} min={0} max={3} show={(v) => v.toFixed(1) + "s"} onChange={(v) => updClip((c) => (c.fadeOut = v), "fo")} />
        <Toggle label="Voice enhance" on={selClip.voice} onChange={(v) => updClip((c) => (c.voice = v))} />
        <div className="note">Equalizer</div>
        <Chips scroll items={Object.keys(P.EQ_PRESETS).map((k) => ({ k, label: k }))} value={Object.keys(P.EQ_PRESETS).find((k) => P.EQ_PRESETS[k].join() === selClip.eq.join()) ?? ""} onChange={(k) => updClip((c) => (c.eq = [...P.EQ_PRESETS[k]]))} />
        {P.EQ_BANDS.map((f, i) => (
          <Slider key={f} label={f >= 1000 ? f / 1000 + " kHz" : f + " Hz"} value={selClip.eq[i]} min={-12} max={12} step={0.5} show={(v) => (v > 0 ? "+" : "") + v + "dB"} onChange={(v) => updClip((c) => (c.eq[i] = v), "eq" + i)} />
        ))}
        <button className="btn gray" onClick={normalize}>Normalize loudness</button>
        <button className="btn gray" onClick={() => commit((d) => d.clips.forEach((c) => { c.eq = [...selClip.eq]; c.voice = selClip.voice; }))}>Apply EQ to all clips</button>
      </Sheet>
    ),
    transition: () => selClip && (
      <Sheet title="Transition to next clip" onClose={() => setPanel(null)}>
        {selClipIdx === p.clips.length - 1 ? <p className="note">Select a clip that has another clip after it.</p> : (
          <>
            <div className="grid">
              {P.TRANSITIONS.map((t) => (
                <button key={t.id} className={"tile" + (selClip.transition.kind === t.id ? " on" : "")} onClick={() => updClip((c) => (c.transition.kind = t.id))}>{t.name}</button>
              ))}
            </div>
            <Slider label="Duration" value={selClip.transition.dur} min={0.2} max={2} show={(v) => v.toFixed(1) + "s"} onChange={(v) => updClip((c) => (c.transition.dur = v), "tdur")} />
            <button className="btn gray" onClick={() => commit((d) => d.clips.forEach((c, i) => i < d.clips.length - 1 && (c.transition = { ...selClip.transition })))}>Apply to all cuts</button>
          </>
        )}
      </Sheet>
    ),
    transform: () => selClip && (
      <Sheet title="Transform" onClose={() => setPanel(null)}>
        <Slider label="Zoom" value={selClip.zoom} min={0.5} max={3} show={(v) => v.toFixed(2) + "×"} onChange={(v) => updClip((c) => (c.zoom = v), "zoom")} />
        <Slider label="Move X" value={selClip.panX} min={-0.5} max={0.5} onChange={(v) => updClip((c) => (c.panX = v), "px")} />
        <Slider label="Move Y" value={selClip.panY} min={-0.5} max={0.5} onChange={(v) => updClip((c) => (c.panY = v), "py")} />
        <Chips items={[0, 90, 180, 270].map((r) => ({ k: r, label: r + "°" }))} value={selClip.rotate} onChange={(v) => updClip((c) => (c.rotate = v))} />
        <Toggle label="Ken Burns slow zoom" on={selClip.kenBurns} onChange={(v) => updClip((c) => (c.kenBurns = v))} />
        <button className="btn gray" onClick={() => updClip((c) => { c.zoom = 1; c.panX = 0; c.panY = 0; c.rotate = 0; })}>Reset</button>
      </Sheet>
    ),
    canvas: () => (
      <Sheet title="Canvas" onClose={() => setPanel(null)}>
        <div className="note">Aspect ratio</div>
        <Chips items={Object.keys(P.ASPECTS).map((k) => ({ k, label: k }))} value={p.aspect} onChange={(v) => commit((d) => (d.aspect = v))} />
        <div className="note">Fit</div>
        <Chips items={[{ k: "cover", label: "Fill" }, { k: "contain", label: "Fit" }, { k: "blur", label: "Fit + blur" }] as { k: Project["fit"]; label: string }[]} value={p.fit} onChange={(v) => commit((d) => (d.fit = v))} />
        <ColorRow label="Background" value={p.bgColor} onChange={(v) => commit((d) => (d.bgColor = v), "bgcol")} />
        <Toggle label="Progress bar" on={!!p.progress?.on} onChange={(v) => commit((d) => (d.progress = { color: "#ffffff", top: false, ...d.progress, on: v }))} />
        {p.progress?.on && (
          <>
            <ColorRow label="Bar color" value={p.progress.color} onChange={(v) => commit((d) => (d.progress!.color = v), "pcol")} />
            <Chips items={[{ k: "t", label: "Top" }, { k: "b", label: "Bottom" }]} value={p.progress.top ? "t" : "b"} onChange={(v) => commit((d) => (d.progress!.top = v === "t"))} />
          </>
        )}
        <Toggle label="Show TikTok / Reels safe zones" on={safe} onChange={setSafe} />
        <Slider label="Master vol" value={p.master} min={0} max={2} show={(v) => Math.round(v * 100) + "%"} onChange={(v) => commit((d) => (d.master = v), "master")} />
      </Sheet>
    ),
    music: () => (
      <Sheet title="Music" onClose={() => setPanel(null)}>
        <button className="btn" onClick={() => musicRef.current?.click()}>Add music or sound at playhead</button>
        <Toggle label="Lower music when someone talks" on={p.duck} onChange={(v) => commit((d) => (d.duck = v))} />
        {selMusic && (
          <>
            <div className="note">{assets[selMusic.assetId]?.name}</div>
            <Slider label="Volume" value={selMusic.volume} min={0} max={2} show={(v) => Math.round(v * 100) + "%"} onChange={(v) => commit((d) => { const m = d.music.find((x) => x.id === selMusic.id); if (m) m.volume = v; }, "mvol")} />
            <Slider label="Fade in" value={selMusic.fadeIn} min={0} max={5} show={(v) => v.toFixed(1) + "s"} onChange={(v) => commit((d) => { const m = d.music.find((x) => x.id === selMusic.id); if (m) m.fadeIn = v; }, "mfi")} />
            <Slider label="Fade out" value={selMusic.fadeOut} min={0} max={5} show={(v) => v.toFixed(1) + "s"} onChange={(v) => commit((d) => { const m = d.music.find((x) => x.id === selMusic.id); if (m) m.fadeOut = v; }, "mfo")} />
            <button className="btn gray" onClick={() => commit((d) => { const m = d.music.find((x) => x.id === selMusic.id); if (m) m.out = Math.min(m.out, m.in + Math.max(0.5, P.layout(d).videoEnd - m.start)); })}>Trim to video length</button>
          </>
        )}
      </Sheet>
    ),
    autocut: () => (
      <Sheet title="Auto Cut Silence" onClose={() => setPanel(null)}>
        <p className="note">Listens to your audio and cuts out the pauses where nobody is talking. Runs in Rust on your device.</p>
        <Chips items={[{ k: "all", label: "All clips" }, { k: "sel", label: "Selected clip" }]} value={selClip ? cut.scope : "all"} onChange={(v) => setCut({ ...cut, scope: v })} />
        <Toggle label="Auto threshold" on={cut.auto} onChange={(v) => setCut({ ...cut, auto: v })} />
        {!cut.auto && <Slider label="Threshold" value={cut.thresh} min={-65} max={-15} step={1} show={(v) => v + "dB"} onChange={(v) => setCut({ ...cut, thresh: v })} />}
        <Slider label="Min pause" value={cut.minSil} min={0.15} max={2} show={(v) => v.toFixed(2) + "s"} onChange={(v) => setCut({ ...cut, minSil: v })} />
        <Slider label="Padding" value={cut.pad} min={0} max={0.5} show={(v) => v.toFixed(2) + "s"} onChange={(v) => setCut({ ...cut, pad: v })} />
        <button className="btn" disabled={busy || !p.clips.length} onClick={autoCut}>{busy ? "Working…" : "Cut silences"}</button>
        <div className="note" style={{ marginTop: 14 }}>Filler words</div>
        <p className="note">Removes &quot;um&quot;, &quot;uh&quot; and stutters (repeated words) using on-device speech recognition. Whisper sometimes cleans fillers out of its transcript, so a few may survive.</p>
        <Toggle label="Also cut like / basically / literally / so" on={fillerExtra} onChange={setFillerExtra} />
        <button className="btn" disabled={busy || !p.clips.length} onClick={removeFillers}>{busy ? "Working…" : "Remove filler words"}</button>
        <div className="note" style={{ marginTop: 14 }}>Jump cuts</div>
        <button className="btn gray" disabled={p.clips.length < 2} onClick={punchIn}>Add punch-in zooms</button>
        <p className="note">You can undo all of this.</p>
      </Sheet>
    ),
    captions: () => (
      <Sheet title="Auto Captions" onClose={() => setPanel(null)}>
        <p className="note">Speech recognition (Whisper) runs on your device. The model downloads once, then works offline.</p>
        <div className="row"><label>Model</label>
          <select value={cap.model} onChange={(e) => setCap({ ...cap, model: e.target.value })}>
            {ASR_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <Slider label="Words / line" value={cap.words} min={1} max={8} step={1} show={(v) => String(v)} onChange={(v) => setCap({ ...cap, words: v })} />
        <div className="note">Style</div>
        <Chips scroll items={P.CAPTION_STYLES.map((s) => ({ k: s.name, label: s.name }))} value="" onChange={(n) => setCaptionStyle(P.CAPTION_STYLES.find((s) => s.name === n)!.s)} />
        <div className="chips scroll">
          {P.FONTS.slice(0, 20).map((f) => (
            <button key={f.name} className={"chip" + (p.captionStyle.font === f.name ? " on" : "")} style={{ fontFamily: `"${f.name}"` }} onClick={() => setCaptionStyle({ font: f.name, weight: f.w[f.w.length - 1] })}>{f.name}</button>
          ))}
        </div>
        <ColorRow label="Highlight" value={p.captionStyle.highlight} onChange={(v) => setCaptionStyle({ highlight: v })} />
        <Slider label="Size" value={p.captionStyle.size} min={20} max={140} step={1} show={(v) => String(v)} onChange={(v) => setCaptionStyle({ size: v })} />
        <Slider label="Position" value={p.texts.find((t) => t.caption)?.y ?? 0.72} min={0.05} max={0.95} onChange={(v) => commit((d) => d.texts.forEach((t) => t.caption && (t.y = v)), "capy")} />
        <button className="btn" disabled={busy || !p.clips.length} onClick={genCaptions}>{busy ? "Working…" : p.texts.some((t) => t.caption) ? "Regenerate captions" : "Generate captions"}</button>
        {p.texts.some((t) => t.caption) && <button className="btn gray" onClick={() => commit((d) => (d.texts = d.texts.filter((t) => !t.caption)))}>Remove captions</button>}
      </Sheet>
    ),
    templates: () => (
      <Sheet title="Creator Templates" onClose={() => setPanel(null)}>
        <div className="note">Hooks · first 3 seconds</div>
        <div className="chips">
          {["POV: you finally found it", "Stop scrolling if you…", "3 things nobody tells you about", "I tried it so you don't have to", "Don't buy this until you watch", "Wait for the end 👀", "Honest review:", "This changed everything", "Day 1 vs Day 30", "You're doing it wrong"].map((h) => (
            <button key={h} className="chip" onClick={() => addTemplate(h, "hook")}>{h}</button>
          ))}
        </div>
        <div className="note">Calls to action · last 3 seconds</div>
        <div className="chips">
          {["Link in bio 🔗", "Follow for part 2", "Comment \"LINK\" and I'll DM you", "Save this for later 📌", "Shop now ↓", "Use code SAVE20", "Tag someone who needs this"].map((h) => (
            <button key={h} className="chip" onClick={() => addTemplate(h, "cta")}>{h}</button>
          ))}
        </div>
        <div className="note">Labels</div>
        <div className="chips">
          {["Before", "After", "Unboxing", "Results", "Step 1", "Step 2", "Step 3", "Pro tip", "Game changer"].map((h) => (
            <button key={h} className="chip" onClick={() => addTemplate(h, "label")}>{h}</button>
          ))}
        </div>
      </Sheet>
    ),
    textEdit: () => selText && (
      <Sheet title={selText.caption ? "Caption" : "Text"} onClose={() => setPanel(null)}>
        <textarea value={selText.text} onChange={(e) => updText((t) => { t.text = e.target.value; if (t.words && t.words.length !== e.target.value.split(/\s+/).filter(Boolean).length) t.words = undefined; }, "txt")} />
        <div className="note">Font</div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", maxHeight: 180, overflowY: "auto" }}>
          {P.FONTS.map((f) => (
            <button key={f.name} className={"fontbtn" + (selText.font === f.name ? " on" : "")} style={{ fontFamily: `"${f.name}"`, fontWeight: f.w[f.w.length - 1] }} onClick={() => updText((t) => { t.font = f.name; t.weight = f.w[f.w.length - 1]; })}>{f.name}</button>
          ))}
        </div>
        <Chips items={(P.FONTS.find((f) => f.name === selText.font)?.w ?? [400]).map((w) => ({ k: w, label: w === 400 ? "Regular" : w >= 900 ? "Black" : "Bold" }))} value={selText.weight} onChange={(v) => updText((t) => (t.weight = v))} />
        <Slider label="Size" value={selText.size} min={16} max={200} step={1} show={(v) => String(v)} onChange={(v) => updText((t) => (t.size = v), "size")} />
        <ColorRow label="Color" value={selText.color} onChange={(v) => updText((t) => (t.color = v), "col")} />
        <Slider label="Outline" value={selText.stroke} min={0} max={20} step={0.5} show={(v) => String(v)} onChange={(v) => updText((t) => (t.stroke = v), "stroke")} />
        {selText.stroke > 0 && <ColorRow label="Outline color" value={selText.strokeColor} onChange={(v) => updText((t) => (t.strokeColor = v), "scol")} />}
        <Slider label="Shadow" value={selText.shadow} min={0} max={1} onChange={(v) => updText((t) => (t.shadow = v), "shadow")} />
        <Toggle label="Background box" on={selText.bgOn} onChange={(v) => updText((t) => (t.bgOn = v))} />
        {selText.bgOn && <ColorRow label="Box color" value={selText.bg} onChange={(v) => updText((t) => (t.bg = v + "cc"), "bgc")} />}
        {selText.words && <ColorRow label="Word highlight" value={selText.highlight} onChange={(v) => updText((t) => (t.highlight = v), "hl")} />}
        <Toggle label="ALL CAPS" on={selText.upper} onChange={(v) => updText((t) => (t.upper = v))} />
        <Chips items={(["left", "center", "right"] as const).map((a) => ({ k: a, label: a[0].toUpperCase() + a.slice(1) }))} value={selText.align} onChange={(v) => updText((t) => (t.align = v))} />
        <div className="note">Animation</div>
        <Chips scroll items={P.TEXT_ANIMS.map((a) => ({ k: a, label: a[0].toUpperCase() + a.slice(1) }))} value={selText.anim} onChange={(v) => updText((t) => (t.anim = v))} />
        {selText.caption && (
          <button className="btn gray" onClick={() => { const { font, weight, size, color, stroke, strokeColor, shadow, bg, bgOn, highlight, anim, upper, align } = selText; setCaptionStyle({ font, weight, size, color, stroke, strokeColor, shadow, bg, bgOn, highlight, anim, upper, align }); }}>Apply style to all captions</button>
        )}
      </Sheet>
    ),
  };

  // ---------------------------------------------------------------- toolbar

  const close = () => { setSel(null); setPanel(null); };
  const I = 22;
  let tools: ReactNode;
  if (selClip) {
    tools = (
      <>
        <Tool icon={<ChevronLeft size={I} />} label="Back" onClick={close} />
        <Tool icon={<Scissors size={I} />} label="Split" onClick={split} />
        <Tool icon={<Gauge size={I} />} label="Speed" onClick={() => setPanel("speed")} />
        <Tool icon={<Palette size={I} />} label="Filters" onClick={() => setPanel("filters")} />
        <Tool icon={<SlidersHorizontal size={I} />} label="Adjust" onClick={() => setPanel("adjust")} />
        <Tool icon={<ScanFace size={I} />} label="Cutout" onClick={() => setPanel("cutout")} />
        <Tool icon={<Lamp size={I} />} label="Lighting" onClick={() => setPanel("light")} />
        <Tool icon={<Volume2 size={I} />} label="Audio/EQ" onClick={() => setPanel("audio")} />
        <Tool icon={<Blend size={I} />} label="Transition" onClick={() => setPanel("transition")} />
        <Tool icon={<Move size={I} />} label="Transform" onClick={() => setPanel("transform")} />
        <Tool icon={<AudioWaveform size={I} />} label="Cut silence" onClick={() => { setCut({ ...cut, scope: "sel" }); setPanel("autocut"); }} />
        <Tool icon={<ArrowLeft size={I} />} label="Move left" onClick={() => move(-1)} />
        <Tool icon={<ArrowRight size={I} />} label="Move right" onClick={() => move(1)} />
        <Tool icon={<Copy size={I} />} label="Duplicate" onClick={duplicate} />
        <Tool icon={<Trash2 size={I} />} label="Delete" onClick={del} danger />
      </>
    );
  } else if (selText) {
    tools = (
      <>
        <Tool icon={<ChevronLeft size={I} />} label="Back" onClick={close} />
        <Tool icon={<Type size={I} />} label="Edit" onClick={() => setPanel("textEdit")} />
        <Tool icon={<Scissors size={I} />} label="Split" onClick={split} />
        <Tool icon={<Copy size={I} />} label="Duplicate" onClick={duplicate} />
        <Tool icon={<Trash2 size={I} />} label="Delete" onClick={del} danger />
      </>
    );
  } else if (selMusic) {
    tools = (
      <>
        <Tool icon={<ChevronLeft size={I} />} label="Back" onClick={close} />
        <Tool icon={<Volume2 size={I} />} label="Volume" onClick={() => setPanel("music")} />
        <Tool icon={<Trash2 size={I} />} label="Delete" onClick={del} danger />
      </>
    );
  } else {
    tools = (
      <>
        <Tool icon={<Film size={I} />} label="Add media" onClick={() => fileRef.current?.click()} />
        <Tool icon={<Video size={I} />} label="Record" onClick={() => { player.current?.pause(); setRecMode("camera"); }} />
        <Tool icon={<Mic size={I} />} label="Voiceover" onClick={() => { player.current?.pause(); setPanel(null); setRecMode("voice"); }} />
        <Tool icon={<Type size={I} />} label="Text" onClick={addText} />
        <Tool icon={<LayoutTemplate size={I} />} label="Templates" onClick={() => setPanel("templates")} />
        <Tool icon={<Captions size={I} />} label="Captions" onClick={() => setPanel("captions")} />
        <Tool icon={<WandSparkles size={I} />} label="Auto cut" onClick={() => { setCut({ ...cut, scope: "all" }); setPanel("autocut"); }} />
        <Tool icon={<Music size={I} />} label="Music" onClick={() => setPanel("music")} />
        <Tool icon={<Sparkles size={I} />} label="Effects" onClick={() => p.clips[0] ? (setSel({ type: "clip", id: p.clips[Math.max(0, clipAt(T()))].id }), setPanel("filters")) : flash("Add a clip first")} />
        <Tool icon={<Crop size={I} />} label="Canvas" onClick={() => setPanel("canvas")} />
        <Tool icon={<Scissors size={I} />} label="Split" onClick={split} />
      </>
    );
  }

  // ---------------------------------------------------------------- timeline

  const end = Math.max(lay.end, 1);
  const step = [0.5, 1, 2, 5, 10, 30, 60].find((s) => s * pps >= 56) ?? 120;
  const half = "50vw";
  const ticks: number[] = [];
  for (let t = 0; t <= end + step; t += step) ticks.push(t);

  return (
    <div className="ed" onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <input ref={fileRef} type="file" accept="video/*,image/*" multiple hidden onChange={(e) => { addMedia(e.target.files); e.target.value = ""; }} />
      <input ref={musicRef} type="file" accept="audio/*,video/*" hidden onChange={(e) => { addMusic(e.target.files); e.target.value = ""; }} />
      <input ref={bgImgRef} type="file" accept="image/*" hidden onChange={(e) => { setBgImage(e.target.files); e.target.value = ""; }} />

      <div className="top">
        <button className="icon" aria-label="Projects" onClick={onBack}><ChevronLeft /></button>
        <button className="icon" aria-label="Undo" disabled={!hist.u} onClick={undo}><Undo2 size={20} /></button>
        <button className="icon" aria-label="Redo" disabled={!hist.r} onClick={redo}><Redo2 size={20} /></button>
        <input className="name" value={p.name} onChange={(e) => commit((d) => (d.name = e.target.value), "name")} />
        <button className="icon" aria-label="Canvas" onClick={() => setPanel("canvas")}><RectangleHorizontal size={20} /></button>
        <button className="pill" disabled={!p.clips.length} onClick={() => { player.current?.pause(); setPanel("export"); setExp((e) => ({ ...e, phase: "setup" })); }}>Export</button>
      </div>

      <div className="stage">
        {status && <div className="status">{status}</div>}
        <canvas ref={canvasRef} onPointerDown={onCanvasDown} />
      </div>

      <div className="transport">
        <span ref={timeLbl}>0:00.0 / {P.fmt(lay.end)}</span>
        <button className="play" aria-label={playing ? "Pause" : "Play"} onClick={() => player.current?.toggle()}>
          {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
        </button>
        <span style={{ display: "flex", gap: 4 }}>
          <button className="icon" aria-label="Safe zones" style={{ color: safe ? ACCENT : undefined }} onClick={() => setSafe(!safe)}><Smartphone size={18} /></button>
          <button className="icon" aria-label="Zoom out" onClick={() => setPps((v) => Math.max(6, v / 1.6))}><ZoomOut size={18} /></button>
          <button className="icon" aria-label="Zoom in" onClick={() => setPps((v) => Math.min(400, v * 1.6))}><ZoomIn size={18} /></button>
        </span>
      </div>

      <div className="tlwrap">
        <div className="tl" ref={tlRef} data-pps={pps} onScroll={onTlScroll}>
          <div className="tl-inner" style={{ width: `calc(${end * pps}px + 100vw)`, paddingLeft: half }}>
            <div className="ruler" style={{ left: half }}>
              {ticks.map((t) => <span key={t} style={{ left: t * pps }}>{P.fmt(t).replace(/\.\d$/, "")}</span>)}
            </div>
            <div className="track" style={{ top: 24, height: 52, left: half }}>
              {p.clips.map((c, i) => {
                const on = selClip?.id === c.id;
                const a = assets[c.assetId];
                return (
                  <div key={c.id} className={"clip" + (on ? " sel" : "")} style={{ left: lay.starts[i] * pps, width: P.clipLen(c) * pps - 2, backgroundImage: a?.thumb ? `url(${a.thumb})` : undefined }}
                    onClick={() => { setSel(on ? null : { type: "clip", id: c.id }); if (on) setPanel(null); }}>
                    <span className="lbl">{P.fmt(P.clipLen(c))}{c.speed !== 1 ? ` · ${c.speed}×` : ""}{P.lookActive(c.look) ? " · fx" : ""}</span>
                    {on && (
                      <>
                        <div className="handle l" onPointerDown={(e) => startDrag(e, "trimL", c.id, { in: c.in, out: c.out })} />
                        <div className="handle r" onPointerDown={(e) => startDrag(e, "trimR", c.id, { in: c.in, out: c.out })} />
                      </>
                    )}
                  </div>
                );
              })}
              {p.clips.slice(0, -1).map((c, i) => (
                <button key={c.id + "t"} className={"tbtn" + (c.transition.kind ? " on" : "")} aria-label="Transition" style={{ left: (lay.starts[i + 1] + lay.trans[i] / 2) * pps }}
                  onClick={(e) => { e.stopPropagation(); setSel({ type: "clip", id: c.id }); setPanel("transition"); }}>
                  <Blend size={13} />
                </button>
              ))}
              <button className="addbtn" aria-label="Add media" style={{ left: lay.videoEnd * pps + 10 }} onClick={() => fileRef.current?.click()}><Plus size={20} /></button>
            </div>
            {[{ cap: false, top: 82 }, { cap: true, top: 108 }].map(({ cap: isCap, top }) => (
              <div key={top} className="track" style={{ top, height: 22, left: half }}>
                {p.texts.filter((t) => !!t.caption === isCap).map((t) => {
                  const on = selText?.id === t.id;
                  return (
                    <div key={t.id} className={"item " + (isCap ? "cap" : "text") + (on ? " sel" : "")} style={{ left: t.start * pps, width: Math.max(8, (t.end - t.start) * pps - 1) }}
                      onClick={() => !on && setSel({ type: "text", id: t.id })}
                      onPointerDown={(e) => on && startDrag(e, "tMove", t.id, { start: t.start, end: t.end })}>
                      {t.text}
                      {on && (
                        <>
                          <div className="handle l" style={{ width: 14, left: -14 }} onPointerDown={(e) => startDrag(e, "tL", t.id, { start: t.start, end: t.end })} />
                          <div className="handle r" style={{ width: 14, right: -14 }} onPointerDown={(e) => startDrag(e, "tR", t.id, { start: t.start, end: t.end })} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="track" style={{ top: 134, height: 22, left: half }}>
              {p.music.map((m) => {
                const on = selMusic?.id === m.id;
                return (
                  <div key={m.id} className={"item music" + (on ? " sel" : "")} style={{ left: m.start * pps, width: Math.max(8, (m.out - m.in) * pps - 1) }}
                    onClick={() => !on && setSel({ type: "music", id: m.id })}
                    onPointerDown={(e) => on && startDrag(e, "mMove", m.id, { start: m.start, in: m.in, out: m.out })}>
                    ♪ {assets[m.assetId]?.name ?? "Music"}
                    {on && (
                      <>
                        <div className="handle l" style={{ width: 14, left: -14 }} onPointerDown={(e) => startDrag(e, "mL", m.id, { start: m.start, in: m.in, out: m.out })} />
                        <div className="handle r" style={{ width: 14, right: -14 }} onPointerDown={(e) => startDrag(e, "mR", m.id, { start: m.start, in: m.in, out: m.out })} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="playhead" />
        {!p.clips.length && (
          <button className="pill" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(8px,-50%)", zIndex: 7 }} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Add videos
          </button>
        )}
      </div>

      <div className="tools">{tools}</div>

      {panel && panel !== "export" && !recMode && panels[panel]?.()}

      {recMode && (
        <Recorder
          mode={recMode}
          onDone={onRecorded}
          onClose={() => setRecMode(null)}
          onStart={() => { if (recMode === "voice") { voStart.current = T(); player.current?.play(); } }}
          onStop={() => player.current?.pause()}
        />
      )}

      {panel === "export" && (
        <div className="modal">
          <div className="card">
            {exp.phase === "setup" && (
              <>
                <h3 style={{ margin: "0 0 12px" }}>Export video</h3>
                <Chips items={[{ k: 854, label: "480p" }, { k: 1280, label: "720p" }, { k: 1920, label: "1080p" }]} value={exp.res} onChange={(v) => setExp({ ...exp, res: v })} />
                <p className="note">Renders in real time ({P.fmt(lay.end)}). Keep the screen on and the app open.</p>
                <button className="btn" onClick={runExport}>Export</button>
                <button className="btn gray" onClick={() => setPanel(null)}>Cancel</button>
              </>
            )}
            {exp.phase === "running" && (
              <>
                <h3 style={{ margin: 0 }}>Exporting… {Math.round(exp.progress * 100)}%</h3>
                <div className="bar"><i style={{ width: `${exp.progress * 100}%` }} /></div>
                <button className="btn gray" onClick={() => (exportSignal.current.cancel = true)}>Cancel</button>
              </>
            )}
            {exp.phase === "done" && exp.url && (
              <>
                <video src={exp.url} controls playsInline />
                <button className="btn" onClick={share}><Share2 size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Save to Photos / Share</button>
                <a className="btn gray" style={{ display: "grid", placeItems: "center", textDecoration: "none" }} href={exp.url} download={fileName()}><span><Download size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Download</span></a>
                <button className="btn gray" onClick={() => { URL.revokeObjectURL(exp.url!); setExp({ ...exp, phase: "setup", url: undefined, blob: undefined }); setPanel(null); }}><X size={16} style={{ verticalAlign: -3 }} /> Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
