#!/bin/bash
# Terminal integration tests for Blink
# Tests the VS Code workbench terminal with Tauri PTY backend

source "$(dirname "$0")/../lib/test-client.sh"

# Track terminal IDs for cleanup
CREATED_TERMINALS=()

# ============================================================================
# Cleanup
# ============================================================================

cleanup_terminals() {
    for term_id in "${CREATED_TERMINALS[@]}"; do
        test_invoke "kill_terminal" "{\"terminalId\": \"$term_id\"}" > /dev/null 2>&1
    done
    CREATED_TERMINALS=()
}

# Cleanup on exit
trap cleanup_terminals EXIT

# ============================================================================
# Terminal Backend Tests (Rust/Tauri commands)
# ============================================================================

test_get_default_shell() {
    local result=$(test_invoke "get_default_shell" "{}")

    assert_json_true "$result" ".success" "get_default_shell should succeed"

    local shell=$(echo "$result" | jq -r '.result')
    assert_not_empty "$shell" "Default shell should not be empty"
    assert_contains "$shell" "/" "Shell path should contain /"
}

test_get_available_shells() {
    local result=$(test_invoke "get_available_shells" "{}")

    assert_json_true "$result" ".success" "get_available_shells should succeed"

    local count=$(echo "$result" | jq '.result | length')
    assert_greater_than "$count" "0" "Should have at least one shell available"

    # Check first shell has required fields
    local first_shell=$(echo "$result" | jq '.result[0]')
    local has_name=$(echo "$first_shell" | jq 'has("name")')
    local has_path=$(echo "$first_shell" | jq 'has("path")')

    assert_equals "$has_name" "true" "Shell should have name field"
    assert_equals "$has_path" "true" "Shell should have path field"
}

test_spawn_terminal_default() {
    local result=$(test_invoke "spawn_terminal" "{}")

    assert_json_true "$result" ".success" "spawn_terminal should succeed"

    local term_id=$(echo "$result" | jq -r '.result.id')
    assert_not_empty "$term_id" "Terminal should have an ID"
    assert_contains "$term_id" "term-" "Terminal ID should start with term-"

    # Track for cleanup
    CREATED_TERMINALS+=("$term_id")

    # Verify terminal info
    local shell=$(echo "$result" | jq -r '.result.shell')
    local cwd=$(echo "$result" | jq -r '.result.cwd')
    local cols=$(echo "$result" | jq -r '.result.cols')
    local rows=$(echo "$result" | jq -r '.result.rows')

    assert_not_empty "$shell" "Terminal should have shell"
    assert_not_empty "$cwd" "Terminal should have cwd"
    assert_greater_than "$cols" "0" "Terminal should have positive cols"
    assert_greater_than "$rows" "0" "Terminal should have positive rows"
}

test_spawn_terminal_with_shell() {
    local result=$(test_invoke "spawn_terminal" "{\"shell\": \"/bin/bash\"}")

    assert_json_true "$result" ".success" "spawn_terminal with shell should succeed"

    local term_id=$(echo "$result" | jq -r '.result.id')
    CREATED_TERMINALS+=("$term_id")

    local shell=$(echo "$result" | jq -r '.result.shell')
    assert_equals "$shell" "/bin/bash" "Shell should be /bin/bash"
}

test_spawn_terminal_with_cwd() {
    local result=$(test_invoke "spawn_terminal" "{\"cwd\": \"/tmp\"}")

    assert_json_true "$result" ".success" "spawn_terminal with cwd should succeed"

    local term_id=$(echo "$result" | jq -r '.result.id')
    CREATED_TERMINALS+=("$term_id")

    local cwd=$(echo "$result" | jq -r '.result.cwd')
    assert_equals "$cwd" "/tmp" "CWD should be /tmp"
}

test_spawn_terminal_with_size() {
    local result=$(test_invoke "spawn_terminal" "{\"cols\": 120, \"rows\": 40}")

    assert_json_true "$result" ".success" "spawn_terminal with size should succeed"

    local term_id=$(echo "$result" | jq -r '.result.id')
    CREATED_TERMINALS+=("$term_id")

    local cols=$(echo "$result" | jq -r '.result.cols')
    local rows=$(echo "$result" | jq -r '.result.rows')

    assert_equals "$cols" "120" "Cols should be 120"
    assert_equals "$rows" "40" "Rows should be 40"
}

test_list_terminals() {
    # Spawn a terminal first
    local spawn_result=$(test_invoke "spawn_terminal" "{}")
    local term_id=$(echo "$spawn_result" | jq -r '.result.id')
    CREATED_TERMINALS+=("$term_id")

    # List terminals
    local result=$(test_invoke "list_terminals" "{}")

    assert_json_true "$result" ".success" "list_terminals should succeed"

    local count=$(echo "$result" | jq '.result | length')
    assert_greater_than "$count" "0" "Should have at least one terminal"

    # Find our terminal
    local found=$(echo "$result" | jq --arg id "$term_id" '.result | map(select(.id == $id)) | length')
    assert_equals "$found" "1" "Our terminal should be in the list"
}

