# Blink - Feature Checklist

## CRITICAL MANDATE

**NO FEATURE IS COMPLETE WITHOUT PASSING E2E TESTS.**

Every feature includes:

1. **Implementation requirements** - What to build
2. **E2E test file** - The test script that must exist
3. **Test scenarios** - SPECIFIC user-centric interactions to verify
4. **Acceptance criteria** - What the test must assert

Tests MUST:

- Execute via clicks/actions as a user would (not programmatic API calls)
- Query the actual DOM in the Tauri webview
- Use `data-testid` attributes for reliable element selection
- Pass completely before the feature is marked DONE

---

## Status Legend

| Status     | Meaning                                                  |
| ---------- | -------------------------------------------------------- |
| ✅ DONE    | Feature works AND E2E tests pass                         |
| 🔨 PARTIAL | Feature implemented but tests incomplete or not verified |
| ❌ TODO    | Feature not started                                      |
| 🚫 BLOCKED | Waiting on dependency                                    |

---

## Test File Numbering Convention

| Range | Category                                  |
| ----- | ----------------------------------------- |
| 01-09 | Core health, workbench, extensions        |
| 10-19 | Reserved                                  |
| 20-29 | AI integration                           |
| 30-39 | Terminal, panels                          |
| 40-49 | AI features (autocomplete, inline edit)   |
| 50-59 | VS Code features (Git, Debugger, Testing) |
| 60-69 | Agent/Composer features                   |
| 70-79 | Document editing                          |

### ✅ Test File Organization (RESOLVED)

Test file collisions have been resolved. Current organization:

| Range | Category         | Files                                                        |
| ----- | ---------------- | ------------------------------------------------------------ |
| 01-05 | Core tests       | health, workbench, extensions, editor, error-check           |
| 10-13 | Terminal tests   | terminal, terminal-ui, terminal-user, terminal-e2e           |
| 22-25 | AI integration  | ai-service, ai-auth-flow, ai-chat-ui, ai-streaming       |
| 30-39 | Extension panel  | panel-ui, installed-visible, install-button, etc.            |
| 40-49 | AI IDE features  | tab-autocomplete, inline-edit, context-mentions, diff-review |
| 70-93 | Document editing | docx, xlsx, pptx open/edit/render tests                      |

---

## P0: Critical AI Features (Weeks 1-14)

### 1. Tab Autocomplete (Ghost Text)

**Status**: 🔨 PARTIAL (Infrastructure registered, needs AI auth for full functionality)

**Implementation**: `src/services/vscode/tabAutocomplete.ts`

**E2E Test File**: `testing/tauri/tests/ui-e2e/40-tab-autocomplete.sh`

**Test Scenarios**:

```bash
test_01_ghost_text_appears_on_typing() {
    # Arrange: Open a .js file with some code context
    open_file "/tmp/test-workspace/index.js"
    wait_for_editor_ready 10

    # Act: Type partial code that should trigger completion
    type_in_editor "function hello() {\n  console.lo"
    sleep 2  # Wait for debounce + LLM response

    # Assert: Ghost text appears
    assert_element_exists ".ghost-text" "Ghost text should appear"
    local ghost_content=$(get_element_text ".ghost-text")
    assert_contains "$ghost_content" "g(" "Should suggest console.log"
}

test_02_tab_accepts_completion() {
    # Arrange: Ghost text is visible
    assert_element_exists ".ghost-text"

    # Act: Press Tab key
    send_key "Tab"
    wait_for_element_gone ".ghost-text" 2

    # Assert: Ghost text is now real text
    local editor_content=$(get_editor_content)
    assert_contains "$editor_content" "console.log(" "Tab should accept"
}

test_03_escape_dismisses_completion() {
    # Arrange: Trigger new ghost text
    type_in_editor "\n  const x = "
    sleep 2
    assert_element_exists ".ghost-text"

    # Act: Press Escape
    send_key "Escape"

    # Assert: Ghost text disappears
    wait_for_element_gone ".ghost-text" 2
}

test_04_multiline_completion() {
    # Arrange: Type function signature
    clear_editor
    type_in_editor "// Calculate fibonacci\nfunction fib(n) {"
    sleep 2

    # Assert: Multi-line ghost text appears
    assert_element_exists ".ghost-text"
    local ghost=$(get_element_text ".ghost-text")
    assert_contains "$ghost" "return" "Should suggest function body"
}
```

