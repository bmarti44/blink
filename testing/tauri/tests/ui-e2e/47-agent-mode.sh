#!/bin/bash
# Agent Mode E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests verify the Agent Mode feature which provides multi-step
# autonomous execution with tool-use loops.
#
# ============================================================================
#
# Usage:
#   ./47-agent-mode.sh
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
# Test: Agent Mode Registration
# ============================================================================
test_01_agent_mode_registered() {
    echo "  Checking if Agent Mode is registered..."

    local result=$(test_js "(function() {
        const registered = window.__AGENT_MODE_REGISTERED__;
        const disposable = window.__AGENT_MODE_DISPOSABLE__;
        if (registered && disposable && typeof disposable.dispose === 'function') {
            return 'registered';
        }
        return 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Agent Mode is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Agent Mode should be registered"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: runAgent Function Exposed
# ============================================================================
test_02_run_agent_function() {
    echo "  Checking if runAgent function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__RUN_AGENT__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} runAgent function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} runAgent should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: cancelAgent Function Exposed
# ============================================================================
test_03_cancel_agent_function() {
    echo "  Checking if cancelAgent function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__CANCEL_AGENT__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} cancelAgent function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} cancelAgent should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: getAgentSession Function Exposed
# ============================================================================
test_04_get_session_function() {
    echo "  Checking if getAgentSession function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__GET_AGENT_SESSION__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} getAgentSession function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} getAgentSession should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: No Initial Session
# ============================================================================
test_05_no_initial_session() {
    echo "  Checking no agent session initially..."

    local result=$(test_js "(function() {
        const session = window.__GET_AGENT_SESSION__();
        return session === null ? 'no-session' : 'has-session';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "no-session" ]; then
        echo -e "  ${GREEN}✓${NC} No initial agent session"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Should have no initial session"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Cancel Handles No Session
# ============================================================================
test_06_cancel_no_session() {
    echo "  Checking cancel handles no session gracefully..."

    local result=$(test_js "(function() {
        try {
            window.__CANCEL_AGENT__();
            return 'handled';
        } catch (e) {
            return 'error: ' + e.message;
        }
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "handled" ]; then
        echo -e "  ${GREEN}✓${NC} Cancel handles no session gracefully"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Cancel should handle no session: $status"
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
    echo "  Agent Mode E2E Tests"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Run tests
    test_00_server_ready
    test_01_agent_mode_registered
    test_02_run_agent_function
    test_03_cancel_agent_function
    test_04_get_session_function
    test_05_no_initial_session
    test_06_cancel_no_session

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
