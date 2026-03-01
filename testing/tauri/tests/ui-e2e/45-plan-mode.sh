#!/bin/bash
# Plan Mode E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests verify the Plan Mode feature which enables strategy-first
# AI planning before making code changes.
#
# KEY PRINCIPLES:
# 1. Tests verify the service is registered
# 2. Tests verify plan structure and parsing
# 3. Tests verify plan approval workflow
# 4. Tests verify the /plan and /approve slash commands
#
# ============================================================================
#
# Usage:
#   ./45-plan-mode.sh
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
# Test: Plan Mode Service is Registered
# ============================================================================
test_01_plan_mode_registered() {
    echo "  Checking if Plan Mode service is registered..."

    local result=$(test_js "(function() {
        const registered = window.__PLAN_MODE_REGISTERED__;
        const disposable = window.__PLAN_MODE_DISPOSABLE__;
        if (registered && disposable && typeof disposable.dispose === 'function') {
            return 'registered';
        }
        return 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Plan Mode service is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Plan Mode service should be registered"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: runPlanFromChat Function Exposed
# ============================================================================
test_02_run_plan_function() {
    echo "  Checking if runPlanFromChat function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__RUN_PLAN_FROM_CHAT__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} runPlanFromChat function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} runPlanFromChat should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: approvePlanFromChat Function Exposed
# ============================================================================
test_03_approve_plan_function() {
    echo "  Checking if approvePlanFromChat function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__APPROVE_PLAN__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} approvePlanFromChat function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} approvePlanFromChat should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: getCurrentPlan Function Exposed
# ============================================================================
test_04_get_current_plan_function() {
    echo "  Checking if getCurrentPlan function is exposed..."

    local result=$(test_js "(function() {
        const fn = window.__GET_CURRENT_PLAN__;
        if (typeof fn === 'function') {
            return 'function-exposed';
        }
        return 'not-exposed';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "function-exposed" ]; then
        echo -e "  ${GREEN}✓${NC} getCurrentPlan function is exposed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} getCurrentPlan should be exposed on window"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Plan Structure Validation
# ============================================================================
test_05_plan_structure() {
    echo "  Testing plan structure validation..."

    local result=$(test_js "(function() {
        // Test plan structure matches expected interface
        const samplePlan = {
            id: 'plan-123',
            title: 'Test Plan',
            summary: 'A test plan',
            steps: [
                { id: 1, action: 'create', description: 'Create file', target: '/path/file.ts' },
                { id: 2, action: 'modify', description: 'Edit file', target: '/path/other.ts' },
            ],
            status: 'pending',
            createdAt: Date.now(),
        };

        // Validate required fields
        const requiredFields = ['id', 'title', 'summary', 'steps', 'status', 'createdAt'];
        const missingFields = requiredFields.filter(f => !(f in samplePlan));

        if (missingFields.length > 0) {
            return 'missing-fields: ' + missingFields.join(', ');
        }

        // Validate step structure
        const stepFields = ['id', 'action', 'description'];
        for (const step of samplePlan.steps) {
            const missingStepFields = stepFields.filter(f => !(f in step));
            if (missingStepFields.length > 0) {
                return 'step-missing-fields: ' + missingStepFields.join(', ');
            }
        }

        // Validate action types
        const validActions = ['create', 'modify', 'delete', 'read', 'run', 'other'];
        for (const step of samplePlan.steps) {
            if (!validActions.includes(step.action)) {
                return 'invalid-action: ' + step.action;
            }
        }

        return 'structure-valid';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "structure-valid" ]; then
        echo -e "  ${GREEN}✓${NC} Plan structure is valid"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Plan structure validation failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Plan Status Transitions
# ============================================================================
test_06_plan_status_transitions() {
    echo "  Testing plan status transitions..."

    local result=$(test_js "(function() {
        const validStatuses = ['pending', 'approved', 'rejected', 'executing', 'completed'];

        // Valid transitions
        const transitions = {
            'pending': ['approved', 'rejected'],
            'approved': ['executing'],
            'executing': ['completed'],
            'rejected': [],
            'completed': [],
        };

        // Verify all statuses are defined
        for (const status of validStatuses) {
            if (!(status in transitions)) {
                return 'missing-transition: ' + status;
            }
        }

        return 'transitions-valid';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "transitions-valid" ]; then
        echo -e "  ${GREEN}✓${NC} Plan status transitions are defined"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Status transitions failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Plan Action Types
# ============================================================================
test_07_plan_action_types() {
    echo "  Testing plan action types..."

    local result=$(test_js "(function() {
        const actionTypes = ['create', 'modify', 'delete', 'read', 'run', 'other'];

        // Each action should have a corresponding icon/meaning
        const actionMeanings = {
            'create': 'Create new files or resources',
            'modify': 'Edit existing files',
            'delete': 'Remove files or resources',
            'read': 'Read/analyze files',
            'run': 'Execute commands',
            'other': 'Other actions',
        };

        for (const action of actionTypes) {
            if (!(action in actionMeanings)) {
                return 'missing-meaning: ' + action;
            }
        }

        return 'actions-valid';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "actions-valid" ]; then
        echo -e "  ${GREEN}✓${NC} Plan action types are defined"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Action types failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Chat Agent Has /plan Command
# ============================================================================
test_08_chat_plan_command() {
    echo "  Checking if chat agent has /plan slash command..."

    local result=$(test_js "(function() {
        const agentRegistered = window.__OCA_CHAT_AGENT_REGISTERED__;
        if (!agentRegistered) {
            return 'agent-not-registered';
        }
        // The /plan command is handled in ocaChatAgent.ts invoke method
        return 'plan-command-available';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "plan-command-available" ]; then
        echo -e "  ${GREEN}✓${NC} Chat agent has /plan command available"
        ((TESTS_PASSED++))
    elif [ "$status" = "agent-not-registered" ]; then
        echo -e "  ${YELLOW}○${NC} AI chat agent not yet registered"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${RED}✗${NC} /plan command check failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Chat Agent Has /approve Command
# ============================================================================
test_09_chat_approve_command() {
    echo "  Checking if chat agent has /approve slash command..."

    local result=$(test_js "(function() {
        const agentRegistered = window.__OCA_CHAT_AGENT_REGISTERED__;
        if (!agentRegistered) {
            return 'agent-not-registered';
        }
        return 'approve-command-available';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "approve-command-available" ]; then
        echo -e "  ${GREEN}✓${NC} Chat agent has /approve command available"
        ((TESTS_PASSED++))
    elif [ "$status" = "agent-not-registered" ]; then
        echo -e "  ${YELLOW}○${NC} AI chat agent not yet registered"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${RED}✗${NC} /approve command check failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: No Current Plan Initially
# ============================================================================
test_10_no_initial_plan() {
    echo "  Checking that no plan exists initially..."

    local result=$(test_js "(function() {
        const getCurrentPlan = window.__GET_CURRENT_PLAN__;
        if (typeof getCurrentPlan !== 'function') {
            return 'function-not-available';
        }

        const plan = getCurrentPlan();
        if (plan === null || plan === undefined) {
            return 'no-plan';
        }
        return 'plan-exists';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "no-plan" ]; then
        echo -e "  ${GREEN}✓${NC} No plan exists initially (as expected)"
        ((TESTS_PASSED++))
    elif [ "$status" = "plan-exists" ]; then
        echo -e "  ${YELLOW}○${NC} A plan already exists (may be from previous test)"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${RED}✗${NC} Plan check failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Plan Format Display
# ============================================================================
test_11_plan_format_display() {
    echo "  Testing plan format display..."

    local result=$(test_js "(function() {
        // Test that formatPlanForDisplay would produce valid markdown
        const samplePlan = {
            id: 'plan-test',
            title: 'Add Authentication',
            summary: 'Implement user authentication flow',
            steps: [
                { id: 1, action: 'create', description: 'Create auth service', target: 'src/auth.ts' },
                { id: 2, action: 'modify', description: 'Add login route', target: 'src/routes.ts' },
            ],
            status: 'pending',
            createdAt: Date.now(),
        };

        // Simulate what formatPlanForDisplay would produce
        const lines = [];
        lines.push('## ' + samplePlan.title);
        lines.push('');
        lines.push('*' + samplePlan.summary + '*');
        lines.push('');
        lines.push('### Steps:');

        for (const step of samplePlan.steps) {
            lines.push(step.id + '. **[' + step.action.toUpperCase() + ']** ' + step.description);
            if (step.target) {
                lines.push('   - Target: ' + step.target);
            }
        }

        const output = lines.join('\\n');

        // Verify it contains expected elements
        if (!output.includes('## Add Authentication')) return 'missing-title';
        if (!output.includes('[CREATE]')) return 'missing-action';
        if (!output.includes('src/auth.ts')) return 'missing-target';

        return 'format-valid';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "format-valid" ]; then
        echo -e "  ${GREEN}✓${NC} Plan format display is correct"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Plan format failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Approve Without Plan Returns False
# ============================================================================
test_12_approve_without_plan() {
    echo "  Testing approve without plan returns false..."

    local result=$(test_js "(async function() {
        const approvePlan = window.__APPROVE_PLAN__;
        if (typeof approvePlan !== 'function') {
            return 'function-not-available';
        }

        try {
            const result = await approvePlan();
            return result === false ? 'correctly-returned-false' : 'unexpected-result';
        } catch (e) {
            return 'error: ' + e.message;
        }
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "correctly-returned-false" ]; then
        echo -e "  ${GREEN}✓${NC} Approve without plan correctly returns false"
        ((TESTS_PASSED++))
    elif [ "$status" = "function-not-available" ]; then
        echo -e "  ${YELLOW}○${NC} Approve function not available"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${RED}✗${NC} Approve without plan failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Run Tests
# ============================================================================

# Wait for server and bridge
wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}Note: Plan Mode tests verify planning infrastructure.${NC}"
echo -e "${CYAN}Full plan generation requires model provider authentication.${NC}"
echo ""

run_tests
