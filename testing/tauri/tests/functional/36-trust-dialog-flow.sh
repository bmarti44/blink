#!/bin/bash
# E2E Test: Trust Publisher Dialog Flow
#
# This test specifically captures what happens when the Trust Publisher dialog
# is shown and clicked during extension installation.

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Helper: Capture detailed state including dialogs
# ============================================================================

capture_full_state() {
    local label="$1"
    test_js "(function() {
        const sidebar = document.querySelector('.sidebar');
        const viewlet = document.querySelector('.extensions-viewlet');
        const extEditor = document.querySelector('.extension-editor');

        // Check for dialogs
        const dialogShadow = document.querySelector('.dialog-shadow');
        const monacoDialog = document.querySelector('.monaco-dialog-box');
        const quickInput = document.querySelector('.quick-input-widget:not(.hidden)');

        // Look for trust-related buttons
        const allButtons = Array.from(document.querySelectorAll('button, .monaco-button')).slice(0, 20);
        const trustButtons = allButtons.filter(b => {
            const text = b.textContent?.toLowerCase() || '';
            return text.includes('trust') || text.includes('install');
        });

        return {
            label: '$label',
            sidebar: {
                exists: !!sidebar,
                hasContent: (sidebar?.textContent?.length || 0) > 50,
                contentLen: sidebar?.innerHTML?.length || 0,
                classes: sidebar?.className || ''
            },
            viewlet: {
                exists: !!viewlet,
                visible: viewlet?.offsetParent !== null,
                contentLen: viewlet?.innerHTML?.length || 0
            },
            editor: {
                hasExtEditor: !!extEditor,
                extensionName: extEditor?.querySelector('.name')?.textContent || ''
            },
            dialogs: {
                hasShadow: !!dialogShadow,
                hasMonacoDialog: !!monacoDialog,
                hasQuickInput: !!quickInput,
                quickInputVisible: quickInput?.style?.display !== 'none'
            },
            trustButtons: trustButtons.map(b => ({
                text: b.textContent?.trim()?.substring(0, 50),
                classes: b.className,
                visible: b.offsetParent !== null
            }))
        };
    })()"
}

# ============================================================================
# Test: Capture Install and Trust Dialog Flow
# ============================================================================

