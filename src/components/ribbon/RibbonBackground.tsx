'use client';
// Drop-in React wrappers for ribbon-engine.js (Next.js App Router, Vite, any React 18/19).
// Copy this file and ribbon-engine.js (+ ribbon-engine.d.ts) into the same folder, e.g. src/components/ribbon/.
//
//   <div className="relative overflow-clip">            // hero wrapper
//     <RibbonHero accent="#c3ff4c" />
//     <section className="relative z-[1]">...hero content...</section>
//   </div>
//   <RibbonAmbient accent="#c3ff4c" />                   // once, anywhere in the layout
//   <div className="relative"><RibbonWaves accent="#c3ff4c" />...pricing / CTA...</div>
//
// All layers on a page share one engine (one animation loop) per accent.
import { useEffect, useRef, type CSSProperties } from 'react';

type Kind = 'hero' | 'ambient' | 'waves';
type EngineOpts = { accent?: string; cool?: string[]; dpr?: number; fps?: number };
type Handle = { destroy(): void };
type Engine = Record<Kind, (c: HTMLCanvasElement, o?: Record<string, unknown>) => Handle> & { destroy(): void; supported: boolean };

const engines = new Map<string, { fx: Engine; refs: number }>();
async function acquire(opts: EngineOpts) {
  const key = JSON.stringify(opts);
  let e = engines.get(key);
  if (!e) {
    const mod = await import('./ribbon-engine.js');
    e = engines.get(key); // another layer may have created it while we awaited
    if (!e) { e = { fx: mod.createRibbons(opts) as unknown as Engine, refs: 0 }; engines.set(key, e); }
  }
  e.refs++;
  return { fx: e.fx, release() { e!.refs--; if (e!.refs <= 0) { e!.fx.destroy(); engines.delete(key); } } };
}

const base: CSSProperties = { pointerEvents: 'none', width: '100%', height: '100%', display: 'block' };
const styles: Record<Kind, CSSProperties> = {
  hero: { ...base, position: 'absolute', inset: 0, zIndex: 0 },
  waves: { ...base, position: 'absolute', inset: 0, zIndex: 0 },
  ambient: { ...base, position: 'fixed', inset: 0, zIndex: 0, opacity: 0 },
};

type Props = EngineOpts & { options?: Record<string, unknown>; className?: string; style?: CSSProperties };

function RibbonLayer({ kind, accent, cool, dpr, fps, options, className, style }: Props & { kind: Kind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const optKey = JSON.stringify(options ?? {});
  const coolKey = (cool ?? []).join(',');
  useEffect(() => {
    let alive = true, handle: Handle | null = null, release: (() => void) | null = null;
    const engineOpts: EngineOpts = { accent, cool: cool?.length ? cool : undefined, dpr, fps };
    acquire(engineOpts).then((got) => {
      if (!alive || !ref.current) { got.release(); return; }
      release = got.release;
      if (!got.fx.supported) { document.documentElement.classList.add('ribbon-nogl'); return; }
      handle = got.fx[kind](ref.current, options ?? {});
    });
    return () => { alive = false; handle?.destroy(); release?.(); };
    // optKey / coolKey stand in for the object identities
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, accent, coolKey, dpr, fps, optKey]);
  return <canvas ref={ref} aria-hidden="true" data-ribbon={kind} className={className} style={{ ...styles[kind], ...style }} />;
}

/** Sharp hairpin light ribbon. Place inside a position:relative wrapper around the hero (optionally hero + next section). */
export function RibbonHero(p: Props) { return <RibbonLayer kind="hero" {...p} />; }
/** Soft fixed light behind the whole page. Reshapes per <section> (or [data-ribbon-shape]) as you scroll. Render once. */
export function RibbonAmbient(p: Props) { return <RibbonLayer kind="ambient" {...p} />; }
/** Sharp horizontal fan + rising band across its wrapper (pricing / CTA zone). */
export function RibbonWaves(p: Props) { return <RibbonLayer kind="waves" {...p} />; }
