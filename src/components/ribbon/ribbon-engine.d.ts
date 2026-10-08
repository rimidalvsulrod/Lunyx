// Type declarations for ribbon-engine.js
export type RGB = [number, number, number];
export interface Palette { main: RGB[]; cool: RGB[]; haze: RGB; coreHot: RGB; core: RGB; glitter: RGB; bokeh: RGB; dust: RGB }
export interface LayerHandle { destroy(): void; layer: unknown }
export interface HeroOptions { fade?: [number, number]; alpha?: number; heightFrom?: HTMLElement; params?: Record<string, number> }
export interface WavesOptions { fade?: [number, number]; fanY?: number; bandY?: number; fan?: boolean; band?: boolean; fanParams?: Record<string, number>; bandParams?: Record<string, number> }
export interface AmbientOptions { hideUntil?: HTMLElement; stops?: Array<HTMLElement | { el: HTMLElement; shape: string }>; selector?: string; opacity?: number; shapes?: Record<string, { p: number[][]; o: number }>; params?: Record<string, number> }
export interface Ribbons {
  hero(canvas: HTMLCanvasElement, o?: HeroOptions): LayerHandle;
  ambient(canvas: HTMLCanvasElement, o?: AmbientOptions): LayerHandle;
  waves(canvas: HTMLCanvasElement, o?: WavesOptions): LayerHandle;
  custom(canvas: HTMLCanvasElement, o?: { fade?: [number, number]; scale?: number; fixed?: boolean; bundles: Array<{ params: string | Record<string, number>; points: (t: number, w: number, h: number) => number[][] }> }): LayerHandle;
  refresh(): void; destroy(): void; palette: Palette; perf: { lvl: number; q: number; dpr: number }; supported: boolean;
}
export function createRibbons(opts?: { accent?: string; cool?: string[]; palette?: Palette; reducedMotion?: boolean; dpr?: number; fps?: number; onDegrade?: (level: number) => void }): Ribbons;
export function autoMount(opts?: Parameters<typeof createRibbons>[0] & { hero?: HeroOptions; ambient?: AmbientOptions; waves?: WavesOptions }): Ribbons;
export function paletteFromAccent(hex: string, opts?: { cool?: string[] }): Palette;
export function supported(): boolean;
export function drift(pts: number[][], t: number, ax: number, ay: number): number[][];
export function pulse(t: number): number;
export const PALETTES: { lime: Palette };
export const PRESETS: Record<'hero' | 'fan' | 'band' | 'ambient', Record<string, number>>;
export const SHAPES: Record<string, (w: number, v: number) => number[][]>;
export const AMBIENT: Record<string, { p: number[][]; o: number }>;
