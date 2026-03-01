#!/bin/bash
# Core test client library for Blink Tauri E2E testing
# Source this file to use test functions in your scripts
#
# Multi-Window Support:
# Most functions accept an optional window parameter as the last argument.
# If not specified, defaults to "main".
#
# Examples:
#   test_js "document.title"           # Runs on main window
#   test_js "document.title" "context-1"  # Runs on context-1 window

# Configuration
TEST_SERVER="${TEST_SERVER:-http://localhost:9999}"
TEST_TIMEOUT="${TEST_TIMEOUT:-5000}"
DEFAULT_WINDOW="${DEFAULT_WINDOW:-main}"
UI_TIMEOUT="${UI_TIMEOUT:-5}"  # Default timeout for waiting on UI elements (seconds)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# ============================================================================
# Window Management Functions
# ============================================================================

# List all open windows
# Usage: list_windows
list_windows() {
    curl -s "$TEST_SERVER/windows" | jq .
}

# Get window labels only
# Usage: get_window_labels
get_window_labels() {
    curl -s "$TEST_SERVER/windows" | jq -r '.windows[].label'
}

# Open a new context window with a specific folder
# Usage: open_context_window "/path/to/folder" ["label"] ["title"]
open_context_window() {
    local folder="$1"
    local label="${2:-}"
    local title="${3:-}"

    local body="{\"folder\": \"$folder\""
    [ -n "$label" ] && body="$body, \"label\": \"$label\""
    [ -n "$title" ] && body="$body, \"title\": \"$title\""
    body="$body}"

    curl -s -X POST "$TEST_SERVER/windows/open" \
        -H "Content-Type: application/json" \
        -d "$body"
}

# Open folder picker dialog and return selected path
# Usage: folder=$(pick_folder)
pick_folder() {
    local result=$(curl -s -X POST "$TEST_SERVER/windows/pick" --max-time 120)
    if echo "$result" | jq -e '.success' > /dev/null 2>&1; then
        echo "$result" | jq -r '.folder'
    else
        echo ""
        return 1
    fi
}

# Open a context window with folder picker
# Usage: open_context_window_interactive ["label"]
open_context_window_interactive() {
    local label="${1:-}"

    echo -e "${CYAN}Opening folder picker...${NC}"
    local folder=$(pick_folder)

    if [ -z "$folder" ]; then
        echo -e "${RED}No folder selected${NC}"
        return 1
    fi

    echo -e "${GREEN}Selected: $folder${NC}"
    open_context_window "$folder" "$label"
}

# Close a window by label
# Usage: close_window "context-1"
close_window() {
    local label="$1"
    curl -s -X DELETE "$TEST_SERVER/windows/$label"
}

# Focus a window by label
# Usage: focus_window "context-1"
focus_window() {
    local label="$1"
    curl -s -X POST "$TEST_SERVER/windows/$label/focus"
}

# Inject bridge into a window
# Usage: inject_bridge "context-1"
inject_bridge() {
    local label="$1"
    curl -s -X POST "$TEST_SERVER/windows/$label/inject"
}

# Wait for a window's bridge to be ready
# Usage: wait_for_window_bridge "context-1" [timeout_seconds]
wait_for_window_bridge() {
    local label="$1"
    local timeout="${2:-30}"
    local elapsed=0

    echo -n "Waiting for bridge in '$label'..."
    while [ $elapsed -lt $timeout ]; do
        local result=$(curl -s "$TEST_SERVER/windows")
        if echo "$result" | jq -e ".windows[] | select(.label == \"$label\" and .bridge_injected == true)" > /dev/null 2>&1; then
            echo -e " ${GREEN}ready${NC}"
            return 0
        fi
        sleep 1
        ((elapsed++))
        echo -n "."
    done
    echo -e " ${RED}timeout${NC}"
    return 1
}

# ============================================================================
# HTTP Client Functions (with window support)
# ============================================================================

# Execute JavaScript in the webview
# Usage: test_js "document.title" [window]
test_js() {
    local code="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    local timeout="${TEST_TIMEOUT}"
    curl -s -X POST "$TEST_SERVER/js?window=$window" \
        -H "Content-Type: application/json" \
        -d "{\"code\": $(echo "$code" | jq -Rs .), \"timeout\": $timeout}"
}

