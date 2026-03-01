#!/bin/bash
# Multi-file Edit (Composer) E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests verify the Multi-file Editing / Composer feature which enables
# batch editing of multiple files with diff tracking and preview.
#
# ============================================================================
#
# Usage:
#   ./48-multi-file-edit.sh
#
# Prerequisites:
#   - Tauri app running with test server on port 9999
#   - jq installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

# ============================================================================
# Test: Server and Bridge Ready
# ============================================================================
test_00_server_ready() {
    echo "  Checking server and bridge status..."

    local result=$(test_health)
    assert_json_equals "$result" ".status" "ok" "Server should be healthy"
}

# ============================================================================
# Test: Multi-file Edit Registration
# ============================================================================
test_01_multi_file_edit_registered() {
    echo "  Checking if Multi-file Edit is registered..."

    local result=$(test_js "(function() {
        const registered = window.__MULTI_FILE_EDIT_REGISTERED__;
        const disposable = window.__MULTI_FILE_EDIT_DISPOSABLE__;
        if (registered && disposable && typeof disposable.dispose === 'function') {
            return 'registered';
        }
        return 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Multi-file Edit is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Multi-file Edit should be registered"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: runComposer Function Exposed
# ============================================================================
test_02_run_composer_function() {
    echo "  Checking if runComposer function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__RUN_COMPOSER__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} runComposer function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} runComposer should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: applyComposer Function Exposed
# ============================================================================
test_03_apply_composer_function() {
    echo "  Checking if applyComposer function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__APPLY_COMPOSER__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} applyComposer function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} applyComposer should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: getComposerSession Function Exposed
# ============================================================================
test_04_get_session_function() {
    echo "  Checking if getComposerSession function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__GET_COMPOSER_SESSION__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} getComposerSession function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} getComposerSession should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: No Initial Session
# ============================================================================
test_05_no_initial_session() {
    echo "  Checking no composer session initially..."

    local result=$(test_js "(function() {
        const session = window.__GET_COMPOSER_SESSION__();
        return session === null ? 'no-session' : 'has-session';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "no-session" ]; then
        echo -e "  ${GREEN}✓${NC} No initial composer session"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Should have no initial session"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Diff Review Integration
# ============================================================================
test_06_diff_review_integration() {
    echo "  Checking diff review integration..."

    local result=$(test_js "(function() {
        const composerRegistered = window.__MULTI_FILE_EDIT_REGISTERED__;
        const diffReviewRegistered = window.__DIFF_REVIEW_REGISTERED__;
        if (composerRegistered && diffReviewRegistered) {
            return 'integrated';
        }
        return 'not-integrated';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "integrated" ]; then
        echo -e "  ${GREEN}✓${NC} Diff review integration verified"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Both composer and diff review should be registered"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Main Test Runner
# ============================================================================
main() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo "  Multi-file Edit (Composer) E2E Tests"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Run tests
    test_00_server_ready
    test_01_multi_file_edit_registered
    test_02_run_composer_function
    test_03_apply_composer_function
    test_04_get_session_function
    test_05_no_initial_session
    test_06_diff_review_integration

    # Summary
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    printf "  ${GREEN}Passed:${NC}  %d\n" "$TESTS_PASSED"
    printf "  ${RED}Failed:${NC}  %d\n" "$TESTS_FAILED"
    printf "  ${YELLOW}Skipped:${NC} %d\n" "$TESTS_SKIPPED"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Return exit code
    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
    exit 0
}

main "$@"
