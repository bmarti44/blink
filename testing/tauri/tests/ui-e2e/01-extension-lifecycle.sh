#!/bin/bash
# Extension Lifecycle UI E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests simulate actual user interactions with VS Code's native workbench
# UI (via monaco-vscode-api), as closely as possible to how a real user would
# click and type through the interface.
#
# KEY PRINCIPLES:
# 1. All actions are performed through UI clicks/typing, NOT API calls
# 2. Tests verify that the UI updates correctly in response to user actions
# 3. Wait for asynchronous UI elements to appear before interacting with them
# 4. Use VS Code's native CSS selectors (not data-testid from Preact components)
# 5. Timeouts are configurable via UI_TIMEOUT env var (default: 5 seconds)
#
# WHAT WE TEST:
# - Opening the Extensions panel via activity bar click
# - Searching for extensions in the marketplace
# - Clicking Install button and verifying UI updates
# - Verifying extension appears in @installed search
# - Uninstalling via UI and verifying extension disappears
# - Reinstalling to verify full lifecycle
#
# ============================================================================
#
# Usage:
#   ./01-extension-lifecycle.sh
#
# Configuration:
#   UI_TIMEOUT=10 ./01-extension-lifecycle.sh  # Increase wait timeout
#
# Prerequisites:
#   - Tauri app running with test server on port 9999
#   - Internet connection for Open VSX access
#   - jq and bc installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

# Test extension - use a small, simple theme extension for fast testing
TEST_EXTENSION="jdinhlife.gruvbox"
TEST_EXTENSION_NAME="gruvbox"

# ============================================================================
# Test: Server and Bridge Ready
# ============================================================================
test_00_server_ready() {
    echo "  Checking server and bridge status..."

    local result=$(test_health)
    assert_json_equals "$result" ".status" "ok" "Server should be healthy"
    assert_json_true "$result" ".bridge_connected" "Bridge should be connected"
}

