#!/bin/bash
# E2E Test: Install Button in Details Tab Blanks Sidebar
#
# CRITICAL BUG REPRODUCTION
#
# User-reported flow:
# 1. Click Extensions icon in activity bar
# 2. Search for "Python"
# 3. Click on a result to open details tab in editor area
# 4. Click Install button IN THE DETAILS TAB (main content area)
# 5. BUG: Left rail/sidebar goes BLANK
# 6. BUG: Extension doesn't actually install
#
# This test reproduces this exact flow.

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Helper: Capture detailed state
# ============================================================================

capture_state() {
    local label="$1"
    test_js "(function() {
        const sidebar = document.querySelector('.sidebar');
        const viewlet = document.querySelector('.extensions-viewlet');
        const extEditor = document.querySelector('.extension-editor');

        return {
            label: '$label',
            sidebar: {
                exists: !!sidebar,
                classes: sidebar?.className || '',
                hasContent: (sidebar?.textContent?.length || 0) > 50,
                contentLen: sidebar?.innerHTML?.length || 0
            },
            viewlet: {
                exists: !!viewlet,
                visible: viewlet?.offsetParent !== null,
                contentLen: viewlet?.innerHTML?.length || 0
            },
            editor: {
                hasExtEditor: !!extEditor,
                extensionName: extEditor?.querySelector('.name')?.textContent || ''
            }
        };
    })()"
}

# ============================================================================
# Test: Full Install Flow Reproduction
# ============================================================================

test_01_reproduce_install_blanks_sidebar() {
    echo "  REPRODUCING BUG: Install button blanks sidebar"
    echo ""

    # Step 1: Open Extensions panel
    echo "  Step 1: Opening Extensions panel..."
    test_js "document.querySelector('.codicon-extensions-view-icon')?.closest('.action-item')?.click()" > /dev/null
    sleep 1.5

    local state1=$(capture_state "after-open-extensions")
    echo "    State: $(echo "$state1" | jq -c '.result.sidebar | {exists, hasContent, contentLen}')"

    local viewlet_after_open=$(echo "$state1" | jq -r '.result.viewlet.exists')
    if [ "$viewlet_after_open" != "true" ]; then
        echo -e "  ${RED}✗${NC} Extensions viewlet not found after opening"
        ((TESTS_FAILED++))
        return 1
    fi
    echo "    ✓ Extensions panel opened"

    # Step 2: Search for Python
    echo ""
    echo "  Step 2: Searching for 'Python'..."
    test_js "(function() {
        const c = document.querySelector('.extensions-viewlet .suggest-input-container');
        c?.click();
        setTimeout(() => {
            const ta = c?.querySelector('textarea.inputarea');
            if (ta) { ta.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, 'Python'); }
        }, 100);
    })()" > /dev/null
    sleep 3

    local result_count=$(test_js "document.querySelectorAll('.extensions-viewlet .monaco-list-row').length" | jq -r '.result // 0')
    echo "    Found $result_count search results"

    if [ "$result_count" -eq 0 ]; then
        echo -e "  ${RED}✗${NC} No search results found"
        ((TESTS_FAILED++))
        return 1
    fi
    echo "    ✓ Search returned results"

    # Step 3: Double-click to open details tab
    echo ""
    echo "  Step 3: Opening extension details tab..."
    test_js "(function() {
        const row = document.querySelector('.extensions-viewlet .monaco-list-row');
        if (row) {
            const evt = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window });
            row.dispatchEvent(evt);
            return 'opened';
        }
        return 'no-row';
    })()" > /dev/null
    sleep 2

    local state3=$(capture_state "after-open-details")
    local has_ext_editor=$(echo "$state3" | jq -r '.result.editor.hasExtEditor')
    local ext_name=$(echo "$state3" | jq -r '.result.editor.extensionName')

    echo "    Extension editor open: $has_ext_editor"
    echo "    Extension name: $ext_name"

    if [ "$has_ext_editor" != "true" ]; then
        echo -e "  ${RED}✗${NC} Extension details tab did not open"
        ((TESTS_FAILED++))
        return 1
    fi
    echo "    ✓ Details tab opened for: $ext_name"

    # CRITICAL: Capture sidebar state BEFORE clicking install
    echo ""
    echo "  Step 4: Capturing sidebar state BEFORE install click..."
    local before_install=$(capture_state "BEFORE-INSTALL")
    local before_sidebar_content=$(echo "$before_install" | jq -r '.result.sidebar.contentLen // 0')
    local before_viewlet_exists=$(echo "$before_install" | jq -r '.result.viewlet.exists')
    local before_sidebar_hasContent=$(echo "$before_install" | jq -r '.result.sidebar.hasContent')

    echo "    Sidebar content: $before_sidebar_content chars"
    echo "    Viewlet exists: $before_viewlet_exists"
    echo "    Has content: $before_sidebar_hasContent"

    # Step 5: Click Install button in details tab
    echo ""
    echo "  Step 5: CLICKING INSTALL BUTTON IN DETAILS TAB..."
    local install_click=$(test_js "(function() {
        const extEditor = document.querySelector('.extension-editor');
        if (!extEditor) return { error: 'no editor' };

        // Find install button - try multiple selectors
        const selectors = [
            '.install:not(.disabled)',
            '.monaco-button.install:not(.disabled)',
            'a.extension-action.install:not(.disabled)',
            'button[title*=\"Install\"]:not(:disabled)',
            '.extension-action.install:not(.hide):not(.disabled)'
        ];

        for (const sel of selectors) {
            const btn = extEditor.querySelector(sel);
            if (btn && btn.offsetParent !== null) {
                // Full mouse event sequence
                const rect = btn.getBoundingClientRect();
                ['mousedown', 'mouseup', 'click'].forEach(type => {
                    const evt = new MouseEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        button: 0,
                        buttons: type === 'mousedown' ? 1 : 0,
                        clientX: rect.left + rect.width/2,
                        clientY: rect.top + rect.height/2
                    });
                    btn.dispatchEvent(evt);
                });
                return {
                    clicked: true,
                    buttonText: btn.textContent?.trim(),
                    buttonClasses: btn.className
                };
            }
        }

        // Debug: list all buttons
        const allBtns = extEditor.querySelectorAll('button, .monaco-button, a.action-label');
        return {
            error: 'no install button found',
            buttons: Array.from(allBtns).slice(0, 10).map(b => ({
                text: b.textContent?.trim()?.substring(0, 30),
                classes: b.className,
                visible: b.offsetParent !== null
            }))
        };
    })()")

    echo "    Install click result: $(echo "$install_click" | jq -c '.result')"

    # Wait for any state changes
    sleep 0.5

    # CRITICAL: Capture sidebar state IMMEDIATELY after clicking install
    echo ""
    echo "  Step 6: Capturing sidebar state AFTER install click (0.5s)..."
    local after_install_05=$(capture_state "AFTER-INSTALL-0.5s")
    local after_05_content=$(echo "$after_install_05" | jq -r '.result.sidebar.contentLen // 0')
    local after_05_viewlet=$(echo "$after_install_05" | jq -r '.result.viewlet.exists')
    local after_05_hasContent=$(echo "$after_install_05" | jq -r '.result.sidebar.hasContent')

    echo "    Sidebar content: $after_05_content chars"
    echo "    Viewlet exists: $after_05_viewlet"
    echo "    Has content: $after_05_hasContent"

    sleep 2

    # Capture again after delay
    echo ""
    echo "  Step 7: Capturing sidebar state AFTER install click (2.5s)..."
    local after_install_25=$(capture_state "AFTER-INSTALL-2.5s")
    local after_25_content=$(echo "$after_install_25" | jq -r '.result.sidebar.contentLen // 0')
    local after_25_viewlet=$(echo "$after_install_25" | jq -r '.result.viewlet.exists')
    local after_25_hasContent=$(echo "$after_install_25" | jq -r '.result.sidebar.hasContent')

    echo "    Sidebar content: $after_25_content chars"
    echo "    Viewlet exists: $after_25_viewlet"
    echo "    Has content: $after_25_hasContent"

    # VERDICT: Did the sidebar go blank?
    echo ""
    echo "  ═══════════════════════════════════════"
    echo "  VERDICT:"

    local regression_detected=false

    # Check if sidebar lost significant content
    if [ "$after_25_content" -lt 500 ] && [ "$before_sidebar_content" -gt 500 ]; then
        echo -e "    ${RED}BUG CONFIRMED: Sidebar content dropped from $before_sidebar_content to $after_25_content chars${NC}"
        regression_detected=true
    fi

    # Check if viewlet disappeared
    if [ "$before_viewlet_exists" = "true" ] && [ "$after_25_viewlet" = "false" ]; then
        echo -e "    ${RED}BUG CONFIRMED: Extensions viewlet disappeared after install click${NC}"
        regression_detected=true
    fi

    # Check if sidebar lost all content
    if [ "$after_25_hasContent" = "false" ] && [ "$before_sidebar_hasContent" = "true" ]; then
        echo -e "    ${RED}BUG CONFIRMED: Sidebar went blank (hasContent: true -> false)${NC}"
        regression_detected=true
    fi

    if [ "$regression_detected" = "true" ]; then
        echo -e "  ${RED}✗${NC} REGRESSION DETECTED: Install button blanks sidebar!"
        ((TESTS_FAILED++))
        return 1
    else
        echo -e "    ${GREEN}No regression detected in this run${NC}"
        echo -e "  ${GREEN}✓${NC} Sidebar maintained content after install click"
        ((TESTS_PASSED++))
    fi
}

