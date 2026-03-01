#!/bin/bash
# Quick regression test for Extensions Panel INSTALLED visibility
#
# This is a focused test that specifically catches the regression where
# the "Installed" tab/dropdown is not visible in the Extensions panel.
#
# CRITICAL: This test should FAIL if the INSTALLED UI element is missing.

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Test: Open Extensions Panel and Verify "Installed" is Visible
# ============================================================================
test_installed_text_visible() {
    echo "  Opening Extensions panel and checking for 'Installed' text..."

    # Click on Extensions in the activity bar
    local click_result=$(test_js "(function() {
        // Try multiple selectors for the extensions icon
        const selectors = [
            '.activity-bar__item[data-view=\"extensions\"]',
            '[data-testid=\"activity-extensions\"]',
            '.codicon-extensions-view-icon',
            '.activitybar .action-item[aria-label*=\"Extensions\"]'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const clickable = el.closest('button, .activity-bar__item, .action-item') || el;
                clickable.click();
                return 'clicked: ' + sel;
            }
        }
        return 'not-found';
    })()")

    echo "    Click result: $(echo "$click_result" | jq -r '.result')"
    sleep 1.5  # Wait for panel to render

    # Now check if "Installed" text is visible ANYWHERE in the extensions panel area
    local result=$(test_js "(function() {
        const searchArea = document.querySelector('.extensions-panel, .extensions-viewlet, [data-testid=\"extensions-panel\"], .sidebar');
        if (!searchArea) {
            return { found: false, reason: 'no-panel-container' };
        }

        // Get all text content and search for 'Installed'
        const allText = searchArea.textContent || '';
        const hasInstalledText = /installed/i.test(allText);

        // Also look for specific elements
        const installedTab = searchArea.querySelector('[data-testid=\"tab-installed\"]');
        const installedPaneHeader = searchArea.querySelector('.pane-header[aria-label*=\"Installed\"]');
        const anyInstalledElement = searchArea.querySelector('[class*=\"installed\"], [title*=\"Installed\"], [aria-label*=\"Installed\"]');

        return {
            found: hasInstalledText || installedTab || installedPaneHeader || anyInstalledElement,
            hasInstalledInText: hasInstalledText,
            hasInstalledTab: !!installedTab,
            hasInstalledPaneHeader: !!installedPaneHeader,
            hasAnyInstalledElement: !!anyInstalledElement,
            panelVisible: searchArea.offsetParent !== null,
            textSample: allText.substring(0, 200)
        };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local hasText=$(echo "$result" | jq -r '.result.hasInstalledInText // false')
    local hasTab=$(echo "$result" | jq -r '.result.hasInstalledTab // false')
    local panelVisible=$(echo "$result" | jq -r '.result.panelVisible // false')
    local textSample=$(echo "$result" | jq -r '.result.textSample // ""')

    echo "    Panel visible: $panelVisible"
    echo "    Has 'Installed' text: $hasText"
    echo "    Has Installed tab: $hasTab"
    echo "    Text sample: ${textSample:0:100}..."

    if [ "$found" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} 'Installed' is visible in Extensions panel"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} CRITICAL: 'Installed' text/element NOT FOUND in Extensions panel!"
        echo -e "  ${RED}  This indicates a regression in the Extensions panel UI${NC}"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Installed Tab is Clickable
# ============================================================================
test_installed_tab_clickable() {
    echo "  Checking if Installed tab is clickable..."

    local result=$(test_js "(function() {
        const tab = document.querySelector('[data-testid=\"tab-installed\"]');
        if (!tab) {
            return { found: false };
        }

        // Check if it's clickable (visible, not disabled)
        const isVisible = tab.offsetParent !== null;
        const isDisabled = tab.disabled || tab.classList.contains('disabled');
        const rect = tab.getBoundingClientRect();
        const hasSize = rect.width > 0 && rect.height > 0;

        return {
            found: true,
            clickable: isVisible && !isDisabled && hasSize,
            isVisible: isVisible,
            isDisabled: isDisabled,
            hasSize: hasSize,
            dimensions: { width: rect.width, height: rect.height }
        };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local clickable=$(echo "$result" | jq -r '.result.clickable // false')

    if [ "$found" = "false" ]; then
        skip_test "Installed tab not found (may be native panel)"
        return
    fi

    if [ "$clickable" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Installed tab is clickable"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Installed tab exists but is NOT clickable"
        echo "    Details: $(echo "$result" | jq -c '.result')"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Extensions Panel Has Tab Container
# ============================================================================
test_extensions_tabs_container() {
    echo "  Checking Extensions panel has tabs container..."

    local result=$(test_js "(function() {
        const tabsContainer = document.querySelector('.extensions-panel__tabs');
        if (!tabsContainer) {
            return { found: false };
        }

        const tabs = tabsContainer.querySelectorAll('.extensions-panel__tab');
        const tabNames = Array.from(tabs).map(t => t.textContent?.trim());

        return {
            found: true,
            visible: tabsContainer.offsetParent !== null,
            tabCount: tabs.length,
            tabNames: tabNames
        };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local tabCount=$(echo "$result" | jq -r '.result.tabCount // 0')
    local tabNames=$(echo "$result" | jq -r '.result.tabNames // []')

    if [ "$found" = "true" ] && [ "$tabCount" -ge 2 ]; then
        echo -e "  ${GREEN}✓${NC} Tabs container found with $tabCount tabs: $tabNames"
        ((TESTS_PASSED++))
    elif [ "$found" = "true" ]; then
        echo -e "  ${RED}✗${NC} Tabs container found but only has $tabCount tab(s) - expected at least 2"
        ((TESTS_FAILED++))
        return 1
    else
        skip_test "Custom tabs container not found (may be native panel)"
    fi
}

# ============================================================================
# Run Tests
# ============================================================================

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${RED}REGRESSION TEST: Extensions Panel INSTALLED Visibility${NC}"
echo -e "${CYAN}This test catches missing 'Installed' dropdown in Extensions panel${NC}"
echo ""

run_tests
