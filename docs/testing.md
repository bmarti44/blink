# Blink Testing Architecture

## Overview

Blink includes a debug test server that enables automated E2E testing of the Tauri application. The test server runs on `http://localhost:9999` (configurable via `TAURI_TEST_PORT`) and provides HTTP endpoints to interact with the webview.

**Multi-Window Support:** The test server supports multiple windows. All endpoints accept a `?window=<label>` query parameter to target specific windows. If not specified, defaults to "main".

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Test Runner (curl/scripts)              │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Debug Test Server (Axum - port 9999)           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ /windows │ │  /js     │ │ /query   │ │ /health  │       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────────┘       │
│       │            │            │                           │
│       └────────────┴────────────┘                           │
│                     │                                       │
│              Window Router (by label)                       │
│                     │                                       │
│              Tauri Commands + window.eval()                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   Window:   │ │   Window:   │ │   Window:   │
│    main     │ │  context-1  │ │  context-2  │
│             │ │             │ │             │
│ __TEST_     │ │ __TEST_     │ │ __TEST_     │
│ BRIDGE__    │ │ BRIDGE__    │ │ BRIDGE__    │
└─────────────┘ └─────────────┘ └─────────────┘
```

## Quick Start

### 1. Start the Application

```bash
npm run tauri:dev
```

This script:

1. Starts webpack dev server
2. Waits for it to be ready
3. Starts Tauri application
4. Starts test server on port 9999
5. Injects test bridge into main webview

### 2. Verify Server is Running

```bash
curl http://localhost:9999/health
# {"status":"ok","bridge_connected":true,"uptime_seconds":42,"window_count":1,"windows":["main"]}
```

### 3. Run Tests

```bash
# Run all tests
./testing/tauri/run-tests.sh

# Or use individual commands
source testing/tauri/lib/test-client.sh
test_js "document.title"
test_query ".monaco-workbench"
```

## Multi-Window Testing

### Opening a Context Window

```bash
# Open a window to a specific folder
curl -X POST http://localhost:9999/windows/open \
  -H "Content-Type: application/json" \
  -d '{"folder": "/path/to/folder", "label": "test-context"}'

# Or use the folder picker dialog
curl -X POST http://localhost:9999/windows/pick

# Then open with the selected folder
curl -X POST http://localhost:9999/windows/open \
  -H "Content-Type: application/json" \
  -d '{"folder": "/Users/me/selected-folder"}'
```

### Using the Test Client

```bash
source testing/tauri/lib/test-client.sh

# List all windows
list_windows

# Open a context window
open_context_window "/path/to/folder" "my-context"

# Wait for the bridge to be injected
wait_for_window_bridge "my-context"

# Run commands on specific windows
test_js "document.title" "main"
test_js "document.title" "my-context"

# Compare windows
compare_windows "main" "my-context" "test_query" ".monaco-workbench"

