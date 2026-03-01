#!/bin/bash
# E2E Test: Extension Install Button Click
#
# This test reproduces the issue where clicking the Install button
# in the extension details tab (main content area) causes the left
# rail sidebar to go blank.
#
# Test Flow:
# 1. Open Extensions panel in sidebar
# 2. Search for "Python" extension
# 3. Click on a search result to open details tab
# 4. Capture sidebar state BEFORE clicking install
# 5. Click the Install button in the details tab
# 6. Capture sidebar state AFTER clicking install
# 7. Verify sidebar hasn't gone blank

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Helper Functions
# ============================================================================

# Capture the current state of the sidebar for debugging
capture_sidebar_state() {
    local label="$1"
    echo "  [$label] Capturing sidebar state..."

    local state=$(test_js "(function() {
        const sidebar = document.querySelector('.sidebar');
        const activitybar = document.querySelector('.activitybar');
        const extViewlet = document.querySelector('.extensions-viewlet');

        return {
            sidebarExists: !!sidebar,
            sidebarVisible: sidebar?.offsetParent !== null,
            sidebarWidth: sidebar?.offsetWidth || 0,
            sidebarHeight: sidebar?.offsetHeight || 0,
            sidebarInnerHTML: sidebar?.innerHTML?.substring(0, 500) || '',
            sidebarChildCount: sidebar?.childElementCount || 0,
            activitybarExists: !!activitybar,
            extensionsViewletExists: !!extViewlet,
            extensionsViewletVisible: extViewlet?.offsetParent !== null,
            extensionsViewletChildCount: extViewlet?.childElementCount || 0,
            hasContent: (sidebar?.textContent?.trim()?.length || 0) > 10
        };
    })()")

    echo "$state" | jq -r '.result'
}

# Get all visible elements in sidebar
get_sidebar_elements() {
    test_js "(function() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return { error: 'no sidebar' };

        const elements = [];
        sidebar.querySelectorAll('*').forEach((el, i) => {
            if (i < 50 && el.offsetParent !== null) {
                elements.push({
                    tag: el.tagName,
                    classes: el.className?.split?.(' ')?.slice(0, 3) || [],
                    text: el.textContent?.substring(0, 30) || ''
                });
            }
        });
        return { count: elements.length, elements: elements.slice(0, 20) };
    })()"
}

# Click an extension in the search results to open its details tab
click_extension_result() {
    local ext_name="$1"
    echo "  Clicking on extension: $ext_name..."

    test_js "(function() {
        const rows = Array.from(document.querySelectorAll('.extensions-viewlet .monaco-list-row'));
        for (const row of rows) {
            const name = row.querySelector('.name')?.textContent || '';
            if (name.toLowerCase().includes('${ext_name}'.toLowerCase())) {
                // Double-click to open details tab
                const event = new MouseEvent('dblclick', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                row.dispatchEvent(event);
                return 'clicked: ' + name;
            }
        }
        return 'not found';
    })()"
}

# Click Install button in the extension details tab (editor area)
click_install_in_details_tab() {
    echo "  Clicking Install button in details tab..."

    test_js "(function() {
        // Look for Install button in the editor area (extension details)
        const editorArea = document.querySelector('.editor-container, .editor-instance, .part.editor');
        if (!editorArea) return { error: 'no editor area' };

        // Find extension editor with install button
        const extEditor = document.querySelector('.extension-editor');
        if (!extEditor) return { error: 'no extension editor' };

        // Find the Install button
        const installBtn = extEditor.querySelector(
            '.monaco-button:not(.disabled)[title*=\"Install\"], ' +
            'button.install:not(.disabled), ' +
            '.extension-action.install:not(.disabled):not(.hide), ' +
            'a.monaco-button:not(.disabled)'
        );

        if (!installBtn) {
            // List all buttons for debugging
            const buttons = Array.from(extEditor.querySelectorAll('button, .monaco-button, a.action-label'));
            return {
                error: 'install button not found',
                availableButtons: buttons.map(b => ({
                    text: b.textContent?.trim(),
                    classes: b.className,
                    disabled: b.disabled || b.classList.contains('disabled')
                })).slice(0, 10)
            };
        }

        // Capture button info before clicking
        const btnInfo = {
            text: installBtn.textContent?.trim(),
            classes: installBtn.className,
            rect: installBtn.getBoundingClientRect()
        };

        // Click the button with proper mouse events
        const rect = installBtn.getBoundingClientRect();
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
            installBtn.dispatchEvent(event);
        });

        return { clicked: true, button: btnInfo };
    })()"
}

