#!/bin/bash
# End-to-end terminal tests for Blink
# Comprehensive tests to verify the terminal integration is working

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Terminal Backend Registration Tests
# ============================================================================

test_backend_in_registry() {
    echo "Testing: Backend is registered in the terminal registry..."

    local result=$(test_js "(async () => {
        try {
            // Check if our backend is in the registry
            const backend = window.__TERMINAL_BACKEND_REGISTRY__?.getTerminalBackend?.(undefined);
            if (!backend) {
                return {
                    success: false,
                    message: 'No backend found in registry',
                    hasRegistry: !!window.__TERMINAL_BACKEND_REGISTRY__
                };
            }

            return {
                success: true,
                remoteAuthority: backend.remoteAuthority,
                hasWhenReady: typeof backend.whenReady === 'object',
                hasCreateProcess: typeof backend.createProcess === 'function',
                hasGetDefaultSystemShell: typeof backend.getDefaultSystemShell === 'function'
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    local success=$(echo "$result" | jq -r '.result.success // false')
    if [ "$success" = "true" ]; then
        echo "  ✓ Backend is registered in the terminal registry"
        local hasCreateProcess=$(echo "$result" | jq -r '.result.hasCreateProcess')
        local hasGetDefaultShell=$(echo "$result" | jq -r '.result.hasGetDefaultSystemShell')
        echo "    - hasCreateProcess: $hasCreateProcess"
        echo "    - hasGetDefaultSystemShell: $hasGetDefaultShell"
        return 0
    else
        echo "  ✗ Backend not found in registry"
        echo "  Details: $(echo "$result" | jq -r '.result.message // "unknown"')"
        return 1
    fi
}

test_terminal_instance_service() {
    echo "Testing: Terminal instance service has backend..."

    local result=$(test_js "(async () => {
        try {
            const instanceService = window.__TERMINAL_INSTANCE_SERVICE__;
            if (!instanceService) {
                return { success: false, message: 'No terminal instance service exposed' };
            }

            // Try to get the backend via the instance service
            const backend = await instanceService.getBackend(undefined);

            return {
                success: !!backend,
                hasBackend: !!backend,
                backendType: backend?.constructor?.name || 'unknown'
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    local success=$(echo "$result" | jq -r '.result.success // false')
    if [ "$success" = "true" ]; then
        echo "  ✓ Terminal instance service can get backend"
        local backendType=$(echo "$result" | jq -r '.result.backendType')
        echo "    - Backend type: $backendType"
        return 0
    else
        echo "  ✗ Terminal instance service cannot get backend"
        echo "  Details: $(echo "$result" | jq -r '.result.message // "unknown"')"
        return 1
    fi
}

test_terminal_service_instances() {
    echo "Testing: Terminal service has instances..."

    local result=$(test_js "(async () => {
        try {
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService) {
                return { success: false, message: 'No terminal service exposed' };
            }

            return {
                success: true,
                instanceCount: terminalService.instances?.length || 0,
                instances: (terminalService.instances || []).map(i => ({
                    id: i.instanceId,
                    title: i.title,
                    hasProcess: !!i._processManager?._process
                }))
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    echo "  Terminal service state: $(echo "$result" | jq -r '.result | @json')"

    local success=$(echo "$result" | jq -r '.result.success // false')
    if [ "$success" = "true" ]; then
        echo "  ✓ Terminal service is accessible"
        return 0
    else
        echo "  ✗ Terminal service check failed"
        return 1
    fi
}

# ============================================================================
# Process Manager Tests
# ============================================================================

test_process_manager_has_backend() {
    echo "Testing: Process manager has backend attached..."

    local result=$(test_js "(async () => {
        try {
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService || !terminalService.instances?.length) {
                return { success: false, message: 'No terminal instances' };
            }

            const instance = terminalService.instances[0];
            const pm = instance._processManager;

            if (!pm) {
                return { success: false, message: 'No process manager' };
            }

            return {
                success: true,
                hasBackend: !!pm.backend,
                backendType: pm.backend?.constructor?.name || 'none',
                processState: pm.processState,
                hasProcess: !!pm._process
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    local hasBackend=$(echo "$result" | jq -r '.result.hasBackend // false')
    local hasProcess=$(echo "$result" | jq -r '.result.hasProcess // false')

    echo "  Process manager state:"
    echo "    - hasBackend: $hasBackend"
    echo "    - hasProcess: $hasProcess"
    echo "    - backendType: $(echo "$result" | jq -r '.result.backendType // "none"')"
    echo "    - processState: $(echo "$result" | jq -r '.result.processState // "unknown"')"

    if [ "$hasBackend" = "true" ] && [ "$hasProcess" = "true" ]; then
        echo "  ✓ Process manager is properly connected"
        return 0
    elif [ "$hasBackend" = "true" ]; then
        echo "  ⚠ Backend attached but no process yet"
        return 0
    else
        echo "  ✗ Process manager has no backend"
        return 1
    fi
}

# ============================================================================
# Terminal Data Flow Tests
# ============================================================================

test_write_and_read_terminal_data() {
    echo "Testing: Write to terminal and verify data flow..."

    # This test verifies data flow using the VS Code terminal path (pm.write)
    # which properly goes through the TauriTerminalProcess
    local result=$(test_js "(async () => {
        const ts = window.__TERMINAL_SERVICE__;
        if (!ts || !ts.instances || !ts.instances.length) {
            return { success: false, message: 'No terminal instances' };
        }

        // Use the last terminal (most likely to have the timing fix applied)
        const inst = ts.instances[ts.instances.length - 1];
        const pm = inst._processManager;
        const xterm = inst.xterm?.raw;

        if (!pm || !xterm) {
            return { success: false, message: 'No process manager or xterm' };
        }

        // Wait for ptyProcessReady
        const ready = await Promise.race([
            pm.ptyProcessReady.then(() => true),
            new Promise(r => setTimeout(() => r(false), 2000))
        ]);

        if (!ready) {
            return { success: false, message: 'ptyProcessReady did not resolve' };
        }

        // Write a unique marker
        const marker = 'DATAFLOW_' + Date.now();
        await pm.write('echo ' + marker + '\\n');

        // Wait for output
        await new Promise(r => setTimeout(r, 800));

        // Check terminal buffer for marker
        const buffer = xterm.buffer.active;
        let content = '';
        for (let i = 0; i < buffer.length; i++) {
            const line = buffer.getLine(i);
            if (line) content += line.translateToString(true) + '\\n';
        }

        const found = content.includes(marker);
        return {
            success: found,
            marker,
            contentLength: content.length,
            message: found ? 'Marker found in terminal output' : 'Marker NOT found'
        };
    })()")

    local success=$(echo "$result" | jq -r '.result.success // false')
    local marker=$(echo "$result" | jq -r '.result.marker // "unknown"')
    local message=$(echo "$result" | jq -r '.result.message // "unknown"')

    if [ "$success" = "true" ]; then
        echo "  ✓ Found marker '$marker' in terminal output"
        return 0
    else
        echo "  ✗ $message"
        return 1
    fi
}

# ============================================================================
# Console Log Analysis
# ============================================================================

test_check_terminal_logs() {
    echo "Checking console logs for terminal initialization..."

    # Check for our key log messages
    local logs=$(curl -s "$TEST_SERVER/console" | jq '[.entries[] | select(.message | test("TauriTerminalBackend|Terminal backend|createProcess|didRegisterBackend"; "i"))] | .[-15:]')

    echo "  Terminal-related logs:"
    echo "$logs" | jq -r '.[] | "    \(.level): \(.message[0:100])"'

    # Check for critical messages
    local has_backend_created=$(echo "$logs" | jq 'any(.message | contains("Singleton created"))')
    local has_backend_registered=$(echo "$logs" | jq 'any(.message | contains("backend registration notified"))')
    local has_create_process=$(echo "$logs" | jq 'any(.message | contains("createProcess"))')

    echo ""
    echo "  Key initialization steps:"
    echo "    - Backend singleton created: $has_backend_created"
    echo "    - Backend registration notified: $has_backend_registered"
    echo "    - createProcess called: $has_create_process"
}

test_check_terminal_errors() {
    echo "Checking for terminal-related errors..."

    local errors=$(curl -s "$TEST_SERVER/errors" | jq '[.entries[] | select(.message | test("terminal|Terminal|PTY|pty|backend"; "i"))]')
    local error_count=$(echo "$errors" | jq 'length')

    if [ "$error_count" -eq 0 ]; then
        echo "  ✓ No terminal-related errors found"
        return 0
    else
        echo "  ⚠ Found $error_count terminal-related error(s):"
        echo "$errors" | jq -r '.[] | "    ERROR: \(.message[0:150])"'
        return 1
    fi
}

# ============================================================================
# Character Doubling Test
# ============================================================================

test_character_doubling() {
    echo "Testing: Character input is not doubled..."

    # This test simulates user typing via xterm's input method
    # and verifies that characters don't appear twice
    local result=$(test_js "(async () => {
        try {
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService || !terminalService.instances?.length) {
                return { success: false, message: 'No terminal instances' };
            }

            const instance = terminalService.instances[0];
            const xterm = instance.xterm?.raw;

            if (!xterm) {
                return { success: false, message: 'No xterm instance' };
            }

            // Wait for terminal to be ready
            await new Promise(r => setTimeout(r, 500));

            // Clear terminal and capture initial state
            // Send a unique test marker via xterm input (simulating user typing)
            const testString = 'X' + Math.random().toString(36).slice(2, 6);

            // Collect output data
            const outputData = [];
            const disposable = xterm.onData(data => {
                // This is input data (what user types), not output
            });

            // Listen for output from the process
            const outputCollector = [];
            const pm = instance._processManager;
            const processDataHandler = pm.onProcessData(e => {
                outputCollector.push(e.data);
            });

            // Simulate typing by calling xterm's internal input handler
            // In xterm.js, user input triggers the onData event
            // We need to write TO the terminal to see output
            await pm.write('echo ' + testString + '\\n');

            // Wait for echo
            await new Promise(r => setTimeout(r, 1000));

            // Clean up
            disposable.dispose();
            processDataHandler.dispose();

            // Get current terminal content
            const buffer = xterm.buffer.active;
            let content = '';
            for (let i = 0; i < buffer.length; i++) {
                const line = buffer.getLine(i);
                if (line) {
                    content += line.translateToString(true) + '\\n';
                }
            }

            // Count occurrences of the test string in the output
            // It should appear exactly twice: once in the command, once in the output
            const regex = new RegExp(testString, 'g');
            const matches = content.match(regex) || [];

            return {
                success: matches.length <= 2,
                testString: testString,
                occurrences: matches.length,
                expectedMax: 2,
                content: content.substring(0, 500),
                outputCollected: outputCollector.join('').substring(0, 200)
            };
        } catch (e) {
            return { success: false, message: e.message, stack: e.stack };
        }
    })()")

    local success=$(echo "$result" | jq -r '.result.success // false')
    local occurrences=$(echo "$result" | jq -r '.result.occurrences // 0')
    local testString=$(echo "$result" | jq -r '.result.testString // ""')

    if [ "$success" = "true" ]; then
        echo "  ✓ No character doubling detected"
        echo "    - Test string '$testString' appeared $occurrences time(s) (expected ≤2)"
        return 0
    else
        echo "  ✗ Possible character doubling detected"
        echo "    - Test string '$testString' appeared $occurrences time(s) (expected ≤2)"
        echo "    - Content: $(echo "$result" | jq -r '.result.content // "empty"' | head -c 200)"
        return 1
    fi
}

test_input_call_tracking() {
    echo "Testing: Track input() calls for doubling detection..."

    # Clear the tracking array first
    test_js "window.__INPUT_CALLS__ = []; 'cleared'" > /dev/null

    # Send a single character through the process manager
    local result=$(test_js "(async () => {
        try {
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService || !terminalService.instances?.length) {
                return { success: false, message: 'No terminal instances' };
            }

            const instance = terminalService.instances[0];
            const pm = instance._processManager;

            if (!pm) {
                return { success: false, message: 'No process manager' };
            }

            // Clear tracking
            window.__INPUT_CALLS__ = [];

            // Send a single test character
            await pm.write('X');

            // Wait for async processing
            await new Promise(r => setTimeout(r, 500));

            // Check how many times input() was called
            const calls = window.__INPUT_CALLS__ || [];
            const xCalls = calls.filter(c => c.data.includes('X'));

            return {
                success: true,
                totalCalls: calls.length,
                xCalls: xCalls.length,
                calls: calls.map(c => ({
                    data: c.data,
                    terminalId: c.terminalId,
                    stack: c.stack?.slice(0, 3)
                })),
                doubled: xCalls.length > 1
            };
        } catch (e) {
            return { success: false, message: e.message, stack: e.stack };
        }
    })()")

    local success=$(echo "$result" | jq -r '.result.success')
    local doubled=$(echo "$result" | jq -r '.result.doubled')
    local xCalls=$(echo "$result" | jq -r '.result.xCalls // 0')
    local totalCalls=$(echo "$result" | jq -r '.result.totalCalls // 0')

    echo "  Input tracking results:"
    echo "    - Total input() calls: $totalCalls"
    echo "    - Calls containing 'X': $xCalls (expected 1)"

    if [ "$success" = "true" ]; then
        if [ "$doubled" = "true" ]; then
            echo "  ✗ INPUT IS DOUBLED! input() called $xCalls times for single character"
            echo "  Call stacks:"
            echo "$result" | jq -r '.result.calls[] | "    \(.data) via \(.stack[0] // "unknown")"'
            return 1
        else
            echo "  ✓ Input is not doubled (called $xCalls time)"
            return 0
        fi
    else
        echo "  ✗ Test failed: $(echo "$result" | jq -r '.result.message')"
        return 1
    fi
}

test_terminal_content_for_doubling() {
    echo "Testing: Terminal content for character doubling via CSS selector..."

    # This test writes a unique marker and checks if it appears doubled in the terminal content
    local marker="DBLTEST$(date +%s)"

    # First, type the marker into the terminal and press Enter
    local type_result=$(test_js "(async () => {
        try {
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService || !terminalService.instances?.length) {
                return { success: false, message: 'No terminal instances' };
            }

            const instance = terminalService.instances[0];
            const pm = instance._processManager;

            if (!pm) {
                return { success: false, message: 'No process manager' };
            }

            // Clear terminal first
            const xterm = instance.xterm?.raw;
            if (xterm) {
                xterm.clear();
            }

            // Wait for clear
            await new Promise(r => setTimeout(r, 200));

            // Type a test command with the marker
            await pm.write('echo ${marker}\\n');

            // Wait for shell to echo back
            await new Promise(r => setTimeout(r, 1500));

            return { success: true, marker: '${marker}' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    local typed=$(echo "$type_result" | jq -r '.result.success')
    if [ "$typed" != "true" ]; then
        echo "  ✗ Failed to type in terminal: $(echo "$type_result" | jq -r '.result.message')"
        return 1
    fi

    # Wait a bit more for rendering
    sleep 1

    # Now read the terminal content using CSS selector
    local content_result=$(test_js "(async () => {
        try {
            // Get xterm content from the DOM
            // xterm renders to canvas, but we can get the buffer content
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService || !terminalService.instances?.length) {
                return { success: false, message: 'No terminal instances' };
            }

            const instance = terminalService.instances[0];
            const xterm = instance.xterm?.raw;

            if (!xterm) {
                return { success: false, message: 'No xterm' };
            }

            // Get buffer content
            const buffer = xterm.buffer.active;
            let lines = [];
            for (let i = 0; i < buffer.length; i++) {
                const line = buffer.getLine(i);
                if (line) {
                    const text = line.translateToString(true).trim();
                    if (text) {
                        lines.push(text);
                    }
                }
            }

            const content = lines.join('\\n');

            // Count occurrences of marker
            const marker = '${marker}';
            const regex = new RegExp(marker, 'g');
            const matches = content.match(regex) || [];

            // Also check for doubled characters in the marker itself
            // If doubled, we'd see something like 'DDBBLLTTEE...' instead of 'DBLTEST...'
            const doubledPattern = marker.split('').map(c => c + c).join('');
            const hasDoubled = content.includes(doubledPattern);

            return {
                success: true,
                content: content,
                marker: marker,
                markerCount: matches.length,
                hasDoubledPattern: hasDoubled,
                lines: lines.slice(0, 10),
                lineCount: lines.length
            };
        } catch (e) {
            return { success: false, message: e.message };
        }
    })()")

    local success=$(echo "$content_result" | jq -r '.result.success')
    local markerCount=$(echo "$content_result" | jq -r '.result.markerCount // 0')
    local hasDoubled=$(echo "$content_result" | jq -r '.result.hasDoubledPattern // false')
    local content=$(echo "$content_result" | jq -r '.result.content // ""')

    echo "  Terminal content analysis:"
    echo "    - Marker '$marker' appears $markerCount time(s)"
    echo "    - Has doubled pattern: $hasDoubled"
    echo "    - Lines: $(echo "$content_result" | jq -r '.result.lines | @json')"

    if [ "$success" = "true" ]; then
        # Marker should appear exactly 2 times: once in 'echo MARKER' and once in output
        # If it appears more, there might be doubling
        if [ "$markerCount" -gt 2 ]; then
            echo "  ✗ Character doubling detected! Marker appeared $markerCount times (expected ≤2)"
            return 1
        elif [ "$hasDoubled" = "true" ]; then
            echo "  ✗ Character doubling detected! Found doubled pattern in content"
            return 1
        else
            echo "  ✓ No character doubling detected"
            return 0
        fi
    else
        echo "  ✗ Failed to read terminal content: $(echo "$content_result" | jq -r '.result.message')"
        return 1
    fi
}

test_pty_ready_resolves() {
    echo "Testing: ptyProcessReady resolves for new terminals..."

    # This is the CRITICAL test for the timing fix.
    # It verifies that when a new terminal is created, the ptyProcessReady
    # promise resolves within a reasonable time (not stuck forever).
    # This catches the bug where onReady was fired before ProcessManager subscribed.
    local result=$(test_js "(async () => {
        try {
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService) {
                return { success: false, message: 'No terminal service' };
            }

            // Create a new terminal
            const beforeCreate = Date.now();
            await terminalService.createTerminal({});

            // Get the new terminal instance
            const instance = terminalService.instances[terminalService.instances.length - 1];
            const pm = instance._processManager;

            if (!pm) {
                return { success: false, message: 'No process manager' };
            }

            // Check if ptyProcessReady resolves within 2 seconds
            const readyResult = await Promise.race([
                pm.ptyProcessReady.then(() => ({ resolved: true, time: Date.now() - beforeCreate })),
                new Promise(r => setTimeout(() => r({ resolved: false, time: 2000 }), 2000))
            ]);

            // Also verify processReadyTimestamp is set
            const hasTimestamp = pm.processReadyTimestamp > 0;

            return {
                success: readyResult.resolved && hasTimestamp,
                ptyReadyResolved: readyResult.resolved,
                resolveTime: readyResult.time,
                hasProcessReadyTimestamp: hasTimestamp,
                processReadyTimestamp: pm.processReadyTimestamp
            };
        } catch (e) {
            return { success: false, message: e.message, stack: e.stack };
        }
    })()")

    local success=$(echo "$result" | jq -r '.result.success // false')
    local resolved=$(echo "$result" | jq -r '.result.ptyReadyResolved // false')
    local resolveTime=$(echo "$result" | jq -r '.result.resolveTime // 0')
    local hasTimestamp=$(echo "$result" | jq -r '.result.hasProcessReadyTimestamp // false')

    if [ "$success" = "true" ]; then
        echo "  ✓ ptyProcessReady resolves correctly"
        echo "    - Resolved in ${resolveTime}ms"
        echo "    - processReadyTimestamp set: $hasTimestamp"
        return 0
    else
        echo "  ✗ ptyProcessReady FAILED to resolve"
        echo "    - Resolved: $resolved"
        echo "    - This indicates the onReady event timing bug"
        echo "    - Error: $(echo "$result" | jq -r '.result.message // "unknown"')"
        return 1
    fi
}

test_pm_write_works() {
    echo "Testing: ProcessManager.write() works for new terminals..."

    # This test verifies that pm.write() completes without hanging.
    # If onReady fires before ProcessManager subscribes, pm.write() will hang forever.
    local result=$(test_js "(async () => {
        try {
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService) {
                return { success: false, message: 'No terminal service' };
            }

            // Get the most recent terminal
            const instance = terminalService.instances[terminalService.instances.length - 1];
            const pm = instance._processManager;
            const xterm = instance.xterm?.raw;

            if (!pm || !xterm) {
                return { success: false, message: 'No process manager or xterm' };
            }

            // Ensure ptyProcessReady is resolved first
            const readyTimeout = await Promise.race([
                pm.ptyProcessReady.then(() => false),
                new Promise(r => setTimeout(() => r(true), 1000))
            ]);

            if (readyTimeout) {
                return { success: false, message: 'ptyProcessReady did not resolve' };
            }

            // Now test that write completes
            const marker = 'PMWRITE_' + Date.now();
            const beforeWrite = Date.now();

            const writeTimeout = await Promise.race([
                pm.write('echo ' + marker + '\\\\n').then(() => false),
                new Promise(r => setTimeout(() => r(true), 2000))
            ]);

            if (writeTimeout) {
                return { success: false, message: 'pm.write() timed out', writeTime: 2000 };
            }

            const writeTime = Date.now() - beforeWrite;

            // Wait for output
            await new Promise(r => setTimeout(r, 500));

            // Check terminal buffer for the marker
            const buffer = xterm.buffer.active;
            let content = '';
            for (let i = 0; i < buffer.length; i++) {
                const line = buffer.getLine(i);
                if (line) content += line.translateToString(true) + '\\\\n';
            }

            const hasMarker = content.includes(marker);

            return {
                success: hasMarker,
                writeTime,
                markerFound: hasMarker,
                marker: marker
            };
        } catch (e) {
            return { success: false, message: e.message, stack: e.stack };
        }
    })()")

    local success=$(echo "$result" | jq -r '.result.success // false')
    local writeTime=$(echo "$result" | jq -r '.result.writeTime // 0')
    local markerFound=$(echo "$result" | jq -r '.result.markerFound // false')

    if [ "$success" = "true" ]; then
        echo "  ✓ ProcessManager.write() works correctly"
        echo "    - Write completed in ${writeTime}ms"
        echo "    - Output marker found: $markerFound"
        return 0
    else
        echo "  ✗ ProcessManager.write() FAILED"
        echo "    - Error: $(echo "$result" | jq -r '.result.message // "unknown"')"
        return 1
    fi
}

test_simulated_user_typing() {
    echo "Testing: Simulated user typing via xterm internal events..."

    # This test simulates user typing by firing xterm's internal _onData event.
    #
    # WHY NOT DISPATCHED KeyboardEvents?
    # xterm.js uses its own keyboard handling that doesn't respond to synthetic
    # browser KeyboardEvents. Real keyboard input goes through xterm's internal
    # handlers which then fire _onData. We simulate at this level because:
    # 1. It's what real typing triggers
    # 2. Synthetic KeyboardEvents don't work with xterm
    # 3. This tests the full path from xterm -> pm.write() -> process.input()
    local result=$(test_js "(async () => {
        try {
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService || !terminalService.instances?.length) {
                return { success: false, message: 'No terminal instances' };
            }

            const instance = terminalService.instances[terminalService.instances.length - 1];
            const pm = instance._processManager;
            const xterm = instance.xterm?.raw;

            if (!pm || !xterm) {
                return { success: false, message: 'No process manager or xterm' };
            }

            // Ensure ptyProcessReady is resolved (critical for pm.write to work)
            const readyResult = await Promise.race([
                pm.ptyProcessReady.then(() => 'ready'),
                new Promise(r => setTimeout(() => r('timeout'), 1000))
            ]);

            if (readyResult === 'timeout') {
                return { success: false, message: 'ptyProcessReady did not resolve - timing bug!' };
            }

            // Track writes to verify data flows through
            let writesReceived = [];
            const origWrite = pm.write.bind(pm);
            pm.write = (data) => {
                writesReceived.push(data);
                return origWrite(data);
            };

            // Simulate user typing by firing xterm's internal onData event
            // This is exactly what happens when a user presses a key
            const testInput = 'echo SIMULATED_TYPE_TEST\\n';
            if (xterm._core && xterm._core._onData) {
                xterm._core._onData.fire(testInput);
            } else {
                pm.write = origWrite;
                return { success: false, message: 'xterm._core._onData not available' };
            }

            await new Promise(r => setTimeout(r, 800));

            // Restore original
            pm.write = origWrite;

            // Check if input was received
            const inputReceived = writesReceived.some(w => w.includes('SIMULATED_TYPE_TEST'));

            // Also check terminal output for the echoed result
            const buffer = xterm.buffer.active;
            let content = '';
            for (let i = 0; i < buffer.length; i++) {
                const line = buffer.getLine(i);
                if (line) content += line.translateToString(true) + '\\n';
            }
            const outputVisible = content.includes('SIMULATED_TYPE_TEST');

            return {
                success: inputReceived && outputVisible,
                inputReceived,
                outputVisible,
                writesCount: writesReceived.length,
                message: inputReceived && outputVisible
                    ? 'Simulated typing works end-to-end'
                    : 'Simulated typing failed: input=' + inputReceived + ', output=' + outputVisible
            };
        } catch (e) {
            return { success: false, message: e.message, stack: e.stack };
        }
    })()")

    local success=$(echo "$result" | jq -r '.result.success // false')
    local inputReceived=$(echo "$result" | jq -r '.result.inputReceived // false')
    local outputVisible=$(echo "$result" | jq -r '.result.outputVisible // false')
    local message=$(echo "$result" | jq -r '.result.message // "unknown"')

    if [ "$success" = "true" ]; then
        echo "  ✓ Simulated user typing works"
        echo "    - Input received by pm.write(): $inputReceived"
        echo "    - Output visible in terminal: $outputVisible"
        return 0
    else
        echo "  ✗ Simulated user typing FAILED"
        echo "    - $message"
        return 1
    fi
}