**Acceptance Criteria**:

- [ ] Ghost text appears within 2s of typing pause
- [ ] Tab accepts entire completion
- [ ] Escape dismisses without inserting
- [ ] Multi-line completions render correctly
- [ ] No ghost text in string literals or comments

---

### 2. Inline Editing (Ctrl+K)

**Status**: 🔨 PARTIAL (Infrastructure registered, needs AI auth for full functionality)

**Implementation**: `src/services/vscode/inlineEdit.ts`

**E2E Test File**: `testing/tauri/tests/ui-e2e/41-inline-edit.sh`

**Test Scenarios**:

```bash
test_01_ctrlk_opens_input_box() {
    # Arrange: Select some code
    open_file "/tmp/test-workspace/index.js"
    select_lines 5 10

    # Act: Press Ctrl+K
    send_key "Control+k"

    # Assert: Inline input box appears
    wait_for_element "[data-testid='inline-edit-input']" 5
    assert_element_visible "[data-testid='inline-edit-input']"
}

test_02_submit_instruction_shows_diff() {
    # Arrange: Input box is open

    # Act: Type instruction and submit
    type_text "[data-testid='inline-edit-input']" "Add error handling"
    send_key "Enter"

    # Assert: Diff preview appears
    wait_for_element ".monaco-diff-editor" 10
    assert_element_exists ".line-delete" "Should show deleted lines"
    assert_element_exists ".line-insert" "Should show inserted lines"
}

test_03_accept_applies_changes() {
    # Act: Click Accept button
    click_testid "inline-edit-accept"

    # Assert: Changes applied, diff closed
    wait_for_element_gone ".monaco-diff-editor" 5
    local content=$(get_editor_content)
    assert_contains "$content" "try" "Should have error handling"
}

test_04_reject_discards_changes() {
    # Arrange: Trigger new inline edit
    select_lines 1 3
    send_key "Control+k"
    wait_for_element "[data-testid='inline-edit-input']" 5
    type_text "[data-testid='inline-edit-input']" "Convert to arrow function"
    send_key "Enter"
    wait_for_element ".monaco-diff-editor" 10

    # Act: Click Reject button
    click_testid "inline-edit-reject"

    # Assert: Original code preserved
    wait_for_element_gone ".monaco-diff-editor" 5
    local content=$(get_editor_content)
    assert_not_contains "$content" "=>" "Should NOT have arrow function"
}

test_05_escape_cancels_input() {
    # Arrange: Open input box
    select_lines 1 1
    send_key "Control+k"
    wait_for_element "[data-testid='inline-edit-input']" 5

    # Act: Press Escape
    send_key "Escape"

    # Assert: Input box closes
    wait_for_element_gone "[data-testid='inline-edit-input']" 2
}
```

**Acceptance Criteria**:

- [ ] Ctrl+K (Cmd+K) opens input above selection
- [ ] Enter submits, Escape cancels
- [ ] Diff preview shows before applying
- [ ] Accept applies changes to editor
- [ ] Reject restores original code

---

### 3. @Context Mentions

**Status**: 🔨 PARTIAL (Infrastructure registered, needs AI auth for full functionality)

**Implementation**: `src/services/vscode/contextMentions.ts`

**E2E Test File**: `testing/tauri/tests/ui-e2e/42-context-mentions.sh`

**Test Scenarios**:

```bash
test_01_at_symbol_shows_dropdown() {
    # Arrange: Open chat panel
    click_testid "chat-panel-toggle"
    wait_for_element "[data-testid='chat-input']" 5

    # Act: Type @ symbol
    type_text "[data-testid='chat-input']" "@"

    # Assert: Autocomplete dropdown appears
    wait_for_element "[data-testid='mention-dropdown']" 3
    assert_element_contains "[data-testid='mention-dropdown']" "@file"
    assert_element_contains "[data-testid='mention-dropdown']" "@codebase"
}

test_02_file_mention_autocomplete() {
    # Arrange: @ dropdown is open
    clear_input "[data-testid='chat-input']"
    type_text "[data-testid='chat-input']" "@file:"

    # Assert: File picker shows workspace files
    wait_for_element "[data-testid='file-picker']" 3
    assert_element_exists "[data-testid='file-picker'] .file-item"
}

test_03_select_file_creates_chip() {
    # Act: Click on a file
    click_element "[data-testid='file-picker'] .file-item:first-child"

    # Assert: Context chip appears in input
    wait_for_element "[data-testid='context-chip']" 2
    assert_element_exists "[data-testid='context-chip'][data-type='file']"
}

test_04_context_included_in_request() {
    # Arrange: File context chip is attached

    # Act: Send a message
    type_text "[data-testid='chat-input']" " explain this code"
    click_testid "chat-send"

    # Assert: Response references the file content
    wait_for_element "[data-testid='chat-message-assistant']" 30
    local response=$(get_element_text "[data-testid='chat-message-assistant']:last-child")
    assert_not_empty "$response" "Should have AI response"
}

test_05_codebase_search_mention() {
    # Arrange: Clear chat input
    clear_input "[data-testid='chat-input']"

    # Act: Type @codebase mention with query
    type_text "[data-testid='chat-input']" "@codebase:authentication how is auth implemented?"
    click_testid "chat-send"

    # Assert: Response includes context sources
    wait_for_element "[data-testid='chat-message-assistant']" 30
    assert_element_exists "[data-testid='context-sources']" "Should show searched files"
}
```

**Acceptance Criteria**:

- [ ] @ triggers autocomplete dropdown
- [ ] @file: shows file picker with workspace files
- [ ] @folder: shows folder picker
- [ ] @codebase: triggers semantic search
- [ ] Selected context appears as removable chip
- [ ] Context is included in LLM request

---

### 4. Diff Review Before Apply

**Status**: 🔨 PARTIAL (Infrastructure registered, needs AI auth for full functionality)

**Implementation**: `src/services/vscode/diffReview.ts`

**E2E Test File**: `testing/tauri/tests/ui-e2e/43-diff-review.sh`

**Test Scenarios**:

```bash
test_01_diff_shows_changes() {
    # Arrange: AI has proposed changes
    invoke_test_helper "propose_code_change" "{\"file\": \"/tmp/test.js\"}"

    # Assert: Diff editor opens
    wait_for_element ".monaco-diff-editor" 5
    assert_element_exists ".line-insert" "Should show insertions"
    assert_element_exists ".line-delete" "Should show deletions"
}

test_02_accept_all_applies_changes() {
    # Arrange: Diff is visible
    local original_content=$(get_file_content "/tmp/test.js")

    # Act: Click Accept All
    click_testid "diff-accept-all"

    # Assert: File is modified
    wait_for_element_gone ".monaco-diff-editor" 5
    local new_content=$(get_file_content "/tmp/test.js")
    assert_not_equals "$original_content" "$new_content" "File should be modified"
}

test_03_reject_all_discards_changes() {
    # Arrange: New diff proposed
    invoke_test_helper "propose_code_change" "{\"file\": \"/tmp/test2.js\"}"
    wait_for_element ".monaco-diff-editor" 5
    local original_content=$(get_file_content "/tmp/test2.js")

    # Act: Click Reject All
    click_testid "diff-reject-all"

    # Assert: File unchanged
    wait_for_element_gone ".monaco-diff-editor" 5
    local new_content=$(get_file_content "/tmp/test2.js")
    assert_equals "$original_content" "$new_content" "File should be unchanged"
}

test_04_per_hunk_accept() {
    # Arrange: Diff with multiple hunks
    invoke_test_helper "propose_multi_hunk_change" "{\"file\": \"/tmp/test3.js\"}"
    wait_for_element ".monaco-diff-editor" 5

    # Act: Accept first hunk only
    click_element "[data-testid='hunk-accept']:first-child"

    # Assert: First hunk applied, others pending
    assert_element_exists "[data-testid='hunk-pending']" "Other hunks should remain"
}

test_05_keyboard_navigation() {
    # Arrange: Diff with multiple hunks visible

    # Act: Navigate with j/k keys and accept/reject with y/n
    send_key "j"  # Next hunk
    send_key "y"  # Accept
    send_key "j"  # Next hunk
    send_key "n"  # Reject

    # Assert: Appropriate hunks accepted/rejected
    # (Verify via file content)
}
```

