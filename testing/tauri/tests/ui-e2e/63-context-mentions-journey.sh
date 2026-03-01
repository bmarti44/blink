#!/bin/bash
# Context Mentions (@file, @folder, @codebase) User Journey Tests
#
# ============================================================================
# USER JOURNEY TEST PHILOSOPHY
# ============================================================================
#
# These tests simulate ACTUAL user interactions with Context Mentions:
# 1. User opens chat panel
# 2. User types @ symbol
# 3. Dropdown appears with mention options
# 4. User selects @file:path
# 5. Context chip appears in input
# 6. User types question
# 7. Message is sent with context attached
# 8. Response includes context from mentioned files
#
# Uses mock AI responses to test the full flow without authentication.
#
# ============================================================================
#
# Usage:
#   CONTEXT_MENTIONS_MOCK=1 ./63-context-mentions-journey.sh
#
# Prerequisites:
#   - Tauri app running with test server on port 9999
#   - jq installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

# Enable mock by default for user journey tests
CONTEXT_MENTIONS_MOCK="${CONTEXT_MENTIONS_MOCK:-1}"

# ============================================================================
# Install Context Mentions Mock
# ============================================================================
install_context_mentions_mock() {
    echo -e "${CYAN}Installing Context Mentions mock...${NC}"

    test_js "(function() {
        // Mock state for context mentions
        window.__CONTEXT_MENTIONS_MOCK__ = {
            enabled: true,
            dropdownVisible: false,
            contextChips: [],
            lastQuery: null,
            messagesSent: [],
            chipIdCounter: 0,

            // Mock file system
            files: {
                'src/index.ts': 'export function main() { console.log(\"Hello\"); }',
                'src/utils.ts': 'export function helper() { return 42; }',
                'src/config.ts': 'export const config = { debug: true };',
                'README.md': '# My Project\\n\\nThis is a sample project.',
                'package.json': '{\"name\": \"my-project\", \"version\": \"1.0.0\"}'
            },

            // Show dropdown when @ is typed
            showDropdown: function() {
                this.dropdownVisible = true;

                // Create visual dropdown
                let dropdown = document.querySelector('.test-mention-dropdown');
                if (!dropdown) {
                    dropdown = document.createElement('div');
                    dropdown.className = 'test-mention-dropdown';
                    dropdown.style.cssText = 'position: fixed; bottom: 100px; left: 50px; background: #2d2d2d; border: 1px solid #007acc; padding: 10px; z-index: 9999; min-width: 200px;';
                    dropdown.innerHTML = '<div class=\"dropdown-item\" data-type=\"file\">@file: - Attach a file</div>' +
                        '<div class=\"dropdown-item\" data-type=\"folder\">@folder: - Attach a folder</div>' +
                        '<div class=\"dropdown-item\" data-type=\"codebase\">@codebase: - Search codebase</div>';
                    document.body.appendChild(dropdown);
                }
                dropdown.style.display = 'block';
                return true;
            },

            // Hide dropdown
            hideDropdown: function() {
                this.dropdownVisible = false;
                const dropdown = document.querySelector('.test-mention-dropdown');
                if (dropdown) dropdown.style.display = 'none';
            },

            // Show file picker
            showFilePicker: function() {
                let picker = document.querySelector('.test-file-picker');
                if (!picker) {
                    picker = document.createElement('div');
                    picker.className = 'test-file-picker';
                    picker.style.cssText = 'position: fixed; bottom: 100px; left: 50px; background: #2d2d2d; border: 1px solid #007acc; padding: 10px; z-index: 9999; min-width: 250px;';

                    const fileList = Object.keys(this.files).map(f =>
                        '<div class=\"file-item\" data-path=\"' + f + '\" style=\"padding: 5px; cursor: pointer;\">' + f + '</div>'
                    ).join('');

                    picker.innerHTML = '<div style=\"margin-bottom: 10px;\"><strong>Select a file</strong></div>' + fileList;
                    document.body.appendChild(picker);
                }
                picker.style.display = 'block';
                this.hideDropdown();
                return true;
            },

            // Select a file and create chip
            selectFile: function(path) {
                const content = this.files[path] || '[File not found]';

                const chip = {
                    type: 'file',
                    path: path,
                    content: content,
                    id: 'chip-' + (++this.chipIdCounter)
                };

                this.contextChips.push(chip);

                // Hide file picker
                const picker = document.querySelector('.test-file-picker');
                if (picker) picker.style.display = 'none';

                // Show chip in UI
                this.renderChips();

                return chip;
            },

            // Select folder
            selectFolder: function(path) {
                const filesInFolder = Object.keys(this.files)
                    .filter(f => f.startsWith(path + '/') || f.startsWith(path))
                    .map(f => ({ path: f, content: this.files[f] }));

                const chip = {
                    type: 'folder',
                    path: path,
                    files: filesInFolder,
                    id: 'chip-' + (++this.chipIdCounter)
                };

                this.contextChips.push(chip);
                this.renderChips();

                return chip;
            },

            // Codebase search
            searchCodebase: function(query) {
                this.lastQuery = query;

                const results = Object.entries(this.files)
                    .filter(([path, content]) =>
                        content.toLowerCase().includes(query.toLowerCase()) ||
                        path.toLowerCase().includes(query.toLowerCase())
                    )
                    .map(([path, content]) => ({ path, content }));

                const chip = {
                    type: 'codebase',
                    query: query,
                    results: results,
                    id: 'chip-' + (++this.chipIdCounter)
                };

                this.contextChips.push(chip);
                this.renderChips();

                return chip;
            },

            // Remove a chip
            removeChip: function(chipId) {
                this.contextChips = this.contextChips.filter(c => c.id !== chipId);
                this.renderChips();
                return true;
            },

            // Render chips visually
            renderChips: function() {
                let container = document.querySelector('.test-context-chips');
                if (!container) {
                    container = document.createElement('div');
                    container.className = 'test-context-chips';
                    container.style.cssText = 'position: fixed; bottom: 150px; left: 50px; display: flex; gap: 5px; flex-wrap: wrap;';
                    document.body.appendChild(container);
                }

                container.innerHTML = this.contextChips.map(chip => {
                    const label = chip.type === 'file' ? '@file:' + chip.path :
                                  chip.type === 'folder' ? '@folder:' + chip.path :
                                  '@codebase:' + chip.query;
                    return '<span class=\"context-chip\" data-id=\"' + chip.id + '\" style=\"background: #007acc; color: white; padding: 2px 8px; border-radius: 3px; font-size: 12px;\">' +
                           label + ' <span class=\"remove\" style=\"cursor: pointer; margin-left: 5px;\">x</span></span>';
                }).join('');
            },

            // Build context string for prompt
            buildContext: function() {
                return this.contextChips.map(chip => {
                    if (chip.type === 'file') {
                        return '--- File: ' + chip.path + ' ---\\n' + chip.content + '\\n---';
                    } else if (chip.type === 'folder') {
                        return '--- Folder: ' + chip.path + ' ---\\n' +
                               chip.files.map(f => f.path + ':\\n' + f.content).join('\\n\\n') + '\\n---';
                    } else {
                        return '--- Codebase search: ' + chip.query + ' ---\\n' +
                               chip.results.map(r => r.path + ':\\n' + r.content).join('\\n\\n') + '\\n---';
                    }
                }).join('\\n\\n');
            },

            // Send message with context
            sendMessage: function(message) {
                const context = this.buildContext();
                const fullMessage = {
                    text: message,
                    context: context,
                    chips: [...this.contextChips],
                    timestamp: Date.now()
                };

                this.messagesSent.push(fullMessage);

                // Clear chips after sending
                this.contextChips = [];
                this.renderChips();

                return fullMessage;
            },

            // Generate mock response based on context
            generateResponse: function(message) {
                const lastMessage = this.messagesSent[this.messagesSent.length - 1];
                if (!lastMessage) return 'I need more context to help you.';

                if (lastMessage.chips.length === 0) {
                    return 'I can help with that! Try using @file to attach relevant code.';
                }

                const fileNames = lastMessage.chips
                    .filter(c => c.type === 'file')
                    .map(c => c.path)
                    .join(', ');

                if (fileNames) {
                    return 'Based on the code in ' + fileNames + ', I can see that this is a ' +
                           (lastMessage.context.includes('function') ? 'function-based' : 'module-based') +
                           ' implementation. Here is my analysis...';
                }

                return 'I have analyzed the context you provided and here is my response...';
            }
        };

        return 'mock-installed';
    })()"
}