# Query DOM elements by CSS selector
# Usage: test_query ".monaco-workbench" [window]
test_query() {
    local selector="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    curl -s -X POST "$TEST_SERVER/query?window=$window" \
        -H "Content-Type: application/json" \
        -d "{\"selector\": \"$selector\"}"
}

# Get console logs
# Usage: test_console [limit] [window]
test_console() {
    local limit="${1:-100}"
    local window="${2:-$DEFAULT_WINDOW}"
    curl -s "$TEST_SERVER/console?window=$window" | jq ".entries[-$limit:]"
}

# Get captured errors
# Usage: test_errors [window]
test_errors() {
    local window="${1:-$DEFAULT_WINDOW}"
    curl -s "$TEST_SERVER/errors?window=$window"
}

# Get network requests
# Usage: test_network [window]
test_network() {
    local window="${1:-$DEFAULT_WINDOW}"
    curl -s "$TEST_SERVER/network?window=$window"
}

# Get custom events
# Usage: test_events [window]
test_events() {
    local window="${1:-$DEFAULT_WINDOW}"
    curl -s "$TEST_SERVER/events?window=$window"
}

# Get health status
# Usage: test_health
test_health() {
    curl -s "$TEST_SERVER/health"
}

# Get DOM snapshot
# Usage: test_dom [window]
test_dom() {
    local window="${1:-$DEFAULT_WINDOW}"
    curl -s "$TEST_SERVER/dom?window=$window"
}

# Get computed styles
# Usage: test_styles ".selector" '["color", "background"]' [window]
test_styles() {
    local selector="$1"
    local properties="$2"
    local window="${3:-$DEFAULT_WINDOW}"
    curl -s -X POST "$TEST_SERVER/styles?window=$window" \
        -H "Content-Type: application/json" \
        -d "{\"selector\": \"$selector\", \"properties\": $properties}"
}

# Invoke Tauri command
# Usage: test_invoke "command_name" '{"arg": "value"}' [window]
test_invoke() {
    local command="$1"
    local args="${2:-{}}"
    local window="${3:-$DEFAULT_WINDOW}"
    curl -s -X POST "$TEST_SERVER/invoke?window=$window" \
        -H "Content-Type: application/json" \
        -d "{\"command\": \"$command\", \"args\": $args}"
}

# Clear all captured data
# Usage: test_clear [window]
test_clear() {
    local window="${1:-$DEFAULT_WINDOW}"
    curl -s -X DELETE "$TEST_SERVER/console?window=$window" > /dev/null
    curl -s -X DELETE "$TEST_SERVER/errors?window=$window" > /dev/null
    curl -s -X DELETE "$TEST_SERVER/network?window=$window" > /dev/null
    curl -s -X DELETE "$TEST_SERVER/events?window=$window" > /dev/null
}

# ============================================================================
# Assertion Functions
# ============================================================================

# Assert that a value equals expected
# Usage: assert_equals "$actual" "$expected" "description"
assert_equals() {
    local actual="$1"
    local expected="$2"
    local description="${3:-Assertion}"

    if [ "$actual" = "$expected" ]; then
        echo -e "  ${GREEN}✓${NC} $description"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "  ${RED}✗${NC} $description"
        echo -e "    Expected: $expected"
        echo -e "    Actual:   $actual"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Assert that a value is not empty
# Usage: assert_not_empty "$value" "description"
assert_not_empty() {
    local value="$1"
    local description="${2:-Value should not be empty}"

    if [ -n "$value" ] && [ "$value" != "null" ]; then
        echo -e "  ${GREEN}✓${NC} $description"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "  ${RED}✗${NC} $description"
        echo -e "    Value was empty or null"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Assert that a JSON field equals expected value
# Usage: assert_json_equals "$json" ".field" "expected" "description"
assert_json_equals() {
    local json="$1"
    local field="$2"
    local expected="$3"
    local description="${4:-JSON assertion}"

    local actual=$(echo "$json" | jq -r "$field")
    assert_equals "$actual" "$expected" "$description"
}

# Assert that a JSON field is true
# Usage: assert_json_true "$json" ".found" "description"
assert_json_true() {
    local json="$1"
    local field="$2"
    local description="${3:-Field should be true}"

    local actual=$(echo "$json" | jq -r "$field")
    assert_equals "$actual" "true" "$description"
}

# Assert that a JSON field is false
# Usage: assert_json_false "$json" ".found" "description"
assert_json_false() {
    local json="$1"
    local field="$2"
    local description="${3:-Field should be false}"

    local actual=$(echo "$json" | jq -r "$field")
    assert_equals "$actual" "false" "$description"
}

# Assert that a value contains a substring
# Usage: assert_contains "$value" "substring" "description"
assert_contains() {
    local value="$1"
    local substring="$2"
    local description="${3:-Should contain substring}"

    if [[ "$value" == *"$substring"* ]]; then
        echo -e "  ${GREEN}✓${NC} $description"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "  ${RED}✗${NC} $description"
        echo -e "    Value does not contain: $substring"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Assert that a numeric value is greater than expected
# Usage: assert_greater_than "$actual" "$expected" "description"
assert_greater_than() {
    local actual="$1"
    local expected="$2"
    local description="${3:-Should be greater than}"

    if [ "$actual" -gt "$expected" ] 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $description"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "  ${RED}✗${NC} $description"
        echo -e "    Expected > $expected, got: $actual"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Skip a test with a reason
# Usage: skip_test "reason"
skip_test() {
    local reason="${1:-No reason provided}"
    echo -e "  ${YELLOW}○${NC} SKIPPED: $reason"
    ((TESTS_SKIPPED++))
}

# ============================================================================
# Helper Functions
# ============================================================================

# Wait for test server to be ready
# Usage: wait_for_server [timeout_seconds]
wait_for_server() {
    local timeout="${1:-60}"
    local elapsed=0

    echo -n "Waiting for test server..."
    while [ $elapsed -lt $timeout ]; do
        if curl -s "$TEST_SERVER/health" | grep -q '"status":"ok"'; then
            echo -e " ${GREEN}ready${NC}"
            return 0
        fi
        sleep 1
        ((elapsed++))
        echo -n "."
    done
    echo -e " ${RED}timeout${NC}"
    return 1
}

# Wait for bridge to be connected (on main window)
# This will inject the bridge if it's not already present
# Usage: wait_for_bridge [timeout_seconds]
wait_for_bridge() {
    local timeout="${1:-30}"
    local elapsed=0

    echo -n "Waiting for bridge connection..."
    while [ $elapsed -lt $timeout ]; do
        # Check if bridge actually exists in window (not just marked as injected)
        local bridge_check=$(curl -s "$TEST_SERVER/js?window=main" \
            -H "Content-Type: application/json" \
            -d '{"code":"typeof window.__TEST_BRIDGE__"}' 2>/dev/null)

        if echo "$bridge_check" | grep -q '"result":"object"'; then
            echo -e " ${GREEN}connected${NC}"
            return 0
        fi

        # Bridge not present - try to inject it
        curl -s -X POST "$TEST_SERVER/windows/main/inject" > /dev/null 2>&1

        sleep 1
        ((elapsed++))
        echo -n "."
    done
    echo -e " ${RED}timeout${NC}"
    return 1
}

# Wait for workbench to load
# Usage: wait_for_workbench [timeout_seconds] [window]
wait_for_workbench() {
    local timeout="${1:-60}"
    local window="${2:-$DEFAULT_WINDOW}"
    local elapsed=0

    echo -n "Waiting for workbench in '$window'..."
    while [ $elapsed -lt $timeout ]; do
        local result=$(test_query ".monaco-workbench" "$window")
        if echo "$result" | grep -q '"found":true'; then
            echo -e " ${GREEN}loaded${NC}"
            return 0
        fi
        sleep 1
        ((elapsed++))
        echo -n "."
    done
    echo -e " ${RED}timeout${NC}"
    return 1
}

# Open a VS Code view
# Usage: open_view "extensions|explorer|search" [window]
open_view() {
    local view="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    local icon=""

    case "$view" in
        extensions) icon="extensions-view-icon" ;;
        explorer)   icon="explorer-view-icon" ;;
        search)     icon="search-view-icon" ;;
        *)
            echo "Unknown view: $view"
            return 1
            ;;
    esac

    test_js "document.querySelector('.codicon-$icon')?.closest('.action-item')?.querySelector('.action-label')?.click(); 'opened'" "$window" > /dev/null
    sleep 0.5
}

# Type text into the extensions search box
# Usage: search_extensions "query" [window]
search_extensions() {
    local query="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    open_view extensions "$window"
    sleep 0.5
    test_js "const ta = document.querySelector('.extensions-viewlet textarea.inputarea'); ta?.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, '$query'); 'searched'" "$window" > /dev/null
    sleep 1
}

# Get installed extensions list
# Usage: get_installed_extensions [window]
get_installed_extensions() {
    local window="${1:-$DEFAULT_WINDOW}"
    search_extensions "@installed" "$window"
    sleep 1
    test_js 'Array.from(document.querySelectorAll(".extension-list-item .name, .extensions-viewlet .extension .name")).map(e => e.innerText).filter(n => n)' "$window" | jq -r '.result | fromjson | .[]'
}

# ============================================================================
# UI Interaction Functions
# ============================================================================

# Click an element by selector
# Usage: click_element "[data-testid=\"tab-browse\"]" [window]
click_element() {
    local selector="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    # Use double quotes in JS to avoid conflicts with selector single quotes
    test_js "const el = document.querySelector(\"$selector\"); if (el) { el.click(); 'clicked' } else { 'not found' }" "$window"
}

# Click an element by test ID
# Usage: click_testid "tab-browse" [window]
click_testid() {
    local testid="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    # Use escaped double quotes for the attribute value
    click_element "[data-testid=\\\"$testid\\\"]" "$window"
}

# Type text into an input field by selector
# Usage: type_text "[data-testid=\"search-input\"]" "hello world" [window]
type_text() {
    local selector="$1"
    local text="$2"
    local window="${3:-$DEFAULT_WINDOW}"
    # Escape special characters for JavaScript
    local escaped_text=$(echo "$text" | sed "s/'/\\\\'/g")
    test_js "const el = document.querySelector(\"$selector\"); if (el) { el.focus(); el.value = '$escaped_text'; el.dispatchEvent(new Event('input', { bubbles: true })); 'typed' } else { 'not found' }" "$window"
}

# Type text into an input field by test ID
# Usage: type_testid "extension-search-input" "gruvbox" [window]
type_testid() {
    local testid="$1"
    local text="$2"
    local window="${3:-$DEFAULT_WINDOW}"
    type_text "[data-testid=\\\"$testid\\\"]" "$text" "$window"
}

# Wait for an element to appear
# Usage: wait_for_element "[data-testid='extensions-panel']" [timeout_seconds] [window]
# Default timeout: 5 seconds (configurable via UI_TIMEOUT env var)
wait_for_element() {
    local selector="$1"
    local timeout="${2:-${UI_TIMEOUT:-5}}"
    local window="${3:-$DEFAULT_WINDOW}"
    local elapsed=0
    local interval=0.25  # Check every 250ms for responsiveness

    while (( $(echo "$elapsed < $timeout" | bc -l) )); do
        local result=$(test_query "$selector" "$window")
        if echo "$result" | grep -q '"found":true'; then
            return 0
        fi
        sleep $interval
        elapsed=$(echo "$elapsed + $interval" | bc -l)
    done
    return 1
}

# Wait for an element by test ID
# Usage: wait_for_testid "extensions-panel" [timeout] [window]
wait_for_testid() {
    local testid="$1"
    local timeout="${2:-${UI_TIMEOUT:-5}}"
    local window="${3:-$DEFAULT_WINDOW}"
    wait_for_element "[data-testid=\"$testid\"]" "$timeout" "$window"
}

# Wait for element to disappear
# Usage: wait_for_element_gone "[data-testid='loading']" [timeout] [window]
# Default timeout: 5 seconds (configurable via UI_TIMEOUT env var)
wait_for_element_gone() {
    local selector="$1"
    local timeout="${2:-${UI_TIMEOUT:-5}}"
    local window="${3:-$DEFAULT_WINDOW}"
    local elapsed=0
    local interval=0.25

    while (( $(echo "$elapsed < $timeout" | bc -l) )); do
        local result=$(test_query "$selector" "$window")
        if echo "$result" | grep -q '"found":false' || echo "$result" | jq -e '.count == 0' > /dev/null 2>&1; then
            return 0
        fi
        sleep $interval
        elapsed=$(echo "$elapsed + $interval" | bc -l)
    done
    return 1
}

# Get element count by selector
# Usage: count=$(get_element_count "[data-testid='extension-card']" [window])
get_element_count() {
    local selector="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    local result=$(test_query "$selector" "$window")
    echo "$result" | jq -r '.count // 0'
}

# Check if element exists
# Usage: if element_exists "[data-testid='extension-panel']"; then ...
element_exists() {
    local selector="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    local result=$(test_query "$selector" "$window")
    echo "$result" | grep -q '"found":true'
}

# Get element text content
# Usage: text=$(get_element_text "[data-testid=\"extension-name\"]" [window])
get_element_text() {
    local selector="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    test_js "document.querySelector(\"$selector\")?.textContent?.trim() || ''" "$window" | jq -r '.result // ""'
}

# Get element attribute
# Usage: id=$(get_element_attr "[data-testid=\"extension-card\"]" "data-extension-id" [window])
get_element_attr() {
    local selector="$1"
    local attr="$2"
    local window="${3:-$DEFAULT_WINDOW}"
    test_js "document.querySelector(\"$selector\")?.getAttribute('$attr') || ''" "$window" | jq -r '.result // ""'
}

# ============================================================================
# Extension UI Interaction Functions (VS Code Native Workbench)
# ============================================================================
#
# These functions interact with VS Code's native workbench UI (via monaco-vscode-api)
# rather than custom Preact components.

# Check if Extensions panel is open
# Usage: ui_is_extensions_open [window]
ui_is_extensions_open() {
    local window="${1:-$DEFAULT_WINDOW}"
    local result=$(test_js "document.querySelector('.extensions-viewlet') ? 'open' : 'closed'" "$window")
    echo "$result" | jq -r '.result' | grep -q "open"
}

# Open the Extensions panel via activity bar click (idempotent - won't close if already open)
# Usage: ui_open_extensions_panel [window]
ui_open_extensions_panel() {
    local window="${1:-$DEFAULT_WINDOW}"
    if ui_is_extensions_open "$window"; then
        echo -e "${CYAN}Extensions panel already open${NC}" >&2
        return 0
    fi
    echo -e "${CYAN}Opening Extensions panel...${NC}" >&2
    test_js "(function(){
        const byIcon = document.querySelector('.codicon-extensions-view-icon');
        if (byIcon) {
            const item = byIcon.closest('.action-item');
            const label = item?.querySelector('.action-label');
            if (label) { label.click(); return 'clicked-label'; }
            if (item) { item.click(); return 'clicked-item'; }
        }
        const label2 = document.querySelector('.activitybar .action-item[aria-label*=\"Extensions\"] .action-label');
        if (label2) { label2.click(); return 'clicked-aria-label'; }
        const item2 = document.querySelector('.activitybar .action-item[aria-label*=\"Extensions\"]');
        if (item2) { item2.click(); return 'clicked-aria-item'; }
        return 'not-found';
    })()" "$window" > /dev/null
    wait_for_element ".extensions-viewlet" "${UI_TIMEOUT:-5}" "$window"
}


