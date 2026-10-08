//! Lunyx effects engine. Compiled to WebAssembly (SIMD) and driven from the editor's JS.
//!
//! The JS side writes RGBA frames straight into the buffers exposed by `ptr_*`, fills the
//! parameter block, then calls `process` / `transition`. Everything works on one working
//! resolution set with `setup`, so no allocation happens per frame.

use std::ptr::null_mut;

/// Floats per layer in the parameter block (layer 0 = current clip, layer 1 = incoming clip).
const P: usize = 48;

// Parameter offsets (keep in sync with src/app/engine/presets.ts lookParams).
const EXPOSURE: usize = 0;
const CONTRAST: usize = 1;
const SATURATION: usize = 2;
const TEMPERATURE: usize = 3;
const TINT: usize = 4;
const HIGHLIGHTS: usize = 5;
const SHADOWS: usize = 6;
const FADE: usize = 7;
const VIGNETTE: usize = 8;
const GRAIN: usize = 9;
const SHADOW_TONE: usize = 10; // 3 floats
const HIGHLIGHT_TONE: usize = 13; // 3 floats
const MONO: usize = 16;
const VIBRANCE: usize = 17;
const GAMMA: usize = 18;
const GAIN: usize = 19; // 3 floats
const BG_MODE: usize = 24;
const BG_BLUR: usize = 25;
const BG_COLOR: usize = 26; // 3 floats
const BG_COLOR2: usize = 29; // 3 floats
const LIGHT_MODE: usize = 32;
const LIGHT_AMOUNT: usize = 33;
const LIGHT_POS: usize = 34;
const LIGHT_COLOR: usize = 35; // 3 floats
const LIGHT_SOFT: usize = 38;
const LIGHT_SPEED: usize = 39;
const LIGHT_SUBJECT: usize = 40;
const BG_DIM: usize = 41;
const SHARPEN: usize = 42;
const LIGHT_COLOR2: usize = 43; // 3 floats

struct St {
    w: usize,
    h: usize,
    a: Vec<u8>,
    b: Vec<u8>,
    tmp: Vec<u8>,
    bg: Vec<u8>,
    mask: Vec<u8>,
    maskf: Vec<f32>,
    smask: Vec<u8>,
    light: Vec<f32>,
    lw: usize,
    lh: usize,
    params: Vec<f32>,
    line: Vec<u8>,
    small: Vec<u8>,
    vigmap: Vec<u8>,
    lkey: [f32; 16],
    ltime: f32,
    lvalid: bool,
    vigkey: (usize, usize, u32),
    noise: Vec<i8>,
    audio: Vec<f32>,
    out: Vec<f32>,
    frame: u32,
}

impl St {
    fn new() -> St {
        St {
            w: 0,
            h: 0,
            a: Vec::new(),
            b: Vec::new(),
            tmp: Vec::new(),
            bg: Vec::new(),
            mask: Vec::new(),
            maskf: Vec::new(),
            smask: Vec::new(),
            light: Vec::new(),
            lw: 0,
            lh: 0,
            params: vec![0.0; P * 2],
            line: Vec::new(),
            small: Vec::new(),
            vigmap: Vec::new(),
            lkey: [0.0; 16],
            ltime: 0.0,
            lvalid: false,
            vigkey: (0, 0, 0),
            noise: (0..65536u32).map(|i| ((hash(i, 11, 5) & 0xff) as i32 - 128) as i8).collect(),
            audio: Vec::new(),
            out: vec![0.0; 8192],
            frame: 0,
        }
    }
}

static mut ST: *mut St = null_mut();

fn st() -> &'static mut St {
    // Single-threaded wasm: one global state, created on first use.
    unsafe {
        if ST.is_null() {
            ST = Box::into_raw(Box::new(St::new()));
        }
        &mut *ST
    }
}

// ---------------------------------------------------------------- buffers

#[no_mangle]
pub extern "C" fn setup(w: u32, h: u32) {
    let s = st();
    let (w, h) = (w as usize, h as usize);
    if s.w == w && s.h == h {
        return;
    }
    s.w = w;
    s.h = h;
    let n = w * h;
    s.a = vec![0; n * 4];
    s.b = vec![0; n * 4];
    s.tmp = vec![0; n * 4];
    s.bg = vec![0; n * 4];
    s.mask = vec![255; n];
    s.maskf = vec![1.0; n];
    s.lw = (w + 3) / 4 + 1;
    s.lh = (h + 3) / 4 + 1;
    s.light = vec![0.0; s.lw * s.lh * 4];
    s.lvalid = false;
    s.line = vec![0; n * 4];
}

