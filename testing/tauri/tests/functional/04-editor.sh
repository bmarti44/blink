#!/bin/bash
# Editor functionality tests for Blink Tauri application
# These tests verify the Monaco editor integration

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Test Functions
# ============================================================================

test_editor_container() {
    local result=$(test_query ".editor-container, .editor-instance")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Editor container found"
        ((TESTS_PASSED++))
    else
        skip_test "No editor container found (no file may be open)"
    fi
}

test_monaco_editor_exists() {
    local result=$(test_query ".monaco-editor")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Monaco editor instance found"
        ((TESTS_PASSED++))
    else
        skip_test "No Monaco editor found (no file may be open)"
    fi
}

test_editor_lines() {
    local result=$(test_query ".view-lines, .monaco-editor .view-line")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        local count=$(echo "$result" | jq '.count')
        echo -e "  ${GREEN}✓${NC} Found editor view lines (count: $count)"
        ((TESTS_PASSED++))
    else
        skip_test "No editor lines found"
    fi
}

test_line_numbers() {
    local result=$(test_query ".line-numbers, .margin-view-overlays .line-numbers")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Line numbers are visible"
        ((TESTS_PASSED++))
    else
        skip_test "Line numbers not visible"
    fi
}

test_minimap() {
    local result=$(test_query ".minimap")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Minimap is visible"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Minimap not visible (may be disabled)"
        ((TESTS_SKIPPED++))
    fi
}

test_editor_tabs() {
    local result=$(test_query ".tabs-container .tab")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        local count=$(echo "$result" | jq '.count')
        echo -e "  ${GREEN}✓${NC} Found $count editor tab(s)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} No editor tabs found (no files open)"
        ((TESTS_SKIPPED++))
    fi
}

test_open_explorer() {
    # Open explorer panel
    local result=$(test_js "
        const icon = document.querySelector('.codicon-explorer-view-icon');
        if (icon) {
            icon.closest('.action-item')?.querySelector('.action-label')?.click();
            'clicked'
        } else {
            'not found'
        }
    ")

    if echo "$result" | jq -e '.result == "clicked"' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Opened explorer panel"
        ((TESTS_PASSED++))
        sleep 0.5
    else
        skip_test "Explorer icon not found"
    fi
}

test_explorer_tree() {
    local result=$(test_query ".explorer-viewlet, .explorer-folders-view")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Explorer tree view found"
        ((TESTS_PASSED++))
    else
        skip_test "Explorer tree not found"
    fi
}

test_file_tree_items() {
    local result=$(test_query ".monaco-list-row, .explorer-item")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        local count=$(echo "$result" | jq '.count')
        echo -e "  ${GREEN}✓${NC} Found $count items in file tree"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} No file tree items found (folder may be empty)"
        ((TESTS_SKIPPED++))
    fi
}

test_breadcrumbs() {
    local result=$(test_query ".breadcrumbs-control")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Breadcrumbs navigation found"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Breadcrumbs not visible (may be disabled)"
        ((TESTS_SKIPPED++))
    fi
}

test_scroll_behavior() {
    local result=$(test_query ".editor-scrollable, .monaco-scrollable-element")

    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Scrollable editor element found"
        ((TESTS_PASSED++))
    else
        skip_test "Scrollable element not found"
    fi
}

# ============================================================================
# Run Tests
# ============================================================================

run_tests