test_01_capture_install_trust_flow() {
    echo "  CAPTURING: Full Install + Trust Dialog Flow"
    echo ""

    # Clear console for fresh logs
    curl -s -X DELETE "$TEST_SERVER/console" > /dev/null 2>&1
    curl -s -X DELETE "$TEST_SERVER/errors" > /dev/null 2>&1

    # Step 1: Open Extensions panel
    echo "  Step 1: Opening Extensions panel..."
    test_js "document.querySelector('.codicon-extensions-view-icon')?.closest('.action-item')?.click()" > /dev/null
    sleep 1.5

    local state1=$(capture_full_state "after-open")
    echo "    State: $(echo "$state1" | jq -c '.result.viewlet | {exists, contentLen}')"

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

    # Step 3: Open extension details
    echo ""
    echo "  Step 3: Opening extension details..."
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

    local state3=$(capture_full_state "after-details-open")
    echo "    Editor open: $(echo "$state3" | jq -r '.result.editor.hasExtEditor')"
    echo "    Extension: $(echo "$state3" | jq -r '.result.editor.extensionName')"

    # CRITICAL: Capture state BEFORE install click
    echo ""
    echo "  Step 4: State BEFORE clicking Install..."
    local before_install=$(capture_full_state "BEFORE-INSTALL")
    local before_sidebar=$(echo "$before_install" | jq -r '.result.sidebar.contentLen // 0')
    local before_viewlet=$(echo "$before_install" | jq -r '.result.viewlet.exists')
    echo "    Sidebar content: $before_sidebar chars"
    echo "    Viewlet exists: $before_viewlet"
    echo "    Dialogs: $(echo "$before_install" | jq -c '.result.dialogs')"

    # Step 5: Click Install button in details tab
    echo ""
    echo "  Step 5: CLICKING INSTALL BUTTON..."
    local install_click=$(test_js "(function() {
        const extEditor = document.querySelector('.extension-editor');
        if (!extEditor) return { error: 'no editor' };

        const selectors = [
            '.install:not(.disabled)',
            '.monaco-button.install:not(.disabled)',
            'a.extension-action.install:not(.disabled)',
            '.extension-action.install:not(.hide):not(.disabled)'
        ];

        for (const sel of selectors) {
            const btn = extEditor.querySelector(sel);
            if (btn && btn.offsetParent !== null) {
                btn.click();
                return { clicked: true, buttonText: btn.textContent?.trim() };
            }
        }
        return { error: 'no install button' };
    })()")

    echo "    Click result: $(echo "$install_click" | jq -c '.result')"

    # Step 6: Check for Trust dialog IMMEDIATELY
    sleep 0.3
    echo ""
    echo "  Step 6: Checking for Trust dialog (0.3s)..."
    local state6=$(capture_full_state "after-install-click-0.3s")
    echo "    Dialogs: $(echo "$state6" | jq -c '.result.dialogs')"
    echo "    Trust buttons: $(echo "$state6" | jq -c '.result.trustButtons')"
    echo "    Sidebar: $(echo "$state6" | jq -c '.result.sidebar | {exists, hasContent, contentLen}')"

    # Step 7: Wait a bit more and check again
    sleep 1
    echo ""
    echo "  Step 7: State after 1.3s total..."
    local state7=$(capture_full_state "after-install-click-1.3s")
    echo "    Dialogs: $(echo "$state7" | jq -c '.result.dialogs')"
    echo "    Trust buttons: $(echo "$state7" | jq -c '.result.trustButtons')"
    echo "    Sidebar content: $(echo "$state7" | jq -r '.result.sidebar.contentLen // 0') chars"
    echo "    Viewlet exists: $(echo "$state7" | jq -r '.result.viewlet.exists')"

    # Step 8: Try to click Trust & Install button if visible
    echo ""
    echo "  Step 8: Attempting to click Trust & Install button..."
    local trust_click=$(ui_click_trust_publisher)
    echo "    Trust click result: $(echo "$trust_click" | jq -r '.result')"

    # Step 9: Wait and capture final state
    sleep 2
    echo ""
    echo "  Step 9: Final state (3.3s total)..."
    local final_state=$(capture_full_state "FINAL")
    local final_sidebar=$(echo "$final_state" | jq -r '.result.sidebar.contentLen // 0')
    local final_viewlet=$(echo "$final_state" | jq -r '.result.viewlet.exists')
    local final_hasContent=$(echo "$final_state" | jq -r '.result.sidebar.hasContent')

    echo "    Sidebar content: $final_sidebar chars"
    echo "    Viewlet exists: $final_viewlet"
    echo "    Has content: $final_hasContent"
    echo "    Dialogs: $(echo "$final_state" | jq -c '.result.dialogs')"

    # VERDICT
    echo ""
    echo "  ═══════════════════════════════════════"
    echo "  ANALYSIS:"

    if [ "$final_sidebar" -lt 500 ] && [ "$before_sidebar" -gt 500 ]; then
        echo -e "    ${RED}SIDEBAR CONTENT DROPPED: $before_sidebar -> $final_sidebar chars${NC}"
    fi

    if [ "$before_viewlet" = "true" ] && [ "$final_viewlet" = "false" ]; then
        echo -e "    ${RED}VIEWLET DISAPPEARED after install flow${NC}"
    fi

    if [ "$final_hasContent" = "false" ]; then
        echo -e "    ${RED}SIDEBAR IS BLANK (hasContent = false)${NC}"
    fi

    echo ""
    echo "  Diagnostic passed."
    ((TESTS_PASSED++))
}

test_02_capture_console_during_install() {
    echo "  Checking console logs for install-related messages..."

    # Get recent console entries
    local logs=$(curl -s "$TEST_SERVER/console" | jq '[.entries[] | select(.message | test("install|Install|Trust|trust|MgmtService|ExtOverride|gallery|Gallery"; "i"))] | .[-30:]')

    local count=$(echo "$logs" | jq 'length')
    echo "    Found $count install-related log entries"

    if [ "$count" -gt 0 ]; then
        echo ""
        echo "    Recent install-related logs:"
        echo "$logs" | jq -r '.[].message' | while read -r line; do
            echo "      $line" | head -c 120
            echo ""
        done | head -30
    fi

    ((TESTS_PASSED++))
}

test_03_capture_errors() {
    echo "  Checking for JavaScript errors..."

    local errors=$(curl -s "$TEST_SERVER/errors" | jq '.entries')
    local error_count=$(echo "$errors" | jq 'length')

    if [ "$error_count" -gt 0 ]; then
        echo -e "    ${RED}Found $error_count errors:${NC}"
        echo "$errors" | jq -r '.[].message' | while read -r line; do
            echo "      $line" | head -c 150
            echo ""
        done | head -10
        ((TESTS_SKIPPED++))
    else
        echo -e "    ${GREEN}No JavaScript errors captured${NC}"
        ((TESTS_PASSED++))
    fi
}

# ============================================================================
# Run Tests
# ============================================================================

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  DIAGNOSTIC: Trust Publisher Dialog Flow${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "This test captures the full state during the install flow"
echo "to diagnose why the sidebar goes blank."
echo ""

run_tests
