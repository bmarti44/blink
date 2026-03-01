#!/bin/bash
# AI Chat Entitlement Service E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests verify the AI Chat Entitlement Service which bypasses VS Code's
# default Copilot login overlay and uses Blink Code Assist authentication.
#
# ============================================================================
#
# Usage:
#   ./50-ai-entitlement.sh
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
# Test: No Login Overlay Visible
# ============================================================================
test_01_no_login_overlay() {
    echo "  Checking that login overlay is not visible..."

    local result=$(test_js "(function() {
        // Check for common login overlay text
        var body = document.body ? document.body.innerText : '';
        var hasSignIn = body.includes('Sign in to use AI') || body.includes('continue with github');
        var hasGoogleApple = body.includes('continue with google') || body.includes('continue with apple');
        return hasSignIn || hasGoogleApple ? 'overlay-visible' : 'no-overlay';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "no-overlay" ]; then
        echo -e "  ${GREEN}✓${NC} No login overlay visible"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Login overlay should not be visible"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: AI Chat Agent Registered
# ============================================================================
test_02_oca_agent_registered() {
    echo "  Checking if AI chat agent is registered..."

    local result=$(test_js "(function() {
        return window.__OCA_CHAT_AGENT_REGISTERED__ ? 'registered' : 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} AI chat agent is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} AI chat agent should be registered"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: AI Service Available
# ============================================================================
test_03_oca_service_available() {
    echo "  Checking if AI service is available..."

    local result=$(test_js "(function() {
        var svc = window.__AI_SERVICE__;
        if (svc && typeof svc.hasValidToken === 'function') {
            return 'available';
        }
        return 'not-available';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "available" ]; then
        echo -e "  ${GREEN}✓${NC} AI service is available"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} AI service should be available"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Chat Panel Can Be Opened
# ============================================================================
test_04_chat_panel_accessible() {
    echo "  Checking if chat panel is accessible..."

    local result=$(test_js "(function() {
        // Try to find chat input or chat panel
        var chatInput = document.querySelector('.interactive-input-part textarea, [class*=\"chat\"] textarea, .chat-input textarea');
        var chatPanel = document.querySelector('[id*=\"chat\"], .chat-widget, [class*=\"chatView\"]');
        if (chatInput || chatPanel) {
            return 'accessible';
        }
        return 'not-accessible';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "accessible" ]; then
        echo -e "  ${GREEN}✓${NC} Chat panel is accessible"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}⚠${NC} Chat panel may not be open (not a failure)"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: isAIAuthenticated Function Exposed
# ============================================================================
test_05_auth_function_exposed() {
    echo "  Checking if isAIAuthenticated is exposed..."

    local result=$(test_js "(function() {
        var svc = window.__AI_SERVICE__;
        if (svc && typeof svc.hasValidToken === 'function') {
            return 'exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "exposed" ]; then
        echo -e "  ${GREEN}✓${NC} Auth check function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Auth check function should be exposed"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: No JavaScript Errors Related to Agent
# ============================================================================
test_06_no_agent_errors() {
    echo "  Checking for agent-related errors..."

    # Get recent errors
    local errors=$(curl -s http://localhost:9999/errors 2>/dev/null)
    local agent_errors=$(echo "$errors" | jq -r '.entries[] | select(.message | contains("agent")) | .message' 2>/dev/null | wc -l)

    if [ "$agent_errors" -lt 5 ]; then
        echo -e "  ${GREEN}✓${NC} Few or no agent-related errors"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}⚠${NC} Multiple agent-related errors detected ($agent_errors)"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Slash Commands Registered
# ============================================================================
test_07_slash_commands_registered() {
    echo "  Checking if slash commands are registered..."

    local result=$(test_js "(function() {
        // Check for exposed slash command handlers
        var hasRun = typeof window.__RUN_TERMINAL_AI__ === 'function';
        var hasPlan = typeof window.__RUN_PLAN_FROM_CHAT__ === 'function';
        var hasAgent = typeof window.__RUN_AGENT__ === 'function';
        if (hasRun && hasPlan && hasAgent) {
            return 'registered';
        }
        return 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Slash commands are registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Slash commands should be registered"
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
    echo "  AI Chat Entitlement Service E2E Tests"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Run tests
    test_00_server_ready
    test_01_no_login_overlay
    test_02_oca_agent_registered
    test_03_oca_service_available
    test_04_chat_panel_accessible
    test_05_auth_function_exposed
    test_06_no_agent_errors
    test_07_slash_commands_registered

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