# Close the context window
close_window "my-context"
```

## API Reference

### Window Management Endpoints

| Endpoint                 | Method | Description               |
| ------------------------ | ------ | ------------------------- |
| `/windows`               | GET    | List all open windows     |
| `/windows/open`          | POST   | Open a new context window |
| `/windows/pick`          | POST   | Open folder picker dialog |
| `/windows/:label`        | DELETE | Close a window            |
| `/windows/:label/focus`  | POST   | Focus a window            |
| `/windows/:label/inject` | POST   | Inject bridge into window |

### JavaScript & DOM Endpoints

All endpoints support `?window=<label>` (defaults to "main")

| Endpoint  | Method | Description                          |
| --------- | ------ | ------------------------------------ |
| `/js`     | POST   | Execute JavaScript and return result |
| `/query`  | POST   | Query DOM elements by CSS selector   |
| `/dom`    | GET    | Get full DOM snapshot                |
| `/styles` | POST   | Get computed styles for element      |
| `/invoke` | POST   | Invoke Tauri commands                |

### Log Endpoints

All endpoints support `?window=<label>` (defaults to "main")

| Endpoint   | Method | Description                    |
| ---------- | ------ | ------------------------------ |
| `/console` | GET    | Get captured console logs      |
| `/console` | DELETE | Clear console logs             |
| `/errors`  | GET    | Get captured JavaScript errors |
| `/errors`  | DELETE | Clear errors                   |
| `/network` | GET    | Get captured network requests  |
| `/network` | DELETE | Clear network logs             |
| `/events`  | GET    | Get custom events              |
| `/events`  | DELETE | Clear events                   |

### Extension Management Endpoints

| Endpoint                   | Method | Description                     |
| -------------------------- | ------ | ------------------------------- |
| `/extensions`              | GET    | List all installed extensions   |
| `/extensions/search`       | POST   | Search Open VSX marketplace     |
| `/extensions/install`      | POST   | Install extension from Open VSX |
| `/extensions/:id`          | DELETE | Uninstall extension             |
| `/extensions/host/status`  | GET    | Get extension host status       |
| `/extensions/host/restart` | POST   | Restart extension host          |

### Utility Endpoints

| Endpoint  | Method | Description                          |
| --------- | ------ | ------------------------------------ |
| `/health` | GET    | Health check - returns server status |

## Example Requests

### List Windows

```bash
curl http://localhost:9999/windows
# {"windows":[{"label":"main","title":"Blink","folder":null,"is_visible":true,"is_focused":true,"bridge_injected":true}],"count":1,"active":"main"}
```

### Open Context Window

```bash
curl -X POST http://localhost:9999/windows/open \
  -H "Content-Type: application/json" \
  -d '{"folder": "/Users/me/projects/my-app", "label": "context-1", "title": "My App Context"}'
# {"success":true,"label":"context-1","folder":"/Users/me/projects/my-app","error":null}
```

### Execute JavaScript (on specific window)

```bash
curl -X POST "http://localhost:9999/js?window=context-1" \
  -H "Content-Type: application/json" \
  -d '{"code": "document.title"}'
# {"success":true,"result":"My App Context","error":null}
```

### Query DOM

```bash
curl -X POST http://localhost:9999/query \
  -H "Content-Type: application/json" \
  -d '{"selector": ".monaco-workbench"}'
# {"found":true,"count":1,"elements":[{"tag":"div","classes":["monaco-workbench","vs-dark"],...}]}
```

### Get Console Logs

```bash
curl http://localhost:9999/console
# {"entries":[{"level":"log","message":"[Workbench] Initializing...","timestamp":1234567890}],"total":42}
```

### List Installed Extensions

```bash
curl http://localhost:9999/extensions
# {"extensions":[{"id":"jdinhlife.gruvbox","name":"gruvbox","publisher":"jdinhlife","version":"1.29.0",...}],"count":1}
```

### Search Open VSX Marketplace

```bash
curl -X POST http://localhost:9999/extensions/search \
  -H "Content-Type: application/json" \
  -d '{"query": "python", "limit": 10}'
# {"extensions":[{"namespace":"ms-python","name":"python","version":"2024.0.1",...}],"count":10}
```

### Install Extension from Open VSX

```bash
curl -X POST http://localhost:9999/extensions/install \
  -H "Content-Type: application/json" \
  -d '{"extension_id": "jdinhlife.gruvbox"}'
# {"success":true,"extension_id":"jdinhlife.gruvbox","version":"1.29.0","path":"...","error":null}
```

### Uninstall Extension

```bash
curl -X DELETE http://localhost:9999/extensions/jdinhlife.gruvbox
# {"success":true,"extension_id":"jdinhlife.gruvbox"}
```

### Extension Host Status

```bash
curl http://localhost:9999/extensions/host/status
# {"running":true,"ready":true,"activated_extensions":[]}
```

### Restart Extension Host

```bash
curl -X POST http://localhost:9999/extensions/host/restart
# {"success":true,"message":"Extension host restarted"}
```

## Test Utilities

### Shell Script Library

Located at `testing/tauri/lib/test-client.sh`:

```bash
source testing/tauri/lib/test-client.sh

# Window Management
list_windows                    # List all windows
get_window_labels               # Get just the labels
open_context_window "/path"     # Open window to folder
pick_folder                     # Open folder picker dialog
close_window "label"            # Close a window
focus_window "label"            # Focus a window
inject_bridge "label"           # Inject bridge
wait_for_window_bridge "label"  # Wait for bridge ready