# Focus the search input in Extensions view
# Usage: ui_focus_extension_search [window]
ui_focus_extension_search() {
    local window="${1:-$DEFAULT_WINDOW}"
    echo -e "${CYAN}Focusing extension search...${NC}" >&2
    test_js "(function(){
        const direct = document.querySelector('.extensions-viewlet .inputarea, .extensions-viewlet input[type=\"text\"]');
        if (direct) { direct.focus(); return 'focused-direct'; }
        const container = document.querySelector('.extensions-viewlet .suggest-input-container, .extensions-viewlet .search-box');
        if (container) {
            container.click();
            const ta = container.querySelector('textarea.inputarea');
            if (ta) { ta.focus(); return 'focused-container'; }
        }
        return 'not-found';
    })()" "$window"
}

# Search for an extension in the Extensions view
# Usage: ui_search_extension "gruvbox" [window]
ui_search_extension() {
    local query="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    echo -e "${CYAN}Searching for: $query${NC}" >&2

    ui_open_extensions_panel "$window" > /dev/null 2>&1

    test_js "
        const container = document.querySelector('.extensions-viewlet .suggest-input-container');
        if (container) {
            container.click();
            const editor = container.querySelector('.monaco-editor');
            const textarea = editor?.querySelector('textarea.inputarea');
            if (textarea) {
                textarea.focus();
                document.execCommand('selectAll');
                document.execCommand('insertText', false, '$query');
                'typed'
            } else {
                const placeholder = container.querySelector('.suggest-input-placeholder');
                if (placeholder) {
                    placeholder.click();
                    setTimeout(() => {
                        const ta = container.querySelector('textarea.inputarea');
                        if (ta) {
                            ta.focus();
                            document.execCommand('selectAll');
                            document.execCommand('insertText', false, '$query');
                        }
                    }, 50);
                    'typing...'
                } else {
                    'no textarea'
                }
            }
        } else {
            'not found'
        }
    " "$window"
    wait_for_extension_results "${UI_TIMEOUT:-5}" "$window"
}

