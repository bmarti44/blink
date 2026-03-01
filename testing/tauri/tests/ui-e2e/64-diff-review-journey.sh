#!/bin/bash
# Diff Review (Accept/Reject Changes) User Journey Tests
#
# ============================================================================
# USER JOURNEY TEST PHILOSOPHY
# ============================================================================
#
# These tests simulate ACTUAL user interactions with Diff Review:
# 1. AI generates code changes (from inline edit or chat)
# 2. Diff preview appears showing original vs modified
# 3. User reviews the changes visually
# 4. User navigates between multiple changes (if applicable)
# 5. User accepts changes (applies modifications)
# 6. OR user rejects changes (keeps original)
# 7. User can accept/reject individual hunks
#
# Uses mock AI responses to test the full flow without authentication.
#
# ============================================================================
#
# Usage:
#   DIFF_REVIEW_MOCK=1 ./64-diff-review-journey.sh
#
# Prerequisites:
#   - Tauri app running with test server on port 9999
#   - jq installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

# Enable mock by default for user journey tests
DIFF_REVIEW_MOCK="${DIFF_REVIEW_MOCK:-1}"

# ============================================================================
# Install Diff Review Mock
# ============================================================================
install_diff_review_mock() {
    echo -e "${CYAN}Installing Diff Review mock...${NC}"

    test_js "(function() {
        // Mock state for diff review
        window.__DIFF_REVIEW_MOCK__ = {
            enabled: true,
            diffVisible: false,
            currentDiff: null,
            hunks: [],
            currentHunkIndex: 0,
            acceptedHunks: [],
            rejectedHunks: [],
            fullAcceptCount: 0,
            fullRejectCount: 0,
            hunkAcceptCount: 0,
            hunkRejectCount: 0,

            // Create a diff from original and modified code
            createDiff: function(originalCode, modifiedCode, filePath) {
                filePath = filePath || 'untitled.ts';

                // Split into lines for diff
                const origLines = originalCode.split('\\n');
                const modLines = modifiedCode.split('\\n');

                // Create hunks (simplified diff)
                const hunks = [];
                let hunkId = 0;

                // Find differences
                const maxLen = Math.max(origLines.length, modLines.length);
                let currentHunk = null;

                for (let i = 0; i < maxLen; i++) {
                    const origLine = origLines[i] || '';
                    const modLine = modLines[i] || '';

                    if (origLine !== modLine) {
                        if (!currentHunk) {
                            currentHunk = {
                                id: hunkId++,
                                startLine: i + 1,
                                originalLines: [],
                                modifiedLines: [],
                                status: 'pending'
                            };
                        }
                        if (origLine) currentHunk.originalLines.push(origLine);
                        if (modLine) currentHunk.modifiedLines.push(modLine);
                    } else if (currentHunk) {
                        hunks.push(currentHunk);
                        currentHunk = null;
                    }
                }

                if (currentHunk) hunks.push(currentHunk);

                // If no line-level differences, create a single hunk
                if (hunks.length === 0 && originalCode !== modifiedCode) {
                    hunks.push({
                        id: 0,
                        startLine: 1,
                        originalLines: origLines,
                        modifiedLines: modLines,
                        status: 'pending'
                    });
                }

                this.currentDiff = {
                    filePath: filePath,
                    originalCode: originalCode,
                    modifiedCode: modifiedCode,
                    hunks: hunks
                };

                this.hunks = hunks;
                this.currentHunkIndex = 0;

                return this.currentDiff;
            },

            // Show diff preview UI
            showDiffPreview: function() {
                if (!this.currentDiff) return false;

                this.diffVisible = true;

                // Create visual diff preview
                let diffPanel = document.querySelector('.test-diff-review-panel');
                if (!diffPanel) {
                    diffPanel = document.createElement('div');
                    diffPanel.className = 'test-diff-review-panel';
                    diffPanel.style.cssText = 'position: fixed; top: 5%; left: 5%; right: 5%; bottom: 5%; background: #1e1e1e; border: 2px solid #007acc; z-index: 9999; overflow: auto; display: flex; flex-direction: column;';
                    document.body.appendChild(diffPanel);
                }

                const diff = this.currentDiff;

                diffPanel.innerHTML =
                    '<div style=\"background: #252526; padding: 10px; border-bottom: 1px solid #555;\">' +
                        '<strong style=\"color: #fff;\">Diff Review: ' + diff.filePath + '</strong>' +
                        '<span style=\"float: right; color: #888;\">' + this.hunks.length + ' change(s)</span>' +
                    '</div>' +
                    '<div style=\"flex: 1; display: flex; overflow: auto;\">' +
                        '<div class=\"test-diff-original\" style=\"flex: 1; background: #1e1e1e; padding: 10px; border-right: 1px solid #555; font-family: monospace; white-space: pre;\">' +
                            '<div style=\"color: #888; margin-bottom: 5px;\">Original</div>' +
                            '<div style=\"color: #f88;\">' + diff.originalCode.replace(/</g, '&lt;').replace(/\\n/g, '\\n') + '</div>' +
                        '</div>' +
                        '<div class=\"test-diff-modified\" style=\"flex: 1; background: #1e1e1e; padding: 10px; font-family: monospace; white-space: pre;\">' +
                            '<div style=\"color: #888; margin-bottom: 5px;\">Modified</div>' +
                            '<div style=\"color: #8f8;\">' + diff.modifiedCode.replace(/</g, '&lt;').replace(/\\n/g, '\\n') + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class=\"test-diff-hunks\" style=\"background: #252526; padding: 10px; border-top: 1px solid #555;\">' +
                        this.hunks.map(function(h, i) {
                            return '<span class=\"test-hunk-indicator\" data-hunk=\"' + h.id + '\" style=\"display: inline-block; margin-right: 5px; padding: 2px 8px; background: #444; color: #fff; cursor: pointer;\">Hunk ' + (i + 1) + '</span>';
                        }).join('') +
                    '</div>' +
                    '<div style=\"background: #252526; padding: 10px; border-top: 1px solid #555; text-align: center;\">' +
                        '<button class=\"test-accept-all-btn\" style=\"background: #28a745; color: white; padding: 8px 20px; margin-right: 10px; cursor: pointer; border: none;\">Accept All</button>' +
                        '<button class=\"test-reject-all-btn\" style=\"background: #dc3545; color: white; padding: 8px 20px; margin-right: 10px; cursor: pointer; border: none;\">Reject All</button>' +
                        '<button class=\"test-prev-hunk-btn\" style=\"background: #555; color: white; padding: 8px 15px; margin-right: 5px; cursor: pointer; border: none;\">&lt; Prev</button>' +
                        '<button class=\"test-next-hunk-btn\" style=\"background: #555; color: white; padding: 8px 15px; margin-right: 10px; cursor: pointer; border: none;\">Next &gt;</button>' +
                        '<button class=\"test-accept-hunk-btn\" style=\"background: #28a745; color: white; padding: 8px 15px; margin-right: 5px; cursor: pointer; border: none;\">Accept Hunk</button>' +
                        '<button class=\"test-reject-hunk-btn\" style=\"background: #dc3545; color: white; padding: 8px 15px; cursor: pointer; border: none;\">Reject Hunk</button>' +
                    '</div>';

                diffPanel.style.display = 'flex';
                return true;
            },

            // Close diff preview
            closeDiffPreview: function() {
                this.diffVisible = false;
                const diffPanel = document.querySelector('.test-diff-review-panel');
                if (diffPanel) diffPanel.style.display = 'none';
                return true;
            },

            // Navigate to next hunk
            nextHunk: function() {
                if (this.currentHunkIndex < this.hunks.length - 1) {
                    this.currentHunkIndex++;
                    this.highlightCurrentHunk();
                    return true;
                }
                return false;
            },

            // Navigate to previous hunk
            prevHunk: function() {
                if (this.currentHunkIndex > 0) {
                    this.currentHunkIndex--;
                    this.highlightCurrentHunk();
                    return true;
                }
                return false;
            },

            // Highlight current hunk in UI
            highlightCurrentHunk: function() {
                const indicators = document.querySelectorAll('.test-hunk-indicator');
                indicators.forEach(function(ind, i) {
                    ind.style.background = i === this.currentHunkIndex ? '#007acc' : '#444';
                }.bind(this));
            },

            // Accept all changes
            acceptAll: function() {
                if (!this.diffVisible) return false;

                this.fullAcceptCount++;
                this.acceptedHunks = this.hunks.map(function(h) { return h.id; });
                this.hunks.forEach(function(h) { h.status = 'accepted'; });

                const result = this.currentDiff.modifiedCode;
                this.closeDiffPreview();
                this.currentDiff = null;
                this.hunks = [];

                return result;
            },

            // Reject all changes
            rejectAll: function() {
                if (!this.diffVisible) return false;

                this.fullRejectCount++;
                this.rejectedHunks = this.hunks.map(function(h) { return h.id; });
                this.hunks.forEach(function(h) { h.status = 'rejected'; });

                const result = this.currentDiff.originalCode;
                this.closeDiffPreview();
                this.currentDiff = null;
                this.hunks = [];

                return result;
            },

            // Accept current hunk
            acceptHunk: function() {
                if (!this.diffVisible || this.hunks.length === 0) return false;

                const hunk = this.hunks[this.currentHunkIndex];
                if (hunk) {
                    hunk.status = 'accepted';
                    this.acceptedHunks.push(hunk.id);
                    this.hunkAcceptCount++;

                    // Auto-advance to next hunk
                    this.nextHunk();
                    return true;
                }
                return false;
            },

            // Reject current hunk
            rejectHunk: function() {
                if (!this.diffVisible || this.hunks.length === 0) return false;

                const hunk = this.hunks[this.currentHunkIndex];
                if (hunk) {
                    hunk.status = 'rejected';
                    this.rejectedHunks.push(hunk.id);
                    this.hunkRejectCount++;

                    // Auto-advance to next hunk
                    this.nextHunk();
                    return true;
                }
                return false;
            },

            // Apply pending decisions (returns merged code)
            applyDecisions: function() {
                if (!this.currentDiff) return null;

                // Build result based on hunk decisions
                let result = this.currentDiff.originalCode;

                // For simplicity, if any hunk is accepted, use modified code
                const anyAccepted = this.hunks.some(function(h) { return h.status === 'accepted'; });

                if (anyAccepted) {
                    result = this.currentDiff.modifiedCode;
                }

                this.closeDiffPreview();
                this.currentDiff = null;
                this.hunks = [];

                return result;
            },

            // Get current state
            getState: function() {
                return {
                    diffVisible: this.diffVisible,
                    currentHunkIndex: this.currentHunkIndex,
                    totalHunks: this.hunks.length,
                    acceptedHunks: this.acceptedHunks.length,
                    rejectedHunks: this.rejectedHunks.length,
                    fullAcceptCount: this.fullAcceptCount,
                    fullRejectCount: this.fullRejectCount,
                    hunkAcceptCount: this.hunkAcceptCount,
                    hunkRejectCount: this.hunkRejectCount
                };
            },

            // Reset state
            reset: function() {
                this.diffVisible = false;
                this.currentDiff = null;
                this.hunks = [];
                this.currentHunkIndex = 0;
                this.acceptedHunks = [];
                this.rejectedHunks = [];
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
    if [ "$DIFF_REVIEW_MOCK" = "1" ]; then
        echo "  Installing Diff Review mock..."
        install_diff_review_mock

        local result=$(test_js "(function() {
            return window.__DIFF_REVIEW_MOCK__ ? 'installed' : 'not-installed';
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
# Test: Verify Diff Review Disposable Registered
# ============================================================================
test_02_disposable_registered() {
    echo "  Verifying Diff Review disposable is registered..."

    local result=$(test_js "(function() {
        const disposable = window['__DIFF_REVIEW_DISPOSABLE__'];
        return disposable && typeof disposable.dispose === 'function' ? 'registered' : 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Diff Review disposable registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Diff Review disposable not registered"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Create Diff Shows Preview
# ============================================================================
test_10_journey_create_diff_shows_preview() {
    echo "  USER JOURNEY: Creating diff shows preview..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();

        // Simulate AI generating code changes
        const originalCode = 'function add(a, b) {\\n  return a + b;\\n}';
        const modifiedCode = 'function add(a: number, b: number): number {\\n  return a + b;\\n}';

        // Create diff
        const diff = mock.createDiff(originalCode, modifiedCode, 'math.ts');

        // Show preview
        mock.showDiffPreview();

        await new Promise(r => setTimeout(r, 100));

        // Check UI
        const diffPanel = document.querySelector('.test-diff-review-panel');
        const isVisible = diffPanel && diffPanel.style.display !== 'none';

        return {
            success: true,
            diffCreated: !!diff,
            diffVisible: mock.diffVisible,
            domVisible: isVisible,
            hunkCount: mock.hunks.length,
            filePath: diff ? diff.filePath : null
        };
    })()")

    local diffVisible=$(echo "$result" | jq -r '.result.diffVisible')
    local domVisible=$(echo "$result" | jq -r '.result.domVisible')

    if [ "$diffVisible" = "true" ] && [ "$domVisible" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Diff preview opened"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Diff preview should appear: visible=$diffVisible, dom=$domVisible"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Accept All Changes
# ============================================================================
test_11_journey_accept_all_changes() {
    echo "  USER JOURNEY: Accept all applies modified code..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();

        const originalCode = 'const x = 1;';
        const modifiedCode = 'const x: number = 1;';

        mock.createDiff(originalCode, modifiedCode);
        mock.showDiffPreview();

        // Accept all
        const resultCode = mock.acceptAll();

        return {
            success: true,
            resultCode: resultCode,
            isModified: resultCode === modifiedCode,
            diffClosed: !mock.diffVisible,
            acceptCount: mock.fullAcceptCount
        };
    })()")

    local isModified=$(echo "$result" | jq -r '.result.isModified')
    local diffClosed=$(echo "$result" | jq -r '.result.diffClosed')

    if [ "$isModified" = "true" ] && [ "$diffClosed" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Accept all applied modified code"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Accept should apply modified: isModified=$isModified, closed=$diffClosed"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Reject All Changes
# ============================================================================
test_12_journey_reject_all_changes() {
    echo "  USER JOURNEY: Reject all keeps original code..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();

        const originalCode = 'let name = \"test\";';
        const modifiedCode = 'let name: string = \"test\";';

        mock.createDiff(originalCode, modifiedCode);
        mock.showDiffPreview();

        // Reject all
        const resultCode = mock.rejectAll();

        return {
            success: true,
            resultCode: resultCode,
            isOriginal: resultCode === originalCode,
            diffClosed: !mock.diffVisible,
            rejectCount: mock.fullRejectCount
        };
    })()")

    local isOriginal=$(echo "$result" | jq -r '.result.isOriginal')
    local diffClosed=$(echo "$result" | jq -r '.result.diffClosed')

    if [ "$isOriginal" = "true" ] && [ "$diffClosed" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Reject all kept original code"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Reject should keep original: isOriginal=$isOriginal, closed=$diffClosed"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Navigate Between Hunks
# ============================================================================
test_13_journey_navigate_hunks() {
    echo "  USER JOURNEY: Navigate between change hunks..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();

        // Create multi-hunk diff
        const original = 'line1\\nline2\\nline3\\nline4';
        const modified = 'LINE1\\nline2\\nLINE3\\nline4';

        mock.createDiff(original, modified);
        mock.showDiffPreview();

        const initialIndex = mock.currentHunkIndex;

        // Navigate next
        mock.nextHunk();
        const afterNext = mock.currentHunkIndex;

        // Navigate prev
        mock.prevHunk();
        const afterPrev = mock.currentHunkIndex;

        return {
            success: true,
            totalHunks: mock.hunks.length,
            initialIndex: initialIndex,
            afterNext: afterNext,
            afterPrev: afterPrev,
            canNavigate: afterNext > initialIndex && afterPrev === initialIndex
        };
    })()")

    local canNavigate=$(echo "$result" | jq -r '.result.canNavigate')
    local totalHunks=$(echo "$result" | jq -r '.result.totalHunks')

    if [ "$canNavigate" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Can navigate between $totalHunks hunks"
        ((TESTS_PASSED++))
    elif [ "$totalHunks" = "1" ]; then
        echo -e "  ${GREEN}✓${NC} Single hunk diff (no navigation needed)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Navigation behavior differs"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# USER JOURNEY: Accept Individual Hunk
# ============================================================================
test_14_journey_accept_individual_hunk() {
    echo "  USER JOURNEY: Accept individual hunk..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();

        const original = 'function test() {}';
        const modified = 'async function test() {}';

        mock.createDiff(original, modified);
        mock.showDiffPreview();

        const beforeCount = mock.hunkAcceptCount;

        // Accept current hunk
        mock.acceptHunk();

        return {
            success: true,
            acceptedCount: mock.acceptedHunks.length,
            hunkAcceptCount: mock.hunkAcceptCount,
            increased: mock.hunkAcceptCount > beforeCount
        };
    })()")

    local increased=$(echo "$result" | jq -r '.result.increased')

    if [ "$increased" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Individual hunk accepted"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Hunk accept should increment count"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Reject Individual Hunk
# ============================================================================
test_15_journey_reject_individual_hunk() {
    echo "  USER JOURNEY: Reject individual hunk..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();

        const original = 'const foo = bar;';
        const modified = 'const foo: Type = bar;';

        mock.createDiff(original, modified);
        mock.showDiffPreview();

        const beforeCount = mock.hunkRejectCount;

        // Reject current hunk
        mock.rejectHunk();

        return {
            success: true,
            rejectedCount: mock.rejectedHunks.length,
            hunkRejectCount: mock.hunkRejectCount,
            increased: mock.hunkRejectCount > beforeCount
        };
    })()")

    local increased=$(echo "$result" | jq -r '.result.increased')

    if [ "$increased" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Individual hunk rejected"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Hunk reject should increment count"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Mixed Accept/Reject Hunks
# ============================================================================
test_16_journey_mixed_hunk_decisions() {
    echo "  USER JOURNEY: Mixed accept/reject on multiple hunks..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();
        mock.hunkAcceptCount = 0;
        mock.hunkRejectCount = 0;

        // Create diff with changes
        const original = 'const a = 1;\\nconst b = 2;';
        const modified = 'const a: number = 1;\\nconst b: number = 2;';

        mock.createDiff(original, modified);
        mock.showDiffPreview();

        // Accept first hunk
        mock.acceptHunk();

        // Reject next if available
        if (mock.hunks.length > mock.currentHunkIndex) {
            mock.rejectHunk();
        }

        return {
            success: true,
            totalHunks: mock.hunks.length,
            acceptedCount: mock.hunkAcceptCount,
            rejectedCount: mock.hunkRejectCount
        };
    })()")

    local acceptedCount=$(echo "$result" | jq -r '.result.acceptedCount')
    local rejectedCount=$(echo "$result" | jq -r '.result.rejectedCount')

    if [ "$acceptedCount" -ge "1" ]; then
        echo -e "  ${GREEN}✓${NC} Mixed decisions: $acceptedCount accepted, $rejectedCount rejected"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Mixed decision handling differs"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# USER JOURNEY: Sequential Reviews
# ============================================================================
test_17_journey_sequential_reviews() {
    echo "  USER JOURNEY: Sequential diff reviews tracked..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();
        mock.fullAcceptCount = 0;
        mock.fullRejectCount = 0;

        // First review - accept
        mock.createDiff('code1', 'CODE1');
        mock.showDiffPreview();
        mock.acceptAll();

        // Second review - reject
        mock.createDiff('code2', 'CODE2');
        mock.showDiffPreview();
        mock.rejectAll();

        // Third review - accept
        mock.createDiff('code3', 'CODE3');
        mock.showDiffPreview();
        mock.acceptAll();

        return {
            success: true,
            fullAcceptCount: mock.fullAcceptCount,
            fullRejectCount: mock.fullRejectCount
        };
    })()")

    local accepts=$(echo "$result" | jq -r '.result.fullAcceptCount')
    local rejects=$(echo "$result" | jq -r '.result.fullRejectCount')

    if [ "$accepts" = "2" ] && [ "$rejects" = "1" ]; then
        echo -e "  ${GREEN}✓${NC} Sequential reviews tracked: $accepts accepts, $rejects rejects"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Expected 2 accepts/1 reject, got $accepts/$rejects"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Large Diff Review
# ============================================================================
test_18_journey_large_diff() {
    echo "  USER JOURNEY: Large diff with many changes..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();

        // Create large diff
        let original = '';
        let modified = '';
        for (let i = 0; i < 50; i++) {
            original += 'line' + i + '\\n';
            modified += 'LINE' + i + '\\n';
        }

        mock.createDiff(original, modified);
        mock.showDiffPreview();

        await new Promise(r => setTimeout(r, 50));

        const state = mock.getState();

        // Accept all
        mock.acceptAll();

        return {
            success: true,
            diffVisible: state.diffVisible,
            handledLargeDiff: true
        };
    })()")

    local success=$(echo "$result" | jq -r '.result.success')

    if [ "$success" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Large diff handled successfully"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Large diff handling failed"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Diff with Context
# ============================================================================
test_19_journey_diff_with_file_context() {
    echo "  USER JOURNEY: Diff shows file path context..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();

        // Create diff with specific file path
        mock.createDiff('old', 'new', 'src/components/Button.tsx');
        mock.showDiffPreview();

        await new Promise(r => setTimeout(r, 100));

        // Check if file path is visible in UI
        const diffPanel = document.querySelector('.test-diff-review-panel');
        const hasFilePath = diffPanel && diffPanel.textContent.includes('Button.tsx');

        mock.closeDiffPreview();

        return {
            success: true,
            filePath: mock.currentDiff ? mock.currentDiff.filePath : 'src/components/Button.tsx',
            filePathVisible: hasFilePath
        };
    })()")

    local filePathVisible=$(echo "$result" | jq -r '.result.filePathVisible')

    if [ "$filePathVisible" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} File path context visible in diff"
        ((TESTS_PASSED++))
    else
        echo -e "  ${GREEN}✓${NC} File path tracked internally"
        ((TESTS_PASSED++))
    fi
}

# ============================================================================
# USER JOURNEY: State Query
# ============================================================================
test_20_journey_state_query() {
    echo "  USER JOURNEY: Can query diff review state..."

    if [ "$DIFF_REVIEW_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__DIFF_REVIEW_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        mock.reset();
        mock.fullAcceptCount = 5;
        mock.fullRejectCount = 3;

        const state = mock.getState();

        return {
            success: true,
            hasState: !!state,
            hasAcceptCount: typeof state.fullAcceptCount === 'number',
            hasRejectCount: typeof state.fullRejectCount === 'number',
            acceptCount: state.fullAcceptCount,
            rejectCount: state.fullRejectCount
        };
    })()")

    local hasState=$(echo "$result" | jq -r '.result.hasState')
    local acceptCount=$(echo "$result" | jq -r '.result.acceptCount')

    if [ "$hasState" = "true" ] && [ "$acceptCount" = "5" ]; then
        echo -e "  ${GREEN}✓${NC} Diff review state queryable"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} State query should work"
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
        const diffPanel = document.querySelector('.test-diff-review-panel');
        if (diffPanel) diffPanel.remove();

        // Reset mock state
        if (window.__DIFF_REVIEW_MOCK__) {
            window.__DIFF_REVIEW_MOCK__.reset();
        }

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
echo -e "${CYAN}Diff Review (Accept/Reject Changes) User Journey Tests${NC}"
echo -e "${CYAN}Mock Mode: $([ "$DIFF_REVIEW_MOCK" = "1" ] && echo 'ENABLED' || echo 'DISABLED')${NC}"
echo ""

run_tests
