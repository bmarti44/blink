#!/bin/bash
# E2E Test: Extensions Panel Blank Regression
#
# CRITICAL REGRESSION TEST
#
# This test catches the regression where the Extensions panel goes blank
# when clicked. The sidebar shows the title bar but no content.
#
# Expected behavior: Extensions panel should show search box and extension list
# Regression behavior: Sidebar shows empty content area

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Test: Extensions Panel Content After Open
# ============================================================================

test_01_open_extensions_panel_has_content() {
    echo "  Opening Extensions panel and checking for content..."

    # First ensure we're on a different view
    local click_explorer=$(test_js "document.querySelector('.codicon-explorer-view-icon')?.closest('.action-item')?.click(); 'clicked'")
    sleep 1

    # Capture sidebar BEFORE opening extensions
    local before=$(test_js "(function() {
        const sidebar = document.querySelector('.sidebar');
        return {
            exists: !!sidebar,
            hasContent: sidebar && sidebar.textContent.trim().length > 50,
            contentLength: sidebar?.textContent?.trim()?.length || 0
        };
    })()")
    echo "    Sidebar before: $(echo "$before" | jq -c '.result')"

    # Now click Extensions
    local click_result=$(test_js "document.querySelector('.codicon-extensions-view-icon')?.closest('.action-item')?.click(); 'clicked'")
    echo "    Click result: $(echo "$click_result" | jq -r '.result')"

    sleep 2  # Wait for panel to render

    # Capture sidebar AFTER opening extensions
    local after=$(test_js "(function() {
        const sidebar = document.querySelector('.sidebar');
        const viewlet = document.querySelector('.extensions-viewlet');
        const searchBox = document.querySelector('.extensions-viewlet .suggest-input-container');
        const listContainer = document.querySelector('.extensions-viewlet .monaco-list, .extensions-viewlet .extensions-list');

        return {
            sidebarExists: !!sidebar,
            sidebarContentLength: sidebar?.textContent?.trim()?.length || 0,
            viewletExists: !!viewlet,
            viewletVisible: viewlet?.offsetParent !== null,
            viewletContentLength: viewlet?.innerHTML?.length || 0,
            hasSearchBox: !!searchBox,
            hasListContainer: !!listContainer,
            sidebarText: sidebar?.textContent?.substring(0, 100) || 'EMPTY'
        };
    })()")

    echo "    Sidebar after: $(echo "$after" | jq -c '.result')"

    # Check for regression
    local viewlet_exists=$(echo "$after" | jq -r '.result.viewletExists // false')
    local has_search=$(echo "$after" | jq -r '.result.hasSearchBox // false')
    local content_len=$(echo "$after" | jq -r '.result.viewletContentLength // 0')
    local sidebar_text=$(echo "$after" | jq -r '.result.sidebarText // ""')

    if [ "$viewlet_exists" = "false" ]; then
        echo -e "  ${RED}✗${NC} REGRESSION: Extensions viewlet does not exist!"
        echo "    Sidebar text: $sidebar_text"
        ((TESTS_FAILED++))
        return 1
    fi

    if [ "$has_search" = "false" ]; then
        echo -e "  ${RED}✗${NC} REGRESSION: Extensions panel missing search box!"
        echo "    Sidebar text: $sidebar_text"
        ((TESTS_FAILED++))
        return 1
    fi

    if [ "$content_len" -lt 1000 ]; then
        echo -e "  ${RED}✗${NC} REGRESSION: Extensions panel appears empty (content: $content_len chars)"
        echo "    Sidebar text: $sidebar_text"
        ((TESTS_FAILED++))
        return 1
    fi

    echo -e "  ${GREEN}✓${NC} Extensions panel has content (viewlet: $content_len chars)"
    ((TESTS_PASSED++))
}

