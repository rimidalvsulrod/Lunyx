#!/bin/sh
# Builds the effects engine and copies it to where the editor loads it from.
set -e
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/editor_fx.wasm ../public/cut/fx.wasm
ls -l ../public/cut/fx.wasm