test_keyboard_input_reaches_process() {
    echo "Testing: Keyboard input via xterm.onData reaches the process..."

    # This test verifies that when xterm fires onData (which happens when user types),
    # the data reaches the terminal process via pm.write().
    # Note: Synthetic KeyboardEvents don't trigger xterm's internal handlers,
    # so we test via the onData event directly.
    local result=$(test_js "(async () => {
        try {
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService || !terminalService.instances?.length) {
                return { success: false, message: 'No terminal instances' };
            }

            const instance = terminalService.instances[terminalService.instances.length - 1];
            const pm = instance._processManager;
            const xterm = instance.xterm?.raw;

            if (!pm || !xterm) {
                return { success: false, message: 'No process manager or xterm' };
            }

            // Ensure ptyProcessReady is resolved
            await Promise.race([
                pm.ptyProcessReady,
                new Promise((_, reject) => setTimeout(() => reject('timeout'), 1000))
            ]).catch(() => null);

            // Track if data reaches the process by monitoring pm.write calls
            let writesCalled = 0;
            const origWrite = pm.write.bind(pm);
            pm.write = (data) => {
                writesCalled++;
                return origWrite(data);
            };

            // Simulate xterm receiving input data (this is what happens when user types)
            // In real usage, xterm's keyboard handler fires this event
            const testData = 'XYZ';
            if (xterm._core && xterm._core._onData) {
                xterm._core._onData.fire(testData);
            }

            await new Promise(r => setTimeout(r, 500));

            // Restore original
            pm.write = origWrite;

            return {
                success: writesCalled > 0,
                writesCalled,
                message: writesCalled > 0
                    ? 'xterm.onData triggers pm.write()'
                    : 'xterm.onData did NOT trigger pm.write()'
            };
        } catch (e) {
            return { success: false, message: e.message, stack: e.stack };
        }
    })()")

    local success=$(echo "$result" | jq -r '.result.success // false')
    local inputDelta=$(echo "$result" | jq -r '.result.inputDelta // 0')
    local message=$(echo "$result" | jq -r '.result.message // "unknown"')

    if [ "$success" = "true" ]; then
        echo "  ✓ $message"
        echo "    - Input calls increased by $inputDelta"
        return 0
    else
        echo "  ✗ $message"
        echo "    - Input calls increased by $inputDelta (expected > 0)"
        return 1
    fi
}

