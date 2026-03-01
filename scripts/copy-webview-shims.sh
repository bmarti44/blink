#!/usr/bin/env bash
# Copy VSCode webview shim files from monaco-vscode-api into public/
# These must be served at /vs/workbench/contrib/webview/browser/pre/
# so that extension detail panels render correctly instead of loading the full app.
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT_DIR/node_modules/@codingame/monaco-vscode-view-common-service-override/service-override/vs/workbench/contrib/webview/browser/pre"
DEST="$ROOT_DIR/public/vs/workbench/contrib/webview/browser/pre"
mkdir -p "$DEST"
cp "$SRC/index.html" "$DEST/index.html"
cp "$SRC/fake.html"  "$DEST/fake.html"
cp "$SRC/service-worker.js" "$DEST/service-worker.js"
echo "Webview shims copied."
