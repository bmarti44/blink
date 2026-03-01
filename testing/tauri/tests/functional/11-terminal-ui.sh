#!/bin/bash
# Terminal UI integration tests for Blink
# Tests the actual VS Code terminal UI functionality

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Terminal UI Tests
# ============================================================================

test_terminal_panel_visible() {
    # Check if terminal panel exists in the workbench
    local result=$(test_query ".panel .terminal-outer-container, .panel [class*='terminal']")
    echo "Terminal panel query result: $result"

    local found=$(echo "$result" | jq -r '.found')
    # Terminal panel may not be visible until opened
    assert_not_empty "$result" "Should get a response for terminal panel query"
}

test_open_terminal_via_command() {
    # Try to open a terminal using VS Code command
    local result=$(test_js "(async () => {
        try {
            // Try to execute the terminal command
            if (window.vscode && window.vscode.commands) {
                await window.vscode.commands.executeCommand('workbench.action.terminal.new');
                return { success: true, message: 'Command executed' };
            }
            return { success: false, message: 'vscode.commands not available' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    echo "Open terminal command result: $result"

    local success=$(echo "$result" | jq -r '.result.success // false')
    local message=$(echo "$result" | jq -r '.result.message // "unknown"')

    echo "Success: $success, Message: $message"
}

test_terminal_xterm_element() {
    # After opening terminal, check for xterm.js elements
    sleep 1

    local result=$(test_query ".xterm, .xterm-screen, .xterm-viewport")
    echo "Xterm element query: $result"

    local found=$(echo "$result" | jq -r '.found')
    local count=$(echo "$result" | jq -r '.count')

    echo "Found xterm elements: $found, count: $count"
}

test_terminal_instance_exists() {
    # Check if terminal instances exist in the terminal service
    local result=$(test_js "(async () => {
        try {
            // Try to access terminal service
            const terminalService = window.__BLINK_SERVICES__?.terminalService;
            if (terminalService) {
                const instances = terminalService.instances || [];
                return {
                    success: true,
                    instanceCount: instances.length,
                    hasService: true
                };
            }

            // Alternative: check via vscode API
            if (window.vscode && window.vscode.window) {
                const terminals = window.vscode.window.terminals || [];
                return {
                    success: true,
                    instanceCount: terminals.length,
                    hasService: false,
                    hasVscodeApi: true
                };
            }

            return { success: false, message: 'No terminal service found' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    echo "Terminal instance check: $result"
}

test_terminal_backend_connected() {
    # Verify terminal backend is initialized
    local result=$(test_js "(async () => {
        try {
            // Check if Tauri invoke works for terminal
            const shell = await window.__TAURI__.core.invoke('get_default_shell', {});
            return { success: true, shell: shell };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    echo "Terminal backend check: $result"

    local success=$(echo "$result" | jq -r '.result.success')
    assert_equals "$success" "true" "Terminal backend should be accessible"
}

test_spawn_and_check_terminal_data() {
    # Spawn a terminal and check if data events are received
    local result=$(test_js "(async () => {
        try {
            // Spawn a terminal
            const termInfo = await window.__TAURI__.core.invoke('spawn_terminal', {});
            console.log('[Test] Spawned terminal:', termInfo);

            // Set up listener for terminal data
            let dataReceived = false;
            let receivedData = '';

            const { listen } = await import('@tauri-apps/api/event');
            const unlisten = await listen('terminal-data-' + termInfo.id, (event) => {
                dataReceived = true;
                receivedData += event.payload;
                console.log('[Test] Received terminal data:', event.payload);
            });

            // Write to terminal to trigger response
            await window.__TAURI__.core.invoke('write_to_terminal', {
                terminalId: termInfo.id,
                data: 'echo test\\n'
            });

            // Wait a bit for data
            await new Promise(r => setTimeout(r, 500));

            // Cleanup
            unlisten();
            await window.__TAURI__.core.invoke('kill_terminal', { terminalId: termInfo.id });

            return {
                success: true,
                terminalId: termInfo.id,
                dataReceived: dataReceived,
                receivedData: receivedData.substring(0, 200)
            };
        } catch (e) {
            return { success: false, message: e.message, stack: e.stack };
        }
    })()")

    echo "Spawn and data check result: $result"

    local success=$(echo "$result" | jq -r '.result.success')
    local dataReceived=$(echo "$result" | jq -r '.result.dataReceived')

    assert_equals "$success" "true" "Should spawn terminal successfully"
    assert_equals "$dataReceived" "true" "Should receive terminal data events"
}

test_terminal_process_start_called() {
    # Check if TauriTerminalProcess.start() is being called
    local result=$(test_js "(async () => {
        try {
            // Check console logs for terminal process messages
            const logs = window.__TEST_BRIDGE__.getConsoleLogs();
            const terminalLogs = logs.filter(l =>
                l.message.includes('[TauriTerminal') ||
                l.message.includes('terminal') ||
                l.message.includes('Terminal')
            );

            return {
                success: true,
                terminalLogCount: terminalLogs.length,
                recentLogs: terminalLogs.slice(-10).map(l => l.message)
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    echo "Terminal process logs: $result"
}

test_check_terminal_errors() {
    # Check for any terminal-related errors
    local result=$(curl -s "$TEST_SERVER/errors")
    local errors=$(echo "$result" | jq '.entries')

    echo "Error entries: $errors"

    local terminalErrors=$(echo "$result" | jq '[.entries[] | select(.message | contains("terminal") or contains("Terminal") or contains("pty") or contains("PTY"))]')
    echo "Terminal-related errors: $terminalErrors"
}

test_console_terminal_logs() {
    # Get all console logs related to terminal
    local result=$(curl -s "$TEST_SERVER/console")

    local terminalLogs=$(echo "$result" | jq '[.entries[] | select(.message | test("terminal|Terminal|PTY|pty|TauriTerminal"; "i"))] | .[-20:]')
    echo "Recent terminal console logs:"
    echo "$terminalLogs" | jq -r '.[] | "\(.level): \(.message)"'
}

test_terminal_service_override_loaded() {
    # Check if terminal service override is properly loaded
    local result=$(test_js "(async () => {
        try {
            // Check if the terminal service is available
            const hasTerminalService = typeof window !== 'undefined';

            // Try to find terminal-related services in the workbench
            const workbench = document.querySelector('.monaco-workbench');
            const panel = document.querySelector('.panel');
            const terminalTab = document.querySelector('[id*=\"terminal\"], [aria-label*=\"Terminal\"]');

            return {
                success: true,
                hasWorkbench: !!workbench,
                hasPanel: !!panel,
                hasTerminalTab: !!terminalTab,
                terminalTabInfo: terminalTab ? {
                    id: terminalTab.id,
                    className: terminalTab.className,
                    ariaLabel: terminalTab.getAttribute('aria-label')
                } : null
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    echo "Terminal service check: $result"
}

test_click_terminal_tab() {
    # Click on the Terminal tab in the panel
    local result=$(test_js "(async () => {
        try {
            // Find and click the Terminal tab
            const tabs = document.querySelectorAll('.panel-switcher-container .action-item');
            let terminalTab = null;

            for (const tab of tabs) {
                const label = tab.querySelector('.action-label');
                if (label && label.textContent.includes('Terminal')) {
                    terminalTab = tab;
                    break;
                }
            }

            if (terminalTab) {
                terminalTab.click();
                await new Promise(r => setTimeout(r, 500));

                // Check if terminal panel is now visible
                const terminalPanel = document.querySelector('.terminal-outer-container, [id*=\"workbench.panel.terminal\"]');

                return {
                    success: true,
                    clicked: true,
                    terminalPanelVisible: !!terminalPanel
                };
            }

            return { success: false, message: 'Terminal tab not found' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    echo "Click terminal tab result: $result"
}

test_create_terminal_via_ui() {
    # Try to create a terminal via the UI
    local result=$(test_js "(async () => {
        try {
            // First, make sure terminal panel is visible
            const terminalTab = Array.from(document.querySelectorAll('.panel-switcher-container .action-item'))
                .find(tab => tab.textContent.includes('Terminal'));

            if (terminalTab) {
                terminalTab.click();
                await new Promise(r => setTimeout(r, 300));
            }

            // Look for the '+' button to create new terminal
            const addButton = document.querySelector('.terminal-actions .codicon-plus, [aria-label*=\"New Terminal\"], [title*=\"New Terminal\"]');

            if (addButton) {
                addButton.click();
                await new Promise(r => setTimeout(r, 1000));

                // Check if terminal was created
                const xterm = document.querySelector('.xterm');
                const terminalContainer = document.querySelector('.terminal-outer-container');

                return {
                    success: true,
                    clicked: true,
                    hasXterm: !!xterm,
                    hasContainer: !!terminalContainer
                };
            }

            // Try via command palette instead
            if (window.vscode && window.vscode.commands) {
                await window.vscode.commands.executeCommand('workbench.action.terminal.new');
                await new Promise(r => setTimeout(r, 1000));
            }

            const xterm = document.querySelector('.xterm');
            return {
                success: true,
                usedCommand: true,
                hasXterm: !!xterm
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    echo "Create terminal via UI result: $result"
}

test_terminal_input_handler() {
    # Check if the terminal can receive input
    local result=$(test_js "(async () => {
        try {
            const xterm = document.querySelector('.xterm');
            if (!xterm) {
                return { success: false, message: 'No xterm element found' };
            }

            // Find the textarea that handles input
            const textarea = xterm.querySelector('.xterm-helper-textarea, textarea');
            if (!textarea) {
                return { success: false, message: 'No input textarea found in xterm' };
            }

            // Check if textarea is focusable
            textarea.focus();
            const isFocused = document.activeElement === textarea;

            // Check textarea properties
            return {
                success: true,
                hasTextarea: true,
                isFocused: isFocused,
                textareaInfo: {
                    tagName: textarea.tagName,
                    className: textarea.className,
                    readOnly: textarea.readOnly,
                    disabled: textarea.disabled,
                    tabIndex: textarea.tabIndex
                }
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    echo "Terminal input handler check: $result"
}

test_simulate_terminal_input() {
    # Actually simulate typing in the terminal and see if it reaches the backend
    local result=$(test_js "(async () => {
        try {
            // Focus the terminal
            const xterm = document.querySelector('.xterm.focus, .xterm');
            if (!xterm) {
                return { success: false, step: 'find_xterm', message: 'No xterm element' };
            }

            const textarea = xterm.querySelector('.xterm-helper-textarea, textarea');
            if (!textarea) {
                return { success: false, step: 'find_textarea', message: 'No textarea' };
            }

            // Focus textarea
            textarea.focus();
            await new Promise(r => setTimeout(r, 100));

            // List terminals before input
            const terminalsBefore = await window.__TAURI__.core.invoke('list_terminals', {});

            // Simulate keyboard input
            const testString = 'test123';
            for (const char of testString) {
                const keyEvent = new KeyboardEvent('keydown', {
                    key: char,
                    code: 'Key' + char.toUpperCase(),
                    bubbles: true,
                    cancelable: true
                });
                textarea.dispatchEvent(keyEvent);

                // Also dispatch input event
                const inputEvent = new InputEvent('input', {
                    data: char,
                    inputType: 'insertText',
                    bubbles: true
                });
                textarea.dispatchEvent(inputEvent);
            }

            await new Promise(r => setTimeout(r, 500));

            // List terminals after input
            const terminalsAfter = await window.__TAURI__.core.invoke('list_terminals', {});

            return {
                success: true,
                terminalsBefore: terminalsBefore.length,
                terminalsAfter: terminalsAfter.length,
                terminalIds: terminalsAfter.map(t => t.id)
            };
        } catch (e) {
            return { success: false, message: e.message, stack: e.stack };
        }
    })()")

    echo "Simulate terminal input result: $result"
}

test_check_active_terminals() {
    # Check what terminals the backend knows about
    local result=$(test_invoke "list_terminals" "{}")
    echo "Active terminals from backend: $result"

    local count=$(echo "$result" | jq '.result | length')
    echo "Terminal count: $count"
}

# ============================================================================
# Run Tests
# ============================================================================

run_tests
