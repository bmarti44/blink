#!/bin/bash
# Persistent Memory / Rules E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests verify the Persistent Memory / Rules feature which enables
# project-specific rules and context that the AI remembers.
#
# ============================================================================
#
# Usage:
#   ./49-persistent-memory.sh
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
# Test: Persistent Memory Registration
# ============================================================================
test_01_persistent_memory_registered() {
    echo "  Checking if Persistent Memory is registered..."

    local result=$(test_js "(function() {
        const registered = window.__PERSISTENT_MEMORY_REGISTERED__;
        const disposable = window.__PERSISTENT_MEMORY_DISPOSABLE__;
        if (registered && disposable && typeof disposable.dispose === 'function') {
            return 'registered';
        }
        return 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Persistent Memory is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Persistent Memory should be registered"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: getProjectRules Function Exposed
# ============================================================================
test_02_get_rules_function() {
    echo "  Checking if getProjectRules function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__GET_PROJECT_RULES__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} getProjectRules function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} getProjectRules should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: getProjectMemory Function Exposed
# ============================================================================
test_03_get_memory_function() {
    echo "  Checking if getProjectMemory function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__GET_PROJECT_MEMORY__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} getProjectMemory function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} getProjectMemory should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: handleRemember Function Exposed
# ============================================================================
test_04_handle_remember_function() {
    echo "  Checking if handleRemember function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__HANDLE_REMEMBER__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} handleRemember function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} handleRemember should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: handleRules Function Exposed
# ============================================================================
test_05_handle_rules_function() {
    echo "  Checking if handleRules function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__HANDLE_RULES__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} handleRules function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} handleRules should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: getContextForPrompt Function Exposed
# ============================================================================
test_06_get_context_function() {
    echo "  Checking if getContextForPrompt function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__GET_CONTEXT_FOR_PROMPT__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} getContextForPrompt function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} getContextForPrompt should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Remember Empty Shows Usage
# ============================================================================
test_07_remember_empty_usage() {
    echo "  Checking /remember empty input shows usage..."

    local result=$(test_js "(async function() {
        try {
            const response = await window.__HANDLE_REMEMBER__('');
            return response.includes('Usage') ? 'shows-usage' : 'no-usage';
        } catch (e) {
            return 'error: ' + e.message;
        }
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "shows-usage" ]; then
        echo -e "  ${GREEN}✓${NC} Remember empty input shows usage"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Remember should show usage for empty input: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Rules Show Returns Content
# ============================================================================
test_08_rules_show() {
    echo "  Checking /rules show returns content..."

    local result=$(test_js "(async function() {
        try {
            const response = await window.__HANDLE_RULES__('show');
            return (response.includes('Project Rules') || response.includes('Guidelines') || response.includes('blink-rules'))
                   ? 'has-content' : 'no-content';
        } catch (e) {
            return 'error: ' + e.message;
        }
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "has-content" ]; then
        echo -e "  ${GREEN}✓${NC} Rules show returns content"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Rules show should return content: $status"
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
    echo "  Persistent Memory / Rules E2E Tests"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Run tests
    test_00_server_ready
    test_01_persistent_memory_registered
    test_02_get_rules_function
    test_03_get_memory_function
    test_04_handle_remember_function
    test_05_handle_rules_function
    test_06_get_context_function
    test_07_remember_empty_usage
    test_08_rules_show

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