# Clear search and show all extensions
# Usage: ui_clear_extension_search [window]
ui_clear_extension_search() {
    local window="${1:-$DEFAULT_WINDOW}"
    echo -e "${CYAN}Clearing extension search...${NC}" >&2
    test_js "
        const searchBox = document.querySelector('.extensions-viewlet .search-box .inputarea, .extensions-viewlet input');
        if (searchBox) {
            searchBox.focus();
            document.execCommand('selectAll');
            document.execCommand('insertText', false, '');
            'cleared'
        } else {
            'not found'
        }
    " "$window"
    wait_for_extension_results "${UI_TIMEOUT:-5}" "$window"
}

# Search for installed extensions
# Usage: ui_search_installed [window]
ui_search_installed() {
    local window="${1:-$DEFAULT_WINDOW}"
    ui_search_extension "@installed" "$window"
}

# Get list of extension names visible in the Extensions view
# Usage: names=$(ui_get_visible_extensions [window])
ui_get_visible_extensions() {
    local window="${1:-$DEFAULT_WINDOW}"
    test_js "Array.from(document.querySelectorAll('.extensions-viewlet .name')).map(e => e.textContent).filter(Boolean)" "$window" | jq -r '.result | fromjson | .[]' 2>/dev/null
}

# Click Install button on a search result by extension name
# Usage: ui_click_install_by_name "Gruvbox Theme" [window]
ui_click_install_by_name() {
    local ext_name="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    echo -e "${CYAN}Clicking Install for: $ext_name${NC}" >&2
    test_js "(function() {
        const rows = Array.from(document.querySelectorAll('.extensions-viewlet .monaco-list-row'));
        for (const row of rows) {
            const name = row.querySelector('.name')?.textContent;
            if (name && name.toLowerCase().includes('$ext_name'.toLowerCase())) {
                const installBtn = row.querySelector('.extension-action.install:not(.installing):not(.hide)');
                if (installBtn && installBtn.textContent?.includes('Install')) {
                    installBtn.click();
                    return 'clicked';
                }
            }
        }
        return 'not found';
    })()" "$window"
}

