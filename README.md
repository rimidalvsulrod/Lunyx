# Lunyx

A video editor that runs entirely in the browser and installs on iPhone from Safari (Share → Add to Home Screen). Projects and media stay on the device (IndexedDB) and the app works offline after the first visit.

## Features

- Timeline: split, trim, reorder, duplicate, speed (0.25×–4×), zoom/move/rotate, Ken Burns, photo clips, undo/redo, 6 aspect ratios
- 22 cinematic filters, 12 adjustments, 18 transitions
- AI person cutout with background blur / colour / gradient / image / colour pop
- Lighting overlays: window sunlight, tree shade, blinds, god rays, golden hour, neon, light leaks, spotlight, caustics
- Audio: 5-band EQ + presets, voice enhance, fades, loudness normalise, music with auto-ducking
- Auto cut silence, auto captions (Whisper, on device), filler-word removal
- Creator tools: camera recorder with teleprompter, voiceover, punch-in zooms, hook / CTA templates, safe zones, progress bar
- 48 Google Fonts, real-time MP4 export with share-to-Photos

## Stack

- Next.js app (`src/app`), page rendered per request; the editor runs client side
- Rust effects engine in `editor-fx/`, compiled to WebAssembly with SIMD → `public/cut/fx.wasm` (committed, so Vercel needs no Rust toolchain)
- MediaPipe (segmentation) and transformers.js (Whisper) load from jsDelivr on first use

## Develop

```sh
npm install
npm run dev
```

Rebuild the WASM engine after editing `editor-fx/src/lib.rs` (needs `rustup target add wasm32-unknown-unknown`):

```sh
npm run build:fx
```

## Deploy

Import the repo in Vercel (framework preset: Next.js, no settings needed).
