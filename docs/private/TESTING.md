# Blink - Testing Guidelines

## CRITICAL MANDATE

**ALWAYS, ABSOLUTELY, write an E2E test to reproduce an issue BEFORE attempting to fix it.**

This is non-negotiable. The workflow is:

1. User reports issue or you observe an error
2. **FIRST:** Write E2E test that reproduces the issue
3. Run the test - confirm it FAILS
4. **THEN:** Work on the fix
5. Keep fixing until the E2E test PASSES
6. Commit both test and fix together

**Never skip step 2.** If you cannot write a failing test, you do not understand the issue.

---

## Core Principles

### 1. User-Centric E2E Testing

**All implemented features MUST be verified through end-to-end tests that simulate real user interactions.**

This means:

- Use clicks, not API calls
- Use keyboard input, not programmatic text insertion
- Wait for UI updates, don't assume immediate state changes
- Test what the user sees, not internal state

### 2. Test-First for Bug Fixes

**When fixing a bug, you MUST write a failing test BEFORE writing any fix code.**

```
Bug Fix Process:
1. Write E2E test that reproduces the bug
2. Run test - it MUST FAIL
3. If test passes, you misunderstand the bug - try again
4. Fix the bug in code
5. Run test - it should pass now
6. Commit both test and fix together
```

**Why?**

- Proves the bug exists before you "fix" it
- Prevents regression - if test exists, bug can never come back unnoticed
- Forces you to understand the bug from user's perspective
- Creates documentation of what was broken

**If you cannot write a failing test for a bug, you do not understand the bug well enough to fix it.**

## Test Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Test Runner (Bash)                          │
│                    ./testing/tauri/run-tests.sh                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Test Client Library                            │
│              testing/tauri/lib/test-client.sh                    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ HTTP Helpers │ │  UI Actions  │ │ Assertions   │             │
│  │ test_js()    │ │ click_elem() │ │ assert_eq()  │             │
│  │ test_query() │ │ type_text()  │ │ assert_json()│             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Debug Test Server (Rust - port 9999)               │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │  /js         │ │  /query      │ │  /extensions │             │
│  │  Execute JS  │ │  Query DOM   │ │  Ext mgmt    │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Test Bridge (window.__TEST_BRIDGE__)             │
│                     Injected into WebView                        │
└─────────────────────────────────────────────────────────────────┘
```

## Running Tests

```bash
# Start the app in dev mode (includes test server)
npm run tauri:dev

# In another terminal, run all tests
./testing/tauri/run-tests.sh

# Run specific test file
./testing/tauri/tests/ui-e2e/02-uninstall-ui-update.sh
```

## Writing Tests

### Basic Test Structure

```bash
#!/bin/bash
set -e

# Load test utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

# Test function naming: test_XX_description
test_01_my_feature() {
    echo "Testing my feature..."

    # Arrange: Set up preconditions
    wait_for_workbench 60

    # Act: Perform user actions
    click_element "[data-testid='my-button']"
    wait_for_element ".expected-result" 10

    # Assert: Verify outcome
    local result=$(get_element_text ".expected-result")
    assert_contains "$result" "expected text" "Should show expected text"

    echo "  ✓ My feature works"
}

# Run all tests
run_tests
```

### UI Interaction Functions

```bash
# Click an element by CSS selector
click_element ".my-button"

# Click by data-testid (preferred for stability)
click_testid "submit-button"

# Type text into an input
type_text ".search-input" "my search query"
type_testid "search-box" "query"

# Wait for element to appear
wait_for_element ".loading-complete" 30  # 30 second timeout

# Wait for element to disappear
wait_for_element_gone ".loading-spinner" 10

# Check if element exists
if element_exists ".optional-feature"; then
    echo "Feature is available"
fi

# Get element text
local text=$(get_element_text ".status-message")

# Get element attribute
local href=$(get_element_attr ".link" "href")

# Count elements
local count=$(get_element_count ".list-item")
```

### Extension UI Functions

```bash
# Open extensions panel
ui_open_extensions_panel

