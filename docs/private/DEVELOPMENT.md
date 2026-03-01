# Blink - Development Guide

## Prerequisites

Before developing Blink, ensure you have:

| Requirement | Version       | Check Command           |
| ----------- | ------------- | ----------------------- |
| Node.js     | >= 18.0.0     | `node --version`        |
| npm         | >= 8.0        | `npm --version`         |
| Rust        | Latest stable | `rustc --version`       |
| Tauri CLI   | v2.x          | `cargo tauri --version` |
| macOS       | 11.0+         | `sw_vers`               |

> **Note**: Node 16 is EOL. Use Node 18+ for security updates.

### Installing Prerequisites

```bash
# Install Rust (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Tauri CLI
cargo install tauri-cli

# Verify Node.js version
node --version  # Should be >= 18.0.0
```

## Initial Setup

```bash
# Clone the repository
git clone <repo-url>
cd blink

# Install dependencies
npm install

# Apply patches (runs automatically via postinstall)
npm run patch:package
```

## Development Workflow

### Starting Development Mode

```bash
# Start the full development environment
npm run tauri:dev
```

This command:

1. Starts the webpack dev server on port 8000
2. Waits for webpack to compile
3. Launches the Tauri application
4. Starts the test server on port 9999
5. Injects the test bridge into the webview

**Expected startup time**: 30-60 seconds for first launch, faster on subsequent launches.

### Verifying the App is Running

```bash
# Check if test server is responding
curl http://localhost:9999/health

# Expected response:
# {"status":"ok","bridge_connected":true,"uptime_seconds":42,"window_count":1}
```

### Development Loop

#### For New Features:

```
1. Write E2E test for the feature (will fail - feature doesn't exist)
        ↓
2. Implement the feature
        ↓
3. Webpack hot-reloads (frontend) or restart app (Rust)
        ↓
4. Run tests - should pass now
        ↓
5. Commit when tests pass
```

#### For Bug Fixes (TEST FIRST!):

```
1. Write E2E test that reproduces the bug (MUST FAIL)
        ↓
2. Verify test fails for the right reason
        ↓
3. Fix the bug in code
        ↓
4. Run tests - should pass now
        ↓
5. Commit when tests pass
```

**Why test first for bugs?**

- Proves the bug exists before you "fix" it
- Prevents regression - bug can never come back
- Ensures you understand the bug correctly
- If you can't write a failing test, you don't understand the bug

## Running Tests

### MANDATORY: The Testing Loop

**Every feature implementation MUST follow this loop:**

```bash
# 1. Start the app in dev mode (in terminal 1)
npm run tauri:dev

# 2. Wait for app to fully load (check health)
curl http://localhost:9999/health

# 3. Run the full test suite (in terminal 2)
./testing/tauri/run-tests.sh

# 4. All tests must pass before feature is complete
```

### Running All Tests

```bash
./testing/tauri/run-tests.sh
```

### Running Specific Test Files

```bash
# Run a single test file
./testing/tauri/tests/functional/01-health.sh

# Run UI E2E tests only
./testing/tauri/tests/ui-e2e/02-uninstall-ui-update.sh
```

### Running Tests with Debug Output

```bash
DEBUG=1 ./testing/tauri/run-tests.sh
```

### Test File Categories

| Directory           | Purpose                      | Run When |
| ------------------- | ---------------------------- | -------- |
| `tests/functional/` | Core API and workbench tests | Always   |
| `tests/ui-e2e/`     | User-centric workflow tests  | Always   |

### Test Output Interpretation

```
Running test suite: 01-health.sh
  ✓ Server responds to health check
  ✓ Bridge is connected
  ✓ Workbench is loaded

Tests passed: 3/3
```

If tests fail:

```
  ✗ Extension install button should be enabled
    Expected: true
    Got: false

Tests passed: 2/3
FAILED
```

## Building for Production

### Development Build

```bash
# Build frontend only
npm run build

# Build Tauri app (debug)
npm run tauri build -- --debug
```

### Production Build

```bash
# Full release build
npm run tauri:build
```

**Output location**: `src-tauri/target/release/bundle/`

### Build Artifacts

| Platform  | Location                        |
| --------- | ------------------------------- |
| macOS     | `bundle/macos/Blink.app` |
| macOS DMG | `bundle/dmg/Blink.dmg`   |
| Windows   | `bundle/msi/` (not tested)      |
| Linux     | `bundle/appimage/` (not tested) |