# Click Install button by publisher.name format
# Also handles "Install Locally" button for remote/web extension contexts
# Usage: ui_click_install "jdinhlife.gruvbox" [window]
ui_click_install() {
    local extension_id="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    echo -e "${CYAN}Clicking Install for: $extension_id${NC}" >&2
    # Parse publisher and name from extension_id
    local publisher=$(echo "$extension_id" | cut -d. -f1)
    local name=$(echo "$extension_id" | cut -d. -f2-)
    test_js "(function() {
        const rows = Array.from(document.querySelectorAll('.extensions-viewlet .monaco-list-row'));
        for (const row of rows) {
            const publisherEl = row.querySelector('.publisher-name');
            const pub = publisherEl?.textContent?.toLowerCase() || '';

            // Match by publisher name
            if (pub.includes('$publisher'.toLowerCase())) {
                // First try: Regular install button
                const installBtn = row.querySelector('.extension-action.install:not(.installing):not(.hide):not(.disabled)');
                if (installBtn && installBtn.textContent?.includes('Install') && !installBtn.textContent?.includes('Locally')) {
                    installBtn.click();
                    return 'clicked';
                }
                // Second try: Install Locally button (for web/remote extension context)
                const installLocallyBtn = row.querySelector('.extension-action.install-other-server:not(.hide):not(.disabled)');
                if (installLocallyBtn && installLocallyBtn.textContent?.includes('Install Locally')) {
                    installLocallyBtn.click();
                    return 'clicked-locally';
                }
                // Third try: Any visible install button
                const anyInstallBtn = row.querySelector('.extension-action[class*=\"install\"]:not(.installing):not(.hide):not(.disabled)');
                if (anyInstallBtn && anyInstallBtn.textContent?.includes('Install')) {
                    anyInstallBtn.click();
                    return 'clicked-any';
                }
            }
        }
        return 'not found';
    })()" "$window"
}

# Click the "Trust Publisher & Install" button if the trust dialog is visible
# Usage: ui_click_trust_publisher [window]
ui_click_trust_publisher() {
    local window="${1:-$DEFAULT_WINDOW}"
    test_js "(function() {
        // Look for the trust dialog - VS Code uses different selectors
        // Try to find any button with 'trust' or 'install' in the text
        const dialogs = document.querySelectorAll('.dialog-shadow, .monaco-dialog-box, .quick-input-widget');
        for (const dialog of dialogs) {
            // Find buttons in dialog
            const buttons = dialog.querySelectorAll('button, .monaco-button');
            for (const btn of buttons) {
                const text = btn.textContent?.toLowerCase() || '';
                if (text.includes('trust') && text.includes('install')) {
                    btn.click();
                    return 'clicked-trust';
                }
                if (text.includes('install') && !text.includes('cancel')) {
                    btn.click();
                    return 'clicked-install';
                }
            }
        }
        // Also try quick input actions
        const quickInput = document.querySelector('.quick-input-widget:not(.hidden)');
        if (quickInput) {
            const actions = quickInput.querySelectorAll('.quick-input-action');
            for (const action of actions) {
                const text = action.textContent?.toLowerCase() || '';
                if (text.includes('trust') || (text.includes('install') && !text.includes('cancel'))) {
                    action.click();
                    return 'clicked-quick-action';
                }
            }
        }
        return 'no-dialog';
    })()" "$window"
}

