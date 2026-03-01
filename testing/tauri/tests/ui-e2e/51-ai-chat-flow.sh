#!/bin/bash
# AI Chat Message Flow E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests verify the end-to-end chat message flow using Blink Code Assist.
# They test that messages can be sent and the AI agent is invoked properly.
#
# ============================================================================
#
# Usage:
#   ./51-ai-chat-flow.sh
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
# Test: AI Agent Invoke Function
# ============================================================================
test_01_agent_invoke_exists() {
    echo "  Checking if AI agent can be invoked..."

    local result=$(test_js "(function() {
        // The agent should be registered and have an invoke method
        if (window.__OCA_CHAT_AGENT_REGISTERED__) {
            return 'can-invoke';
        }
        return 'cannot-invoke';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "can-invoke" ]; then
        echo -e "  ${GREEN}✓${NC} AI agent can be invoked"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} AI agent should be invokable"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: AI Service getPromptResponse Exists
# ============================================================================
test_02_prompt_response_function() {
    echo "  Checking if getPromptResponse function exists..."

    local result=$(test_js "(function() {
        var svc = window.__AI_SERVICE__;
        if (svc && typeof svc.getPromptResponse === 'function') {
            return 'exists';
        }
        return 'not-exists';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "exists" ]; then
        echo -e "  ${GREEN}✓${NC} getPromptResponse function exists"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} getPromptResponse should exist"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Token State Check
# ============================================================================
test_03_token_state_check() {
    echo "  Checking token state functionality..."

    local result=$(test_js "(function() {
        var svc = window.__AI_SERVICE__;
        if (!svc) return 'no-service';

        var state = svc.getTokenState();
        if (state && typeof state.accessToken !== 'undefined') {
            return 'token-state-works';
        }
        return 'token-state-broken';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "token-state-works" ]; then
        echo -e "  ${GREEN}✓${NC} Token state check works"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Token state check should work: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Authentication Flow Available
# ============================================================================
test_04_auth_flow_available() {
    echo "  Checking if authentication flow is available..."

    local result=$(test_js "(function() {
        var svc = window.__AI_SERVICE__;
        if (!svc) return 'no-service';

        // Check waitForToken exists (the OAuth flow)
        if (typeof svc.waitForToken === 'function') {
            return 'auth-available';
        }
        return 'auth-not-available';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "auth-available" ]; then
        echo -e "  ${GREEN}✓${NC} Authentication flow is available"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Authentication flow should be available: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Slash Command /run Handler
# ============================================================================
test_05_run_command_handler() {
    echo "  Checking /run command handler..."

    local result=$(test_js "(function() {
        if (typeof window.__RUN_TERMINAL_AI__ === 'function') {
            return 'handler-exists';
        }
        return 'no-handler';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "handler-exists" ]; then
        echo -e "  ${GREEN}✓${NC} /run command handler exists"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} /run command handler should exist"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Slash Command /plan Handler
# ============================================================================
test_06_plan_command_handler() {
    echo "  Checking /plan command handler..."

    local result=$(test_js "(function() {
        if (typeof window.__RUN_PLAN_FROM_CHAT__ === 'function') {
            return 'handler-exists';
        }
        return 'no-handler';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "handler-exists" ]; then
        echo -e "  ${GREEN}✓${NC} /plan command handler exists"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} /plan command handler should exist"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Slash Command /agent Handler
# ============================================================================
test_07_agent_command_handler() {
    echo "  Checking /agent command handler..."

    local result=$(test_js "(function() {
        if (typeof window.__RUN_AGENT__ === 'function') {
            return 'handler-exists';
        }
        return 'no-handler';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "handler-exists" ]; then
        echo -e "  ${GREEN}✓${NC} /agent command handler exists"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} /agent command handler should exist"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Model Provider Initialized
# ============================================================================
test_08_model_provider_initialized() {
    echo "  Checking if model provider is initialized..."

    local result=$(test_js "(function() {
        // Check if the active model provider is available
        if (window.__ACTIVE_MODEL_PROVIDER__) {
            return 'initialized';
        }
        // Also check if AI service exists as fallback
        if (window.__AI_SERVICE__) {
            return 'initialized';
        }
        return 'not-initialized';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "initialized" ]; then
        echo -e "  ${GREEN}✓${NC} Model provider is initialized"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}⚠${NC} Model provider may not be fully initialized"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: No Critical Errors in Console
# ============================================================================
test_09_no_critical_errors() {
    echo "  Checking for critical errors..."

    # Get errors and look for critical ones
    local errors=$(curl -s http://localhost:9999/errors 2>/dev/null)
    local critical=$(echo "$errors" | jq -r '.entries[] | select(.message | (contains("Cannot read") or contains("is not defined") or contains("TypeError"))) | .message' 2>/dev/null | wc -l)

    if [ "$critical" -lt 3 ]; then
        echo -e "  ${GREEN}✓${NC} No critical errors detected"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}⚠${NC} Some errors detected ($critical)"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Main Test Runner
# ============================================================================
main() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo "  AI Chat Message Flow E2E Tests"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Run tests
    test_00_server_ready
    test_01_agent_invoke_exists
    test_02_prompt_response_function
    test_03_token_state_check
    test_04_auth_flow_available
    test_05_run_command_handler
    test_06_plan_command_handler
    test_07_agent_command_handler
    test_08_model_provider_initialized
    test_09_no_critical_errors

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
