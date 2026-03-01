#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
EXT_DIR="$ROOT_DIR/extensions/builtin"
if [ ! -d "$EXT_DIR" ]; then
  echo "No builtin extensions dir: $EXT_DIR" >&2
  exit 0
fi
for ext in "$EXT_DIR"/*; do
  [ -d "$ext" ] || continue
  echo "Building extension: $(basename "$ext")"
  (cd "$ext" && npm i --no-audit --no-fund >/dev/null 2>&1 || true && npx esbuild --bundle src/extension.ts --format=esm --platform=browser --outfile=dist/extension.js --external:vscode)
  mkdir -p "$ROOT_DIR/src-tauri/resources/extensions/builtin/$(basename "$ext")"
  rsync -a --delete --include='package.json' --include='dist/***' --exclude='*' "$ext/" "$ROOT_DIR/src-tauri/resources/extensions/builtin/$(basename "$ext")/"
  mkdir -p "$ROOT_DIR/extensions-web/builtin/$(basename "$ext")"
  rsync -a --delete "$ext/dist/extension.js" "$ROOT_DIR/extensions-web/builtin/$(basename "$ext")/extension.js"
done
echo "Extensions built and copied."