# Wait for extension to finish installing (Install button changes to Uninstall/Manage)
# Also handles "Trust Publisher" dialog if it appears
# Usage: ui_wait_for_extension_installed "jdinhlife.gruvbox" [timeout] [window]
ui_wait_for_extension_installed() {
    local extension_id="$1"
    local timeout="${2:-60}"
    local window="${3:-$DEFAULT_WINDOW}"
    local elapsed=0
    local publisher=$(echo "$extension_id" | cut -d. -f1)

    echo -n "Waiting for extension '$extension_id' to install..." >&2
    while [ $elapsed -lt $timeout ]; do
        # First, check for and click any trust dialog
        local trust_result=$(ui_click_trust_publisher "$window")
        if echo "$trust_result" | jq -r '.result' | grep -q "clicked"; then
            echo -n "[trust]" >&2
            sleep 1
        fi

        local result=$(test_js "(function() {
            const rows = Array.from(document.querySelectorAll('.extensions-viewlet .monaco-list-row'));
            for (const row of rows) {
                const publisherEl = row.querySelector('.publisher-name');
                if (publisherEl?.textContent?.toLowerCase().includes('$publisher'.toLowerCase())) {
                    // Check for Uninstall or Manage button (indicates installed)
                    const manageBtn = row.querySelector('.extension-action.manage:not(.hide), .extension-action.uninstall:not(.hide)');
                    if (manageBtn) return 'installed';
                    // Check if still installing
                    const installingBtn = row.querySelector('.extension-action.installing:not(.hide)');
                    if (installingBtn) return 'installing';
                }
            }
            return 'not-installed';
        })()" "$window")
        local install_status=$(echo "$result" | jq -r '.result')
        if [ "$install_status" = "installed" ]; then
            echo -e " ${GREEN}done${NC}" >&2
            return 0
        fi
        sleep 1
        ((elapsed++))
        echo -n "." >&2
    done
    echo -e " ${RED}timeout${NC}" >&2
    return 1
}

# Click Uninstall button on an installed extension
# If the extension uses a manage dropdown, this will open it and click uninstall
# Usage: ui_click_uninstall "jdinhlife.gruvbox" [window]
ui_click_uninstall() {
    local extension_id="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    echo -e "${CYAN}Clicking Uninstall for: $extension_id${NC}" >&2
    local name=$(echo "$extension_id" | cut -d. -f2-)

    # First try to click the manage button to open dropdown
    local result=$(test_js "(function() {
        const items = Array.from(document.querySelectorAll('.extensions-viewlet .extension-list-item, .extensions-viewlet .monaco-list-row'));
        for (const item of items) {
            const nameEl = item.querySelector('.name');
            if (nameEl?.textContent?.toLowerCase().includes('$name'.toLowerCase())) {
                // Try direct uninstall button first
                const uninstallBtn = item.querySelector('.extension-action.uninstall:not(.hide), button[title*=\"Uninstall\"]');
                if (uninstallBtn) {
                    uninstallBtn.click();
                    return 'clicked';
                }
                // Open manage dropdown
                const manageBtn = item.querySelector('.extension-action.manage:not(.hide)');
                if (manageBtn) {
                    manageBtn.click();
                    return 'opened-manage';
                }
            }
        }
        return 'not found';
    })()" "$window")

    local click_status=$(echo "$result" | jq -r '.result')
    if [ "$click_status" = "opened-manage" ]; then
        # Wait for dropdown to appear then click Uninstall
        sleep 0.3
        test_js "(function() {
            // Look for context menu or dropdown with uninstall option
            const menus = document.querySelectorAll('.context-view, .monaco-menu, .monaco-action-bar.vertical');
            for (const menu of menus) {
                const items = menu.querySelectorAll('.action-item, .action-menu-item, li');
                for (const item of items) {
                    const text = item.textContent?.toLowerCase() || '';
                    if (text.includes('uninstall')) {
                        const target = item.querySelector('.action-label, a') || item;
                        // Use proper mouse events - VS Code's action handlers require this
                        const rect = target.getBoundingClientRect();
                        const centerX = rect.left + rect.width / 2;
                        const centerY = rect.top + rect.height / 2;

                        ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                            const event = new MouseEvent(eventType, {
                                bubbles: true,
                                cancelable: true,
                                view: window,
                                button: 0,
                                buttons: eventType === 'mousedown' ? 1 : 0,
                                clientX: centerX,
                                clientY: centerY
                            });
                            target.dispatchEvent(event);
                        });
                        return 'clicked';
                    }
                }
            }
            return 'uninstall-not-in-menu';
        })()" "$window"
    else
        echo "$result"
    fi
}

# Wait for extension to be uninstalled
# In web/remote contexts, considers "uninstalled" if:
# - Extension disappears from @installed list, OR
# - Only "Install Locally" button is visible (no manage button)
# Usage: ui_wait_for_extension_uninstalled "jdinhlife.gruvbox" [timeout] [window]
ui_wait_for_extension_uninstalled() {
    local extension_id="$1"
    local timeout="${2:-30}"
    local window="${3:-$DEFAULT_WINDOW}"
    local elapsed=0
    local name=$(echo "$extension_id" | cut -d. -f2-)

    echo -n "Waiting for extension '$extension_id' to uninstall..." >&2
    while [ $elapsed -lt $timeout ]; do
        # Search for installed extensions
        ui_search_installed "$window" > /dev/null 2>&1
        sleep 1
        local result=$(test_js "(function() {
            const items = Array.from(document.querySelectorAll('.extensions-viewlet .extension-list-item, .extensions-viewlet .monaco-list-row'));
            for (const item of items) {
                const nameEl = item.querySelector('.name');
                if (nameEl?.textContent?.toLowerCase().includes('$name'.toLowerCase())) {
                    // Check if it has a manage button (installed) or only install buttons
                    const manageBtn = item.querySelector('.extension-action.manage:not(.hide)');
                    const uninstallBtn = item.querySelector('.extension-action.uninstall:not(.hide)');
                    if (manageBtn || uninstallBtn) {
                        return 'still-installed';
                    }
                    // If only install buttons visible, consider it uninstalled from current context
                    const installBtn = item.querySelector('.extension-action.install:not(.hide):not(.disabled), .extension-action.install-other-server:not(.hide):not(.disabled)');
                    if (installBtn) {
                        return 'uninstalled-but-available';
                    }
                    return 'still-installed';
                }
            }
            return 'not-in-list';
        })()" "$window")
        local uninstall_status=$(echo "$result" | jq -r '.result')
        if [ "$uninstall_status" = "not-in-list" ] || [ "$uninstall_status" = "uninstalled-but-available" ]; then
            echo -e " ${GREEN}done${NC}" >&2
            return 0
        fi
        ((elapsed++))
        echo -n "." >&2
    done
    echo -e " ${RED}timeout${NC}" >&2
    return 1
}