# Core Functions (with optional window param)
test_js "code" [window]         # Execute JavaScript
test_query "selector" [window]  # Query DOM
test_console [limit] [window]   # Get console logs
test_errors [window]            # Get errors
test_health                     # Health check

# Assertions
assert_equals "$a" "$b" "desc"
assert_json_true "$json" ".field" "desc"
assert_contains "$val" "substr" "desc"

# Helpers
wait_for_server [timeout]
wait_for_bridge [timeout]
wait_for_workbench [timeout] [window]

# UI Interaction Functions (simulate user clicks/typing)
click_element "selector" [window]    # Click any element
click_testid "test-id" [window]      # Click by data-testid
type_text "selector" "text" [window] # Type into input field
type_testid "test-id" "text" [window] # Type by data-testid
wait_for_element "selector" [timeout] [window]  # Wait for element
wait_for_testid "test-id" [timeout] [window]    # Wait by data-testid
wait_for_element_gone "selector" [timeout] [window]  # Wait until gone
element_exists "selector" [window]   # Check if element exists
get_element_count "selector" [window] # Count matching elements
get_element_text "selector" [window]  # Get text content
get_element_attr "selector" "attr" [window] # Get attribute

# Extension UI Interaction Functions
ui_open_extensions_panel [window]    # Click extensions in activity bar
ui_open_browse_tab [window]          # Click Browse tab
ui_open_installed_tab [window]       # Click Installed tab
ui_search_extension "query" [window] # Type in search box
ui_click_install "pub.name" [window] # Click Install button
ui_click_uninstall "pub.name" [window] # Click Uninstall (confirms automatically)
ui_expand_extension_card "pub.name" [window] # Click card to expand
ui_wait_for_installed_badge "pub.name" [timeout] [window]  # Wait for badge
ui_wait_for_extension_card "pub.name" [timeout] [window]   # Wait for card
ui_wait_for_extension_card_gone "pub.name" [timeout] [window] # Wait until gone
ui_get_installed_count [window]      # Get installed count badge
ui_get_installed_extension_ids [window] # Get list of extension IDs

# Extension Management (API-based, for cleanup)
list_installed_extensions         # List all installed extensions
get_extension_ids                 # Get extension IDs only
search_marketplace "query" [limit] # Search Open VSX
install_extension "pub.name"      # Install from Open VSX
uninstall_extension "pub.name"    # Uninstall extension
extension_host_status             # Get host status
restart_extension_host            # Restart extension host
is_extension_installed "pub.name" # Check if installed
wait_for_extension "pub.name"     # Wait for installation
get_extension_info "pub.name"     # Get extension details

# Multi-window helpers
for_each_window "fn" "args..."
compare_windows "w1" "w2" "fn" "args..."
```

## JavaScript Bridge API

The test server injects `window.__TEST_BRIDGE__` into each webview with these methods:

```javascript
// Data access
__TEST_BRIDGE__.getConsoleLogs(); // Returns array of console entries
__TEST_BRIDGE__.getErrors(); // Returns array of error entries
__TEST_BRIDGE__.getNetworkRequests(); // Returns array of network entries
__TEST_BRIDGE__.getEvents(); // Returns array of custom events

// Clear data
__TEST_BRIDGE__.clearConsoleLogs();
__TEST_BRIDGE__.clearErrors();
__TEST_BRIDGE__.clearNetworkRequests();
__TEST_BRIDGE__.clearEvents();
__TEST_BRIDGE__.clearAll();

// DOM helpers
__TEST_BRIDGE__.query(selector); // Query elements, returns array of element info
__TEST_BRIDGE__.getStyles(selector, ['color', 'background']); // Get computed styles
__TEST_BRIDGE__.getDom(); // Get {html, title, url}

// Execute with callback (for async results)
__TEST_BRIDGE__.executeWithCallback(requestId, code);