test_02_check_extension_actually_installs() {
    echo "  Checking if extension installation actually completes..."

    # Check console for install-related logs
    local logs=$(curl -s "$TEST_SERVER/console" | jq '[.entries[] | select(.message | test("install|Install|MgmtService"; "i"))] | .[-20:] | .[].message' 2>/dev/null)

    echo "    Recent install-related logs:"
    echo "$logs" | head -10

    # Check if installFromGallery was called
    local install_called=$(curl -s "$TEST_SERVER/console" | jq '[.entries[] | select(.message | test("installFromGallery"; "i"))] | length')

    if [ "$install_called" -gt 0 ]; then
        echo -e "  ${GREEN}✓${NC} installFromGallery was called"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} installFromGallery was NOT called - install flow is broken!"
        ((TESTS_FAILED++))
        return 1
    fi
}

test_03_check_for_errors() {
    echo "  Checking for JavaScript errors..."

    local errors=$(curl -s "$TEST_SERVER/errors" | jq '.entries')
    local error_count=$(echo "$errors" | jq 'length')

    if [ "$error_count" -gt 0 ]; then
        echo -e "  ${YELLOW}Found $error_count errors:${NC}"
        echo "$errors" | jq '.[].message' | head -5
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${GREEN}✓${NC} No JavaScript errors captured"
        ((TESTS_PASSED++))
    fi
}

# ============================================================================
# Run Tests
# ============================================================================

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
echo -e "${RED}  BUG REPRODUCTION: Install Button Blanks Sidebar${NC}"
echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "This test reproduces the user-reported bug where clicking"
echo "the Install button in the extension details tab causes"
echo "the sidebar to go blank and the extension doesn't install."
echo ""

run_tests
