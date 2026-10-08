export type AssetKind = "video" | "audio" | "image";

export type Asset = {
  id: string;
  name: string;
  kind: AssetKind;
  blob: Blob;
  duration: number;
  w: number;
  h: number;
  thumb?: Blob;
  added: number;
};

export type AdjKey =
  | "exposure" | "contrast" | "saturation" | "vibrance" | "temperature" | "tint"
  | "highlights" | "shadows" | "fade" | "vignette" | "grain" | "sharpen";

export type Look = {
  filter: string;
  filterAmt: number;
  adj: Record<AdjKey, number>;
  /** 0 none, 1 blur, 2 colour, 3 image, 4 gradient, 5 colour pop */
  bg: { mode: number; blur: number; color: string; color2: string; imageId?: string; dim: number };
  light: { preset: string; amount: number; pos: number; soft: number; speed: number; subject: number; color: string; color2: string };
  cutout: boolean;
};

export type Clip = {
  id: string;
  assetId: string;
  in: number;
  out: number;
  speed: number;
  volume: number;
  mute: boolean;
  fadeIn: number;
  fadeOut: number;
  look: Look;
  eq: number[];
  voice: boolean;
  /** Transition into the NEXT clip. */
  transition: { kind: number; dur: number };
  zoom: number;
  panX: number;
  panY: number;
  rotate: number;
  kenBurns: boolean;
};

export type Word = { w: string; s: number; e: number };

export type TextStyle = {
  font: string;
  weight: number;
  size: number;
  color: string;
  stroke: number;
  strokeColor: string;
  shadow: number;
  bg: string;
  bgOn: boolean;
  highlight: string;
  anim: string;
  upper: boolean;
  align: "left" | "center" | "right";
};

export type TextItem = TextStyle & {
  id: string;
  start: number;
  end: number;
  text: string;
  x: number;
  y: number;
  caption?: boolean;
  words?: Word[];
};

export type MusicItem = {
  id: string;
  assetId: string;
  start: number;
  in: number;
  out: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** Voiceover: never ducked. */
  vo?: boolean;
};

export type Project = {
  id: string;
  name: string;
  aspect: string;
  fit: "cover" | "contain" | "blur";
  bgColor: string;
  created: number;
  updated: number;
  clips: Clip[];
  texts: TextItem[];
  music: MusicItem[];
  captionStyle: TextStyle;
  master: number;
  duck: boolean;
  progress?: { on: boolean; color: string; top: boolean };
};