**Acceptance Criteria**:

- [ ] Diff editor shows insertions (green) and deletions (red)
- [ ] Accept All applies all changes
- [ ] Reject All discards all changes
- [ ] Per-hunk accept/reject works
- [ ] Keyboard shortcuts (j/k/y/n) work
- [ ] Undo restores previous state

---

### 5. Git/SCM Panel

**Status**: ❌ TODO (NOT WORKING)

**Implementation**:

- Rust backend: `src-tauri/src/services/git.rs` (git2-rs)
- Frontend: Wire to `scm-service-override`

**E2E Test File**: `testing/tauri/tests/ui-e2e/50-git-scm-panel.sh`

**Test Scenarios**:

```bash
test_01_scm_panel_opens() {
    # Arrange: Open workspace with git repo
    open_workspace "/tmp/test-git-repo"
    wait_for_workbench 30

    # Act: Click Source Control icon in activity bar
    click_element "[data-testid='activitybar-scm']"

    # Assert: SCM panel opens
    wait_for_element "[data-testid='scm-view']" 5
}

test_02_shows_changed_files() {
    # Arrange: Create a modified file
    invoke_tauri "write_file" "{\"path\": \"/tmp/test-git-repo/modified.txt\", \"content\": \"changed\"}"
    sleep 1

    # Assert: File appears in changes list
    wait_for_element "[data-testid='scm-resource-modified.txt']" 10
}

test_03_stage_file() {
    # Act: Click stage button
    click_element "[data-testid='scm-resource-modified.txt'] [data-testid='stage-button']"

    # Assert: File moves to staged section
    wait_for_element "[data-testid='scm-staged-modified.txt']" 5
}

test_04_unstage_file() {
    # Act: Click unstage button
    click_element "[data-testid='scm-staged-modified.txt'] [data-testid='unstage-button']"

    # Assert: File moves back to changes
    wait_for_element "[data-testid='scm-resource-modified.txt']" 5
    assert_element_not_exists "[data-testid='scm-staged-modified.txt']"
}

test_05_commit_staged_changes() {
    # Arrange: Stage a file
    click_element "[data-testid='scm-resource-modified.txt'] [data-testid='stage-button']"
    wait_for_element "[data-testid='scm-staged-modified.txt']" 5

    # Act: Type commit message and commit
    type_text "[data-testid='scm-commit-input']" "Test commit message"
    click_testid "scm-commit-button"

    # Assert: Staged files cleared
    wait_for_element_gone "[data-testid='scm-staged-modified.txt']" 5
}

test_06_view_file_diff() {
    # Arrange: Create another modified file
    invoke_tauri "write_file" "{\"path\": \"/tmp/test-git-repo/diff-test.txt\", \"content\": \"new\"}"
    sleep 1
    wait_for_element "[data-testid='scm-resource-diff-test.txt']" 10

    # Act: Click on the file
    click_element "[data-testid='scm-resource-diff-test.txt']"

    # Assert: Diff editor opens
    wait_for_element ".monaco-diff-editor" 5
}

test_07_discard_changes() {
    # Act: Click discard button
    click_element "[data-testid='scm-resource-diff-test.txt'] [data-testid='discard-button']"
    click_testid "confirm-discard"

    # Assert: File removed from changes
    wait_for_element_gone "[data-testid='scm-resource-diff-test.txt']" 5
}

test_08_branch_display() {
    # Assert: Current branch shown in status bar
    assert_element_exists "[data-testid='git-branch-indicator']"
    local branch=$(get_element_text "[data-testid='git-branch-indicator']")
    assert_not_empty "$branch"
}

test_09_create_branch() {
    # Act: Click branch indicator, create new branch
    click_testid "git-branch-indicator"
    wait_for_element "[data-testid='branch-picker']" 5
    click_testid "create-new-branch"
    type_text "[data-testid='new-branch-input']" "feature/test-branch"
    send_key "Enter"

    # Assert: Branch created and checked out
    wait_for_element "[data-testid='git-branch-indicator']" 10
    local branch=$(get_element_text "[data-testid='git-branch-indicator']")
    assert_contains "$branch" "feature/test-branch"
}

test_10_switch_branch() {
    # Act: Switch to main
    click_testid "git-branch-indicator"
    wait_for_element "[data-testid='branch-picker']" 5
    click_element "[data-testid='branch-item-main']"

    # Assert: Branch switched
    wait_for_element "[data-testid='git-branch-indicator']" 10
    local branch=$(get_element_text "[data-testid='git-branch-indicator']")
    assert_contains "$branch" "main"
}
```