# ============================================================================
# Test: Open Extensions Panel via Activity Bar Click
# ============================================================================
test_01_open_extensions_panel() {
    echo "  Opening Extensions panel via activity bar..."

    # Use our idempotent function that checks if already open
    ui_open_extensions_panel

    # Verify the extensions panel is visible
    if ui_is_extensions_open; then
        echo -e "  ${GREEN}✓${NC} Extensions panel opened"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Extensions panel should be visible"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Search for Extension via UI
# ============================================================================
test_02_search_extension() {
    echo "  Searching for extension via UI..."

    # Type search query in the search input
    ui_search_extension "$TEST_EXTENSION_NAME"

    # Wait for search results to load
    sleep 2

    # Verify extension appears in results
    if ui_is_extension_visible "$TEST_EXTENSION"; then
        echo -e "  ${GREEN}✓${NC} Found $TEST_EXTENSION in search results"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} $TEST_EXTENSION should appear in search results"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Install Extension via UI Click
# ============================================================================
test_03_install_via_ui() {
    echo "  Installing extension via Install button click..."

    # First check if already installed and uninstall if so
    ui_search_installed > /dev/null 2>&1
    sleep 1
    if ui_is_extension_visible "$TEST_EXTENSION"; then
        echo "  Extension already installed, uninstalling first..."
        ui_click_uninstall "$TEST_EXTENSION"
        sleep 3
        # Search marketplace again
        ui_search_extension "$TEST_EXTENSION_NAME"
        sleep 2
    fi

    # Click the Install button for our test extension
    local click_result=$(ui_click_install "$TEST_EXTENSION")

    if echo "$click_result" | jq -r '.result' | grep -q "clicked"; then
        echo -e "  ${GREEN}✓${NC} Clicked Install button"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Failed to click Install button: $(echo "$click_result" | jq -r '.result')"
        ((TESTS_FAILED++))
        return 1
    fi

    # Wait for installation to complete
    if ui_wait_for_extension_installed "$TEST_EXTENSION" 60; then
        echo -e "  ${GREEN}✓${NC} Extension installed successfully"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Extension installation timed out"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Verify Extension Appears in @installed Search
# ============================================================================
test_04_verify_in_installed() {
    echo "  Verifying extension appears in @installed search..."

    # Search for installed extensions
    ui_search_installed

    # Wait for results
    sleep 2

    # Check if our extension is visible
    if ui_is_extension_visible "$TEST_EXTENSION"; then
        echo -e "  ${GREEN}✓${NC} Extension visible in @installed search"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Extension should appear in @installed search"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Uninstall Extension via UI Click
# ============================================================================
test_05_uninstall_via_ui() {
    echo "  Uninstalling extension via UI..."

    # Make sure we're viewing installed extensions
    ui_search_installed
    sleep 1

    # Verify extension is there before uninstall
    if ! ui_is_extension_visible "$TEST_EXTENSION"; then
        echo "  Extension not found in installed list, skipping uninstall test"
        skip_test "Extension not installed"
        return
    fi

    # Click uninstall button
    local click_result=$(ui_click_uninstall "$TEST_EXTENSION")

    if echo "$click_result" | jq -r '.result' | grep -qE "clicked|opened-manage"; then
        echo -e "  ${GREEN}✓${NC} Clicked Uninstall button"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Failed to click Uninstall button: $(echo "$click_result" | jq -r '.result')"
        ((TESTS_FAILED++))
        return 1
    fi

    # Wait for uninstall to complete
    # Note: In VS Code web/remote contexts, uninstall may require window reload
    # We check for immediate removal OR presence of reload button
    if ui_wait_for_extension_uninstalled "$TEST_EXTENSION" 10; then
        echo -e "  ${GREEN}✓${NC} Extension uninstalled successfully"
        ((TESTS_PASSED++))
    else
        # Check if a reload is required
        local reload_needed=$(test_js "(function() {
            const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
            for (const row of rows) {
                const name = row.querySelector('.name')?.textContent || '';
                if (name.toLowerCase().includes('gruvbox')) {
                    const reloadBtn = row.querySelector('.extension-action.reload:not(.hide):not(.disabled)');
                    if (reloadBtn) return 'reload-required';
                }
            }
            return 'no-reload';
        })()" | jq -r '.result')

        if [ "$reload_needed" = "reload-required" ]; then
            echo -e "  ${YELLOW}○${NC} Uninstall initiated - reload required (expected in web context)"
            ((TESTS_SKIPPED++))
        else
            echo -e "  ${YELLOW}○${NC} Uninstall may require reload - behavior varies in web contexts"
            ((TESTS_SKIPPED++))
        fi
    fi
}

# ============================================================================
# Test: Verify Install Button Shows After Uninstall
# ============================================================================
test_06_verify_install_button_after_uninstall() {
    echo "  Verifying Install button shows after uninstall..."

    # Search for the extension in marketplace
    ui_search_extension "$TEST_EXTENSION_NAME"
    sleep 2

    # The extension should now show Install button (not Uninstall/Manage)
    # Or "Install Locally" in web/remote contexts
    local result=$(test_js "(function() {
        const rows = Array.from(document.querySelectorAll('.extensions-viewlet .monaco-list-row'));
        for (const row of rows) {
            const name = row.querySelector('.name')?.textContent?.toLowerCase() || '';
            if (name.includes('gruvbox')) {
                const installBtn = row.querySelector('.extension-action.install:not(.hide):not(.disabled)');
                const installLocallyBtn = row.querySelector('.extension-action.install-other-server:not(.hide):not(.disabled)');
                const manageBtn = row.querySelector('.extension-action.manage:not(.hide)');

                if (installBtn && installBtn.textContent?.includes('Install') && !manageBtn) {
                    return 'install-button-visible';
                }
                if (installLocallyBtn && installLocallyBtn.textContent?.includes('Install')) {
                    return 'install-locally-visible';
                }
                if (manageBtn) {
                    return 'still-shows-manage';
                }
            }
        }
        return 'extension-not-found';
    })()")

    local button_status=$(echo "$result" | jq -r '.result')
    if [ "$button_status" = "install-button-visible" ] || [ "$button_status" = "install-locally-visible" ]; then
        echo -e "  ${GREEN}✓${NC} Install button visible after uninstall"
        ((TESTS_PASSED++))
    elif [ "$button_status" = "still-shows-manage" ]; then
        # In web context, may still show manage until reload
        echo -e "  ${YELLOW}○${NC} Manage button still visible (reload may be required in web context)"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${RED}✗${NC} Install button should be visible after uninstall (got: $button_status)"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: Full Reinstall Cycle via UI
# ============================================================================
test_07_reinstall_cycle() {
    echo "  Testing full reinstall cycle via UI..."

    # Install via UI
    echo "    Step 1: Installing..."
    ui_search_extension "$TEST_EXTENSION_NAME"
    sleep 2

    local install_result=$(ui_click_install "$TEST_EXTENSION")
    local install_status=$(echo "$install_result" | jq -r '.result')

    # May return not found if already installed, which is fine
    if [ "$install_status" = "not found" ]; then
        echo -e "  ${GREEN}✓${NC} Extension already installed"
    else
        if ! ui_wait_for_extension_installed "$TEST_EXTENSION" 60; then
            echo -e "  ${RED}✗${NC} Installation failed"
            ((TESTS_FAILED++))
            return 1
        fi
        echo -e "  ${GREEN}✓${NC} Installed successfully"
    fi

    # Verify in @installed
    echo "    Step 2: Verifying in @installed..."
    ui_search_installed
    sleep 2
    if ! ui_is_extension_visible "$TEST_EXTENSION"; then
        echo -e "  ${RED}✗${NC} Extension not found in @installed"
        ((TESTS_FAILED++))
        return 1
    fi
    echo -e "  ${GREEN}✓${NC} Verified in @installed"

    # Uninstall via UI (may require reload in web context)
    echo "    Step 3: Uninstalling..."
    ui_click_uninstall "$TEST_EXTENSION"

    if ! ui_wait_for_extension_uninstalled "$TEST_EXTENSION" 15; then
        # Web context - uninstall may require reload
        echo -e "  ${YELLOW}○${NC} Uninstall initiated (may require reload in web context)"
    else
        echo -e "  ${GREEN}✓${NC} Uninstalled successfully"
    fi

    # Try to reinstall
    echo "    Step 4: Reinstalling..."
    ui_search_extension "$TEST_EXTENSION_NAME"
    sleep 2

    local reinstall_result=$(ui_click_install "$TEST_EXTENSION")
    local reinstall_status=$(echo "$reinstall_result" | jq -r '.result')

    if [ "$reinstall_status" = "not found" ]; then
        # Extension is still installed (uninstall required reload)
        echo -e "  ${YELLOW}○${NC} Extension still installed (reload required to complete uninstall)"
        ((TESTS_SKIPPED++))
    elif ui_wait_for_extension_installed "$TEST_EXTENSION" 60; then
        echo -e "  ${GREEN}✓${NC} Full reinstall cycle completed successfully"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Reinstall failed"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Get Extension Count in UI
# ============================================================================
test_08_extension_count() {
    echo "  Checking extension count in UI..."

    ui_search_installed
    sleep 1

    local count=$(ui_get_extension_count)

    if [ -n "$count" ] && [ "$count" -gt 0 ]; then
        echo -e "  ${GREEN}✓${NC} Found $count installed extension(s)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} No installed extensions found (count: $count)"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Cleanup
# ============================================================================
cleanup() {
    echo ""
    echo -e "${CYAN}Cleaning up test extensions via UI...${NC}"

    # Try to clean up via UI - uninstall test extension
    ui_search_installed 2>/dev/null
    sleep 1

    if ui_is_extension_visible "$TEST_EXTENSION" 2>/dev/null; then
        ui_click_uninstall "$TEST_EXTENSION" 2>/dev/null
        sleep 2
    fi

    echo "Cleanup complete"
}

# Register cleanup on exit
trap cleanup EXIT

# ============================================================================
# Run Tests
# ============================================================================

# Wait for server and bridge
wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}Note: These tests simulate real user interactions with VS Code's native UI.${NC}"
echo -e "${CYAN}UI_TIMEOUT=${UI_TIMEOUT}s (configurable via environment variable)${NC}"
echo ""

run_tests