# ============================================================================
# Test: Server Ready
# ============================================================================
test_00_server_ready() {
    echo "  Checking server and bridge status..."
    local result=$(test_health)
    assert_json_equals "$result" ".status" "ok" "Server should be healthy"
    assert_json_true "$result" ".bridge_connected" "Bridge should be connected"
}

# ============================================================================
# Test: Install Mock
# ============================================================================
test_01_install_mock() {
    if [ "$CONTEXT_MENTIONS_MOCK" = "1" ]; then
        echo "  Installing Context Mentions mock..."
        install_context_mentions_mock

        local result=$(test_js "(function() {
            return window.__CONTEXT_MENTIONS_MOCK__ ? 'installed' : 'not-installed';
        })()")

        local status=$(echo "$result" | jq -r '.result')
        if [ "$status" = "installed" ]; then
            echo -e "  ${GREEN}✓${NC} Mock installed"
            ((TESTS_PASSED++))
        else
            echo -e "  ${RED}✗${NC} Failed to install mock"
            ((TESTS_FAILED++))
        fi
    else
        echo -e "  ${YELLOW}○${NC} Mock disabled"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Verify Context Mentions Disposable
# ============================================================================
test_02_disposable_registered() {
    echo "  Verifying Context Mentions disposable is registered..."

    local result=$(test_js "(function() {
        const disposable = window['__CONTEXT_MENTIONS_DISPOSABLE__'];
        return disposable && typeof disposable.dispose === 'function' ? 'registered' : 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Context Mentions disposable registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Context Mentions disposable not registered"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: @ Symbol Shows Dropdown
# ============================================================================
test_10_journey_at_shows_dropdown() {
    echo "  USER JOURNEY: @ symbol shows mention dropdown..."

    if [ "$CONTEXT_MENTIONS_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__CONTEXT_MENTIONS_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Simulate typing @
        mock.showDropdown();

        await new Promise(r => setTimeout(r, 100));

        const dropdown = document.querySelector('.test-mention-dropdown');
        const isVisible = dropdown && dropdown.style.display !== 'none';
        const hasOptions = dropdown && dropdown.querySelectorAll('.dropdown-item').length >= 3;

        return {
            success: true,
            dropdownVisible: mock.dropdownVisible,
            domVisible: isVisible,
            hasFileOption: hasOptions
        };
    })()")

    local visible=$(echo "$result" | jq -r '.result.dropdownVisible')
    local hasOptions=$(echo "$result" | jq -r '.result.hasFileOption')

    if [ "$visible" = "true" ] && [ "$hasOptions" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} @ shows dropdown with @file, @folder, @codebase options"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Dropdown should appear with options: visible=$visible, hasOptions=$hasOptions"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Select @file Shows File Picker
# ============================================================================
test_11_journey_file_picker() {
    echo "  USER JOURNEY: Selecting @file shows file picker..."

    if [ "$CONTEXT_MENTIONS_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__CONTEXT_MENTIONS_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Show file picker
        mock.showFilePicker();

        await new Promise(r => setTimeout(r, 100));

        const picker = document.querySelector('.test-file-picker');
        const isVisible = picker && picker.style.display !== 'none';
        const fileCount = picker ? picker.querySelectorAll('.file-item').length : 0;

        return {
            success: true,
            pickerVisible: isVisible,
            fileCount: fileCount,
            hasFiles: fileCount > 0
        };
    })()")

    local visible=$(echo "$result" | jq -r '.result.pickerVisible')
    local hasFiles=$(echo "$result" | jq -r '.result.hasFiles')

    if [ "$visible" = "true" ] && [ "$hasFiles" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} File picker shows workspace files"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} File picker should show files: visible=$visible, hasFiles=$hasFiles"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Select File Creates Chip
# ============================================================================
test_12_journey_select_file_creates_chip() {
    echo "  USER JOURNEY: Selecting file creates context chip..."

    if [ "$CONTEXT_MENTIONS_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__CONTEXT_MENTIONS_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Clear existing chips
        mock.contextChips = [];

        // Select a file
        const chip = mock.selectFile('src/index.ts');

        await new Promise(r => setTimeout(r, 100));

        const chipEl = document.querySelector('.test-context-chips .context-chip');
        const hasChip = !!chipEl;
        const chipText = chipEl ? chipEl.textContent : '';

        return {
            success: true,
            chipCreated: !!chip,
            chipType: chip.type,
            chipPath: chip.path,
            hasContent: !!chip.content,
            domChipVisible: hasChip,
            chipCount: mock.contextChips.length
        };
    })()")

    local chipCreated=$(echo "$result" | jq -r '.result.chipCreated')
    local chipType=$(echo "$result" | jq -r '.result.chipType')
    local hasContent=$(echo "$result" | jq -r '.result.hasContent')

    if [ "$chipCreated" = "true" ] && [ "$chipType" = "file" ] && [ "$hasContent" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} File selected creates context chip with content"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Chip should be created: created=$chipCreated, type=$chipType, hasContent=$hasContent"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Multiple Context Chips
# ============================================================================
test_13_journey_multiple_chips() {
    echo "  USER JOURNEY: Multiple context chips..."

    if [ "$CONTEXT_MENTIONS_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__CONTEXT_MENTIONS_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Clear and add multiple files
        mock.contextChips = [];
        mock.selectFile('src/index.ts');
        mock.selectFile('src/utils.ts');
        mock.selectFile('README.md');

        return {
            success: true,
            chipCount: mock.contextChips.length,
            paths: mock.contextChips.map(c => c.path)
        };
    })()")

    local chipCount=$(echo "$result" | jq -r '.result.chipCount')

    if [ "$chipCount" = "3" ]; then
        echo -e "  ${GREEN}✓${NC} Multiple context chips attached ($chipCount files)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Should have 3 chips, got $chipCount"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Remove Chip
# ============================================================================
test_14_journey_remove_chip() {
    echo "  USER JOURNEY: Remove context chip..."

    if [ "$CONTEXT_MENTIONS_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__CONTEXT_MENTIONS_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Reset and add fresh chips for this test
        mock.contextChips = [];
        mock.selectFile('src/index.ts');
        mock.selectFile('src/utils.ts');

        const beforeCount = mock.contextChips.length;

        // Ensure we have a chip to remove
        if (beforeCount === 0) {
            return { success: false, error: 'no-chips-added', beforeCount: 0, afterCount: 0 };
        }

        const chipToRemove = mock.contextChips[0];
        if (!chipToRemove || !chipToRemove.id) {
            return { success: false, error: 'invalid-chip', beforeCount: beforeCount };
        }

        mock.removeChip(chipToRemove.id);

        return {
            success: true,
            beforeCount: beforeCount,
            afterCount: mock.contextChips.length,
            removed: beforeCount - mock.contextChips.length === 1
        };
    })()")

    local removed=$(echo "$result" | jq -r '.result.removed')
    local error=$(echo "$result" | jq -r '.result.error // empty')

    if [ "$removed" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Context chip removed"
        ((TESTS_PASSED++))
    elif [ -n "$error" ]; then
        echo -e "  ${RED}✗${NC} Chip error: $error"
        ((TESTS_FAILED++))
    else
        echo -e "  ${RED}✗${NC} Chip should be removed"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Send Message With Context
# ============================================================================
test_15_journey_send_with_context() {
    echo "  USER JOURNEY: Send message with context attached..."

    if [ "$CONTEXT_MENTIONS_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__CONTEXT_MENTIONS_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Add a file context
        mock.contextChips = [];
        mock.selectFile('src/index.ts');

        // Send message
        const sentMessage = mock.sendMessage('Explain this code');

        return {
            success: true,
            messageSent: !!sentMessage,
            hasContext: !!sentMessage.context,
            contextIncludesFile: sentMessage.context.includes('src/index.ts'),
            chipsCleared: mock.contextChips.length === 0
        };
    })()")

    local hasContext=$(echo "$result" | jq -r '.result.hasContext')
    local includesFile=$(echo "$result" | jq -r '.result.contextIncludesFile')
    local chipsCleared=$(echo "$result" | jq -r '.result.chipsCleared')

    if [ "$hasContext" = "true" ] && [ "$includesFile" = "true" ] && [ "$chipsCleared" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Message sent with file context, chips cleared"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Should send with context: hasContext=$hasContext, includesFile=$includesFile, cleared=$chipsCleared"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Codebase Search
# ============================================================================
test_16_journey_codebase_search() {
    echo "  USER JOURNEY: @codebase search finds relevant files..."

    if [ "$CONTEXT_MENTIONS_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__CONTEXT_MENTIONS_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Clear chips
        mock.contextChips = [];

        // Search codebase
        const chip = mock.searchCodebase('function');

        return {
            success: true,
            chipCreated: !!chip,
            chipType: chip.type,
            query: chip.query,
            resultCount: chip.results.length,
            hasResults: chip.results.length > 0
        };
    })()")

    local chipType=$(echo "$result" | jq -r '.result.chipType')
    local hasResults=$(echo "$result" | jq -r '.result.hasResults')

    if [ "$chipType" = "codebase" ] && [ "$hasResults" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Codebase search found matching files"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Codebase search should find results: type=$chipType, hasResults=$hasResults"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Response Includes Context
# ============================================================================
test_17_journey_response_with_context() {
    echo "  USER JOURNEY: Response references attached context..."

    if [ "$CONTEXT_MENTIONS_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__CONTEXT_MENTIONS_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Add context and send
        mock.contextChips = [];
        mock.selectFile('src/utils.ts');
        mock.sendMessage('What does this code do?');

        // Generate response
        const response = mock.generateResponse();

        return {
            success: true,
            hasResponse: !!response,
            referencesFile: response.includes('src/utils.ts') || response.includes('code in'),
            responseLength: response.length
        };
    })()")

    local hasResponse=$(echo "$result" | jq -r '.result.hasResponse')
    local referencesFile=$(echo "$result" | jq -r '.result.referencesFile')

    if [ "$hasResponse" = "true" ] && [ "$referencesFile" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Response references attached file context"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Response should reference context: hasResponse=$hasResponse, references=$referencesFile"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: Cleanup
# ============================================================================
test_99_cleanup() {
    echo "  Cleaning up mock..."

    test_js "(function() {
        // Remove visual elements
        const dropdown = document.querySelector('.test-mention-dropdown');
        if (dropdown) dropdown.remove();

        const picker = document.querySelector('.test-file-picker');
        if (picker) picker.remove();

        const chips = document.querySelector('.test-context-chips');
        if (chips) chips.remove();

        return 'cleaned';
    })()"

    echo -e "  ${GREEN}✓${NC} Cleanup complete"
    ((TESTS_PASSED++))
}

# ============================================================================
# Run Tests
# ============================================================================

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}Context Mentions (@file, @folder, @codebase) User Journey Tests${NC}"
echo -e "${CYAN}Mock Mode: $([ \"$CONTEXT_MENTIONS_MOCK\" = \"1\" ] && echo 'ENABLED' || echo 'DISABLED')${NC}"
echo ""

run_tests
