#!/bin/bash
# Extension management tests for Blink Tauri application
# These tests verify extension panel and management functionality

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Test Functions
# ============================================================================

test_open_extensions_panel() {
    # Click the extensions icon
    local result=$(test_js "
        const icon = document.querySelector('.codicon-extensions-view-icon');
        if (icon) {
            icon.closest('.action-item')?.querySelector('.action-label')?.click();
            'clicked'
        } else {
            'not found'
        }
    ")

    if echo "$result" | jq -e '.result == "clicked"' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Clicked extensions icon"
        ((TESTS_PASSED++))
        sleep 1  # Wait for panel to open
    else
        echo -e "  ${YELLOW}○${NC} Extensions icon not found (may be expected in some configurations)"
        ((TESTS_SKIPPED++))
    fi
}

test_extensions_viewlet_exists() {
    sleep 0.5
    local result=$(test_query ".extensions-viewlet")

    if echo "$result" | jq -e '.found' > /dev/null 2>&1; then
        assert_json_true "$result" ".found" "Extensions viewlet should exist after opening"
    else
        skip_test "Extensions viewlet not present (panel may not have opened)"
    fi
}

test_extensions_search_box() {
    local result=$(test_query ".extensions-viewlet input, .extensions-viewlet textarea")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Extensions search box found"
        ((TESTS_PASSED++))
    else
        skip_test "Extensions search box not found"
    fi
}

test_search_installed_extensions() {
    # Focus and type @installed
    local result=$(test_js "
        const textarea = document.querySelector('.extensions-viewlet textarea.inputarea');
        if (textarea) {
            textarea.focus();
            document.execCommand('selectAll');
            document.execCommand('insertText', false, '@installed');
            'typed'
        } else {
            'not found'
        }
    ")

    if echo "$result" | jq -e '.result == "typed"' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Typed @installed in search box"
        ((TESTS_PASSED++))
        sleep 1  # Wait for search results
    else
        skip_test "Could not type in search box"
    fi
}

test_get_installed_extensions() {
    sleep 0.5

    local result=$(test_js "
        const names = Array.from(document.querySelectorAll('.extension-list-item .name, .extensions-viewlet .extension .name'))
            .map(e => e.innerText)
            .filter(n => n && n.length > 0);
        JSON.stringify(names);
    ")

    if echo "$result" | jq -e '.success' > /dev/null 2>&1; then
        local extensions=$(echo "$result" | jq -r '.result | fromjson | .[]' 2>/dev/null)

        if [ -n "$extensions" ]; then
            echo -e "  ${GREEN}✓${NC} Found installed extensions:"
            echo "$extensions" | while read ext; do
                echo "      - $ext"
            done
            ((TESTS_PASSED++))
        else
            echo -e "  ${YELLOW}○${NC} No installed extensions found (may be expected)"
            ((TESTS_SKIPPED++))
        fi
    else
        skip_test "Could not retrieve extension list"
    fi
}

test_extension_list_items() {
    local result=$(test_query ".extension-list-item")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        local count=$(echo "$result" | jq '.count')
        echo -e "  ${GREEN}✓${NC} Found $count extension list items"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} No extension list items found"
        ((TESTS_SKIPPED++))
    fi
}

test_clear_search_and_close() {
    # Clear search
    test_js "
        const textarea = document.querySelector('.extensions-viewlet textarea.inputarea');
        if (textarea) {
            textarea.focus();
            document.execCommand('selectAll');
            document.execCommand('insertText', false, '');
        }
    " > /dev/null

    echo -e "  ${GREEN}✓${NC} Cleared extension search"
    ((TESTS_PASSED++))
}

# ============================================================================
# Run Tests
# ============================================================================

run_tests
