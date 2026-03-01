#!/bin/bash
# User-centric terminal tests for Blink
# Tests that simulate real user interactions with the terminal

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Helper Functions
# ============================================================================

# Wait for terminal to be ready with output
wait_for_terminal_ready() {
    local max_attempts=10
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        local result=$(test_query ".xterm-rows")
        local found=$(echo "$result" | jq -r '.found')

        if [ "$found" = "true" ]; then
            return 0
        fi

        sleep 0.5
        attempt=$((attempt + 1))
    done

    return 1
}

# Get terminal text content
get_terminal_content() {
    test_js "(async () => {
        const rows = document.querySelector('.xterm-rows');
        if (!rows) return { success: false, message: 'No xterm-rows element' };
        return { success: true, content: rows.textContent };
    })()" | jq -r '.result.content // ""'
}

# ============================================================================
# User-Centric Tests
# ============================================================================

test_terminal_displays_prompt() {
    echo "Checking if terminal displays a shell prompt..."

    # First ensure terminal panel is visible
    local click_result=$(test_js "(async () => {
        const tabs = document.querySelectorAll('.panel-switcher-container .action-item');
        for (const tab of tabs) {
            if (tab.textContent.includes('Terminal')) {
                tab.click();
                await new Promise(r => setTimeout(r, 500));
                return { clicked: true };
            }
        }
        return { clicked: false };
    })()")

    sleep 1

    # Check if we have xterm rows with content
    local content=$(get_terminal_content)
    echo "Terminal content (first 200 chars): ${content:0:200}"

    # Should have some content (prompt, previous output, etc.)
    if [ -n "$content" ] && [ ${#content} -gt 0 ]; then
        echo "  ✓ Terminal has content"
    else
        echo "  ✗ Terminal appears empty"
    fi
}

test_type_and_verify_echo() {
    echo "Testing: Type 'echo hello' and verify output..."

    # Clear any previous content by sending clear command
    local clear_result=$(test_invoke "list_terminals" "{}")
    local term_id=$(echo "$clear_result" | jq -r '.result[0].id // empty')

    if [ -z "$term_id" ]; then
        echo "  ✗ No terminal found in backend"
        return 1
    fi

    echo "  Using terminal: $term_id"

    # Write a command directly to the terminal
    local write_result=$(test_invoke "write_to_terminal" "{\"terminalId\": \"$term_id\", \"data\": \"echo TESTMARKER123\\n\"}")
    local write_success=$(echo "$write_result" | jq -r '.success')

    if [ "$write_success" != "true" ]; then
        echo "  ✗ Failed to write to terminal"
        return 1
    fi

    echo "  Wrote 'echo TESTMARKER123' to terminal"

    # Wait for output
    sleep 1

    # Check terminal content for our marker
    local content=$(get_terminal_content)
    echo "  Terminal content sample: ${content:0:300}"

    if echo "$content" | grep -q "TESTMARKER123"; then
        echo "  ✓ Found TESTMARKER123 in terminal output"
        return 0
    else
        echo "  ✗ TESTMARKER123 not found in output"
        return 1
    fi
}

test_terminal_receives_shell_prompt() {
    echo "Testing: Verify terminal receives shell data..."

    # Get terminal ID
    local list_result=$(test_invoke "list_terminals" "{}")
    local term_id=$(echo "$list_result" | jq -r '.result[0].id // empty')

    if [ -z "$term_id" ]; then
        echo "  ✗ No terminal found"
        return 1
    fi

    # Check if terminal is receiving data by looking at xterm content
    local content=$(get_terminal_content)

    # A working terminal should have some content (at minimum a prompt)
    if [ ${#content} -gt 5 ]; then
        echo "  ✓ Terminal has content (${#content} chars)"

        # Check for common prompt indicators
        if echo "$content" | grep -qE '[\$%#>~]'; then
            echo "  ✓ Found prompt-like characters"
        fi

        return 0
    else
        echo "  ✗ Terminal has minimal content (${#content} chars)"
        return 1
    fi
}

test_interactive_command() {
    echo "Testing: Run 'pwd' and verify path output..."

    local list_result=$(test_invoke "list_terminals" "{}")
    local term_id=$(echo "$list_result" | jq -r '.result[0].id // empty')

    if [ -z "$term_id" ]; then
        echo "  ✗ No terminal found"
        return 1
    fi

    # Send pwd command
    test_invoke "write_to_terminal" "{\"terminalId\": \"$term_id\", \"data\": \"pwd\\n\"}" > /dev/null

    sleep 1

    local content=$(get_terminal_content)

    # pwd should output a path starting with /
    if echo "$content" | grep -qE '/[a-zA-Z]'; then
        echo "  ✓ Found path-like output from pwd"
        return 0
    else
        echo "  ✗ No path found in output"
        echo "  Content: ${content:0:200}"
        return 1
    fi
}

test_terminal_event_flow() {
    echo "Testing: Verify terminal data events are flowing..."

    # This test checks if the Tauri event system is working
    local result=$(test_js "(async () => {
        try {
            // Get terminal list
            const terminals = await window.__TAURI__.core.invoke('list_terminals', {});
            if (!terminals || terminals.length === 0) {
                return { success: false, message: 'No terminals' };
            }

            const termId = terminals[0].id;

            // Write a unique marker
            const marker = 'EVENTTEST_' + Date.now();
            await window.__TAURI__.core.invoke('write_to_terminal', {
                terminalId: termId,
                data: 'echo ' + marker + '\\n'
            });

            // Wait for output
            await new Promise(r => setTimeout(r, 1000));

            // Check xterm content
            const rows = document.querySelector('.xterm-rows');
            const content = rows ? rows.textContent : '';

            return {
                success: content.includes(marker),
                marker: marker,
                found: content.includes(marker),
                contentLength: content.length
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    echo "  Event flow test result: $result"

    local success=$(echo "$result" | jq -r '.result.success // false')
    if [ "$success" = "true" ]; then
        echo "  ✓ Terminal event flow is working"
        return 0
    else
        echo "  ✗ Terminal event flow may be broken"
        return 1
    fi
}

test_console_logs_for_terminal() {
    echo "Checking console for terminal-related logs..."

    local logs=$(curl -s "$TEST_SERVER/console" | jq '[.entries[] | select(.message | test("TauriTerminal|createProcess|input\\(\\)|start\\(\\)"; "i"))] | .[-10:]')

    echo "  Terminal-related logs:"
    echo "$logs" | jq -r '.[] | "    \(.level): \(.message)"'

    local log_count=$(echo "$logs" | jq 'length')
    echo "  Found $log_count terminal-related log entries"
}

# ============================================================================
# Summary Test
# ============================================================================

test_full_terminal_workflow() {
    echo ""
    echo "=========================================="
    echo "  Full Terminal Workflow Test"
    echo "=========================================="

    # Step 1: Check terminal exists
    echo ""
    echo "Step 1: Verify terminal exists in backend..."
    local list_result=$(test_invoke "list_terminals" "{}")
    local term_count=$(echo "$list_result" | jq '.result | length')

    if [ "$term_count" -gt 0 ]; then
        echo "  ✓ Found $term_count terminal(s)"
    else
        echo "  ✗ No terminals found"
        return 1
    fi

    local term_id=$(echo "$list_result" | jq -r '.result[0].id')
    echo "  Terminal ID: $term_id"

    # Step 2: Check UI has terminal elements
    echo ""
    echo "Step 2: Verify terminal UI elements..."
    local ui_result=$(test_query ".xterm")
    local has_xterm=$(echo "$ui_result" | jq -r '.found')

    if [ "$has_xterm" = "true" ]; then
        echo "  ✓ xterm element exists"
    else
        echo "  ✗ No xterm element found"
    fi

    # Step 3: Write to terminal and check output
    echo ""
    echo "Step 3: Write command and verify output..."
    local marker="WORKFLOW_$(date +%s)"

    test_invoke "write_to_terminal" "{\"terminalId\": \"$term_id\", \"data\": \"echo $marker\\n\"}" > /dev/null
    sleep 1

    local content=$(get_terminal_content)

    if echo "$content" | grep -q "$marker"; then
        echo "  ✓ Command output appears in terminal"
    else
        echo "  ✗ Command output not found"
        echo "  Expected: $marker"
        echo "  Content (first 200 chars): ${content:0:200}"
    fi

    # Step 4: Check input method connectivity
    echo ""
    echo "Step 4: Check input handler..."
    local input_result=$(test_query ".xterm-helper-textarea")
    local has_input=$(echo "$input_result" | jq -r '.found')

    if [ "$has_input" = "true" ]; then
        echo "  ✓ Input textarea exists"
    else
        echo "  ✗ No input textarea found"
    fi

    echo ""
    echo "=========================================="
}

# ============================================================================
# Run Tests
# ============================================================================

echo "Starting user-centric terminal tests..."
echo ""

test_terminal_displays_prompt
test_terminal_receives_shell_prompt
test_type_and_verify_echo
test_interactive_command
test_terminal_event_flow
test_console_logs_for_terminal
test_full_terminal_workflow

echo ""
echo "Tests complete."