# Check if an extension is visible in the current list
# Usage: ui_is_extension_visible "jdinhlife.gruvbox" [window]
ui_is_extension_visible() {
    local extension_id="$1"
    local window="${2:-$DEFAULT_WINDOW}"
    local name=$(echo "$extension_id" | cut -d. -f2-)
    local result=$(test_js "(function() {
        const items = Array.from(document.querySelectorAll('.extensions-viewlet .extension-list-item .name, .extensions-viewlet .monaco-list-row .name'));
        for (const item of items) {
            if (item.textContent?.toLowerCase().includes('$name'.toLowerCase())) {
                return 'visible';
            }
        }
        return 'not-visible';
    })()" "$window")
    echo "$result" | jq -r '.result' | grep -q "visible"
}

# Get count of extensions in current view
# Usage: count=$(ui_get_extension_count [window])
ui_get_extension_count() {
    local window="${1:-$DEFAULT_WINDOW}"
    test_js "document.querySelectorAll('.extensions-viewlet .extension-list-item, .extension-list .monaco-list-row').length" "$window" | jq -r '.result // 0'
}

# Wait for extension search results to load
# Usage: wait_for_extension_results [timeout] [window]
wait_for_extension_results() {
    local timeout="${1:-5}"
    local window="${2:-$DEFAULT_WINDOW}"
    local elapsed=0

    while [ $elapsed -lt $timeout ]; do
        local result=$(test_js "(function() {
            const viewlet = document.querySelector('.extensions-viewlet');
            if (!viewlet) return 'no-viewlet';
            const loading = viewlet.querySelector('.message-container.loading, .monaco-progress-container.active');
            if (loading) return 'loading';
            const results = viewlet.querySelectorAll('.extension-list-item, .monaco-list-row');
            if (results.length > 0) return 'ready';
            const empty = viewlet.querySelector('.message-container:not(.loading)');
            if (empty) return 'empty';
            return 'waiting';
        })()" "$window")

        local status=$(echo "$result" | jq -r '.result // "error"')
        if [ "$status" = "ready" ] || [ "$status" = "empty" ]; then
            return 0
        fi
        sleep 0.5
        ((elapsed++))
    done
    return 1
}

# Wait for a specific extension to be visible in the list
# Usage: ui_wait_for_extension_visible "extension-id" [timeout] [window]
ui_wait_for_extension_visible() {
    local extension_id="$1"
    local timeout="${2:-10}"
    local window="${3:-$DEFAULT_WINDOW}"
    local name=$(echo "$extension_id" | cut -d. -f2-)
    local elapsed=0

    echo -n "Waiting for extension '$extension_id' to be visible..." >&2
    while [ $elapsed -lt $timeout ]; do
        local result=$(test_js "(function() {
            const items = Array.from(document.querySelectorAll('.extensions-viewlet .extension-list-item .name, .extensions-viewlet .monaco-list-row .name'));
            for (const item of items) {
                if (item.textContent?.toLowerCase().includes('$name'.toLowerCase())) {
                    return 'visible';
                }
            }
            return 'not-visible';
        })()" "$window")

        local status=$(echo "$result" | jq -r '.result // "error"')
        if [ "$status" = "visible" ]; then
            echo -e " ${GREEN}found${NC}" >&2
            return 0
        fi
        sleep 1
        ((elapsed++))
        echo -n "." >&2
    done
    echo -e " ${RED}timeout${NC}" >&2
    return 1
}

# Get count of installed extensions (from @installed search)
# Usage: count=$(ui_get_installed_count [window])
ui_get_installed_count() {
    local window="${1:-$DEFAULT_WINDOW}"
    ui_search_installed "$window" > /dev/null 2>&1
    sleep 1
    ui_get_extension_count "$window"
}


# ============================================================================
# Extension Management Functions (API-based)
# ============================================================================

# List all installed extensions
# Usage: list_installed_extensions
list_installed_extensions() {
    curl -s "$TEST_SERVER/extensions" | jq .
}

# Get extension IDs only
# Usage: get_extension_ids
get_extension_ids() {
    curl -s "$TEST_SERVER/extensions" | jq -r '.extensions[].id'
}

# Search Open VSX marketplace
# Usage: search_marketplace "query" [limit]
search_marketplace() {
    local query="$1"
    local limit="${2:-20}"
    curl -s -X POST "$TEST_SERVER/extensions/search" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"$query\", \"limit\": $limit}"
}