#[no_mangle]
pub extern "C" fn ptr_a() -> *mut u8 {
    st().a.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn ptr_b() -> *mut u8 {
    st().b.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn ptr_bg() -> *mut u8 {
    st().bg.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn ptr_mask() -> *mut u8 {
    st().mask.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn ptr_params() -> *mut f32 {
    st().params.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn ptr_smask(n: u32) -> *mut u8 {
    let s = st();
    if s.smask.len() < n as usize {
        s.smask = vec![0; n as usize];
    }
    s.smask.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn ptr_audio(n: u32) -> *mut f32 {
    let s = st();
    if s.audio.len() < n as usize {
        s.audio = vec![0.0; n as usize];
    }
    s.audio.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn ptr_out() -> *mut f32 {
    st().out.as_mut_ptr()
}

// ---------------------------------------------------------------- helpers

#[inline]
fn clamp01(x: f32) -> f32 {
    x.max(0.0).min(1.0)
}
#[inline]
fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = clamp01((x - e0) / (e1 - e0));
    t * t * (3.0 - 2.0 * t)
}
#[inline]
fn to_u8(x: f32) -> u8 {
    x.max(0.0).min(255.0) as u8
}
#[inline]
fn hash(x: u32, y: u32, z: u32) -> u32 {
    let mut h = x.wrapping_mul(374761393) ^ y.wrapping_mul(668265263) ^ z.wrapping_mul(2246822519);
    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    h ^ (h >> 16)
}
#[inline]
fn hashf(x: i32, y: i32) -> f32 {
    (hash(x as u32, y as u32, 77) & 0xffff) as f32 / 65535.0
}
fn vnoise(x: f32, y: f32) -> f32 {
    let (xi, yi) = (x.floor(), y.floor());
    let (fx, fy) = (x - xi, y - yi);
    let (ux, uy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let (xi, yi) = (xi as i32, yi as i32);
    let a = hashf(xi, yi);
    let b = hashf(xi + 1, yi);
    let c = hashf(xi, yi + 1);
    let d = hashf(xi + 1, yi + 1);
    a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}
fn fbm(x: f32, y: f32) -> f32 {
    vnoise(x, y) * 0.55 + vnoise(x * 2.03, y * 2.03) * 0.3 + vnoise(x * 4.1, y * 4.1) * 0.15
}

/// Separable running-sum box blur on an RGBA buffer. Cost does not depend on the radius.
/// `line` must hold at least w*h*4 bytes (vertical pass works row by row, which is cache friendly).
fn box_blur(buf: &mut [u8], w: usize, h: usize, r: usize, line: &mut [u8], horizontal_only: bool) {
    if r == 0 || w == 0 || h == 0 {
        return;
    }
    let div = (2 * r + 1) as u32;
    let inv = (65536 + div / 2) / div;
    // horizontal
    for y in 0..h {
        let row = &mut buf[y * w * 4..(y + 1) * w * 4];
        line[..w * 4].copy_from_slice(row);
        let mut s = [0u32; 4];
        for c in 0..4 {
            s[c] = line[c] as u32 * (r as u32 + 1);
            for k in 1..=r {
                s[c] += line[k.min(w - 1) * 4 + c] as u32;
            }
        }
        for x in 0..w {
            let add = (x + r + 1).min(w - 1) * 4;
            let sub = x.saturating_sub(r) * 4;
            for c in 0..4 {
                row[x * 4 + c] = ((s[c] * inv) >> 16).min(255) as u8;
                s[c] = s[c] + line[add + c] as u32 - line[sub + c] as u32;
            }
        }
    }
    if horizontal_only {
        return;
    }
    // vertical, one whole row at a time
    let stride = w * 4;
    let src = &mut line[..stride * h];
    src.copy_from_slice(&buf[..stride * h]);
    let mut sums = vec![0u32; stride];
    for x in 0..stride {
        let mut v = src[x] as u32 * (r as u32 + 1);
        for k in 1..=r {
            v += src[k.min(h - 1) * stride + x] as u32;
        }
        sums[x] = v;
    }
    for y in 0..h {
        let add = (y + r + 1).min(h - 1) * stride;
        let sub = y.saturating_sub(r) * stride;
        let o = y * stride;
        for x in 0..stride {
            buf[o + x] = ((sums[x] * inv) >> 16).min(255) as u8;
            sums[x] = sums[x] + src[add + x] as u32 - src[sub + x] as u32;
        }
    }
}

/// Soft blur. Large radii work on a 2x / 4x smaller copy and scale back up, which is
/// up to 16x less work and looks the same for a blur.
fn blur(buf: &mut [u8], w: usize, h: usize, r: f32, line: &mut [u8], small: &mut Vec<u8>) {
    let r = r.max(0.0) as usize;
    if r == 0 {
        return;
    }
    let f = if r >= 10 { 4 } else if r >= 5 { 2 } else { 1 };
    if f == 1 {
        let r1 = (r / 2).max(1);
        box_blur(buf, w, h, r1, line, false);
        box_blur(buf, w, h, r1, line, false);
        return;
    }
    let (sw, sh) = ((w + f - 1) / f, (h + f - 1) / f);
    if small.len() < sw * sh * 4 {
        small.resize(sw * sh * 4, 0);
    }
    // box downsample (RGB)
    for y in 0..sh {
        let y0 = y * f;
        let y1 = (y0 + f).min(h);
        for x in 0..sw {
            let x0 = x * f;
            let x1 = (x0 + f).min(w);
            let mut acc = [0u32; 3];
            for yy in y0..y1 {
                let mut i = (yy * w + x0) * 4;
                for _ in x0..x1 {
                    acc[0] += buf[i] as u32;
                    acc[1] += buf[i + 1] as u32;
                    acc[2] += buf[i + 2] as u32;
                    i += 4;
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as u32;
            let o = (y * sw + x) * 4;
            small[o] = (acc[0] / n) as u8;
            small[o + 1] = (acc[1] / n) as u8;
            small[o + 2] = (acc[2] / n) as u8;
            small[o + 3] = 255;
        }
    }
    let r1 = ((r / f) / 2).max(1);
    box_blur(&mut small[..sw * sh * 4], sw, sh, r1, line, false);
    box_blur(&mut small[..sw * sh * 4], sw, sh, r1, line, false);
    // bilinear upsample: blend the two source rows once per output row, then across
    let xs: Vec<(usize, usize, u32)> = (0..w)
        .map(|x| {
            let fx = ((x as f32 + 0.5) / f as f32 - 0.5).max(0.0);
            let x0 = (fx as usize).min(sw - 1);
            (x0 * 4, (x0 + 1).min(sw - 1) * 4, ((fx - x0 as f32) * 256.0) as u32)
        })
        .collect();
    let mut vrow = vec![0u32; sw * 4];
    for y in 0..h {
        let fy = ((y as f32 + 0.5) / f as f32 - 0.5).max(0.0);
        let y0 = (fy as usize).min(sh - 1);
        let y1 = (y0 + 1).min(sh - 1);
        let ty = ((fy - y0 as f32) * 256.0) as u32;
        let (q0, q1) = (y0 * sw * 4, y1 * sw * 4);
        for i in 0..sw * 4 {
            vrow[i] = (small[q0 + i] as u32 * (256 - ty) + small[q1 + i] as u32 * ty) >> 8;
        }
        let mut o = y * w * 4;
        for x in 0..w {
            let (a, b, tx) = xs[x];
            buf[o] = ((vrow[a] * (256 - tx) + vrow[b] * tx) >> 8) as u8;
            buf[o + 1] = ((vrow[a + 1] * (256 - tx) + vrow[b + 1] * tx) >> 8) as u8;
            buf[o + 2] = ((vrow[a + 2] * (256 - tx) + vrow[b + 2] * tx) >> 8) as u8;
            buf[o + 3] = 255;
            o += 4;
        }
    }
}

// ---------------------------------------------------------------- segmentation mask

/// Upsamples the small person mask (`ptr_smask`, sw*sh bytes) to the working size with
/// temporal smoothing (`smooth` 0..1) and an edge-tightening curve.
#[no_mangle]
pub extern "C" fn set_mask(sw: u32, sh: u32, smooth: f32) {
    let s = st();
    let (w, h, sw, sh) = (s.w, s.h, sw as usize, sh as usize);
    if w == 0 || sw == 0 || sh == 0 {
        return;
    }
    let keep = clamp01(smooth);
    let xs: Vec<(usize, usize, f32)> = (0..w)
        .map(|x| {
            let fx = ((x as f32 + 0.5) * sw as f32 / w as f32 - 0.5).max(0.0);
            let x0 = (fx as usize).min(sw - 1);
            (x0, (x0 + 1).min(sw - 1), fx - x0 as f32)
        })
        .collect();
    for y in 0..h {
        let fy = ((y as f32 + 0.5) * sh as f32 / h as f32 - 0.5).max(0.0);
        let y0 = (fy as usize).min(sh - 1);
        let y1 = (y0 + 1).min(sh - 1);
        let ty = fy - y0 as f32;
        let r0 = &s.smask[y0 * sw..y0 * sw + sw];
        let r1 = &s.smask[y1 * sw..y1 * sw + sw];
        for x in 0..w {
            let (x0, x1, tx) = xs[x];
            let top = r0[x0] as f32 + (r0[x1] as f32 - r0[x0] as f32) * tx;
            let bot = r1[x0] as f32 + (r1[x1] as f32 - r1[x0] as f32) * tx;
            let v = (top + (bot - top) * ty) / 255.0;
            let i = y * w + x;
            let m = s.maskf[i] * keep + v * (1.0 - keep);
            s.maskf[i] = m;
            s.mask[i] = (smoothstep(0.3, 0.7, m) * 255.0) as u8;
        }
    }
}

// ---------------------------------------------------------------- lighting

/// Fills the quarter-resolution light map: per cell (r, g, b light, shade).
fn build_light(s: &mut St, p: &[f32], time: f32) {
    let mode = p[LIGHT_MODE] as i32;
    let (lw, lh) = (s.lw, s.lh);
    let aspect = s.w as f32 / s.h.max(1) as f32;
    let t = time * p[LIGHT_SPEED].max(0.0);
    let pos = p[LIGHT_POS];
    let soft = clamp01(p[LIGHT_SOFT]);
    let col = [p[LIGHT_COLOR], p[LIGHT_COLOR + 1], p[LIGHT_COLOR + 2]];
    let alt = [p[LIGHT_COLOR2], p[LIGHT_COLOR2 + 1], p[LIGHT_COLOR2 + 2]]; // second neon colour
    let e = 0.004 + soft * 0.06;
    for y in 0..lh {
        let v = y as f32 / (lh - 1).max(1) as f32;
        for x in 0..lw {
            let u = x as f32 / (lw - 1).max(1) as f32;
            let (mut l, mut shade, mut c) = (0.0f32, 0.0f32, col);
            match mode {
                // Sunlight through a four-pane window, skewed onto the wall.
                1 => {
                    let sway = (t * 0.35).sin() * 0.008;
                    let su = u - 0.12 - pos * 0.55 + (v - 0.5) * 0.42 + sway;
                    let sv = v;
                    let bx = smoothstep(0.0 - e, 0.0 + e, su) * (1.0 - smoothstep(0.46 - e, 0.46 + e, su));
                    let by = smoothstep(0.1 - e, 0.1 + e, sv) * (1.0 - smoothstep(0.86 - e, 0.86 + e, sv));
                    let mx = smoothstep(0.012, 0.012 + e * 1.5, (su - 0.23).abs());
                    let my = smoothstep(0.014, 0.014 + e * 1.5, (sv - 0.47).abs());
                    l = bx * by * mx * my;
                    let dx = (su - 0.23) * aspect;
                    let dy = sv - 0.48;
                    l += 0.18 * (-(dx * dx + dy * dy) * 4.0).exp();
                    shade = 0.45;
                }
                // Dappled light through tree leaves, drifting in the wind.
                2 => {
                    let wind = (t * 0.5).sin() * 0.25 + t * 0.06;
                    let n = fbm(u * aspect * 5.0 + wind, v * 5.0 + (t * 0.37).cos() * 0.15);
                    let th = 0.56 - pos * 0.12;
                    l = smoothstep(th - 0.02 - soft * 0.08, th + 0.04 + soft * 0.08, n);
                    l *= 0.65 + 0.35 * (1.0 - v);
                    shade = 0.5;
                }
                // Venetian blinds.
                3 => {
                    let d = u * 0.55 + v * 0.85;
                    let f = (d * 11.0 + pos * 2.0 + t * 0.02).fract();
                    let stripe = smoothstep(0.08 - e * 4.0, 0.08 + e * 4.0, f) * (1.0 - smoothstep(0.55 - e * 4.0, 0.55 + e * 4.0, f));
                    let region = smoothstep(0.05, 0.25, u + 0.2 - pos * 0.3) * (1.0 - smoothstep(0.75, 1.05, u - pos * 0.3 + v * 0.2));
                    l = stripe * region;
                    shade = 0.45;
                }
                // God rays from above.
                4 => {
                    let dx = (u - pos) * aspect;
                    let dy = v + 0.15;
                    let ang = dx.atan2(dy);
                    let rays = (vnoise(ang * 9.0 + t * 0.15, 0.5) * 0.7 + vnoise(ang * 23.0 - t * 0.1, 3.5) * 0.3).powf(1.6 - soft * 0.6);
                    let dist = (dx * dx + dy * dy).sqrt();
                    l = rays * (-dist * 1.4).exp() * 1.6;
                    shade = 0.2;
                }
                // Golden hour side light.
                5 => {
                    let dx = (u - pos) * aspect;
                    let dy = v - 0.2;
                    let d = (dx * dx + dy * dy).sqrt();
                    l = (1.0 - smoothstep(0.0, 1.0 + soft, d)).powf(1.5);
                    shade = 0.2;
                }
                // Two-colour neon side lights.
                6 => {
                    let left = (-(u * aspect) * (3.5 - soft * 2.0)).exp();
                    let right = (-((1.0 - u) * aspect) * (3.5 - soft * 2.0)).exp();
                    let pulse = 0.85 + 0.15 * (t * 2.0).sin();
                    l = 1.0;
                    c = [
                        (col[0] * left + alt[0] * right) * pulse,
                        (col[1] * left + alt[1] * right) * pulse,
                        (col[2] * left + alt[2] * right) * pulse,
                    ];
                    shade = 0.35;
                }
                // Film light leaks.
                7 => {
                    let mut acc = [0.0f32; 3];
                    let blobs = [(0.1, 0.3, 1.0, 0.35, 0.1), (0.9, 0.7, 1.0, 0.6, 0.15), (0.3, 0.9, 1.0, 0.85, 0.4)];
                    for (k, &(bx, by, r, g, b)) in blobs.iter().enumerate() {
                        let kf = k as f32;
                        let cx = bx + (t * (0.13 + kf * 0.05) + kf).sin() * 0.25 + pos - 0.5;
                        let cy = by + (t * (0.11 + kf * 0.04) + kf * 2.0).cos() * 0.2;
                        let dx = (u - cx) * aspect;
                        let dy = v - cy;
                        let f = (-(dx * dx + dy * dy) * (6.0 - soft * 4.0)).exp();
                        acc[0] += f * r;
                        acc[1] += f * g;
                        acc[2] += f * b;
                    }
                    l = 1.0;
                    c = [acc[0] * col[0].max(0.3), acc[1] * col[1].max(0.3), acc[2] * col[2].max(0.3)];
                    shade = 0.0;
                }
                // Stage spotlight.
                8 => {
                    let dx = (u - pos) * aspect;
                    let dy = (v - 0.42) * 0.8;
                    let d = (dx * dx + dy * dy).sqrt();
                    l = 1.0 - smoothstep(0.18, 0.5 + soft * 0.3, d);
                    shade = 0.65;
                }
                // Water caustics.
                9 => {
                    let px = u * aspect * 7.0 + pos * 3.0;
                    let py = v * 7.0;
                    let a1 = (px + t * 0.6 + (py * 1.3 + t).sin()).sin();
                    let a2 = (py * 1.1 - t * 0.5 + (px * 0.9 - t * 0.7).cos()).cos();
                    let a3 = ((px + py) * 0.7 + t * 0.4).sin();
                    let n = (a1 + a2 + a3) / 3.0;
                    l = (1.0 - n.abs()).powf(6.0 - soft * 3.0);
                    shade = 0.3;
                }
                _ => {}
            }
            let i = (y * lw + x) * 4;
            s.light[i] = l * c[0];
            s.light[i + 1] = l * c[1];
            s.light[i + 2] = l * c[2];
            s.light[i + 3] = shade * (1.0 - clamp01(l));
        }
    }
}

fn apply_light(s: &mut St, p: &[f32], has_mask: bool) {
    let (w, h, lw, lh) = (s.w, s.h, s.lw, s.lh);
    let amount = p[LIGHT_AMOUNT];
    let subj = clamp01(p[LIGHT_SUBJECT]);
    let sx = (lw - 1) as f32 / (w.max(2) - 1) as f32;
    let sy = (lh - 1) as f32 / (h.max(2) - 1) as f32;
    // Per-column cell index and 8-bit blend.
    let cols: Vec<(usize, usize, i32)> = (0..w)
        .map(|x| {
            let fx = x as f32 * sx;
            let x0 = (fx as usize).min(lw - 1);
            (x0 * 4, (x0 + 1).min(lw - 1) * 4, ((fx - x0 as f32) * 256.0) as i32)
        })
        .collect();
    // How much of the light lands on a pixel, by mask value (0..256).
    let mut kt = [256i32; 256];
    if has_mask {
        for m in 0..256 {
            let mf = m as f32 / 255.0;
            kt[m] = (((1.0 - mf) + mf * subj) * 256.0) as i32;
        }
    }
    let mut lrow = vec![0i32; lw * 4];
    for y in 0..h {
        let fy = y as f32 * sy;
        let y0 = (fy as usize).min(lh - 1);
        let y1 = (y0 + 1).min(lh - 1);
        let ty = fy - y0 as f32;
        let (r0, r1) = (y0 * lw * 4, y1 * lw * 4);
        let mut any = false;
        for i in 0..lw * 4 {
            let v = s.light[r0 + i] + (s.light[r1 + i] - s.light[r0 + i]) * ty;
            // channels: light scaled by amount, clamped to 0..1; shade (index 3) capped at 0.9
            let q = if i & 3 == 3 { ((v * amount).min(0.9).max(0.0) * 256.0) as i32 } else { ((v * amount).min(1.0).max(0.0) * 256.0) as i32 };
            lrow[i] = q;
            any |= q > 0;
        }
        if !any {
            continue;
        }
        let base = y * w;
        for x in 0..w {
            let kk = if has_mask { kt[s.mask[base + x] as usize] } else { 256 };
            if kk == 0 {
                continue;
            }
            let (a, b, tx) = cols[x];
            let itx = 256 - tx;
            let mut sh = (lrow[a + 3] * itx + lrow[b + 3] * tx) >> 8;
            let mut l0 = (lrow[a] * itx + lrow[b] * tx) >> 8;
            let mut l1 = (lrow[a + 1] * itx + lrow[b + 1] * tx) >> 8;
            let mut l2 = (lrow[a + 2] * itx + lrow[b + 2] * tx) >> 8;
            if kk != 256 {
                sh = (sh * kk) >> 8;
                l0 = (l0 * kk) >> 8;
                l1 = (l1 * kk) >> 8;
                l2 = (l2 * kk) >> 8;
            }
            if l0 + l1 + l2 + sh == 0 {
                continue;
            }
            let dark = 256 - sh;
            let pi = (base + x) * 4;
            let v0 = (s.a[pi] as i32 * dark) >> 8;
            let v1 = (s.a[pi + 1] as i32 * dark) >> 8;
            let v2 = (s.a[pi + 2] as i32 * dark) >> 8;
            s.a[pi] = (v0 + (((255 - v0) * l0) >> 8)).min(255) as u8;
            s.a[pi + 1] = (v1 + (((255 - v1) * l1) >> 8)).min(255) as u8;
            s.a[pi + 2] = (v2 + (((255 - v2) * l2) >> 8)).min(255) as u8;
        }
    }
}

fn build_luts(p: &[f32]) -> [[u8; 256]; 3] {
    let mut luts = [[0u8; 256]; 3];
    let exp = 2f32.powf(p[EXPOSURE]);
    let temp = p[TEMPERATURE];
    let tint = p[TINT];
    let wb = [
        (1.0 + temp * 0.12) * (1.0 + tint * 0.05),
        1.0 - tint * 0.09,
        (1.0 - temp * 0.12) * (1.0 + tint * 0.05),
    ];
    let gamma = if p[GAMMA] > 0.05 { p[GAMMA] } else { 1.0 };
    let contrast = p[CONTRAST];
    let fade = p[FADE];
    for c in 0..3 {
        let gain = if p[GAIN + c] > 0.0 { p[GAIN + c] } else { 1.0 };
        for i in 0..256 {
            let mut x = i as f32 / 255.0;
            x *= exp * wb[c] * gain;
            let xc = clamp01(x);
            x += p[SHADOWS] * 0.45 * xc * (1.0 - xc) * (1.0 - xc) * 2.0;
            x += p[HIGHLIGHTS] * 0.45 * xc * xc * (1.0 - xc) * 2.0;
            x = clamp01(x);
            if contrast > 0.0 {
                let sc = x * x * (3.0 - 2.0 * x);
                x += (sc - x) * contrast;
            } else {
                x += (0.5 - x) * -contrast * 0.5;
            }
            x = clamp01(x).powf(1.0 / gamma);
            x = fade * 0.13 + x * (1.0 - fade * 0.18);
            luts[c][i] = (clamp01(x) * 255.0 + 0.5) as u8;
        }
    }
    luts
}

fn grade(buf: &mut [u8], w: usize, h: usize, p: &[f32], frame: u32, vigmap: &mut Vec<u8>, vigkey: &mut (usize, usize, u32), noise: &[i8]) {
    let luts = build_luts(p);
    let mono = clamp01(p[MONO]);
    let sat = 1.0 + p[SATURATION];
    let vib = p[VIBRANCE];
    let satq = (sat * (1.0 - mono) * 256.0) as i32;
    let st = [p[SHADOW_TONE], p[SHADOW_TONE + 1], p[SHADOW_TONE + 2]];
    let ht = [p[HIGHLIGHT_TONE], p[HIGHLIGHT_TONE + 1], p[HIGHLIGHT_TONE + 2]];
    let toning = st.iter().chain(ht.iter()).any(|v| v.abs() > 0.001);
    let color = toning || (sat - 1.0).abs() > 0.001 || vib.abs() > 0.001 || mono > 0.001;
    let vig = p[VIGNETTE];
    let grain = p[GRAIN] * 30.0;
    let n = w * h;

    // Tone offsets by luma, and film-grain weight by luma.
    let mut offs = [[0i32; 256]; 3];
    let mut gq = [0i32; 256];
    for l in 0..256 {
        let wl = l as f32 / 255.0;
        let ws = (1.0 - wl) * (1.0 - wl) * 60.0;
        let wh = wl * wl * 60.0;
        for c in 0..3 {
            offs[c][l] = (st[c] * ws + ht[c] * wh) as i32;
        }
        gq[l] = (grain * (1.0 - (wl - 0.5).abs()) * 16.0) as i32;
    }
    // Vignette multiplier per pixel (8.8 fixed), rebuilt only when it changes.
    let use_vig = vig > 0.001;
    if use_vig {
        let key = (w, h, (vig * 1000.0) as u32);
        if *vigkey != key || vigmap.len() != n {
            vigmap.resize(n, 0);
            for y in 0..h {
                let dy = (y as f32 / h as f32 - 0.5) * 2.0;
                for x in 0..w {
                    let dx = (x as f32 / w as f32 - 0.5) * 2.0;
                    let d = (dx * dx + dy * dy) * 0.5;
                    vigmap[y * w + x] = ((1.0 - vig * smoothstep(0.15, 1.0, d)) * 255.0) as u8;
                }
            }
            *vigkey = key;
        }
    }
    let use_grain = grain > 0.01;
    let noff = (hash(frame, 7, 3) as usize) & 0xffff;

    let ctx = GradeCtx { luts: &luts, offs: &offs, gq: &gq, vigmap, noise, noff, satq, vib };
    // One specialised loop per combination, so the per-pixel branches disappear.
    match (color, use_vig, use_grain) {
        (false, false, false) => grade_loop::<false, false, false>(buf, &ctx),
        (true, false, false) => grade_loop::<true, false, false>(buf, &ctx),
        (false, true, false) => grade_loop::<false, true, false>(buf, &ctx),
        (true, true, false) => grade_loop::<true, true, false>(buf, &ctx),
        (false, false, true) => grade_loop::<false, false, true>(buf, &ctx),
        (true, false, true) => grade_loop::<true, false, true>(buf, &ctx),
        (false, true, true) => grade_loop::<false, true, true>(buf, &ctx),
        (true, true, true) => grade_loop::<true, true, true>(buf, &ctx),
    }
}

struct GradeCtx<'a> {
    luts: &'a [[u8; 256]; 3],
    offs: &'a [[i32; 256]; 3],
    gq: &'a [i32; 256],
    vigmap: &'a [u8],
    noise: &'a [i8],
    noff: usize,
    satq: i32,
    vib: f32,
}

#[inline(always)]
fn grade_loop<const COLOR: bool, const VIG: bool, const GRAIN: bool>(buf: &mut [u8], c: &GradeCtx) {
    let toning = COLOR; // tone offsets are zero when unused, so applying them is harmless
    for (i, px) in buf.chunks_exact_mut(4).enumerate() {
        let mut r = c.luts[0][px[0] as usize] as i32;
        let mut g = c.luts[1][px[1] as usize] as i32;
        let mut b = c.luts[2][px[2] as usize] as i32;
        if COLOR {
            let l = (54 * r + 183 * g + 19 * b) >> 8;
            let mut f = c.satq;
            if c.vib != 0.0 {
                let mx = r.max(g).max(b);
                let mn = r.min(g).min(b);
                f = (c.satq as f32 * (1.0 + c.vib * (1.0 - (mx - mn) as f32 / 255.0))) as i32;
            }
            r = l + (((r - l) * f) >> 8);
            g = l + (((g - l) * f) >> 8);
            b = l + (((b - l) * f) >> 8);
            if toning {
                let li = (l & 255) as usize;
                r += c.offs[0][li];
                g += c.offs[1][li];
                b += c.offs[2][li];
            }
        }
        if VIG {
            let k = c.vigmap[i] as i32 + 1;
            r = (r * k) >> 8;
            g = (g * k) >> 8;
            b = (b * k) >> 8;
        }
        if GRAIN {
            let nz = c.noise[(i + c.noff) & 0xffff] as i32;
            let li = (g.clamp(0, 255)) as usize;
            let add = (nz * c.gq[li]) >> 12;
            r += add;
            g += add;
            b += add;
        }
        px[0] = r.clamp(0, 255) as u8;
        px[1] = g.clamp(0, 255) as u8;
        px[2] = b.clamp(0, 255) as u8;
    }
}

fn sharpen(buf: &mut [u8], tmp: &mut [u8], w: usize, h: usize, amt: f32) {
    if w < 3 || h < 3 {
        return;
    }
    tmp[..w * h * 4].copy_from_slice(&buf[..w * h * 4]);
    let k = (amt * 96.0) as i32;
    let stride = w * 4;
    for y in 1..h - 1 {
        let row = y * stride;
        for x in 1..w - 1 {
            let j = row + x * 4;
            for c in 0..3 {
                let v = tmp[j + c] as i32;
                let d = 4 * v - tmp[j + c - 4] as i32 - tmp[j + c + 4] as i32 - tmp[j + c - stride] as i32 - tmp[j + c + stride] as i32;
                buf[j + c] = (v + ((k * d) >> 8)).clamp(0, 255) as u8;
            }
        }
    }
}

// ---------------------------------------------------------------- main entry

/// Runs the full look for one layer: background replacement, lighting, grade, vignette, grain.
/// `layer` 0 works on buffer A (with the person mask), 1 on buffer B.
#[no_mangle]
pub extern "C" fn process(layer: u32, time: f32, has_mask: u32) {
    let s = st();
    let (w, h) = (s.w, s.h);
    if w == 0 {
        return;
    }
    s.frame = s.frame.wrapping_add(1);
    let mut p = [0f32; P];
    let off = if layer == 0 { 0 } else { P };
    p.copy_from_slice(&s.params[off..off + P]);
    let has_mask = has_mask != 0 && layer == 0;

    if layer == 1 {
        // Swap B in so the code below can always work on `a`.
        std::mem::swap(&mut s.a, &mut s.b);
    }

    // 1. Background replacement behind the cut-out person.
    let bg_mode = p[BG_MODE] as i32;
    if bg_mode != 0 && has_mask {
        let n = w * h;
        match bg_mode {
            1 => {
                s.tmp.copy_from_slice(&s.a);
                blur(&mut s.tmp, w, h, p[BG_BLUR], &mut s.line, &mut s.small);
            }
            2 => {
                let c = [to_u8(p[BG_COLOR] * 255.0), to_u8(p[BG_COLOR + 1] * 255.0), to_u8(p[BG_COLOR + 2] * 255.0)];
                for i in 0..n {
                    s.tmp[i * 4..i * 4 + 3].copy_from_slice(&c);
                }
            }
            3 => {
                s.tmp.copy_from_slice(&s.bg);
                if p[BG_BLUR] > 0.5 {
                    blur(&mut s.tmp, w, h, p[BG_BLUR], &mut s.line, &mut s.small);
                }
            }
            4 => {
                for y in 0..h {
                    let t = y as f32 / h as f32;
                    let c = [
                        to_u8((p[BG_COLOR] + (p[BG_COLOR2] - p[BG_COLOR]) * t) * 255.0),
                        to_u8((p[BG_COLOR + 1] + (p[BG_COLOR2 + 1] - p[BG_COLOR + 1]) * t) * 255.0),
                        to_u8((p[BG_COLOR + 2] + (p[BG_COLOR2 + 2] - p[BG_COLOR + 2]) * t) * 255.0),
                    ];
                    for x in 0..w {
                        let i = (y * w + x) * 4;
                        s.tmp[i..i + 3].copy_from_slice(&c);
                    }
                }
            }
            5 => {
                for i in 0..n {
                    let j = i * 4;
                    let l = to_u8(0.2126 * s.a[j] as f32 + 0.7152 * s.a[j + 1] as f32 + 0.0722 * s.a[j + 2] as f32);
                    s.tmp[j] = l;
                    s.tmp[j + 1] = l;
                    s.tmp[j + 2] = l;
                }
            }
            _ => s.tmp.copy_from_slice(&s.a),
        }
        let dim = ((1.0 - p[BG_DIM].max(-1.0).min(1.0) * 0.8) * 256.0) as i32;
        for i in 0..n {
            let m = s.mask[i] as i32;
            let j = i * 4;
            for c in 0..3 {
                let bgv = ((s.tmp[j + c] as i32 * dim) >> 8).min(255);
                s.a[j + c] = (bgv + (((s.a[j + c] as i32 - bgv) * m) >> 8)).clamp(0, 255) as u8;
            }
        }
    } else if p[BG_DIM].abs() > 0.001 && has_mask {
        let dim = 1.0 - p[BG_DIM].max(-1.0).min(1.0) * 0.8;
        for i in 0..w * h {
            let k = 1.0 + (dim - 1.0) * (1.0 - s.mask[i] as f32 / 255.0);
            let j = i * 4;
            for c in 0..3 {
                s.a[j + c] = to_u8(s.a[j + c] as f32 * k);
            }
        }
    }

    // 2. Lighting overlay.
    if p[LIGHT_MODE] as i32 != 0 && p[LIGHT_AMOUNT] > 0.001 {
        // The light map is only rebuilt when its settings change, or ~15 times a second when it
        // moves: it's smooth, so this is invisible and saves most of the work.
        let mut key = [0.0f32; 16];
        key[0] = p[LIGHT_MODE];
        key[1] = p[LIGHT_POS];
        key[2] = p[LIGHT_SOFT];
        key[3] = p[LIGHT_SPEED];
        key[4..7].copy_from_slice(&p[LIGHT_COLOR..LIGHT_COLOR + 3]);
        key[7..10].copy_from_slice(&p[LIGHT_COLOR2..LIGHT_COLOR2 + 3]);
        key[10] = s.w as f32;
        let moving = p[LIGHT_SPEED] > 0.0;
        let stale = !s.lvalid || s.lkey != key || (moving && ((time - s.ltime).abs() >= 0.066 || time < s.ltime));
        if stale {
            build_light(s, &p, if moving { time } else { 0.0 });
            s.lkey = key;
            s.ltime = time;
            s.lvalid = true;
        }
        apply_light(s, &p, has_mask);
    }

    // 3. Detail, grade, vignette, grain.
    if p[SHARPEN] > 0.01 {
        sharpen(&mut s.a, &mut s.tmp, w, h, p[SHARPEN]);
    }
    let idle = p[..GAMMA].iter().enumerate().all(|(i, v)| v.abs() < 0.0005 || i == GAMMA)
        && (p[GAMMA] < 0.05 || (p[GAMMA] - 1.0).abs() < 0.0005)
        && (0..3).all(|c| p[GAIN + c] < 0.0005 || (p[GAIN + c] - 1.0).abs() < 0.0005);
    if !idle {
        grade(&mut s.a, w, h, &p, s.frame, &mut s.vigmap, &mut s.vigkey, &s.noise);
    }

    if layer == 1 {
        std::mem::swap(&mut s.a, &mut s.b);
    }
}

/// Copies buffer A into B (used when the incoming clip has no frame yet).
#[no_mangle]
pub extern "C" fn copy_a_to_b() {
    let s = st();
    s.b.copy_from_slice(&s.a);
}

/// Plain blur of A (for the "blur" clip effect and blur-fill canvas background).
#[no_mangle]
pub extern "C" fn blur_a(r: f32) {
    let s = st();
    blur(&mut s.a, s.w, s.h, r, &mut s.line, &mut s.small);
}

// ---------------------------------------------------------------- transitions

#[inline]
fn px(buf: &[u8], w: usize, h: usize, x: i32, y: i32) -> [u8; 4] {
    let x = x.max(0).min(w as i32 - 1) as usize;
    let y = y.max(0).min(h as i32 - 1) as usize;
    let i = (y * w + x) * 4;
    [buf[i], buf[i + 1], buf[i + 2], 255]
}

#[inline]
fn mix(a: &mut [u8], b: &[u8], t: f32) {
    for c in 0..3 {
        a[c] = to_u8(a[c] as f32 + (b[c] as f32 - a[c] as f32) * t);
    }
}

/// Blends B (incoming) over A (outgoing) with progress `t` 0..1. Result lands in A.
#[no_mangle]
pub extern "C" fn transition(kind: u32, t: f32) {
    let s = st();
    let (w, h) = (s.w, s.h);
    if w == 0 {
        return;
    }
    let t = clamp01(t);
    let ease = t * t * (3.0 - 2.0 * t);
    let n = w * h;
    let wf = w as f32;
    let hf = h as f32;
    match kind {
        // Cross dissolve.
        1 => {
            let e = (ease * 256.0) as i32;
            for i in 0..n {
                let j = i * 4;
                for c in 0..3 {
                    let av = s.a[j + c] as i32;
                    s.a[j + c] = (av + (((s.b[j + c] as i32 - av) * e) >> 8)) as u8;
                }
            }
        }
        // Dip to black / white.
        2 | 3 => {
            let target = if kind == 2 { 0.0 } else { 255.0 };
            for i in 0..n {
                let j = i * 4;
                for c in 0..3 {
                    let src = if t < 0.5 { s.a[j + c] } else { s.b[j + c] } as f32;
                    let k = if t < 0.5 { t * 2.0 } else { 2.0 - t * 2.0 };
                    s.a[j + c] = to_u8(src + (target - src) * k);
                }
            }
        }
        // Wipes: 4 left, 5 right, 6 up, 7 down, 16 diagonal.
        4 | 5 | 6 | 7 | 16 => {
            let edge = 0.03;
            for y in 0..h {
                for x in 0..w {
                    let u = x as f32 / wf;
                    let v = y as f32 / hf;
                    let d = match kind {
                        4 => 1.0 - u,
                        5 => u,
                        6 => 1.0 - v,
                        7 => v,
                        _ => (u + v) * 0.5,
                    };
                    let k = smoothstep(d - edge, d + edge, ease * (1.0 + 2.0 * edge) - edge);
                    if k > 0.0 {
                        let j = (y * w + x) * 4;
                        let bv = [s.b[j], s.b[j + 1], s.b[j + 2]];
                        mix(&mut s.a[j..j + 3], &bv, k);
                    }
                }
            }
        }
        // Slides / push: 8 left, 9 up, 17 whip pan (slide + motion blur).
        8 | 9 | 17 => {
            s.tmp.copy_from_slice(&s.a);
            let e = if kind == 17 { t * t * t * (t * (t * 6.0 - 15.0) + 10.0) } else { ease };
            for y in 0..h {
                for x in 0..w {
                    let j = (y * w + x) * 4;
                    let v = if kind == 9 {
                        let sy = y as f32 + e * hf;
                        if sy < hf { px(&s.tmp, w, h, x as i32, sy as i32) } else { px(&s.b, w, h, x as i32, (sy - hf) as i32) }
                    } else {
                        let sx = x as f32 + e * wf;
                        if sx < wf { px(&s.tmp, w, h, sx as i32, y as i32) } else { px(&s.b, w, h, (sx - wf) as i32, y as i32) }
                    };
                    s.a[j..j + 3].copy_from_slice(&v[..3]);
                }
            }
            if kind == 17 {
                let r = ((t * std::f32::consts::PI).sin() * wf * 0.06) as usize;
                box_blur(&mut s.a, w, h, r, &mut s.line, true);
            }
        }
        // Zoom through.
        10 => {
            s.tmp.copy_from_slice(&s.a);
            let sa = 1.0 + ease * 0.8;
            let sb = 1.6 - ease * 0.6;
            let (cx, cy) = (wf * 0.5, hf * 0.5);
            let axis = |n: usize, c: f32, z: f32| -> Vec<usize> { (0..n).map(|v| ((c + (v as f32 - c) / z).max(0.0) as usize).min(n - 1)).collect() };
            let (xa, ya, xb, yb) = (axis(w, cx, sa), axis(h, cy, sa), axis(w, cx, sb), axis(h, cy, sb));
            let e = (ease * 256.0) as i32;
            for y in 0..h {
                let (ra, rb) = (ya[y] * w, yb[y] * w);
                for x in 0..w {
                    let ia = (ra + xa[x]) * 4;
                    let ib = (rb + xb[x]) * 4;
                    let j = (y * w + x) * 4;
                    for c in 0..3 {
                        let av = s.tmp[ia + c] as i32;
                        s.a[j + c] = (av + (((s.b[ib + c] as i32 - av) * e) >> 8)) as u8;
                    }
                }
            }
        }
        // Circle reveal.
        11 => {
            let maxr = (wf * wf + hf * hf).sqrt() * 0.5;
            let r = ease * maxr;
            let edge = maxr * 0.02;
            for y in 0..h {
                for x in 0..w {
                    let dx = x as f32 - wf * 0.5;
                    let dy = y as f32 - hf * 0.5;
                    let d = (dx * dx + dy * dy).sqrt();
                    let k = 1.0 - smoothstep(r - edge, r + edge, d);
                    if k > 0.0 {
                        let j = (y * w + x) * 4;
                        let bv = [s.b[j], s.b[j + 1], s.b[j + 2]];
                        mix(&mut s.a[j..j + 3], &bv, k);
                    }
                }
            }
        }
        // Blur dissolve.
        12 => {
            let r = (t * std::f32::consts::PI).sin() * wf * 0.03;
            blur(&mut s.a, w, h, r, &mut s.line, &mut s.small);
            blur(&mut s.b, w, h, r, &mut s.line, &mut s.small);
            for i in 0..n {
                let j = i * 4;
                let bv = [s.b[j], s.b[j + 1], s.b[j + 2]];
                mix(&mut s.a[j..j + 3], &bv, ease);
            }
        }
        // Glitch: block shifts + RGB split.
        13 => {
            let src_is_b = t >= 0.5;
            if src_is_b {
                s.tmp.copy_from_slice(&s.b);
            } else {
                s.tmp.copy_from_slice(&s.a);
            }
            let amt = 1.0 - (t * 2.0 - 1.0).abs();
            let step = (t * 12.0) as u32;
            let split = (amt * wf * 0.02) as i32;
            for y in 0..h {
                let band = (y / (h / 24).max(1)) as u32;
                let hv = hash(band, step, 9);
                let shift = if hv & 3 == 0 { ((hv >> 8) % (w as u32 / 6 + 1)) as i32 - w as i32 / 12 } else { 0 };
                let shift = (shift as f32 * amt) as i32;
                for x in 0..w {
                    let xi = x as i32 + shift;
                    let r = px(&s.tmp, w, h, xi + split, y as i32)[0];
                    let g = px(&s.tmp, w, h, xi, y as i32)[1];
                    let b = px(&s.tmp, w, h, xi - split, y as i32)[2];
                    let j = (y * w + x) * 4;
                    s.a[j] = r;
                    s.a[j + 1] = g;
                    s.a[j + 2] = b;
                }
            }
        }
        // Flash.
        14 => {
            let f = (1.0 - (t * 2.0 - 1.0).abs()).powf(1.5);
            for i in 0..n {
                let j = i * 4;
                for c in 0..3 {
                    let src = if t < 0.5 { s.a[j + c] } else { s.b[j + c] } as f32;
                    s.a[j + c] = to_u8(src + (255.0 - src) * f);
                }
            }
        }
        // Luma dissolve.
        15 => {
            let th = t * 1.2 - 0.1;
            for i in 0..n {
                let j = i * 4;
                let l = (0.2126 * s.b[j] as f32 + 0.7152 * s.b[j + 1] as f32 + 0.0722 * s.b[j + 2] as f32) / 255.0;
                let k = smoothstep(l - 0.1, l + 0.1, th);
                let bv = [s.b[j], s.b[j + 1], s.b[j + 2]];
                mix(&mut s.a[j..j + 3], &bv, k);
            }
        }
        // Film burn.
        18 => {
            let f = (t * std::f32::consts::PI).sin();
            let (gw, gh) = (w / 8 + 2, h / 8 + 2);
            let mut grid = vec![0.0f32; gw * gh];
            for gy in 0..gh {
                for gx in 0..gw {
                    grid[gy * gw + gx] = fbm((gx as f32 * 8.0 / wf) * 3.0 + t * 2.0, (gy as f32 * 8.0 / hf) * 3.0);
                }
            }
            let e = (ease * 256.0) as i32;
            for y in 0..h {
                let fy = y as f32 / 8.0;
                let (gy, ty) = (fy as usize, fy - (fy as usize) as f32);
                for x in 0..w {
                    let j = (y * w + x) * 4;
                    let fx = x as f32 / 8.0;
                    let (gx, tx) = (fx as usize, fx - (fx as usize) as f32);
                    let n00 = grid[gy * gw + gx];
                    let n10 = grid[gy * gw + gx + 1];
                    let n01 = grid[(gy + 1) * gw + gx];
                    let n11 = grid[(gy + 1) * gw + gx + 1];
                    let nz = n00 + (n10 - n00) * tx + (n01 - n00) * ty + (n00 - n10 - n01 + n11) * tx * ty;
                    let u = x as f32 / wf;
                    let g = clamp01((nz + u * 0.6 - 0.5) * 2.0 * f + f * 0.3);
                    let tone = [255.0, 140.0, 40.0];
                    for c in 0..3 {
                        let av = s.a[j + c] as i32;
                        let v0 = (av + (((s.b[j + c] as i32 - av) * e) >> 8)) as f32;
                        s.a[j + c] = to_u8(v0 + (tone[c] - v0 * 0.3) * g);
                    }
                }
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------- audio

fn window_db(a: &[f32], win: usize) -> Vec<f32> {
    a.chunks(win.max(1))
        .map(|c| {
            let e: f32 = c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32;
            10.0 * (e + 1e-10).log10()
        })
        .collect()
}

/// Finds the parts worth keeping in `n` mono samples at `sr` Hz.
/// `thresh_db` >= 0 picks the threshold from the noise floor automatically.
/// Writes the threshold used to out[0], then (start, end) second pairs; returns the pair count.
#[no_mangle]
pub extern "C" fn silence(n: u32, sr: f32, thresh_db: f32, min_sil: f32, pad: f32, min_keep: f32) -> u32 {
    let s = st();
    let n = (n as usize).min(s.audio.len());
    let win = (sr * 0.02) as usize;
    if n == 0 || win == 0 {
        return 0;
    }
    let dbs = window_db(&s.audio[..n], win);
    let total = n as f32 / sr;
    let wsec = win as f32 / sr;
    let thresh = if thresh_db >= 0.0 {
        let mut sorted = dbs.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let floor = sorted[sorted.len() * 15 / 100];
        let peak = sorted[(sorted.len() * 95 / 100).min(sorted.len() - 1)];
        (floor + (peak - floor) * 0.3).max(-60.0).min(-18.0)
    } else {
        thresh_db
    };
    // Silent stretches long enough to cut.
    let mut cuts: Vec<(f32, f32)> = Vec::new();
    let mut i = 0;
    while i < dbs.len() {
        if dbs[i] < thresh {
            let start = i;
            while i < dbs.len() && dbs[i] < thresh {
                i += 1;
            }
            let (a, b) = (start as f32 * wsec, (i as f32 * wsec).min(total));
            if b - a >= min_sil {
                cuts.push((a, b));
            }
        } else {
            i += 1;
        }
    }
    // Complement, padded, merged, short bits dropped.
    let mut keeps: Vec<(f32, f32)> = Vec::new();
    let mut cursor = 0.0;
    for &(a, b) in &cuts {
        if a > cursor {
            keeps.push((cursor, a));
        }
        cursor = b;
    }
    if cursor < total {
        keeps.push((cursor, total));
    }
    let mut merged: Vec<(f32, f32)> = Vec::new();
    for (a, b) in keeps {
        let (a, b) = ((a - pad).max(0.0), (b + pad).min(total));
        if let Some(last) = merged.last_mut() {
            if a <= last.1 {
                last.1 = last.1.max(b);
                continue;
            }
        }
        merged.push((a, b));
    }
    merged.retain(|&(a, b)| b - a >= min_keep);
    let max_pairs = (s.out.len() - 1) / 2;
    s.out[0] = thresh;
    let mut count = 0;
    for (k, &(a, b)) in merged.iter().take(max_pairs).enumerate() {
        s.out[1 + k * 2] = a;
        s.out[2 + k * 2] = b;
        count += 1;
    }
    count as u32
}

/// Max-abs peaks per bucket for waveform drawing. Writes `buckets` values to out.
#[no_mangle]
pub extern "C" fn peaks(n: u32, buckets: u32) {
    let s = st();
    let n = (n as usize).min(s.audio.len());
    let b = (buckets as usize).min(s.out.len());
    if n == 0 || b == 0 {
        return;
    }
    for k in 0..b {
        let a = k * n / b;
        let e = ((k + 1) * n / b).max(a + 1).min(n);
        s.out[k] = s.audio[a..e].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    }
}

/// Loudness (RMS dBFS) of `n` samples, for auto-levelling clips.
#[no_mangle]
pub extern "C" fn rms_db(n: u32) -> f32 {
    let s = st();
    let n = (n as usize).min(s.audio.len());
    if n == 0 {
        return -100.0;
    }
    let e: f64 = s.audio[..n].iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>() / n as f64;
    (10.0 * (e + 1e-12).log10()) as f32
}