**Acceptance Criteria**:

- [ ] SCM panel shows in activity bar
- [ ] Changed files appear with correct status (M/A/D/U)
- [ ] Stage/unstage individual files works
- [ ] Commit with message works
- [ ] View diff on click works
- [ ] Discard changes works (with confirmation)
- [ ] Branch indicator shows current branch
- [ ] Create/switch branches works

---

## P1: Important Features (Weeks 15-25)

### 6. Debugger UI

**Status**: ❌ TODO (NOT WORKING)

**Implementation**:

- Rust DAP router: `src-tauri/src/services/dap.rs`
- Frontend: Wire to `debug-service-override`

**E2E Test File**: `testing/tauri/tests/ui-e2e/51-debugger.sh`

**Test Scenarios**:

```bash
test_01_debug_panel_opens() {
    click_element "[data-testid='activitybar-debug']"
    wait_for_element "[data-testid='debug-view']" 5
}

test_02_set_breakpoint() {
    open_file "/tmp/test-debug-workspace/index.js"
    click_element "[data-testid='editor-gutter-line-5']"
    wait_for_element "[data-testid='breakpoint-line-5']" 2
}

test_03_start_debugging() {
    click_testid "debug-start"
    wait_for_element "[data-testid='debug-paused-indicator']" 30
    assert_element_exists "[data-testid='debug-callstack']"
}

test_04_inspect_variables() {
    assert_element_exists "[data-testid='debug-variables-local']"
    click_element "[data-testid='debug-variables-local'] .expand-icon"
    wait_for_element "[data-testid='variable-item']" 5
}

test_05_step_over() {
    local current=$(get_element_text "[data-testid='debug-current-line']")
    click_testid "debug-step-over"
    sleep 1
    local new=$(get_element_text "[data-testid='debug-current-line']")
    assert_not_equals "$current" "$new" "Should advance"
}

test_06_stop_debugging() {
    click_testid "debug-stop"
    wait_for_element_gone "[data-testid='debug-paused-indicator']" 5
}
```

**Acceptance Criteria**:

- [ ] Debug panel visible in activity bar
- [ ] Set/remove breakpoints by clicking gutter
- [ ] Start debugging (F5) works
- [ ] Pause at breakpoints works
- [ ] Variables panel shows locals/globals
- [ ] Step Over/Into/Out works
- [ ] Stop debugging works

---

### 7. Testing Panel

**Status**: ❌ TODO (NOT WORKING)

**E2E Test File**: `testing/tauri/tests/ui-e2e/52-testing-panel.sh`

**Test Scenarios**:

```bash
test_01_testing_panel_opens() {
    click_element "[data-testid='activitybar-testing']"
    wait_for_element "[data-testid='testing-view']" 5
}

test_02_discovers_tests() {
    wait_for_element "[data-testid='test-item']" 30
    local count=$(get_element_count "[data-testid='test-item']")
    assert_greater_than "$count" 0 "Should discover tests"
}

test_03_run_all_tests() {
    click_testid "run-all-tests"
    wait_for_element "[data-testid='test-result-pass']" 60
}

test_04_run_single_test() {
    hover_element "[data-testid='test-item']:first-child"
    click_element "[data-testid='test-item']:first-child [data-testid='run-test-button']"
    wait_for_element "[data-testid='test-item']:first-child [data-testid='test-result']" 30
}
```