# Search for extension
ui_search_extension "python"

# Install extension by clicking Install button
ui_click_install "ms-python.python"

# Uninstall extension
ui_click_uninstall "ms-python.python"

# Switch tabs
ui_open_browse_tab
ui_open_installed_tab

# Get installed count
local count=$(ui_get_installed_count)

# Wait for extension search results to load
wait_for_extension_results 5

# Wait for specific extension to appear
ui_wait_for_extension_visible "ms-python.python" 10
```

### Assertions

```bash
# Exact equality
assert_equals "$actual" "$expected" "Values should match"

# String contains
assert_contains "$text" "substring" "Should contain substring"

# JSON field check
assert_json_true "$json" ".success" "Should have success=true"
assert_json_equals "$json" ".count" "5" "Should have 5 items"

# Not empty
assert_not_empty "$value" "Value should not be empty"
```

## Test Categories

### Functional Tests (`testing/tauri/tests/functional/`)

Low-level tests for core functionality:

- `01-health.sh` - Server health and bridge injection
- `02-workbench.sh` - Workbench loading and basic UI
- `03-extensions.sh` - Extension API endpoints
- `04-editor.sh` - Editor functionality

### UI E2E Tests (`testing/tauri/tests/ui-e2e/`)

User-centric tests simulating real workflows:

- `01-extension-lifecycle.sh` - Full install/uninstall flow
- `02-uninstall-ui-update.sh` - UI updates after operations

## Best Practices

### DO:

1. **Use data-testid attributes** for reliable element selection

   ```html
   <button data-testid="save-button">Save</button>
   ```

   ```bash
   click_testid "save-button"
   ```

2. **Wait for UI updates** after actions

   ```bash
   click_testid "submit"
   wait_for_element ".success-message" 10  # Don't assume instant
   ```

3. **Clean up test state** after tests

   ```bash
   cleanup() {
       # Uninstall any extensions we installed
       uninstall_extension "test.extension" 2>/dev/null || true
   }
   trap cleanup EXIT
   ```

4. **Use descriptive test names**

   ```bash
   test_08_clear_search_verify_installed()  # Good
   test_8()  # Bad
   ```

5. **Test one thing per test function**
   ```bash
   test_01_install_extension()
   test_02_verify_extension_active()
   test_03_uninstall_extension()
   ```

### DON'T:

1. **Don't use programmatic state changes**

   ```bash
   # BAD: Directly setting values
   test_js "document.querySelector('input').value = 'test'"

   # GOOD: Simulate typing
   type_text "input" "test"
   ```

2. **Don't assume timing**

   ```bash
   # BAD: Fixed sleep
   sleep 5

   # GOOD: Wait for condition
   wait_for_element ".complete" 10
   ```

3. **Don't skip the UI**

   ```bash
   # BAD: API call to install
   install_extension "foo.bar"

   # GOOD: Click through UI (unless testing cleanup)
   ui_click_install "foo.bar"
   ui_wait_for_installed_badge "foo.bar" 30
   ```

4. **Don't ignore flaky tests** - Fix the root cause

## Debugging Tests

### View console logs

```bash
curl http://localhost:9999/console | jq
```

### View JavaScript errors

```bash
curl http://localhost:9999/errors | jq
```

### Execute arbitrary JS

```bash
test_js "window.__extWorkbenchService.installed.length"
```

### Query DOM

```bash
test_query ".monaco-workbench" | jq
```

### Verbose mode

```bash
DEBUG=1 ./testing/tauri/run-tests.sh
```

## Adding Tests for New Features

1. **Identify user workflow** - How will users interact with this feature?

2. **Add data-testid attributes** to relevant elements in the code

3. **Create test file** in appropriate directory:
   - `tests/functional/` for API/core tests
   - `tests/ui-e2e/` for user workflow tests

4. **Follow naming convention**: `XX-feature-name.sh`

5. **Implement tests** using user-centric interactions

6. **Run tests locally** before committing

7. **Update FEATURES.md** to mark feature as tested
