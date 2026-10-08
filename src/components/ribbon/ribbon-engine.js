// ribbon-engine.js: GPU light-ribbon backgrounds (WebGL2), zero dependencies.
// SSR-safe: nothing touches window/document until you call createRibbons().
//
//   import { createRibbons } from './ribbon-engine.js';
//   const fx = createRibbons({ accent: '#c3ff4c' });   // omit accent for the original lime
//   fx.hero(heroCanvas);       // sharp hairpin ribbon, canvas absolutely fills the hero wrapper
//   fx.ambient(fixedCanvas);   // soft blurred light behind the whole page, reshapes per section
//   fx.waves(wavesCanvas);     // sharp horizontal fan + band across its box (pricing / CTA area)
//   ...later: fx.destroy();
//
// Or with no JS wiring: put <canvas data-ribbon="hero|ambient|waves"> in the page and call autoMount().

const TAU = Math.PI * 2, R = Math.random;
const MMAX = 96;

/* ------------------------------------------------------------------ colour */
function hexToRgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
  if (!s) return [l * 255, l * 255, l * 255].map(Math.round);
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}
const mixW = (rgb, k) => rgb.map(v => (v + (255 - v) * k) / 255);

/** The original reference palette (lime + teal/blue outer strands). */
export const PALETTES = {
  lime: {
    main: [[214, 255, 96], [196, 250, 58], [176, 236, 46], [150, 212, 40], [122, 184, 36], [236, 255, 168]],
    cool: [[70, 172, 168], [60, 140, 204], [96, 198, 182], [56, 118, 172]],
    haze: [.59, .86, .27], coreHot: [.96, 1, .84], core: [.8, 1, .43], glitter: [.94, 1, .82], bokeh: [.78, .94, .67], dust: [.86, .94, .78],
  },
};

/** Build a ribbon palette from any brand accent. `cool` (hex[]) overrides the outer strand colours. */
export function paletteFromAccent(hex, opts = {}) {
  const base = hexToRgb(hex), [h, s0, l0] = rgbToHsl(base), s = Math.max(.6, s0), l = Math.min(.68, Math.max(.45, l0));
  const main = [[h + 4, s, l + .14], [h, s, l + .04], [h - 2, s * .95, l - .04], [h - 4, s * .9, l - .11], [h - 6, s * .85, l - .19], [h, s, .86]].map(c => hslToRgb(...c));
  const cool = opts.cool ? opts.cool.map(hexToRgb) : [[h + 100, .42, .5], [h + 125, .55, .53], [h + 108, .45, .58], [h + 135, .5, .45]].map(c => hslToRgb(...c));
  const acc = hslToRgb(h, s, l);
  return { main, cool, haze: hslToRgb(h - 4, .6, .38).map(v => v / 255), coreHot: mixW(acc, .85), core: mixW(acc, .35), glitter: mixW(acc, .8), bokeh: mixW(acc, .6), dust: mixW(acc, .75) };
}

