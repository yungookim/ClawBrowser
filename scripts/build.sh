#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building ClawBrowser"

# Step 1: Build sidecar (TypeScript -> JS via tsc)
echo "==> Step 1/3: Building sidecar..."
cd "$ROOT_DIR/sidecar"
npm ci --prefer-offline
npx tsc
echo "    Sidecar built: sidecar/dist/"

# Step 2: Build frontend (Vite)
echo "==> Step 2/3: Building frontend..."
cd "$ROOT_DIR"
npm run build:frontend
echo "    Frontend built: dist/"

# Step 3: Build Tauri app (Rust + bundle)
echo "==> Step 3/3: Building Tauri app..."
cd "$ROOT_DIR"
npm run tauri build
echo "    Tauri build complete"

echo ""
echo "==> Build complete! Check src-tauri/target/release/bundle/ for installers."