// Custom events
__TEST_BRIDGE__.emit('myEvent', { data: 'value' });
```

## Testing Philosophy

### Simulating Real User Interactions

E2E tests should simulate actual user interactions as closely as possible:

1. **Click, Don't Call** - Use UI clicks and keyboard input instead of API calls
2. **Wait for UI Updates** - Asynchronous UI updates require waiting for elements to appear
3. **Use data-testid** - Reliable element selection via `data-testid` attributes
4. **Configurable Timeouts** - Set `UI_TIMEOUT` env var to adjust wait times (default: 5s)

```bash
# Example: Install extension by clicking through UI
ui_open_extensions_panel        # Click extensions icon
ui_open_browse_tab              # Click Browse tab
ui_search_extension "gruvbox"   # Type in search box
ui_click_install "jdinhlife.gruvbox"  # Click Install button
ui_wait_for_installed_badge "jdinhlife.gruvbox" 30  # Verify UI updates
```

### Why This Matters

- **Tests catch real bugs** - If the UI doesn't update, the test fails
- **Confidence in releases** - Tests verify what users actually experience
- **Regression detection** - Broken click handlers or missing updates are caught

### Wait Utilities

All wait functions support configurable timeouts:

```bash
# Default timeout (5s from UI_TIMEOUT)
wait_for_element "[data-testid='my-element']"

# Custom timeout (10 seconds)
wait_for_element "[data-testid='my-element']" 10

# Global configuration
export UI_TIMEOUT=10
./run-tests.sh
```

## Writing Tests

### Basic Test Pattern

```bash
#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

test_my_feature() {
    local result=$(test_js "document.title")
    assert_json_true "$result" ".success" "Should execute JS"
}

run_tests
```

### Multi-Window Test

```bash
#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

test_context_window() {
    # Open a context window
    local result=$(open_context_window "/tmp/test-folder" "test-ctx")
    assert_json_true "$result" ".success" "Should open window"

    # Wait for it to be ready
    wait_for_window_bridge "test-ctx" 30
    wait_for_workbench 60 "test-ctx"

    # Test both windows
    local main_title=$(test_js "document.title" "main" | jq -r '.result')
    local ctx_title=$(test_js "document.title" "test-ctx" | jq -r '.result')

    assert_not_empty "$main_title" "Main should have title"
    assert_not_empty "$ctx_title" "Context should have title"

    # Cleanup
    close_window "test-ctx"
}

run_tests
```

## Configuration

### Environment Variables

| Variable          | Default               | Description                  |
| ----------------- | --------------------- | ---------------------------- |
| `TAURI_TEST_PORT` | 9999                  | Port for test server         |
| `TEST_SERVER`     | http://localhost:9999 | Test server URL (in scripts) |
| `DEFAULT_WINDOW`  | main                  | Default window for commands  |

### Debug vs Release

The test server only compiles in debug builds (`#[cfg(debug_assertions)]`). In release builds, none of the test server code is included.

## File Structure

```
src-tauri/src/test_server/
├── mod.rs          # Main module, server setup, routes
├── handlers.rs     # HTTP endpoint handlers
├── types.rs        # Request/response types
├── bridge.rs       # JavaScript bridge code
└── commands.rs     # Tauri commands for callbacks

testing/tauri/
├── README.md           # Quick start guide
├── lib/
│   └── test-client.sh  # Core test client library
├── tests/
│   ├── 01-health.sh    # Server health tests
│   ├── 02-workbench.sh # Workbench loading tests
│   ├── 03-extensions.sh# Extension management tests
│   ├── 04-editor.sh    # Editor functionality tests
│   └── 05-extensions.sh# Extension E2E tests (Open VSX)
├── run-tests.sh        # Run all tests
└── utils.sh            # Utility functions

scripts/
├── dev.sh          # Development startup script
└── test-utils.sh   # Legacy test helper utilities
```

## Troubleshooting

### Server not responding

- Check if Tauri app is running: `lsof -i:9999`
- Check if webpack is ready: look for "compiled successfully" in terminal
- Try restarting: `pkill -f blink && npm run tauri:dev`

### Context window not opening

- Check if the folder path is valid
- Check console for errors: `curl http://localhost:9999/console`
- Try injecting bridge manually: `curl -X POST http://localhost:9999/windows/my-label/inject`

### JavaScript execution timing out

- The bridge may not be injected yet - use `wait_for_window_bridge`
- Check console for bridge injection message: "Bridge script injected successfully"

### Webview showing white screen

- This happens if Tauri opens before webpack is ready
- Use `npm run tauri:dev` which waits for webpack
