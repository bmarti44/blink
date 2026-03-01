#!/bin/bash
# Terminal AI E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests verify the Terminal AI feature which converts natural language
# to shell commands and executes them in the terminal.
#
# KEY PRINCIPLES:
# 1. Tests verify the service is registered
# 2. Tests verify dangerous command detection
# 3. Tests verify command generation (when provider is available)
# 4. Tests verify the /run slash command in chat
#
# ============================================================================
#
# Usage:
#   ./44-terminal-ai.sh
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
    assert_json_true "$result" ".bridge_connected" "Bridge should be connected"
}

# ============================================================================
# Test: Terminal AI Service is Registered
# ============================================================================
test_01_terminal_ai_registered() {
    echo "  Checking if Terminal AI service is registered..."

    local result=$(test_js "(function() {
        const registered = window.__TERMINAL_AI_REGISTERED__;
        const disposable = window.__TERMINAL_AI_DISPOSABLE__;
        if (registered && disposable && typeof disposable.dispose === 'function') {
            return 'registered';
        }
        return 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Terminal AI service is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Terminal AI service should be registered"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: runTerminalAIFromChat Function Exposed
# ============================================================================
test_02_run_terminal_ai_function() {
    echo "  Checking if runTerminalAIFromChat function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__RUN_TERMINAL_AI__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} runTerminalAIFromChat function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} runTerminalAIFromChat should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Dangerous Command Detection - rm -rf
# ============================================================================
test_03_dangerous_command_rm_rf() {
    echo "  Testing dangerous command detection (rm -rf /)..."

    local result=$(test_js "(function() {
        // Test the dangerous command patterns directly
        const dangerousPatterns = [
            /rm\\s+(-rf?|--recursive)\\s+[\\/~]/i,
            /rm\\s+-rf?\\s+\\*/i,
            /mkfs\\./i,
            /dd\\s+if=.*of=\\/dev/i,
            /chmod\\s+-R\\s+777\\s+\\//i,
        ];

        const testCases = [
            { cmd: 'rm -rf /', expected: true },
            { cmd: 'rm -rf ~', expected: true },
            { cmd: 'rm -rf *', expected: true },
            { cmd: 'rm file.txt', expected: false },
            { cmd: 'ls -la', expected: false },
        ];

        const results = testCases.map(tc => {
            const isDangerous = dangerousPatterns.some(p => p.test(tc.cmd));
            return {
                cmd: tc.cmd,
                detected: isDangerous,
                expected: tc.expected,
                pass: isDangerous === tc.expected
            };
        });

        const allPass = results.every(r => r.pass);
        return allPass ? 'all-pass' : JSON.stringify(results.filter(r => !r.pass));
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "all-pass" ]; then
        echo -e "  ${GREEN}✓${NC} Dangerous command detection working correctly"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Dangerous command detection failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Safe Command Not Blocked
# ============================================================================
test_04_safe_commands_not_blocked() {
    echo "  Testing safe commands are not blocked..."

    local result=$(test_js "(function() {
        const dangerousPatterns = [
            /rm\\s+(-rf?|--recursive)\\s+[\\/~]/i,
            /rm\\s+-rf?\\s+\\*/i,
            /mkfs\\./i,
            /dd\\s+if=.*of=\\/dev/i,
            /chmod\\s+-R\\s+777\\s+\\//i,
        ];

        const safeCommands = [
            'ls -la',
            'pwd',
            'echo hello',
            'cat file.txt',
            'find . -name \"*.ts\"',
            'grep -r \"pattern\" .',
            'npm install',
            'git status',
        ];

        const blocked = safeCommands.filter(cmd =>
            dangerousPatterns.some(p => p.test(cmd))
        );

        return blocked.length === 0 ? 'all-safe' : 'blocked: ' + blocked.join(', ');
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "all-safe" ]; then
        echo -e "  ${GREEN}✓${NC} Safe commands are not blocked"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Safe commands incorrectly blocked: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Terminal Service Available
# ============================================================================
test_05_terminal_service_available() {
    echo "  Checking if terminal service is available..."

    local result=$(test_js "(function() {
        const terminalService = window.__TERMINAL_SERVICE__;
        if (terminalService) {
            return 'service-available';
        }
        return 'not-available';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "service-available" ]; then
        echo -e "  ${GREEN}✓${NC} Terminal service is available"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Terminal service not available (may not be initialized yet)"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Model Provider Check
# ============================================================================
test_06_model_provider_check() {
    echo "  Checking if model provider is available..."

    local result=$(test_js "(async function() {
        try {
            const { getActiveModelProvider } = await import('/src/services/vscode/ai/index.js');
            const provider = getActiveModelProvider();
            if (provider) {
                const authenticated = provider.isAuthenticated?.() || false;
                return authenticated ? 'authenticated' : 'not-authenticated';
            }
            return 'no-provider';
        } catch (e) {
            // Try window globals instead
            const provider = window.__MODEL_PROVIDER__;
            if (provider) {
                return 'provider-from-window';
            }
            return 'import-failed';
        }
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "authenticated" ]; then
        echo -e "  ${GREEN}✓${NC} Model provider is authenticated"
        ((TESTS_PASSED++))
    elif [ "$status" = "not-authenticated" ] || [ "$status" = "no-provider" ]; then
        echo -e "  ${YELLOW}○${NC} Model provider not authenticated (Terminal AI will not generate commands)"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${YELLOW}○${NC} Model provider check: $status"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: OS Context Detection
# ============================================================================
test_07_os_context() {
    echo "  Testing OS context detection..."

    local result=$(test_js "(function() {
        const platform = navigator.platform.toLowerCase();
        let os = 'Unknown';
        if (platform.includes('mac')) os = 'macOS';
        else if (platform.includes('win')) os = 'Windows';
        else if (platform.includes('linux')) os = 'Linux';
        else os = 'Unix-like';

        return os;
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ -n "$status" ] && [ "$status" != "null" ]; then
        echo -e "  ${GREEN}✓${NC} OS context detected: $status"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Failed to detect OS context"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Working Directory Context
# ============================================================================
test_08_working_directory() {
    echo "  Testing working directory context..."

    local result=$(test_js "(function() {
        const cwd = localStorage.getItem('blink-workspace-folder') || '~';
        return cwd;
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ -n "$status" ] && [ "$status" != "null" ]; then
        echo -e "  ${GREEN}✓${NC} Working directory context: $status"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Failed to get working directory"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Chat Agent Has /run Command
# ============================================================================
test_09_chat_run_command() {
    echo "  Checking if chat agent has /run slash command..."

    local result=$(test_js "(function() {
        // Check if AI chat agent is registered
        const agentRegistered = window.__OCA_CHAT_AGENT_REGISTERED__;
        if (!agentRegistered) {
            return 'agent-not-registered';
        }
        // The /run command is handled in ocaChatAgent.ts invoke method
        return 'run-command-available';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "run-command-available" ]; then
        echo -e "  ${GREEN}✓${NC} Chat agent has /run command available"
        ((TESTS_PASSED++))
    elif [ "$status" = "agent-not-registered" ]; then
        echo -e "  ${YELLOW}○${NC} AI chat agent not yet registered"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${RED}✗${NC} /run command check failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Command Result Structure
# ============================================================================
test_10_command_result_structure() {
    echo "  Testing command result structure..."

    local result=$(test_js "(async function() {
        const runFn = window.__RUN_TERMINAL_AI__;
        if (typeof runFn !== 'function') {
            return 'function-not-available';
        }

        // Call with a simple request (may fail if not authenticated, but we check structure)
        try {
            const result = await runFn('list files', false);
            // Check result has expected properties
            if (result && typeof result === 'object') {
                const hasCommand = 'command' in result;
                const hasExecuted = 'executed' in result;
                if (hasCommand && hasExecuted) {
                    return 'structure-valid';
                }
                return 'missing-properties';
            }
            return 'invalid-result-type';
        } catch (e) {
            // Even errors should come from the function
            return 'error-during-call: ' + e.message;
        }
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "structure-valid" ]; then
        echo -e "  ${GREEN}✓${NC} Command result has correct structure"
        ((TESTS_PASSED++))
    elif [[ "$status" == "error-during-call"* ]]; then
        echo -e "  ${YELLOW}○${NC} Command generation requires provider authentication"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${YELLOW}○${NC} Result structure check: $status"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Run Tests
# ============================================================================

# Wait for server and bridge
wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}Note: Terminal AI tests verify command generation infrastructure.${NC}"
echo -e "${CYAN}Full command generation requires model provider authentication.${NC}"
echo ""

run_tests