test_02_extensions_panel_shows_search_results() {
    echo "  Searching for 'Python' in Extensions..."

    # Type in search
    local search_result=$(test_js "(function() {
        const container = document.querySelector('.extensions-viewlet .suggest-input-container');
        if (!container) return { error: 'no search container' };

        container.click();
        const ta = container.querySelector('textarea.inputarea');
        if (!ta) return { error: 'no textarea' };

        ta.focus();
        document.execCommand('selectAll');
        document.execCommand('insertText', false, 'Python');
        return { searched: true };
    })()")

    echo "    Search result: $(echo "$search_result" | jq -c '.result')"

    sleep 3  # Wait for search results

    # Check for results
    local results=$(test_js "(function() {
        const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
        const names = Array.from(rows).slice(0, 5).map(r => r.querySelector('.name')?.textContent);
        return {
            count: rows.length,
            names: names.filter(Boolean)
        };
    })()")

    local count=$(echo "$results" | jq -r '.result.count // 0')
    local names=$(echo "$results" | jq -r '.result.names | join(", ")')

    if [ "$count" -gt 0 ]; then
        echo -e "  ${GREEN}✓${NC} Search returned $count results"
        echo "    First results: $names"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Search returned no results!"
        ((TESTS_FAILED++))
        return 1
    fi
}

test_03_sidebar_not_blank_after_multiple_opens() {
    echo "  Testing sidebar stability after multiple opens..."

    local blank_count=0

    for i in 1 2 3; do
        # Click explorer
        test_js "document.querySelector('.codicon-explorer-view-icon')?.closest('.action-item')?.click()" > /dev/null 2>&1
        sleep 0.5

        # Click extensions
        test_js "document.querySelector('.codicon-extensions-view-icon')?.closest('.action-item')?.click()" > /dev/null 2>&1
        sleep 1

        # Check content
        local check=$(test_js "(function() {
            const viewlet = document.querySelector('.extensions-viewlet');
            return {
                exists: !!viewlet,
                hasContent: (viewlet?.textContent?.length || 0) > 100
            };
        })()")

        local has_content=$(echo "$check" | jq -r '.result.hasContent // false')

        if [ "$has_content" = "false" ]; then
            echo "    Iteration $i: BLANK!"
            ((blank_count++))
        else
            echo "    Iteration $i: OK"
        fi
    done

    if [ $blank_count -eq 0 ]; then
        echo -e "  ${GREEN}✓${NC} Sidebar remained stable after multiple opens"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Sidebar went blank $blank_count times!"
        ((TESTS_FAILED++))
        return 1
    fi
}

test_04_diagnostic_capture_blank_state() {
    echo "  DIAGNOSTIC: Capturing state when panel goes blank..."

    # Clear console to get fresh logs
    curl -s -X DELETE "$TEST_SERVER/console" > /dev/null 2>&1
    curl -s -X DELETE "$TEST_SERVER/errors" > /dev/null 2>&1

    # Click extensions
    test_js "document.querySelector('.codicon-extensions-view-icon')?.closest('.action-item')?.click()" > /dev/null 2>&1
    sleep 2

    # Capture full diagnostic state
    local diag=$(test_js "(function() {
        const sidebar = document.querySelector('.sidebar');
        const viewlet = document.querySelector('.extensions-viewlet');
        const composite = document.querySelector('.composite');
        const panes = document.querySelectorAll('.pane');
        const splitViews = document.querySelectorAll('.split-view-view');

        return {
            sidebar: {
                exists: !!sidebar,
                childCount: sidebar?.childElementCount || 0,
                contentLength: sidebar?.innerHTML?.length || 0,
                classes: sidebar?.className || ''
            },
            viewlet: {
                exists: !!viewlet,
                childCount: viewlet?.childElementCount || 0,
                contentLength: viewlet?.innerHTML?.length || 0,
                visible: viewlet?.offsetParent !== null
            },
            composite: {
                exists: !!composite,
                classes: composite?.className || ''
            },
            paneCount: panes.length,
            splitViewCount: splitViews.length,
            documentTitle: document.title
        };
    })()")

    echo "    Diagnostic state:"
    echo "$diag" | jq '.result'

    # Check console for errors
    local errors=$(curl -s "$TEST_SERVER/errors" | jq '.entries | length')
    local console=$(curl -s "$TEST_SERVER/console" | jq '.entries | length')

    echo "    Errors captured: $errors"
    echo "    Console entries: $console"

    # Show any errors
    if [ "$errors" -gt 0 ]; then
        echo "    Recent errors:"
        curl -s "$TEST_SERVER/errors" | jq '.entries[-5:][].message'
    fi

    echo -e "  ${GREEN}✓${NC} Diagnostic capture complete"
    ((TESTS_PASSED++))
}

# ============================================================================
# Run Tests
# ============================================================================

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
echo -e "${RED}  REGRESSION TEST: Extensions Panel Goes Blank${NC}"
echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "This test catches the critical regression where the Extensions"
echo "panel sidebar goes blank after being opened."
echo ""

run_tests