# Install extension from Open VSX
# Usage: install_extension "publisher.name" [version]
install_extension() {
    local extension_id="$1"
    local version="${2:-}"

    local body="{\"extension_id\": \"$extension_id\""
    [ -n "$version" ] && body="$body, \"version\": \"$version\""
    body="$body}"

    echo -e "${CYAN}Installing extension: $extension_id${NC}" >&2
    curl -s -X POST "$TEST_SERVER/extensions/install" \
        -H "Content-Type: application/json" \
        -d "$body"
}

# Uninstall extension
# Usage: uninstall_extension "publisher.name"
uninstall_extension() {
    local extension_id="$1"
    local encoded_id=$(echo "$extension_id" | sed 's/\./%2E/g')
    echo -e "${CYAN}Uninstalling extension: $extension_id${NC}" >&2
    curl -s -X DELETE "$TEST_SERVER/extensions/$encoded_id"
}

# Get extension host status
# Usage: extension_host_status
extension_host_status() {
    curl -s "$TEST_SERVER/extensions/host/status"
}

# Restart extension host
# Usage: restart_extension_host
restart_extension_host() {
    echo -e "${CYAN}Restarting extension host...${NC}" >&2
    curl -s -X POST "$TEST_SERVER/extensions/host/restart"
}

# Check if extension is installed
# Usage: is_extension_installed "publisher.name"
is_extension_installed() {
    local extension_id="$1"
    curl -s "$TEST_SERVER/extensions" | jq -e ".extensions[] | select(.id == \"$extension_id\")" > /dev/null 2>&1
}

# Wait for extension to be installed
# Usage: wait_for_extension "publisher.name" [timeout_seconds]
wait_for_extension() {
    local extension_id="$1"
    local timeout="${2:-60}"
    local elapsed=0

    echo -n "Waiting for extension '$extension_id' to be installed..."
    while [ $elapsed -lt $timeout ]; do
        if is_extension_installed "$extension_id"; then
            echo -e " ${GREEN}installed${NC}"
            return 0
        fi
        sleep 1
        ((elapsed++))
        echo -n "."
    done
    echo -e " ${RED}timeout${NC}"
    return 1
}

# Get extension info
# Usage: get_extension_info "publisher.name"
get_extension_info() {
    local extension_id="$1"
    curl -s "$TEST_SERVER/extensions" | jq ".extensions[] | select(.id == \"$extension_id\")"
}

# ============================================================================
# Multi-Window Test Helpers
# ============================================================================

# Run a function on all windows
# Usage: for_each_window "test_js" "document.title"
for_each_window() {
    local fn="$1"
    shift
    local args=("$@")

    for label in $(get_window_labels); do
        echo -e "${CYAN}[$label]${NC}"
        "$fn" "${args[@]}" "$label"
    done
}

# Compare results between two windows
# Usage: compare_windows "main" "context-1" "test_js" "document.title"
compare_windows() {
    local window1="$1"
    local window2="$2"
    local fn="$3"
    shift 3
    local args=("$@")

    echo -e "${CYAN}Comparing $window1 vs $window2:${NC}"
    echo -e "  $window1: $("$fn" "${args[@]}" "$window1" | jq -c .)"
    echo -e "  $window2: $("$fn" "${args[@]}" "$window2" | jq -c .)"
}

# ============================================================================
# Test Runner
# ============================================================================

# Run a single test function
# Usage: run_test "test_function_name"
run_test() {
    local test_name="$1"
    echo -e "${BLUE}Running:${NC} $test_name"

    if type "$test_name" &>/dev/null; then
        "$test_name"
    else
        echo -e "  ${RED}✗${NC} Test function not found: $test_name"
        ((TESTS_FAILED++))
    fi
    echo ""
}

# Library function names to exclude from test runner
LIBRARY_TEST_FUNCTIONS="test_js test_query test_console test_errors test_network test_events test_health test_dom test_styles test_invoke test_clear"

# Run all test functions in the current script
# Usage: run_tests
run_tests() {
    local test_file="${BASH_SOURCE[1]:-unknown}"
    local test_name=$(basename "$test_file" .sh)

    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Test Suite: $test_name${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Find all functions starting with test_ that are not library functions
    local tests=$(declare -F | awk '{print $3}' | grep "^test_" | while read fn; do
        local skip=false
        for lib_fn in $LIBRARY_TEST_FUNCTIONS; do
            if [ "$fn" = "$lib_fn" ]; then
                skip=true
                break
            fi
        done
        if [ "$skip" = "false" ]; then
            echo "$fn"
        fi
    done)

    for test in $tests; do
        run_test "$test"
    done

    # Print summary
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "  ${GREEN}Passed:${NC}  $TESTS_PASSED"
    echo -e "  ${RED}Failed:${NC}  $TESTS_FAILED"
    echo -e "  ${YELLOW}Skipped:${NC} $TESTS_SKIPPED"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Output machine-readable counts for test runner to parse
    echo "TEST_RESULTS:passed=$TESTS_PASSED,failed=$TESTS_FAILED,skipped=$TESTS_SKIPPED"

    # Return non-zero if any tests failed
    [ $TESTS_FAILED -eq 0 ]
}

# Print test summary without running (useful for debugging)
# Usage: list_tests
list_tests() {
    echo "Available tests:"
    declare -F | awk '{print $3}' | grep "^test_" | while read fn; do
        local skip=false
        for lib_fn in $LIBRARY_TEST_FUNCTIONS; do
            if [ "$fn" = "$lib_fn" ]; then
                skip=true
                break
            fi
        done
        if [ "$skip" = "false" ]; then
            echo "  - $fn"
        fi
    done
}