# Check if extension details tab is open
is_extension_tab_open() {
    test_js "(function() {
        const extEditor = document.querySelector('.extension-editor');
        if (!extEditor) return { open: false };

        const name = extEditor.querySelector('.name')?.textContent || '';
        const hasInstallBtn = !!extEditor.querySelector('.install, [title*=\"Install\"]');

        return {
            open: true,
            extensionName: name,
            hasInstallButton: hasInstallBtn
        };
    })()"
}

# Get console errors after action
get_recent_errors() {
    test_errors | jq '.entries[-10:]'
}

# ============================================================================
# Test Cases
# ============================================================================

test_01_open_extensions_panel() {
    echo "  Opening Extensions panel..."

    ui_open_extensions_panel > /dev/null 2>&1
    sleep 1

    local result=$(test_js "document.querySelector('.extensions-viewlet') ? 'open' : 'closed'")
    local status=$(echo "$result" | jq -r '.result')

    if [ "$status" = "open" ]; then
        echo -e "  ${GREEN}✓${NC} Extensions panel opened"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Extensions panel failed to open"
        ((TESTS_FAILED++))
        return 1
    fi
}

test_02_search_for_python() {
    echo "  Searching for Python extension..."

    ui_search_extension "Python" > /dev/null 2>&1
    sleep 2

    # Check if search results appeared
    local result=$(test_js "(function() {
        const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
        const names = Array.from(rows).map(r => r.querySelector('.name')?.textContent).filter(Boolean);
        return {
            count: rows.length,
            names: names.slice(0, 5)
        };
    })()")

    local count=$(echo "$result" | jq -r '.result.count // 0')

    if [ "$count" -gt 0 ]; then
        echo -e "  ${GREEN}✓${NC} Found $count search results"
        echo "    First results: $(echo "$result" | jq -r '.result.names | join(", ")')"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} No search results found"
        ((TESTS_FAILED++))
        return 1
    fi
}

