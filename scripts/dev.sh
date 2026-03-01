#!/bin/bash
# Start Vite dev server first, wait for it to be ready, then start Tauri

bash scripts/build-extensions.sh >/dev/null 2>&1 || true
bash scripts/copy-webview-shims.sh >/dev/null 2>&1 || true

STARTED_VITE=0
if nc -z localhost 1420 2>/dev/null; then
    echo "Port 1420 already in use; not starting Vite"
else
    echo "Starting Vite dev server in background..."
    npm run dev &
    VITE_PID=$!
    STARTED_VITE=1
fi

echo "Waiting for Vite server on port 1420..."
until curl -s http://localhost:1420 > /dev/null 2>&1; do
    sleep 2
    echo -n "."
done
echo ""
echo "Vite ready! Starting Tauri (Rust compilation may take a moment)..."

export TAURI_TEST_PORT=${TAURI_TEST_PORT:-9999}
export RUST_LOG=${RUST_LOG:-info}
cd src-tauri && cargo run

if [ "${STARTED_VITE}" = "1" ] && [ -n "${VITE_PID:-}" ]; then
    kill $VITE_PID 2>/dev/null || true
fi