/* ------------------------------------------------------------------ presets and shapes */
/** Bundle presets measured from the reference. Widths are in CSS px at a 1440px wide viewport (scaled automatically). */
export const PRESETS = {
  hero: { n: 280, pinchPoint: 3, wMin: 22, wMax: 440, blue: .16, spark: 360, bokeh: 16, dust: 70, twist: 1.05, la: 1.15, wexp: .95, haze: .85, hz: .62, core: 1.35, M: 88 },
  fan: { n: 230, pinch: 0, wMin: 26, wMax: 360, blue: .24, spark: 300, bokeh: 14, twist: .8, haze: .5, core: 0, la: 1.1, wexp: .9, fadeIn: 300 },
  band: { n: 190, pinch: 0, wMin: 66, wMax: 160, blue: .34, spark: 240, bokeh: 10, twist: .7, haze: .45, core: 0, la: 1.15, wob: .14 },
  ambient: { n: 44, pinch: .3, wMin: 170, wMax: 470, blue: .36, spark: 0, bokeh: 5, lw: 9, twist: .6, haze: .55, core: 0, M: 44, flow: 1.5, la: .95, white: 0, uniform: 1, flowFrac: 1, haloOnly: 1, hw: 16, ha: .6, ef: .16 },
};
/** Spine shapes (Catmull-Rom control points). */
export const SHAPES = {
  // enters top-right, pinches into a hot core at (36%, 72% of the hero height), fans out to the bottom-right
  hairpin: (w, v) => [[1.1, -.34], [.82, .07], [.55, .43], [.36, .715], [.45, .9], [.58, 1.08], [.66, 1.3], [.72, 1.62]].map(([x, y]) => [x * w, y * v]),
  hairpinMobile: (w, v) => [[1.1, -.34], [.82, .07], [.55, .43], [.36, .715], [.45, .9], [.58, 1.08], [.66, 1.3], [.72, 1.62]].map(([x, y]) => [x * w * 1.15 - w * .12, y * v]),
  // starts soft at 25% x and fans up and right, then down the right edge
  fan: (w, y) => [[.25 * w, y - 92], [.45 * w, y - 74], [.63 * w, y - 82], [.8 * w, y - 56], [.95 * w, y + 30], [1.06 * w, y + 220], [1.12 * w, y + 540]],
  // rises from the left edge to the top-right with an S wobble
  band: (w, y) => [[-.1 * w, y - 50], [.12 * w, y - 74], [.3 * w, y - 62], [.5 * w, y - 112], [.68 * w, y - 122], [.86 * w, y - 210], [1.12 * w, y - 340]],
};
/** Ambient (blurred, fixed) shapes in viewport fractions with an opacity. Sections pick one via data-ribbon-shape. */
export const AMBIENT = {
  off: { p: [[.62, -.25], [.66, .3], [.74, .75], [.8, 1.25]], o: 0 },
  arm: { p: [[.6, -.2], [.66, .35], [.74, .75], [.8, 1.25]], o: .75 },
  sweepLeft: { p: [[.68, -.15], [.62, .3], [.3, .62], [.08, 1.2]], o: .85 },
  sweepLeftWide: { p: [[.78, -.2], [.56, .25], [.2, .62], [.04, 1.2]], o: .8 },
  hairpinLeft: { p: [[.55, -.2], [.12, .36], [.16, .62], [.48, 1.2]], o: .9 },
  diagDown: { p: [[.08, -.2], [.3, .35], [.55, .72], [.72, 1.2]], o: .85 },
  edgeRight: { p: [[.7, -.2], [.82, .3], [.93, .72], [1.06, 1.2]], o: .5 },
  edgeRightFaint: { p: [[.98, -.2], [.9, .4], [.95, .8], [1.1, 1.2]], o: .45 },
  diagUp: { p: [[1.1, .08], [.82, .45], [.56, .8], [.36, 1.2]], o: .75 },
  sweepLeftLow: { p: [[.76, -.2], [.56, .3], [.3, .7], [.1, 1.2]], o: .75 },
  arch: { p: [[.05, 1.2], [.06, .45], [.2, .1], [.46, -.12]], o: .85 },
  horizontal: { p: [[.1, .05], [.4, .22], [.7, .3], [1.1, .55]], o: .55 },
  low: { p: [[-.1, .25], [.3, .12], [.7, .18], [1.1, .06]], o: .35 },
};
const AMBIENT_ORDER = ['sweepLeft', 'sweepLeftWide', 'hairpinLeft', 'diagDown', 'edgeRight', 'edgeRightFaint', 'diagUp', 'sweepLeftLow', 'arch', 'horizontal', 'low'];

/* ------------------------------------------------------------------ bundles */
export function drift(pts, t, ax, ay) { return pts.map((p, k) => [p[0] + Math.sin(t * .23 + k * 1.31) * ax, p[1] + Math.cos(t * .19 + k * .93) * ay]); }
export function pulse(t) { return 1 + .1 * Math.sin(TAU * t / 3.1) + .045 * Math.sin(TAU * t / 1.37 + 1.2); }