**Acceptance Criteria**:

- [ ] Testing panel visible in activity bar
- [ ] Auto-discovers tests on workspace open
- [ ] Run All Tests button works
- [ ] Run single test works
- [ ] Pass/fail indicators show correctly

---

### 8. Agent Mode (Multi-step Autonomous)

**Status**: ❌ TODO

**E2E Test File**: `testing/tauri/tests/ui-e2e/60-agent-mode.sh`

**Test Scenarios**:

```bash
test_01_enable_agent_mode() {
    click_testid "agent-mode-toggle"
    wait_for_element "[data-testid='agent-mode-active']" 2
}

test_02_agent_executes_multiple_steps() {
    type_text "[data-testid='chat-input']" "Create a React Button component"
    click_testid "chat-send"
    wait_for_element "[data-testid='tool-use-create-file']" 60
}

test_03_agent_asks_approval_for_destructive() {
    type_text "[data-testid='chat-input']" "Delete all console.log statements"
    click_testid "chat-send"
    wait_for_element "[data-testid='agent-approval-dialog']" 30
}

test_04_approve_agent_action() {
    click_testid "agent-approve"
    wait_for_element_gone "[data-testid='agent-approval-dialog']" 5
    wait_for_element "[data-testid='tool-use-complete']" 60
}
```

**Acceptance Criteria**:

- [ ] Toggle to enable/disable agent mode
- [ ] Agent executes multiple tool calls autonomously
- [ ] Shows progress for each step
- [ ] Asks approval for destructive operations
- [ ] Can be cancelled mid-execution

---

### 9. Multi-file Editing (Composer)

**Status**: ❌ TODO

**E2E Test File**: `testing/tauri/tests/ui-e2e/61-multi-file-edit.sh`

**Acceptance Criteria**:

- [ ] Dedicated Composer panel/mode
- [ ] Can specify multiple files or directories
- [ ] Shows all affected files with diffs
- [ ] Accept/Reject per file and all

---

### 10. Terminal AI Commands

**Status**: 🔨 PARTIAL (PTY works, AI integration TODO)

**E2E Test File**: `testing/tauri/tests/ui-e2e/62-terminal-ai.sh`

**Acceptance Criteria**:

- [ ] Natural language input (# prefix)
- [ ] AI suggests shell command
- [ ] Approve/Edit/Reject flow
- [ ] Error explanation on failure

---

## Core IDE Features (Existing)

### Extensions

| Feature                        | Status  | E2E Test                       |
| ------------------------------ | ------- | ------------------------------ |
| Browse marketplace             | ✅ DONE | `02-uninstall-ui-update.sh`    |
| Install extension              | ✅ DONE | `02-uninstall-ui-update.sh`    |
| Uninstall extension            | ✅ DONE | `02-uninstall-ui-update.sh`    |
| Installed tab shows extensions | ✅ DONE | `02-uninstall-ui-update.sh`    |
| Extension details tabs         | ✅ DONE | `35-extension-details-tabs.sh` |

### AI Chat (Blink Code Assist)

| Feature           | Status     | E2E Test              |
| ----------------- | ---------- | --------------------- |
| Chat panel toggle | ✅ DONE    | `24-ai-chat-ui.sh`   |
| Send message      | ✅ DONE    | `24-ai-chat-ui.sh`   |
| Stream response   | ✅ DONE    | `25-ai-streaming.sh` |
| Cancel request    | ✅ DONE    | `25-ai-streaming.sh` |
| Auth flow         | 🔨 PARTIAL | `23-ai-auth-flow.sh` |

### File System

| Feature             | Status     | E2E Test          |
| ------------------- | ---------- | ----------------- |
| Open folder         | ✅ DONE    | `01-health.sh`    |
| File tree display   | ✅ DONE    | `02-workbench.sh` |
| Open file in editor | ✅ DONE    | (manual verify)   |
| Save file           | 🔨 PARTIAL | -                 |

### Panels

| Feature        | Status     | Notes                        |
| -------------- | ---------- | ---------------------------- |
| Terminal       | 🔨 PARTIAL | Opens, PTY behavior untested |
| Problems panel | 🔨 PARTIAL | Shows markers                |
| Output panel   | 🔨 PARTIAL | Shows output                 |
| Activity bar   | ✅ DONE    | All icons clickable          |

---

## P2: Document Editing (Future)

**Test file range**: 70-79

| Feature                 | Status     | E2E Test             |
| ----------------------- | ---------- | -------------------- |
| Word editing            | 🔨 PARTIAL | `70-docx-edit.sh`    |
| Excel editing           | 🔨 PARTIAL | `71-xlsx-edit.sh`    |
| PowerPoint editing      | 🔨 PARTIAL | `72-pptx-edit.sh`    |
| LLM document operations | ❌ TODO    | `73-document-llm.sh` |

---

## Required data-testid Attributes

Add to components as features are implemented:

```
# Activity Bar
activitybar-explorer, activitybar-search, activitybar-scm
activitybar-debug, activitybar-testing, activitybar-extensions
activitybar-chat

# SCM Panel
scm-view, scm-commit-input, scm-commit-button
scm-resource-{filename}, scm-staged-{filename}
stage-button, unstage-button, discard-button
git-branch-indicator, branch-picker, create-new-branch

# Debug Panel
debug-view, debug-start, debug-stop
debug-step-over, debug-step-into, debug-step-out
debug-continue, debug-callstack, debug-variables-local
debug-paused-indicator, breakpoint-line-{n}

# Testing Panel
testing-view, run-all-tests, test-item
test-result-pass, test-result-fail, run-test-button

# Chat Panel
chat-panel, chat-input, chat-send
chat-message-user, chat-message-assistant
mention-dropdown, context-chip, context-sources

# Inline Edit
inline-edit-input, inline-edit-accept, inline-edit-reject

# Diff Review
diff-accept-all, diff-reject-all, hunk-accept, hunk-reject, hunk-pending

# Agent Mode
agent-mode-toggle, agent-mode-active
agent-approval-dialog, agent-approve, agent-reject, tool-use-complete

# Composer
composer-panel, composer-input, composer-submit
composer-file-diff, composer-accept-all
```

---

## Definition of Done

A feature is **DONE** when:

1. ✅ Implementation complete
2. ✅ E2E test file exists with ALL scenarios from this doc
3. ✅ ALL E2E tests pass (`./testing/tauri/run-tests.sh`)
4. ✅ Manual smoke test confirms UX
5. ✅ This checklist updated with ✅ DONE status
6. ✅ Code committed with test file

**NO EXCEPTIONS.**

---

## Maintaining This Document

### When Implementing a Feature

1. **Before starting**: Check this document for the feature's status and test scenarios
2. **During implementation**: Follow the test scenarios as acceptance criteria
3. **After completing**:
   - Update status from ❌ TODO → 🔨 PARTIAL → ✅ DONE
   - Add actual test file path if different from planned
   - Note any deviations from planned scenarios

### When Adding New Features

1. Add a new section following the existing format:
   - Status indicator
   - Implementation file path
   - E2E test file path (following numbering convention)
   - Test scenarios with bash code
   - Acceptance criteria checklist
2. Add any new `data-testid` attributes to the Required section
3. Update the test file numbering if using a new range

### When Discovering Issues

1. If a feature marked ✅ DONE has bugs, change to 🔨 PARTIAL
2. Add a note explaining what's broken
3. Write a failing E2E test that reproduces the issue
4. Fix the issue, then restore ✅ DONE status

### Quarterly Review

- Verify all ✅ DONE features still pass their E2E tests
- Update status of any degraded features
- Review and update acceptance criteria based on user feedback

---

## Related Documents

- [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) - Code health issues to fix
- [AI_IDE_ROADMAP.md](./plan/AI_IDE_ROADMAP.md) - Detailed implementation timeline
- [TESTING.md](./TESTING.md) - Testing guidelines
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
