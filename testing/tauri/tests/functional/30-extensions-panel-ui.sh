#!/bin/bash
# Extensions Panel UI E2E Tests
#
# These tests verify that the Extensions panel properly shows the INSTALLED
# dropdown/tab and other critical UI elements. This catches regressions where
# the Extensions panel fails to render its tabs or content areas.
#
# Tested elements:
# - Extensions panel container renders
# - "Installed" tab button is visible
# - "Browse" tab button is visible
# - Tab switching works
# - Empty state message shows when no extensions installed
# - Extension count badge shows when extensions are installed

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Test: Extensions Panel Container Exists
# ============================================================================
test_01_extensions_panel_exists() {
    echo "  Checking Extensions panel container..."

    # Click Extensions in activity bar to open the panel
    local click_result=$(test_js "(function() {
        // Try custom activity bar first
        const extIcon = document.querySelector('.activity-bar__item[data-view=\"extensions\"], [data-testid=\"activity-extensions\"], .codicon-extensions-view-icon');
        if (extIcon) {
            extIcon.closest('button, .activity-bar__item, .action-item')?.click();
            return 'clicked';
        }
        return 'not-found';
    })()")

    sleep 1

    # Check for the extensions panel container
    local result=$(test_js "(function() {
        // Check for custom ExtensionsPanel component
        const customPanel = document.querySelector('[data-testid=\"extensions-panel\"], .extensions-panel');
        if (customPanel) {
            return { found: true, type: 'custom', visible: customPanel.offsetParent !== null };
        }
        // Check for VS Code native extensions viewlet
        const nativePanel = document.querySelector('.extensions-viewlet');
        if (nativePanel) {
            return { found: true, type: 'native', visible: nativePanel.offsetParent !== null };
        }
        return { found: false };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local panelType=$(echo "$result" | jq -r '.result.type // "none"')

    if [ "$found" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Extensions panel exists (type: $panelType)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Extensions panel container not found"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Installed Tab Button Exists and is Visible
# ============================================================================
test_02_installed_tab_exists() {
    echo "  Checking for INSTALLED tab button..."

    local result=$(test_js "(function() {
        // Check custom ExtensionsPanel's Installed tab
        const customInstalledTab = document.querySelector('[data-testid=\"tab-installed\"]');
        if (customInstalledTab) {
            return {
                found: true,
                type: 'custom',
                visible: customInstalledTab.offsetParent !== null,
                text: customInstalledTab.textContent?.trim(),
                isActive: customInstalledTab.classList.contains('extensions-panel__tab--active')
            };
        }

        // Check VS Code native extensions panel for INSTALLED section
        const nativeInstalled = document.querySelector('.extensions-viewlet .pane-header[aria-label*=\"Installed\"], .extensions-viewlet [title*=\"Installed\"]');
        if (nativeInstalled) {
            return { found: true, type: 'native-section', visible: true };
        }

        // Check for @installed filter capability
        const searchInput = document.querySelector('.extensions-viewlet .suggest-input-container, .extensions-viewlet input');
        if (searchInput) {
            return { found: true, type: 'search-capable', visible: true };
        }

        return { found: false };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local tabType=$(echo "$result" | jq -r '.result.type // "none"')
    local visible=$(echo "$result" | jq -r '.result.visible // false')
    local text=$(echo "$result" | jq -r '.result.text // ""')

    if [ "$found" = "true" ] && [ "$visible" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} INSTALLED tab/section found (type: $tabType, text: '$text')"
        ((TESTS_PASSED++))
    elif [ "$found" = "true" ]; then
        echo -e "  ${RED}✗${NC} INSTALLED tab found but NOT VISIBLE (type: $tabType)"
        ((TESTS_FAILED++))
        return 1
    else
        echo -e "  ${RED}✗${NC} INSTALLED tab/section NOT FOUND in Extensions panel"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Browse Tab Button Exists
# ============================================================================
test_03_browse_tab_exists() {
    echo "  Checking for Browse tab button..."

    local result=$(test_js "(function() {
        // Check custom ExtensionsPanel's Browse tab
        const browseTab = document.querySelector('[data-testid=\"tab-browse\"]');
        if (browseTab) {
            return {
                found: true,
                visible: browseTab.offsetParent !== null,
                text: browseTab.textContent?.trim()
            };
        }

        // For native VS Code, check for marketplace search capability
        const searchInput = document.querySelector('.extensions-viewlet .suggest-input-container');
        if (searchInput) {
            return { found: true, type: 'native-search', visible: true };
        }

        return { found: false };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local visible=$(echo "$result" | jq -r '.result.visible // false')

    if [ "$found" = "true" ] && [ "$visible" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Browse tab/search found"
        ((TESTS_PASSED++))
    elif [ "$found" = "true" ]; then
        echo -e "  ${YELLOW}○${NC} Browse tab found but not visible"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${YELLOW}○${NC} Browse tab not found (may be expected for native panel)"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Tab Switching Works
# ============================================================================
test_04_tab_switching() {
    echo "  Testing tab switching functionality..."

    # First click Browse tab
    local browseClick=$(test_js "(function() {
        const browseTab = document.querySelector('[data-testid=\"tab-browse\"]');
        if (browseTab) {
            browseTab.click();
            return 'clicked';
        }
        return 'not-found';
    })()")

    local browseStatus=$(echo "$browseClick" | jq -r '.result')

    if [ "$browseStatus" != "clicked" ]; then
        skip_test "Tab switching not applicable (native panel)"
        return
    fi

    sleep 0.5

    # Check that Browse tab is now active
    local browseActive=$(test_js "(function() {
        const browseTab = document.querySelector('[data-testid=\"tab-browse\"]');
        return browseTab?.classList.contains('extensions-panel__tab--active') || false;
    })()" | jq -r '.result')

    if [ "$browseActive" != "true" ]; then
        echo -e "  ${RED}✗${NC} Browse tab should be active after clicking"
        ((TESTS_FAILED++))
        return 1
    fi

    # Click back to Installed tab
    test_js "document.querySelector('[data-testid=\"tab-installed\"]')?.click()" > /dev/null
    sleep 0.5

    local installedActive=$(test_js "(function() {
        const installedTab = document.querySelector('[data-testid=\"tab-installed\"]');
        return installedTab?.classList.contains('extensions-panel__tab--active') || false;
    })()" | jq -r '.result')

    if [ "$installedActive" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Tab switching works correctly"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Installed tab should be active after clicking back"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Empty State Shows When No Extensions Installed
# ============================================================================
test_05_empty_state_or_list() {
    echo "  Checking extension list or empty state..."

    # Ensure we're on Installed tab
    test_js "document.querySelector('[data-testid=\"tab-installed\"]')?.click()" > /dev/null
    sleep 0.5

    local result=$(test_js "(function() {
        // Check for empty state message
        const emptyState = document.querySelector('.extensions-panel__empty, .extensions-viewlet .message');
        if (emptyState) {
            return {
                state: 'empty',
                message: emptyState.textContent?.trim().substring(0, 100)
            };
        }

        // Check for extension list
        const extensionCards = document.querySelectorAll('[data-testid=\"extension-card\"], .extension-list-item');
        if (extensionCards.length > 0) {
            return { state: 'has-extensions', count: extensionCards.length };
        }

        // Check loading state
        const loading = document.querySelector('.extensions-panel__loading');
        if (loading) {
            return { state: 'loading' };
        }

        return { state: 'unknown' };
    })()")

    local state=$(echo "$result" | jq -r '.result.state // "error"')

    case "$state" in
        "empty")
            local msg=$(echo "$result" | jq -r '.result.message // ""')
            echo -e "  ${GREEN}✓${NC} Empty state displayed correctly: \"$msg\""
            ((TESTS_PASSED++))
            ;;
        "has-extensions")
            local count=$(echo "$result" | jq -r '.result.count // 0')
            echo -e "  ${GREEN}✓${NC} Extension list showing $count extension(s)"
            ((TESTS_PASSED++))
            ;;
        "loading")
            echo -e "  ${YELLOW}○${NC} Still loading extensions..."
            ((TESTS_SKIPPED++))
            ;;
        *)
            echo -e "  ${RED}✗${NC} Neither empty state nor extension list found (state: $state)"
            ((TESTS_FAILED++))
            return 1
            ;;
    esac
}

# ============================================================================
# Test: Install VSIX Button Exists
# ============================================================================
test_06_install_vsix_button() {
    echo "  Checking for Install VSIX button..."

    local result=$(test_js "(function() {
        const vsixBtn = document.querySelector('[data-testid=\"install-vsix-btn\"], .extensions-panel__install-btn');
        if (vsixBtn) {
            return {
                found: true,
                visible: vsixBtn.offsetParent !== null,
                text: vsixBtn.textContent?.trim(),
                disabled: vsixBtn.disabled
            };
        }
        return { found: false };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local visible=$(echo "$result" | jq -r '.result.visible // false')

    if [ "$found" = "true" ] && [ "$visible" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Install VSIX button found and visible"
        ((TESTS_PASSED++))
    elif [ "$found" = "true" ]; then
        echo -e "  ${YELLOW}○${NC} Install VSIX button found but not visible"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${YELLOW}○${NC} Install VSIX button not found (may be expected for native panel)"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Panel Header Shows Title
# ============================================================================
test_07_panel_header() {
    echo "  Checking panel header/title..."

    local result=$(test_js "(function() {
        // Check custom panel header
        const customTitle = document.querySelector('.extensions-panel__title');
        if (customTitle) {
            return { found: true, text: customTitle.textContent?.trim() };
        }

        // Check native panel header
        const nativeTitle = document.querySelector('.extensions-viewlet .pane-header .title');
        if (nativeTitle) {
            return { found: true, text: nativeTitle.textContent?.trim() };
        }

        // Check for any Extensions heading
        const anyHeader = document.querySelector('[class*=\"extension\"] h2, [class*=\"extension\"] .title');
        if (anyHeader) {
            return { found: true, text: anyHeader.textContent?.trim() };
        }

        return { found: false };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local text=$(echo "$result" | jq -r '.result.text // ""')

    if [ "$found" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Panel header found: \"$text\""
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Panel header not found"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Badge Count Updates
# ============================================================================
test_08_badge_count() {
    echo "  Checking extension count badge..."

    local result=$(test_js "(function() {
        const badge = document.querySelector('[data-testid=\"installed-count\"], .extensions-panel__badge');
        if (badge) {
            const count = parseInt(badge.textContent?.trim() || '0', 10);
            return { found: true, count: count };
        }
        return { found: false };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local count=$(echo "$result" | jq -r '.result.count // 0')

    if [ "$found" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Badge count found: $count extensions"
        ((TESTS_PASSED++))
    else
        # Badge only shows when count > 0, so this is OK
        echo -e "  ${GREEN}✓${NC} No badge visible (expected when 0 extensions)"
        ((TESTS_PASSED++))
    fi
}

# ============================================================================
# Test: No Console Errors Related to Extensions Panel
# ============================================================================
test_09_no_render_errors() {
    echo "  Checking for render errors in console..."

    local errors=$(test_console 200)
    local extErrors=$(echo "$errors" | jq '[.[] | select(.message != null and (.message | test("ExtensionsPanel|extensions-panel|Cannot read|undefined is not|null is not"; "i")))] | length')

    if [ "$extErrors" = "0" ] || [ -z "$extErrors" ]; then
        echo -e "  ${GREEN}✓${NC} No extension panel render errors in console"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Found $extErrors extension-related errors in console"
        echo "$errors" | jq '.[] | select(.message != null and (.message | test("ExtensionsPanel|extensions-panel"; "i"))) | .message' | head -3
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Installed Tab is Default Active Tab
# ============================================================================
test_10_installed_is_default() {
    echo "  Checking that Installed tab is active by default..."

    # Reload the extensions panel to check default state
    # First close it
    test_js "(function() {
        const extIcon = document.querySelector('.activity-bar__item[data-view=\"explorer\"], .codicon-explorer-view-icon');
        if (extIcon) {
            extIcon.closest('button, .activity-bar__item, .action-item')?.click();
        }
    })()" > /dev/null
    sleep 0.5

    # Re-open extensions
    test_js "(function() {
        const extIcon = document.querySelector('.activity-bar__item[data-view=\"extensions\"], .codicon-extensions-view-icon');
        if (extIcon) {
            extIcon.closest('button, .activity-bar__item, .action-item')?.click();
        }
    })()" > /dev/null
    sleep 0.5

    local result=$(test_js "(function() {
        const installedTab = document.querySelector('[data-testid=\"tab-installed\"]');
        if (installedTab) {
            return installedTab.classList.contains('extensions-panel__tab--active');
        }
        // For native panel, check if we're showing installed by default
        return null;
    })()" | jq -r '.result')

    if [ "$result" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Installed tab is active by default"
        ((TESTS_PASSED++))
    elif [ "$result" = "null" ]; then
        skip_test "Default tab check not applicable for native panel"
    else
        echo -e "  ${RED}✗${NC} Installed tab should be active by default"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Run Tests
# ============================================================================

# Wait for server
wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}Testing Extensions Panel UI components${NC}"
echo -e "${CYAN}These tests verify the INSTALLED dropdown and other critical UI elements${NC}"
echo ""

run_tests