function makeBundle(o, pal) {
  const b = { n: 160, blue: .16, pinch: .42, pinchPoint: null, wMin: 14, wMax: 280, M: 80, alpha: 1, spark: 200, bokeh: 12, dust: 0, flow: 1, lw: 1, la: 1, white: 1, hz: 1, uniform: 0, wexp: 1.25, flowFrac: .65, twist: 1, haze: 1, core: 1, wob: .05, haloFrac: .18, hw: 4, ha: .2, haloOnly: 0, fadeIn: 0, ef: .015, wscale: 1, ...o };
  b.M = Math.min(MMAX, b.M);
  const fil = [];
  for (let i = 0; i < b.n; i++) {
    const u0 = b.uniform ? R() * 2 - 1 : (R() + R() + R()) / 1.5 - 1, r = Math.abs(u0), cool = R() < b.blue * (.15 + r * 1.9), set = cool ? pal.cool : pal.main.slice(0, 5);
    let c = set[(R() * set.length) | 0]; if (!cool && r < .14 && R() < .4 && b.white) c = pal.main[5];
    const d1 = R() * 200 + 90, fl = R() < b.flowFrac;
    fil.push({ halo: b.haloOnly || (r < .45 && R() < b.haloFrac * 2), u0, r, aw: R() * .2 + .05, phi: R() * TAU, tw: (R() * .9 + .3) * (R() < .5 ? -1 : 1) * b.twist, w: (R() * .3 + .08) * (R() < .5 ? -1 : 1),
      wf: R() * 2.2 + .5, ws: R() * .7 + .2, p2: R() * TAU, c, a: (.045 + .17 * Math.pow(1 - r, 1.25)) * (R() * .5 + .7) * b.la,
      lw: ((r < .35 ? R() * .6 + .6 : R() * .55 + .4) * (R() < .06 ? 1.8 : 1)) * b.lw, d1, per: d1 + R() * 520 + 220, fs: (R() * 190 + 90) * b.flow, pa: fl ? R() * .45 + .4 : 0, po: R() * 2000 });
  }
  fil.sort((x, y) => (y.halo ? 1 : 0) - (x.halo ? 1 : 0));
  b.nHalo = fil.filter(f => f.halo).length;
  b.inst = new Float32Array(b.n * 19);
  fil.forEach((f, i) => b.inst.set([f.u0, f.aw, f.phi, f.tw, f.w, f.wf, f.ws, f.p2, f.c[0] / 255, f.c[1] / 255, f.c[2] / 255, f.a, f.lw, f.d1, f.per, f.fs, f.po, f.r, f.pa], i * 19));
  const P = [];
  for (let i = 0; i < b.spark; i++) P.push(R(), (R() * .05 + .012) * b.flow, ((R() + R()) - 1) * 1.25, R() * TAU, R() * 1.4 + .5, R() * 4 + 1, R() * TAU, 0, .9);
  for (let i = 0; i < b.bokeh; i++) P.push(R(), R() * .008 + .002, (R() * 2 - 1) * 1.7, 0, (R() * 13 + 4) * 2, 0, R() * TAU, 1, R() * .11 + .04);
  for (let i = 0; i < b.dust; i++) P.push(R(), R() * 6 + 2, R(), 0, R() * 1.3 + .5, R() * 2 + .5, R() * TAU, 2, R() * .35 + .08);
  b.parts = new Float32Array(P); b.np = P.length / 9;
  const M = b.M; for (const k of ['CX', 'CY', 'S', 'W']) b[k] = new Float32Array(M);
  b.usp = new Float32Array(M * 4); b.usw = new Float32Array(M * 2);
  return b;
}
function spine(b, pts) {
  const M = b.M, n = pts.length, segs = n - 1; let L = 0;
  for (let k = 0; k < M; k++) {
    const g = k / (M - 1) * segs, s = Math.min(segs - 1, g | 0), t = g - s, p0 = pts[Math.max(s - 1, 0)], p1 = pts[s], p2 = pts[s + 1], p3 = pts[Math.min(s + 2, n - 1)], t2 = t * t, t3 = t2 * t;
    b.CX[k] = .5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
    b.CY[k] = .5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
    if (k) L += Math.hypot(b.CX[k] - b.CX[k - 1], b.CY[k] - b.CY[k - 1]); b.S[k] = L;
  }
  for (let k = 0; k < M; k++) b.S[k] /= L || 1;
  const ps = b.pinchPoint != null ? b.S[Math.round(b.pinchPoint / segs * (M - 1))] : b.pinch, span = Math.max(ps, 1 - ps); let best = 9; b.kp = 0;
  for (let k = 0; k < M; k++) {
    const a = Math.max(k - 1, 0), c = Math.min(k + 1, M - 1), tx = b.CX[c] - b.CX[a], ty = b.CY[c] - b.CY[a], l = Math.hypot(tx, ty) || 1;
    b.W[k] = (b.wMin + (b.wMax - b.wMin) * Math.pow(Math.min(1, Math.abs(b.S[k] - ps) / span), b.wexp)) * b.wscale;
    const dd = Math.abs(b.S[k] - ps); if (dd < best) { best = dd; b.kp = k; }
    b.usp.set([b.CX[k], b.CY[k], -ty / l, tx / l], k * 4); b.usw[k * 2] = b.S[k]; b.usw[k * 2 + 1] = b.W[k];
  }
  b.L = L;
}

