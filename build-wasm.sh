#!/usr/bin/env bash
set -euo pipefail
# Build Rust to WebAssembly and generate bindings
wasm-pack build --target web --out-dir pkg --release
echo "Wasm built to pkg/"