test_xterm_input_simulation() {
    echo "Testing: Direct xterm input simulation..."

    # This test simulates actual user typing via keyboard events
    # and monitors all data paths for doubling
    local result=$(test_js "(async () => {
        try {
            const terminalService = window.__TERMINAL_SERVICE__;
            if (!terminalService || !terminalService.instances?.length) {
                return { success: false, message: 'No terminal instances' };
            }

            const instance = terminalService.instances[0];
            const xterm = instance.xterm?.raw;
            const pm = instance._processManager;

            if (!xterm || !pm) {
                return { success: false, message: 'No xterm or process manager' };
            }

            // Track all writes to the process
            const inputCalls = [];
            const origInput = pm._process?.input?.bind(pm._process);
            if (pm._process && origInput) {
                pm._process.input = (data) => {
                    inputCalls.push({ data, stack: new Error().stack, time: Date.now() });
                    return origInput(data);
                };
            }

            // Track xterm write calls (output)
            const outputCalls = [];
            const origWrite = xterm.write.bind(xterm);
            xterm.write = (data, callback) => {
                if (typeof data === 'string') {
                    outputCalls.push({ data: data.substring(0, 50), time: Date.now() });
                }
                return origWrite(data, callback);
            };

            // Wait for stability
            await new Promise(r => setTimeout(r, 300));

            // Clear tracking
            inputCalls.length = 0;
            outputCalls.length = 0;

            // Get the xterm container element
            const xtermElement = document.querySelector('.xterm');
            if (!xtermElement) {
                return { success: false, message: 'Cannot find xterm element' };
            }

            // Find the textarea that xterm uses for input
            const textarea = xtermElement.querySelector('.xterm-helper-textarea') ||
                            xtermElement.querySelector('textarea');
            if (textarea) {
                textarea.focus();
            }

            // Simulate typing a single character 'Q' via xterm's internal onData
            // NOTE: Dispatched KeyboardEvents don't trigger xterm's handlers directly,
            // so we use xterm._core._onData.fire() which is what real keyboard input triggers.
            const testChar = 'Q';

            if (xterm._core && xterm._core._onData) {
                xterm._core._onData.fire(testChar);
            } else {
                return { success: false, message: 'xterm._core._onData not available' };
            }

            // Wait for data to flow
            await new Promise(r => setTimeout(r, 800));

            // Restore original methods
            if (origInput) pm._process.input = origInput;
            xterm.write = origWrite;

            // Count how many times 'Q' was sent to the process
            const qInputs = inputCalls.filter(c => c.data.includes(testChar));
            const qOutputs = outputCalls.filter(c => c.data.includes(testChar));

            return {
                success: true,
                inputCallsCount: inputCalls.length,
                qInputsCount: qInputs.length,
                outputCallsCount: outputCalls.length,
                qOutputsCount: qOutputs.length,
                inputCalls: inputCalls.map(c => ({ data: c.data })),
                outputCalls: outputCalls.slice(0, 5).map(c => ({ data: c.data })),
                doubled: qInputs.length > 1,
                outputDoubled: qOutputs.length > 2
            };
        } catch (e) {
            return { success: false, message: e.message, stack: e.stack };
        }
    })()")

    local success=$(echo "$result" | jq -r '.result.success // false')
    local doubled=$(echo "$result" | jq -r '.result.doubled // false')
    local inputCallsCount=$(echo "$result" | jq -r '.result.inputCallsCount // 0')

    if [ "$success" = "true" ]; then
        if [ "$doubled" = "false" ]; then
            echo "  ✓ Input is not doubled"
            echo "    - Input calls count: $inputCallsCount (expected 1)"
            return 0
        else
            echo "  ✗ Input IS doubled!"
            echo "    - Input calls count: $inputCallsCount (expected 1)"
            echo "    - Input calls: $(echo "$result" | jq -r '.result.inputCalls | @json')"
            return 1
        fi
    else
        echo "  ✗ Test failed: $(echo "$result" | jq -r '.result.message // "unknown"')"
        return 1
    fi
}