## Common Development Tasks

### Adding a New Feature

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Implement the feature
# ... write code ...

# 3. Add data-testid attributes to new UI elements
# <button data-testid="my-feature-button">...</button>

# 4. Write E2E test
# Create: testing/tauri/tests/ui-e2e/XX-my-feature.sh

# 5. Run tests
./testing/tauri/run-tests.sh

# 6. Update FEATURES.md status
# Change TODO -> DONE

# 7. Commit
git add .
git commit -m "feat: add my feature"
```

### Debugging a Failing Test

```bash
# 1. Run the specific failing test with debug
DEBUG=1 ./testing/tauri/tests/ui-e2e/02-uninstall-ui-update.sh

# 2. Check console logs
curl http://localhost:9999/console | jq

# 3. Check JavaScript errors
curl http://localhost:9999/errors | jq

# 4. Inspect DOM state
curl -X POST http://localhost:9999/query \
  -H "Content-Type: application/json" \
  -d '{"selector": ".my-element"}' | jq

# 5. Execute arbitrary JS for debugging
curl -X POST http://localhost:9999/js \
  -H "Content-Type: application/json" \
  -d '{"code": "document.querySelector(\".my-element\").textContent"}'
```

### Restarting the App

```bash
# Kill existing processes
pkill -f "blink"

# Restart
npm run tauri:dev
```

### Clearing Application State

```bash
# Clear extension storage
rm -rf ~/.blink/extensions/
rm -f ~/.blink/extensions.json

# Clear settings
rm -f ~/.blink/settings.json

# Clear workspace memory
# (stored in localStorage, cleared by app or browser dev tools)
```

## Environment Variables

| Variable          | Default | Purpose                        |
| ----------------- | ------- | ------------------------------ |
| `TAURI_TEST_PORT` | 9999    | Test server port               |
| `UI_TIMEOUT`      | 5       | Default wait timeout (seconds) |
| `DEBUG`           | (unset) | Enable verbose test output     |

## Troubleshooting

### App won't start

```bash
# Check if ports are in use
lsof -i:8000  # Webpack
lsof -i:9999  # Test server

# Kill stuck processes
pkill -f webpack
pkill -f blink
```

### Tests timeout waiting for workbench

```bash
# Increase timeout
UI_TIMEOUT=60 ./testing/tauri/run-tests.sh

# Check if webpack finished compiling
curl http://localhost:8000  # Should return HTML
```

### Extension operations hang

```bash
# Check extension host status
curl http://localhost:9999/extensions/host/status

# Restart extension host
curl -X POST http://localhost:9999/extensions/host/restart
```

### Hot reload not working

1. Check webpack terminal for errors
2. Try full restart: `pkill -f blink && npm run tauri:dev`
3. Clear browser cache in webview (if possible)

## Code Quality

### Linting

```bash
# Run ESLint
npm run lint

# Auto-fix issues
npm run lint:fix
```

### Formatting

```bash
# Check formatting
npm run format:check

# Fix formatting
npm run format
```

### Type Checking

```bash
# TypeScript compilation check (part of build)
npm run build
```

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────┐
│                 DEVELOPMENT QUICK REF                   │
├─────────────────────────────────────────────────────────┤
│ Start dev:     npm run tauri:dev                        │
│ Run tests:     ./testing/tauri/run-tests.sh             │
│ Build:         npm run tauri:build                      │
│ Lint:          npm run lint                             │
│ Format:        npm run format                           │
├─────────────────────────────────────────────────────────┤
│ Verify feature: ./scripts/verify-feature.sh [name]     │
│ Verify all:     ./scripts/verify-feature.sh all        │
├─────────────────────────────────────────────────────────┤
│ Health check:  curl http://localhost:9999/health        │
│ Console logs:  curl http://localhost:9999/console       │
│ JS errors:     curl http://localhost:9999/errors        │
├─────────────────────────────────────────────────────────┤
│ Kill app:      pkill -f blink                    │
│ Clear state:   rm -rf ~/.blink/                  │
└─────────────────────────────────────────────────────────┘
```

## Autonomous Verification

After implementing any feature, run the verification script:

```bash
# Verify a specific feature
./scripts/verify-feature.sh tab-autocomplete

# Verify all features
./scripts/verify-feature.sh all
```

The script will:

1. Build the project
2. Check if the app is running
3. Verify health endpoint
4. Run feature-specific tests
5. Check for console errors
6. Report pass/fail status