/* ------------------------------------------------------------------ shaders */
const SPINE = `uniform vec4 u_sp[${MMAX}];uniform vec2 u_sw[${MMAX}];`;
const FADE = `uniform vec4 u_fd;float fadeY(){float y=u_fd.z-gl_FragCoord.y/u_fd.w;float f=1.;if(u_fd.x>0.)f*=smoothstep(0.,u_fd.x,y);if(u_fd.y>0.)f*=smoothstep(0.,u_fd.y,u_fd.z-y);return f;}\n`;
const VS_LINE = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_ks;layout(location=1) in vec4 a_f;layout(location=2) in vec4 a_g;layout(location=3) in vec4 a_c;layout(location=4) in vec4 a_d;layout(location=5) in vec3 a_e;
${SPINE}uniform vec2 u_res;uniform float u_t,u_L,u_wob,u_intro,u_alpha,u_halo,u_hw,u_ha,u_fadeIn,u_ef;
out vec4 v_c;out vec4 v_p;out float v_pa;out float v_hw;out float v_lw;const float TAU=6.2831853;
void main(){int k=int(a_ks.x+.5);vec4 sp=u_sp[k];vec2 sw=u_sw[k];float s=sw.x,W=sw.y;
 float th=a_f.z+a_f.w*s*TAU+u_t*a_g.x;
 float d=W*(a_f.x+a_f.y*sin(th))+sin(s*a_g.y*TAU+u_t*a_g.z+a_g.w)*W*u_wob;
 float hw=u_halo>.5?u_hw+a_d.x*2.:a_d.x*.5+1.;
 vec2 p=sp.xy+sp.zw*(d+a_ks.y*hw);vec2 cl=p/u_res*2.-1.;gl_Position=vec4(cl.x,-cl.y,0.,1.);
 float vis=clamp((u_intro*1.35-a_e.y*.3-s)*14.,0.,1.);
 float fin=(u_fadeIn>0.?smoothstep(0.,u_fadeIn,s*u_L):1.)*smoothstep(0.,u_ef,s)*smoothstep(0.,u_ef,1.-s);
 v_c=vec4(a_c.rgb,a_c.a*u_alpha*vis*fin*(u_halo>.5?u_ha:1.));
 v_p=vec4(a_ks.y,s*u_L-u_t*a_d.w-a_e.x,a_d.y,a_d.z);v_pa=a_e.z*(.35+.65*(1.-a_e.y));v_hw=hw;v_lw=a_d.x;}`;
const FS_LINE = `#version 300 es
precision highp float;
in vec4 v_c;in vec4 v_p;in float v_pa;in float v_hw;in float v_lw;uniform float u_halo,u_flow;
${FADE}out vec4 o;
void main(){float cov;if(u_halo>.5){float e=1.-abs(v_p.x);cov=e*e;}else{float dpx=abs(v_p.x)*v_hw;cov=clamp(v_lw*.5+.5-dpx,0.,1.)*min(1.,v_lw+.3);}
 float x=mod(v_p.y,v_p.w),pl=v_p.z;float pulse=u_flow*smoothstep(0.,pl*.45,x)*(1.-smoothstep(pl*.55,pl,x));
 float a=v_c.a*cov*(1.+pulse*v_pa*3.2)*fadeY();vec3 c=mix(v_c.rgb,min(v_c.rgb+vec3(.16,.04,.27),1.),pulse);o=vec4(c*a,a);}`;
const VS_GLOW = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_q;uniform vec2 u_res,u_c;uniform float u_r;out vec2 v_q;
void main(){v_q=a_q;vec2 p=u_c+a_q*u_r;vec2 cl=p/u_res*2.-1.;gl_Position=vec4(cl.x,-cl.y,0.,1.);}`;
const FS_GLOW = `#version 300 es
precision highp float;
in vec2 v_q;uniform vec4 u_col;uniform float u_k;
${FADE}out vec4 o;
void main(){float d=length(v_q);float a=u_col.a*exp(-d*d*u_k)*(1.-smoothstep(.85,1.,d))*fadeY();o=vec4(u_col.rgb*a,a);}`;
const VS_PART = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_p;layout(location=1) in vec4 a_q;layout(location=2) in float a_a;
${SPINE}uniform vec2 u_res;uniform float u_M,u_t,u_alpha,u_intro,u_dpr;out float v_a;out float v_k;
void main(){float kind=a_q.w;vec2 p;float a=a_a*u_alpha;
 if(kind>1.5){p=vec2(a_p.x*u_res.x,mod(a_p.z*u_res.y-u_t*a_p.y,u_res.y));a*=(.4+.6*abs(sin(u_t*a_q.y+a_q.z)))*min(1.,u_intro*1.5);}
 else{float s=fract(a_p.x+u_t*a_p.y);float kk=s*(u_M-1.);int i0=int(floor(kk));int i1=min(i0+1,int(u_M)-1);float fr=kk-float(i0);
  vec4 A0=u_sp[i0],A1=u_sp[i1];vec2 c=mix(A0.xy,A1.xy,fr);float W=mix(u_sw[i0].y,u_sw[i1].y,fr);
  if(kind<.5){p=c+A0.zw*((a_p.z+.08*sin(a_p.w+u_t*.4))*W);a*=(.2+.8*abs(sin(u_t*a_q.y+a_q.z)))*sqrt(max(0.,sin(s*3.14159)))*step(s,u_intro*1.2);}
  else{p=c+A0.zw*(a_p.z*W)+vec2(0.,sin(u_t*.5+a_q.z)*8.);a*=.6+.4*sin(u_t*.8+a_q.z);}}
 vec2 cl=p/u_res*2.-1.;gl_Position=vec4(cl.x,-cl.y,0.,1.);gl_PointSize=max(1.,a_q.x*u_dpr);v_a=a;v_k=kind;}`;
const FS_PART = `#version 300 es
precision highp float;
in float v_a;in float v_k;uniform vec3 u_cg,u_cb,u_cd;
${FADE}out vec4 o;
void main(){vec2 q=gl_PointCoord*2.-1.;float d=length(q);float a=v_a;vec3 c;
 if(v_k<.5){c=u_cg;a*=1.-smoothstep(.7,1.,max(abs(q.x),abs(q.y)));}
 else if(v_k<1.5){c=u_cb;a*=(1.-smoothstep(.55,1.,d))*(.75+.25*(1.-d));}
 else{c=u_cd;a*=1.-smoothstep(.5,1.,d);}a*=fadeY();o=vec4(c*a,a);}`;

function compile(gl, vs, fs) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name.replace('[0]', ''); u[nm] = gl.getUniformLocation(p, nm); }
  return { p, u };
}

/* ------------------------------------------------------------------ layer (one canvas, one WebGL2 context) */
class Layer {
  constructor(canvas, pal, opt) {
    this.c = canvas; this.pal = pal; this.bundles = []; this.visible = true; this.fade = opt.fade || [0, 0]; this.scale = opt.scale || 1;
    this.q = 1; this.w = 1; this.h = 1; this.dpr = 1;
    this._lost = e => { e.preventDefault(); this.gl = null; };
    this._restored = () => { this.init(); this.bundles.forEach(B => this.upload(B.b)); };
    canvas.addEventListener('webglcontextlost', this._lost, false); canvas.addEventListener('webglcontextrestored', this._restored, false);
    this.init();
  }
  init() {
    let gl = null; try { gl = this.c.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' }); } catch (e) { /* no webgl2 */ }
    this.gl = gl; if (!gl) return;
    try { this.pL = compile(gl, VS_LINE, FS_LINE); this.pG = compile(gl, VS_GLOW, FS_GLOW); this.pP = compile(gl, VS_PART, FS_PART); } catch (e) { console.warn('[ribbon-engine]', e); this.gl = null; return; }
    this.quad = gl.createVertexArray(); gl.bindVertexArray(this.quad); const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null); this.strips = {};
  }
  strip(M) {
    const gl = this.gl; if (this.strips[M]) return this.strips[M];
    const v = new Float32Array(M * 4), ix = new Uint16Array((M - 1) * 6);
    for (let k = 0; k < M; k++) v.set([k, -1, k, 1], k * 4);
    for (let k = 0; k < M - 1; k++) { const i = k * 2; ix.set([i, i + 1, i + 2, i + 1, i + 3, i + 2], k * 6); }
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.STATIC_DRAW);
    return (this.strips[M] = { vb, ib, count: ix.length });
  }
  upload(b) {
    const gl = this.gl; if (!gl) return; const st = this.strip(b.M);
    b.vao = gl.createVertexArray(); gl.bindVertexArray(b.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.vb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, b.inst, gl.STATIC_DRAW);
    for (const [loc, n, off] of [[1, 4, 0], [2, 4, 4], [3, 4, 8], [4, 4, 12], [5, 3, 16]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 76, off * 4); gl.vertexAttribDivisor(loc, 1); }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.ib); b.count = st.count;
    b.pvao = gl.createVertexArray(); gl.bindVertexArray(b.pvao); const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, b.parts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 36, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 36, 16); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 36, 32);
    gl.bindVertexArray(null);
  }
  add(params, points) { const b = makeBundle(params, this.pal); this.bundles.push({ b, points }); this.upload(b); return b; }
  size(w, h, dprCap) {
    this.w = Math.max(1, w); this.h = Math.max(1, h); const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * this.scale; this.dpr = dpr;
    const W = Math.max(1, Math.round(this.w * dpr)), H = Math.max(1, Math.round(this.h * dpr)); if (this.c.width !== W) this.c.width = W; if (this.c.height !== H) this.c.height = H;
  }
  glow(x, y, r, rgb, a, k) { const gl = this.gl, G = this.pG; gl.uniform2f(G.u.u_c, x, y); gl.uniform1f(G.u.u_r, r); gl.uniform4f(G.u.u_col, rgb[0], rgb[1], rgb[2], a); gl.uniform1f(G.u.u_k, k); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  render(t, I, intro, flow) {
    const gl = this.gl; if (!gl) return; const pal = this.pal;
    gl.viewport(0, 0, this.c.width, this.c.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const fd = [this.fade[0], this.fade[1], this.h, this.dpr];
    for (const B of this.bundles) {
      const b = B.b; spine(b, B.points(t, this.w, this.h, b));
      const A = b.alpha * I * Math.min(1, intro * 1.6); if (A < .002) continue;
      gl.useProgram(this.pG.p); gl.bindVertexArray(this.quad); gl.uniform2f(this.pG.u.u_res, this.w, this.h); gl.uniform4fv(this.pG.u.u_fd, fd);
      const px = b.CX[b.kp], py = b.CY[b.kp];
      if (b.haze) this.glow(px, py, Math.min(b.L * .3, 900) * b.hz * .8, pal.haze, .17 * A * b.haze, 3.2);
      if (b.core) { const cr = Math.max(30, b.wMin * b.wscale * 4.5) * b.core; this.glow(px, py, cr, pal.coreHot, .42 * A, 14); this.glow(px, py, cr, pal.core, .14 * A, 3); }
      const L = this.pL, u = L.u; gl.useProgram(L.p); gl.bindVertexArray(b.vao);
      gl.uniform4fv(u.u_sp, b.usp); gl.uniform2fv(u.u_sw, b.usw); gl.uniform2f(u.u_res, this.w, this.h);
      gl.uniform1f(u.u_t, t); gl.uniform1f(u.u_L, b.L); gl.uniform1f(u.u_wob, b.wob); gl.uniform1f(u.u_intro, intro); gl.uniform1f(u.u_alpha, A);
      gl.uniform1f(u.u_fadeIn, b.fadeIn); gl.uniform1f(u.u_ef, b.ef); gl.uniform1f(u.u_flow, flow); gl.uniform4fv(u.u_fd, fd); gl.uniform1f(u.u_hw, b.hw); gl.uniform1f(u.u_ha, b.ha);
      const nH = Math.max(1, Math.floor(b.nHalo * this.q)), nAll = Math.max(20, Math.floor(b.n * this.q));
      if (b.nHalo) { gl.uniform1f(u.u_halo, 1); gl.drawElementsInstanced(gl.TRIANGLES, b.count, gl.UNSIGNED_SHORT, 0, b.haloOnly ? nAll : nH); }
      if (!b.haloOnly) { gl.uniform1f(u.u_halo, 0); gl.drawElementsInstanced(gl.TRIANGLES, b.count, gl.UNSIGNED_SHORT, 0, nAll); }
      if (b.np) {
        const P = this.pP, pu = P.u; gl.useProgram(P.p); gl.bindVertexArray(b.pvao);
        gl.uniform4fv(pu.u_sp, b.usp); gl.uniform2fv(pu.u_sw, b.usw); gl.uniform2f(pu.u_res, this.w, this.h); gl.uniform1f(pu.u_M, b.M); gl.uniform1f(pu.u_t, flow ? t : 4);
        gl.uniform1f(pu.u_alpha, A); gl.uniform1f(pu.u_intro, intro); gl.uniform1f(pu.u_dpr, this.dpr); gl.uniform4fv(pu.u_fd, fd);
        gl.uniform3fv(pu.u_cg, pal.glitter); gl.uniform3fv(pu.u_cb, pal.bokeh); gl.uniform3fv(pu.u_cd, pal.dust);
        gl.drawArrays(gl.POINTS, 0, Math.floor(b.np * (this.q < 1 ? .7 : 1)));
      }
    }
    gl.bindVertexArray(null);
  }
  dispose() {
    this.c.removeEventListener('webglcontextlost', this._lost); this.c.removeEventListener('webglcontextrestored', this._restored);
    const ext = this.gl && this.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); this.gl = null;
  }
}

/* ------------------------------------------------------------------ engine: one rAF loop, visibility, adaptive quality */
export function supported() { try { return typeof document !== 'undefined' && !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } }

/**
 * createRibbons(opts)
 *  accent        brand colour (hex). Omit for the original lime palette.
 *  cool          hex[] for the outer strands (default derived from accent; teal/blue for lime).
 *  palette       a full palette object (overrides accent).
 *  reducedMotion force on/off (default: prefers-reduced-motion).
 *  dpr           resolution cap for sharp layers (default 1; the effect is soft, so 1 is enough).
 *  fps           frame cap (default 60).
 *  onDegrade(level) called when quality steps down (the engine also sets html.ribbon-lite).
 */
export function createRibbons(opts = {}) {
  const pal = opts.palette || (opts.accent ? paletteFromAccent(opts.accent, { cool: opts.cool }) : PALETTES.lime);
  const reduce = opts.reducedMotion != null ? opts.reducedMotion : matchMedia('(prefers-reduced-motion: reduce)').matches;
  const perf = { lvl: 0, dpr: opts.dpr || 1, q: 1, cap: 1000 / (opts.fps || 60) - 1.7, acc: 0, n: 0 };
  const entries = new Set(); let raf = 0, start = performance.now(), lastDraw = 0, last = start;
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { const en = e.target.__ribbon; if (en) en.layer.visible = e.isIntersecting; })) : null;
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => entries.forEach(en => en.resize())) : null;
  if (ro) ro.observe(document.documentElement);
  const onWinResize = () => entries.forEach(en => en.resize()); addEventListener('resize', onWinResize);

  // canvases position themselves, so a bare <canvas data-ribbon="..."> just works
  function place(canvas, fixed) {
    const st = canvas.style, cs = getComputedStyle(canvas);
    if (fixed) { st.position = 'fixed'; st.inset = '0'; st.width = '100%'; st.height = '100%'; if (cs.zIndex === 'auto') st.zIndex = '0'; }
    else {
      if (cs.position === 'static') { st.position = 'absolute'; st.inset = '0'; st.width = '100%'; st.height = '100%'; }
      const host = canvas.parentElement; if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    }
    st.pointerEvents = 'none'; st.display = 'block';
  }
  function register(canvas, layer, resize, extra = {}) {
    place(canvas, extra.fixed);
    const en = { canvas, layer, resize, done: 0, ...extra };
    canvas.__ribbon = en; entries.add(en);
    if (io && !extra.always) io.observe(canvas); if (ro) ro.observe(canvas);
    resize(); if (!raf) raf = requestAnimationFrame(loop);
    return { destroy() { entries.delete(en); if (io) io.unobserve(canvas); if (ro) ro.unobserve(canvas); layer.dispose(); delete canvas.__ribbon; if (!entries.size && raf) { cancelAnimationFrame(raf); raf = 0; } }, layer, entry: en };
  }
  function sizeTo(layer, canvas) { const r = canvas.getBoundingClientRect(); layer.size(r.width, r.height, perf.dpr); layer.q = perf.q; }

  /** Sharp hairpin ribbon. Canvas: position:absolute; inset:0 inside the hero (or hero + next section) wrapper. */
  function hero(canvas, o = {}) {
    const layer = new Layer(canvas, pal, { fade: o.fade || [0, 70] }); const V = { v: 900 };
    layer.add({ ...PRESETS.hero, ...(o.params || {}) }, (t, w, h, b) => {
      const mob = w < 980; b.alpha = (o.alpha != null ? o.alpha : 1) * (mob ? .5 : 1); b.wscale = Math.min(1.15, Math.max(.6, w / 1440));
      return drift((mob ? SHAPES.hairpinMobile : SHAPES.hairpin)(w, V.v), t, w * .012, V.v * .014);
    });
    return register(canvas, layer, () => { sizeTo(layer, canvas); const el = o.heightFrom; V.v = el ? el.offsetHeight : Math.min(layer.h, innerHeight); });
  }
  /** Sharp lower-page waves: a fan near the top of the box and a rising band near the bottom. */
  function waves(canvas, o = {}) {
    const layer = new Layer(canvas, pal, { fade: o.fade || [160, 120] }), fy = o.fanY != null ? o.fanY : .32, by = o.bandY != null ? o.bandY : .9;
    const sc = b => { b.wscale = Math.min(1.15, Math.max(.6, layer.w / 1440)); };
    if (o.fan !== false) layer.add({ ...PRESETS.fan, ...(o.fanParams || {}) }, (t, w, h, b) => { sc(b); return drift(SHAPES.fan(w, h * fy), t, w * .01, 22); });
    if (o.band !== false) layer.add({ ...PRESETS.band, ...(o.bandParams || {}) }, (t, w, h, b) => { sc(b); return drift(SHAPES.band(w, h * by), t, w * .01, 20); });
    return register(canvas, layer, () => sizeTo(layer, canvas));
  }
  /**
   * Soft fixed light behind the page. Canvas: position:fixed; inset:0; z-index below content.
   * Stops: sections with data-ribbon-shape="<AMBIENT key>" (or every <section> automatically, cycling shapes).
   * hideUntil: element (e.g. the hero wrapper); the ambient stays off until it is scrolled past.
   */
  function ambient(canvas, o = {}) {
    const layer = new Layer(canvas, pal, { scale: .25 }); let anchors = [], cur = AMBIENT.off.p.map(p => p.slice()), curO = 0, shownO = -1;
    const shapes = { ...AMBIENT, ...(o.shapes || {}) };
    function compute() {
      const vh = innerHeight, sy = scrollY; anchors = [{ y: 0, k: 'off' }];
      const hu = o.hideUntil || (document.querySelector('[data-ribbon="hero"]') || {}).parentElement;
      if (hu && hu.getBoundingClientRect) anchors.push({ y: Math.max(10, hu.getBoundingClientRect().bottom + sy - vh * 1.15), k: 'off' });
      const els = o.stops ? o.stops : Array.from(document.querySelectorAll(o.selector || '[data-ribbon-shape], main section, body > section'));
      let i = 0;
      els.forEach(st => { const el = st.el || st, k = st.shape || el.dataset.ribbonShape || AMBIENT_ORDER[i++ % AMBIENT_ORDER.length];
        if (hu && hu.contains(el) && !el.dataset.ribbonShape) return; if (!shapes[k]) return;
        anchors.push({ y: el.getBoundingClientRect().top + sy - vh * .45, k }); });
      anchors.sort((a, b) => a.y - b.y);
    }
    function target(sy) {
      let i = 0; while (i < anchors.length - 1 && anchors[i + 1].y <= sy) i++;
      const a = anchors[i], b = anchors[Math.min(i + 1, anchors.length - 1)], t = b.y > a.y ? Math.min(1, Math.max(0, (sy - a.y) / (b.y - a.y))) : 0, s = t * t * (3 - 2 * t), P = shapes[a.k], Q = shapes[b.k];
      return { p: P.p.map((pt, j) => [pt[0] + (Q.p[j][0] - pt[0]) * s, pt[1] + (Q.p[j][1] - pt[1]) * s]), o: (P.o + (Q.o - P.o) * s) * (o.opacity != null ? o.opacity : 1) };
    }
    layer.add({ ...PRESETS.ambient, ...(o.params || {}) }, (t, w, h) => drift(cur.map(q => [q[0] * w, q[1] * h]), t, w * .015, h * .02));
    canvas.style.opacity = 0;
    return register(canvas, layer, () => { layer.size(innerWidth, innerHeight, 1); compute(); }, {
      always: true, fixed: true,
      step(dt) { const tg = target(scrollY), k = Math.min(1, dt * 3.2); for (let j = 0; j < 4; j++) { cur[j][0] += (tg.p[j][0] - cur[j][0]) * k; cur[j][1] += (tg.p[j][1] - cur[j][1]) * k; }
        curO += (tg.o - curO) * k; if (Math.abs(curO - shownO) > .004) { shownO = curO; canvas.style.opacity = curO.toFixed(3); } return curO > .02 && (Math.abs(tg.o - curO) > .002 || !reduce); },
    });
  }
  /** Fully custom layer: bundles = [{ params (or preset name), points(t, w, h) }]. */
  function custom(canvas, o = {}) {
    const layer = new Layer(canvas, pal, { fade: o.fade || [0, 0], scale: o.scale || 1 });
    (o.bundles || []).forEach(B => layer.add(typeof B.params === 'string' ? PRESETS[B.params] : B.params, B.points));
    return register(canvas, layer, () => sizeTo(layer, canvas), { always: !!o.fixed, fixed: !!o.fixed });
  }

  function degrade() {
    perf.lvl++;
    if (perf.lvl === 1) { perf.q = .75; document.documentElement.classList.add('ribbon-lite'); }
    else if (perf.lvl === 2) { perf.q = .55; perf.cap = 31; }
    else if (perf.lvl === 3) { perf.q = .4; perf.dpr = .75; }
    entries.forEach(en => { en.resize(); en.done = 0; }); perf.acc = perf.n = 0; if (opts.onDegrade) opts.onDegrade(perf.lvl);
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const frameDt = now - last; if (now - lastDraw < perf.cap) return;
    const dt = Math.min(.05, (now - lastDraw) / 1000); lastDraw = last = now;
    const t = (now - start) / 1000, I = pulse(t), intro = reduce ? 1 : Math.min(1, 1 - Math.pow(1 - Math.max(0, (t - .1) / 1.25), 3));
    let drew = false;
    entries.forEach(en => {
      if (en.step) { const want = en.step(dt); if (want || !en.done) { en.layer.render(t, I, 1, reduce ? 0 : 1); en.done = 1; } return; }
      if (en.layer.visible && (!reduce || !en.done)) { en.layer.render(t, I, intro, reduce ? 0 : 1); en.done = 1; drew = true; }
    });
    if (drew && !reduce && frameDt < 200) { perf.acc += frameDt; perf.n++;
      if (perf.n >= 90) { const avg = perf.acc / perf.n; perf.acc = perf.n = 0; if (avg > (perf.cap > 20 ? 40 : 24) && perf.lvl < 3) degrade(); } }
  }
  return {
    hero, waves, ambient, custom, palette: pal, perf, supported: supported(),
    refresh() { entries.forEach(en => en.resize()); },
    destroy() { [...entries].forEach(en => { if (io) io.unobserve(en.canvas); en.layer.dispose(); delete en.canvas.__ribbon; }); entries.clear(); if (raf) cancelAnimationFrame(raf); raf = 0;
      if (io) io.disconnect(); if (ro) ro.disconnect(); removeEventListener('resize', onWinResize); },
  };
}

/** Zero-config: mounts every <canvas data-ribbon="hero|ambient|waves"> on the page. Returns the engine. */
export function autoMount(opts = {}) {
  const fx = createRibbons(opts);
  if (!fx.supported) { document.documentElement.classList.add('ribbon-nogl'); return fx; }
  document.querySelectorAll('canvas[data-ribbon]').forEach(c => { const k = c.dataset.ribbon; if (fx[k]) fx[k](c, opts[k] || {}); });
  return fx;
}