# ============================================================================
# Full Integration Test
# ============================================================================

test_full_terminal_integration() {
    echo ""
    echo "==========================================="
    echo "  Full Terminal Integration Test"
    echo "==========================================="

    local passed=0
    local failed=0

    echo ""
    echo "Step 1: Backend Registration"
    if test_backend_in_registry; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 2: Instance Service"
    if test_terminal_instance_service; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 3: Terminal Service"
    if test_terminal_service_instances; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 4: Process Manager"
    if test_process_manager_has_backend; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 5: Data Flow"
    if test_write_and_read_terminal_data; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 6: Input Call Tracking"
    if test_input_call_tracking; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 7: Character Doubling Check (buffer analysis)"
    if test_character_doubling; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 8: Terminal Content Check (CSS selector)"
    if test_terminal_content_for_doubling; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 9: ptyProcessReady Resolution (CRITICAL)"
    if test_pty_ready_resolves; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 10: ProcessManager.write() Works"
    if test_pm_write_works; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 11: Simulated User Typing"
    if test_simulated_user_typing; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 12: Keyboard Input Reaches Process"
    if test_keyboard_input_reaches_process; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "Step 13: Dispatched Event Input Simulation"
    if test_xterm_input_simulation; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
    fi

    echo ""
    echo "==========================================="
    echo "  Results: $passed passed, $failed failed"
    echo "==========================================="

    return $failed
}

# ============================================================================
# Run Tests
# ============================================================================

echo "Starting terminal E2E tests..."
echo ""

# Run diagnostic tests first
test_check_terminal_logs
echo ""
test_check_terminal_errors
echo ""

# Run the full integration test
test_full_terminal_integration

echo ""
echo "Terminal E2E tests complete."