test_write_to_terminal() {
    # Spawn a terminal first
    local spawn_result=$(test_invoke "spawn_terminal" "{}")
    local term_id=$(echo "$spawn_result" | jq -r '.result.id')
    CREATED_TERMINALS+=("$term_id")

    # Write to terminal (echo command)
    local result=$(test_invoke "write_to_terminal" "{\"terminalId\": \"$term_id\", \"data\": \"echo hello\\n\"}")

    assert_json_true "$result" ".success" "write_to_terminal should succeed"

    # Give the shell time to process
    sleep 0.5
}

test_resize_terminal() {
    # Spawn a terminal first
    local spawn_result=$(test_invoke "spawn_terminal" "{\"cols\": 80, \"rows\": 24}")
    local term_id=$(echo "$spawn_result" | jq -r '.result.id')
    CREATED_TERMINALS+=("$term_id")

    # Resize terminal
    local result=$(test_invoke "resize_terminal" "{\"terminalId\": \"$term_id\", \"cols\": 100, \"rows\": 30}")

    assert_json_true "$result" ".success" "resize_terminal should succeed"
}

test_kill_terminal() {
    # Spawn a terminal first
    local spawn_result=$(test_invoke "spawn_terminal" "{}")
    local term_id=$(echo "$spawn_result" | jq -r '.result.id')

    # Kill it
    local result=$(test_invoke "kill_terminal" "{\"terminalId\": \"$term_id\"}")

    assert_json_true "$result" ".success" "kill_terminal should succeed"

    # Verify it's gone
    local list_result=$(test_invoke "list_terminals" "{}")
    local found=$(echo "$list_result" | jq --arg id "$term_id" '.result | map(select(.id == $id)) | length')
    assert_equals "$found" "0" "Killed terminal should not be in list"
}

test_kill_nonexistent_terminal() {
    local result=$(test_invoke "kill_terminal" "{\"terminalId\": \"nonexistent-terminal\"}")

    assert_json_false "$result" ".success" "Killing nonexistent terminal should fail"

    local error=$(echo "$result" | jq -r '.error')
    assert_contains "$error" "not found" "Error should mention not found"
}

test_write_to_nonexistent_terminal() {
    local result=$(test_invoke "write_to_terminal" "{\"terminalId\": \"nonexistent-terminal\", \"data\": \"test\"}")

    assert_json_false "$result" ".success" "Writing to nonexistent terminal should fail"
}

test_resize_nonexistent_terminal() {
    local result=$(test_invoke "resize_terminal" "{\"terminalId\": \"nonexistent-terminal\", \"cols\": 80, \"rows\": 24}")

    assert_json_false "$result" ".success" "Resizing nonexistent terminal should fail"
}

# ============================================================================
# Terminal Lifecycle Tests
# ============================================================================

test_multiple_terminals() {
    # Spawn multiple terminals
    local term1=$(test_invoke "spawn_terminal" "{}" | jq -r '.result.id')
    local term2=$(test_invoke "spawn_terminal" "{}" | jq -r '.result.id')
    local term3=$(test_invoke "spawn_terminal" "{}" | jq -r '.result.id')

    CREATED_TERMINALS+=("$term1" "$term2" "$term3")

    # All should be different (check by creating a unique set)
    local unique_count=$(echo -e "$term1\n$term2\n$term3" | sort -u | wc -l | tr -d ' ')
    assert_equals "$unique_count" "3" "All terminal IDs should be unique"

    # List should show all
    local list_result=$(test_invoke "list_terminals" "{}")
    local count=$(echo "$list_result" | jq '.result | length')
    assert_greater_than "$count" "2" "Should have at least 3 terminals"
}

test_terminal_shell_environment() {
    # Spawn a terminal
    local spawn_result=$(test_invoke "spawn_terminal" "{}")
    local term_id=$(echo "$spawn_result" | jq -r '.result.id')
    CREATED_TERMINALS+=("$term_id")

    # Write a simple command to terminal
    local data='echo hello\n'
    local result=$(test_invoke "write_to_terminal" "{\"terminalId\": \"$term_id\", \"data\": \"$data\"}")
    assert_json_true "$result" ".success" "Should write to terminal"

    sleep 0.3
}

# ============================================================================
# VS Code Terminal Service Integration Tests
# ============================================================================

test_terminal_service_initialized() {
    # Check if terminal service override is loaded
    local result=$(test_js "typeof window !== 'undefined' && document.querySelector('.monaco-workbench') !== null")

    assert_json_true "$result" ".success" "Workbench should be available"
}

test_terminal_panel_exists() {
    # Query for terminal panel in VS Code workbench
    local result=$(test_query "[id*='terminal'], .terminal-outer-container, .integrated-terminal")

    # Terminal panel may not be visible initially, that's ok
    assert_not_empty "$result" "Should get a response for terminal query"
}

test_terminal_tab_in_panel() {
    # Check if Terminal tab exists in panel tabs
    local result=$(test_js "Array.from(document.querySelectorAll('.panel-switcher-container .action-label')).some(el => el.textContent.includes('Terminal'))")

    assert_json_true "$result" ".success" "Query should succeed"
    # The terminal tab should exist in the panel
}

# ============================================================================
# Run Tests
# ============================================================================

run_tests