test_03_capture_sidebar_before_install() {
    echo "  Capturing sidebar state BEFORE clicking install..."

    local state=$(capture_sidebar_state "BEFORE")
    echo "$state" | head -20

    # Store for comparison
    SIDEBAR_BEFORE_CHILD_COUNT=$(echo "$state" | jq -r '.sidebarChildCount // 0')
    SIDEBAR_BEFORE_HAS_CONTENT=$(echo "$state" | jq -r '.hasContent // false')

    if [ "$SIDEBAR_BEFORE_HAS_CONTENT" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Sidebar has content (children: $SIDEBAR_BEFORE_CHILD_COUNT)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Sidebar appears empty before test"
        ((TESTS_SKIPPED++))
    fi
}

test_04_open_extension_details_tab() {
    echo "  Opening extension details tab..."

    # Click on first Python result to open details
    local click_result=$(click_extension_result "Python")
    echo "    Click result: $(echo "$click_result" | jq -r '.result')"

    sleep 1.5

    # Check if details tab opened
    local tab_state=$(is_extension_tab_open)
    local is_open=$(echo "$tab_state" | jq -r '.result.open // false')
    local ext_name=$(echo "$tab_state" | jq -r '.result.extensionName // ""')

    if [ "$is_open" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Extension details tab opened for: $ext_name"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Extension details tab did not open"
        echo "    Tab state: $(echo "$tab_state" | jq -c '.result')"
        ((TESTS_FAILED++))
        return 1
    fi
}

test_05_click_install_and_verify_sidebar() {
    echo "  Clicking Install button and verifying sidebar..."

    # Capture sidebar state before click
    local before=$(capture_sidebar_state "BEFORE-INSTALL")
    local before_children=$(echo "$before" | jq -r '.sidebarChildCount // 0')
    local before_content=$(echo "$before" | jq -r '.hasContent // false')

    echo "    Sidebar before: children=$before_children, hasContent=$before_content"

    # Click the install button
    local install_result=$(click_install_in_details_tab)
    echo "    Install click result: $(echo "$install_result" | jq -c '.result' 2>/dev/null || echo "$install_result")"

    # Wait a moment for any state changes
    sleep 2

    # Capture sidebar state after click
    local after=$(capture_sidebar_state "AFTER-INSTALL")
    local after_children=$(echo "$after" | jq -r '.sidebarChildCount // 0')
    local after_content=$(echo "$after" | jq -r '.hasContent // false')
    local after_viewlet=$(echo "$after" | jq -r '.extensionsViewletExists // false')

    echo "    Sidebar after: children=$after_children, hasContent=$after_content, viewletExists=$after_viewlet"

    # Check for errors
    echo "    Checking for JavaScript errors..."
    local errors=$(get_recent_errors)
    local error_count=$(echo "$errors" | jq 'length')
    if [ "$error_count" -gt 0 ]; then
        echo -e "    ${YELLOW}Found $error_count recent errors:${NC}"
        echo "$errors" | jq -r '.[].message' | head -5
    fi

    # CRITICAL CHECK: Did the sidebar go blank?
    if [ "$after_content" = "false" ] && [ "$before_content" = "true" ]; then
        echo -e "  ${RED}✗${NC} REGRESSION: Sidebar went BLANK after clicking Install!"
        echo "    Before: children=$before_children, hasContent=$before_content"
        echo "    After:  children=$after_children, hasContent=$after_content"
        ((TESTS_FAILED++))
        return 1
    elif [ "$after_viewlet" = "false" ]; then
        echo -e "  ${RED}✗${NC} REGRESSION: Extensions viewlet disappeared!"
        ((TESTS_FAILED++))
        return 1
    elif [ "$after_children" -lt 1 ]; then
        echo -e "  ${RED}✗${NC} REGRESSION: Sidebar has no children after install click!"
        ((TESTS_FAILED++))
        return 1
    else
        echo -e "  ${GREEN}✓${NC} Sidebar maintained content after install click"
        ((TESTS_PASSED++))
    fi
}

test_06_sidebar_content_integrity() {
    echo "  Verifying sidebar content integrity..."

    local elements=$(get_sidebar_elements)
    local count=$(echo "$elements" | jq -r '.result.count // 0')

    if [ "$count" -gt 5 ]; then
        echo -e "  ${GREEN}✓${NC} Sidebar has $count visible elements"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Sidebar appears empty or damaged (only $count elements)"
        echo "    Elements: $(echo "$elements" | jq -c '.result.elements')"
        ((TESTS_FAILED++))
        return 1
    fi
}

test_07_extensions_viewlet_still_functional() {
    echo "  Verifying Extensions viewlet is still functional..."

    # Try to search again
    ui_search_extension "@installed" > /dev/null 2>&1
    sleep 1

    local result=$(test_js "(function() {
        const viewlet = document.querySelector('.extensions-viewlet');
        if (!viewlet) return { functional: false, reason: 'viewlet not found' };

        const searchBox = viewlet.querySelector('.suggest-input-container');
        const listContainer = viewlet.querySelector('.monaco-list, .extensions-list');

        return {
            functional: true,
            hasSearchBox: !!searchBox,
            hasListContainer: !!listContainer,
            viewletVisible: viewlet.offsetParent !== null
        };
    })()")

    local functional=$(echo "$result" | jq -r '.result.functional // false')

    if [ "$functional" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Extensions viewlet is still functional"
        echo "    Details: $(echo "$result" | jq -c '.result')"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Extensions viewlet is not functional!"
        echo "    Details: $(echo "$result" | jq -c '.result')"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Diagnostic Test: Capture Full State on Install Click
# ============================================================================

test_08_diagnostic_full_install_flow() {
    echo "  DIAGNOSTIC: Full install flow capture..."

    # Reset by opening extensions again
    ui_open_extensions_panel > /dev/null 2>&1
    sleep 1

    # Search for a different extension
    ui_search_extension "ESLint" > /dev/null 2>&1
    sleep 2

    echo "    Step 1: Capturing DOM state before any action"
    local dom_before=$(test_js "(function() {
        return {
            workbench: !!document.querySelector('.monaco-workbench'),
            sidebar: !!document.querySelector('.sidebar'),
            sidebarContent: document.querySelector('.sidebar')?.innerHTML?.length || 0,
            activitybar: !!document.querySelector('.activitybar'),
            extensionsViewlet: !!document.querySelector('.extensions-viewlet'),
            viewletContent: document.querySelector('.extensions-viewlet')?.innerHTML?.length || 0
        };
    })()")
    echo "    DOM before: $(echo "$dom_before" | jq -c '.result')"

    # Open details
    click_extension_result "ESLint" > /dev/null 2>&1
    sleep 1

    echo "    Step 2: After opening details tab"
    local dom_after_open=$(test_js "(function() {
        return {
            extensionEditor: !!document.querySelector('.extension-editor'),
            installButton: !!document.querySelector('.extension-editor .install, .extension-editor [title*=\"Install\"]'),
            sidebarContent: document.querySelector('.sidebar')?.innerHTML?.length || 0,
            viewletContent: document.querySelector('.extensions-viewlet')?.innerHTML?.length || 0
        };
    })()")
    echo "    DOM after open: $(echo "$dom_after_open" | jq -c '.result')"

    # Click install
    echo "    Step 3: Clicking install button..."
    click_install_in_details_tab > /dev/null 2>&1

    # Capture immediately after
    sleep 0.5
    local dom_after_click=$(test_js "(function() {
        return {
            sidebar: !!document.querySelector('.sidebar'),
            sidebarContent: document.querySelector('.sidebar')?.innerHTML?.length || 0,
            extensionsViewlet: !!document.querySelector('.extensions-viewlet'),
            viewletContent: document.querySelector('.extensions-viewlet')?.innerHTML?.length || 0,
            anyErrors: Array.from(document.querySelectorAll('.error, [class*=\"error\"]')).length
        };
    })()")
    echo "    DOM after click (0.5s): $(echo "$dom_after_click" | jq -c '.result')"

    # Capture after a delay
    sleep 2
    local dom_after_delay=$(test_js "(function() {
        return {
            sidebar: !!document.querySelector('.sidebar'),
            sidebarContent: document.querySelector('.sidebar')?.innerHTML?.length || 0,
            extensionsViewlet: !!document.querySelector('.extensions-viewlet'),
            viewletContent: document.querySelector('.extensions-viewlet')?.innerHTML?.length || 0,
            sidebarText: document.querySelector('.sidebar')?.textContent?.substring(0, 100) || 'EMPTY'
        };
    })()")
    echo "    DOM after click (2.5s): $(echo "$dom_after_delay" | jq -c '.result')"

    # Check if content was lost
    local before_len=$(echo "$dom_before" | jq -r '.result.sidebarContent // 0')
    local after_len=$(echo "$dom_after_delay" | jq -r '.result.sidebarContent // 0')

    if [ "$after_len" -lt 100 ] && [ "$before_len" -gt 100 ]; then
        echo -e "  ${RED}✗${NC} DIAGNOSTIC CONFIRMS: Sidebar content was lost!"
        echo "    Before: $before_len chars, After: $after_len chars"
        ((TESTS_FAILED++))
    else
        echo -e "  ${GREEN}✓${NC} Sidebar content maintained"
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
echo -e "${CYAN}  E2E TEST: Extension Install Button${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "This test verifies that clicking the Install button in the"
echo "extension details tab does NOT cause the sidebar to go blank."
echo ""

run_tests
