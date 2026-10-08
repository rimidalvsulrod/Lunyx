"use client";

// Camera recorder with a scrolling teleprompter, and a compact mic recorder for voiceovers.
import { useEffect, useRef, useState } from "react";
import { FileText, SwitchCamera, X } from "lucide-react";

const pickType = (video: boolean) =>
  (video
    ? ["video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
    : ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
  ).find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

const read = (k: string, d: string) => {
  try { return localStorage.getItem(k) ?? d; } catch { return d; }
};
const write = (k: string, v: string) => {
  try { localStorage.setItem(k, v); } catch {}
};

type Props = {
  mode: "camera" | "voice";
  onDone: (f: File) => void;
  onClose: () => void;
  onStart?: () => void;
  onStop?: () => void;
};

export function Recorder({ mode, onDone, onClose, onStart, onStop }: Props) {
  const cam = mode === "camera";
  const vid = useRef<HTMLVideoElement>(null);
  const prompter = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const raf = useRef(0);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [state, setState] = useState<"idle" | "count" | "rec">("idle");
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const [script, setScript] = useState(() => read("ed-script", ""));
  const [speed, setSpeed] = useState(() => +read("ed-speed", "45"));
  const [size, setSize] = useState(() => +read("ed-size", "30"));
  const [editing, setEditing] = useState(false);
  const [showPrompt, setShowPrompt] = useState(true);

  useEffect(() => {
    let alive = true;
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    navigator.mediaDevices
      ?.getUserMedia(cam ? { video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio } : { audio })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (vid.current) vid.current.srcObject = s;
      })
      .catch((e) => setErr(e?.name === "NotAllowedError" ? "Allow camera / microphone access in Settings › Safari." : "Can't open the " + (cam ? "camera" : "microphone") + "."));
    return () => {
      alive = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [cam, facing]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const start = async () => {
    const s = stream.current;
    if (!s) return;
    setState("count");
    if (prompter.current) prompter.current.scrollTop = 0;
    for (let c = 3; c > 0; c--) {
      setCount(c);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const type = pickType(cam);
    const r = new MediaRecorder(s, { mimeType: type || undefined, videoBitsPerSecond: 10e6, audioBitsPerSecond: 160000 });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      const t = (type || chunks[0]?.type || (cam ? "video/mp4" : "audio/mp4")).split(";")[0];
      const ext = t.includes("webm") ? "webm" : cam ? "mp4" : "m4a";
      const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      onDone(new File([new Blob(chunks, { type: t })], `${cam ? "Take" : "Voiceover"} ${stamp}.${ext}`, { type: t }));
    };
    r.start(500);
    rec.current = r;
    setState("rec");
    onStart?.();
    const t0 = performance.now();
    let last = t0;
    const tick = (now: number) => {
      setSecs(Math.floor((now - t0) / 1000));
      if (prompter.current) prompter.current.scrollTop += (speed * (now - last)) / 1000;
      last = now;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const stop = () => {
    cancelAnimationFrame(raf.current);
    rec.current?.stop();
    rec.current = null;
    setState("idle");
    onStop?.();
  };

  const recBtn = (
    <button aria-label={state === "rec" ? "Stop" : "Record"} disabled={!!err || state === "count"} onClick={state === "rec" ? stop : start}
      style={{ width: 72, height: 72, borderRadius: 36, border: "4px solid #fff", display: "grid", placeItems: "center", background: "transparent" }}>
      <span style={{ width: state === "rec" ? 28 : 56, height: state === "rec" ? 28 : 56, borderRadius: state === "rec" ? 6 : 28, background: "#ff453a", transition: "all .2s" }} />
    </button>
  );

  if (!cam) {
    return (
      <div className="sheet">
        <div className="sheet-h">
          <span>Voiceover</span>
          <button onClick={() => { if (state === "rec") stop(); onClose(); }}>Done</button>
        </div>
        <div className="sheet-b" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <p className="note" style={{ textAlign: "center" }}>
            {err || (state === "rec" ? `Recording · ${secs}s — the video plays while you talk` : state === "count" ? `Starting in ${count}…` : "Records from the playhead while the video plays. Use headphones to hear it.")}
          </p>
          {recBtn}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50, display: "flex", flexDirection: "column" }}>
      <video ref={vid} autoPlay muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: facing === "user" ? "scaleX(-1)" : undefined }} />
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", padding: "calc(env(safe-area-inset-top) + 8px) 12px 8px", zIndex: 2 }}>
        <button className="icon" aria-label="Close" style={{ background: "rgba(0,0,0,.5)" }} onClick={() => { if (state === "rec") stop(); onClose(); }}><X /></button>
        <span style={{ alignSelf: "center", background: state === "rec" ? "#ff453a" : "rgba(0,0,0,.5)", padding: "4px 12px", borderRadius: 12, fontVariantNumeric: "tabular-nums" }}>
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </span>
        <span style={{ display: "flex", gap: 6 }}>
          <button className="icon" aria-label="Teleprompter" style={{ background: showPrompt ? "#2997ff" : "rgba(0,0,0,.5)" }} onClick={() => setShowPrompt(!showPrompt)}><FileText size={20} /></button>
          <button className="icon" aria-label="Flip camera" style={{ background: "rgba(0,0,0,.5)" }} disabled={state !== "idle"} onClick={() => setFacing(facing === "user" ? "environment" : "user")}><SwitchCamera size={20} /></button>
        </span>
      </div>

      {showPrompt && (
        editing ? (
          <div style={{ position: "relative", zIndex: 2, margin: "0 12px", background: "rgba(28,28,30,.95)", borderRadius: 14, padding: 12 }}>
            <textarea autoFocus value={script} placeholder="Paste or type your script…" style={{ minHeight: 180 }} onChange={(e) => { setScript(e.target.value); write("ed-script", e.target.value); }} />
            <div className="row"><label>Scroll speed</label><input type="range" min={10} max={150} value={speed} onChange={(e) => { setSpeed(+e.target.value); write("ed-speed", e.target.value); }} /></div>
            <div className="row"><label>Text size</label><input type="range" min={18} max={56} value={size} onChange={(e) => { setSize(+e.target.value); write("ed-size", e.target.value); }} /></div>
            <button className="btn" onClick={() => setEditing(false)}>Done</button>
          </div>
        ) : (
          <div ref={prompter} onClick={() => state === "idle" && setEditing(true)}
            style={{ position: "relative", zIndex: 2, margin: "0 12px", height: "34vh", overflow: "hidden", background: "rgba(0,0,0,.55)", borderRadius: 14, padding: "12px 16px", fontSize: size, fontWeight: 600, lineHeight: 1.35, whiteSpace: "pre-wrap" }}>
            {script || <span style={{ color: "#98989f", fontSize: 16 }}>Tap to add your script. It scrolls while you record, right under the front camera.</span>}
            <div style={{ height: "34vh" }} />
          </div>
        )
      )}

      <div style={{ flex: 1 }} />
      {state === "count" && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 120, fontWeight: 800, zIndex: 3, textShadow: "0 4px 30px #000" }}>{count}</div>}
      {err && <p style={{ position: "relative", zIndex: 2, textAlign: "center", padding: 16 }}>{err}</p>}
      <div style={{ position: "relative", zIndex: 2, display: "flex", justifyContent: "center", padding: "16px 0 calc(env(safe-area-inset-bottom) + 20px)" }}>{recBtn}</div>
    </div>
  );
}
