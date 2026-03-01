# Blink: AI IDE Feature Roadmap

**Last Updated**: January 2026
**Estimated Time to Cursor/Windsurf Parity**: 25-30 weeks (optimistic) / 40-50 weeks (realistic)

> ⚠️ **Timeline Caveat**: These estimates assume:
>
> - Full-time dedicated development (no meetings, no interruptions)
> - No major blockers discovered during implementation
> - Existing code health issues don't cause cascading problems
>
> **Realistic expectation for solo developer**: Add 50-100% buffer to all estimates.

---

## Competitive Landscape

Building a competitive AI IDE in 2026 requires **34 essential features** across 8 categories. Your current foundation - working extensions, terminal PTY, AI chat agent, and document editing - positions you at approximately **40% of table-stakes features**.

### What Competitors Offer

| IDE          | Key Differentiator                         | Our Gap                                   |
| ------------ | ------------------------------------------ | ----------------------------------------- |
| **Cursor**   | 8 parallel background agents, "Plan Mode"  | Agent mode, multi-step autonomous         |
| **Windsurf** | "Cascade" click-to-edit live previews      | Beginner-friendly UX, preview mode        |
| **Zed**      | 120 FPS GPU-accelerated performance        | Performance optimization                  |
| **Cline**    | Self-correcting agents, browser automation | Autonomous verification, visual debugging |

### Critical Insight

**Context systems** (@file, @codebase, @docs mentions) differentiate good from great AI IDEs. Every competitor implements these. The AI chat agent needs these context providers to compete.

---

## Priority Matrix

### P0: Critical (Must Ship) - Weeks 1-14

These 8 features are non-negotiable for a competitive AI IDE:

| Feature                          | Current Status  | Effort    | Dependencies                     |
| -------------------------------- | --------------- | --------- | -------------------------------- |
| Tab autocomplete (ghost text)    | ✅ DONE         | 2-3 weeks | Monaco inline completions API    |
| Inline editing (Ctrl+K)          | ✅ DONE         | 2 weeks   | Selection handling, diff preview |
| @file/@codebase context mentions | ✅ DONE         | 2 weeks   | Chat UI, file search             |
| Diff review before apply         | ✅ DONE         | 1-2 weeks | Monaco diff editor               |
| Model provider flexibility       | ✅ DONE         | 1 week    | API abstraction layer            |
| **Git/SCM panel**                | NOT WORKING     | 5-7 weeks | git2-rs backend                  |
| File/text search                 | ✅ DONE (basic) | 1 week    | search-service-override          |
| Extension marketplace            | ✅ DONE         | -         | -                                |

### P1: Important (High Value) - Weeks 15-25

| Feature                       | Current Status | Effort    | Dependencies                |
| ----------------------------- | -------------- | --------- |-----------------------------|
| **Debugger UI**               | NOT WORKING    | 4-6 weeks | DAP, extension host         |
| **Testing panel**             | NOT WORKING    | 5-7 weeks | Test runners per language   |
| Agent mode (multi-step)       | TODO           | 3-4 weeks | Tool-use loop, verification |
| Multi-file editing (Composer) | TODO           | 3 weeks   | Batch apply, diff tracking  |
| Plan mode (strategy first)    | TODO           | 1 week    | LLM plan generation         |
| Terminal AI commands          | PTY works      | 1 week    | NL → shell parsing          |
| Persistent memory/rules       | TODO           | 1-2 weeks | embeddings                  |
| MCP server support            | TODO           | 2-3 weeks | Model Context Protocol      |

### P2: Nice-to-Have (Differentiators) - Weeks 26+

| Feature                    | Effort    | Competitive Advantage              |
| -------------------------- | --------- | ---------------------------------- |
| Background agents          | 4+ weeks  | High - Cursor's key differentiator |
| Browser automation         | 3-4 weeks | High - Cline/Windsurf exclusive    |
| Real-time collaboration    | 8+ weeks  | Medium - Zed's core feature        |
| PR code review bot         | 4+ weeks  | Medium - Cursor's Bugbot           |
| Custom MCP server creation | 2-3 weeks | Medium - Cline exclusive           |
| Click-to-edit live preview | 4+ weeks  | Medium - Windsurf exclusive        |
| Coverage visualization     | 2-3 weeks | Low - Standard feature             |

---

## Implementation Details

### Tab Autocomplete (P0 - Weeks 1-2)

**Implementation**: `src/services/vscode/tabAutocomplete.ts`

```typescript
// Register inline completion provider with Monaco
// Stream predictions from AI on keystroke debounce (300ms)
// Render ghost text in editor
// Tab accepts, Escape dismisses
```

**Key Requirements**:

- Multi-line ghost text support
- Context-aware suggestions (not in strings/comments)
- Streaming from AI with < 500ms perceived latency

**E2E Test**: `testing/tauri/tests/ui-e2e/40-tab-autocomplete.sh`

---

### Inline Editing / Ctrl+K (P0 - Weeks 3-4)

**Implementation**: `src/services/vscode/inlineEdit.ts`

**Flow**:

1. User selects code
2. Ctrl+K (Cmd+K on Mac) opens input above selection
3. User types instruction ("Add error handling")
4. AI streams edits
5. Diff preview shown
6. Accept/Reject buttons

**E2E Test**: `testing/tauri/tests/ui-e2e/41-inline-edit.sh`

---

### @Context Mentions (P0 - Weeks 5-6)

**Implementation**: `src/services/vscode/contextMentions.ts`

**Supported Mentions**:

- `@file:path/to/file.ts` - Include file content
- `@folder:src/components` - Include folder structure
- `@codebase:keyword` - Semantic search across codebase
- `@docs:topic` - Search documentation

**UI Components**:

- Autocomplete dropdown on @ symbol
- Context chips in chat input
- Source references in response

**E2E Test**: `testing/tauri/tests/ui-e2e/42-context-mentions.sh`

---

### Diff Review (P0 - Weeks 7-8)

**Implementation**: `src/services/vscode/diffReview.ts`

**Features**:

- Monaco diff editor integration
- Per-hunk accept/reject buttons
- Keyboard navigation (j/k for hunks, y/n for accept/reject)
- Undo support

**E2E Test**: `testing/tauri/tests/ui-e2e/43-diff-review.sh`

---

### Git/SCM Panel (P0 - Weeks 9-14)

**This is the largest P0 feature requiring Rust backend work.**

#### Architecture

```
Frontend (SCM Service Override)
         ↓ Tauri IPC
Rust Backend (git2-rs)
         ↓
Local Git Repository
```

#### Rust Backend Commands

```rust
// src-tauri/src/services/git.rs

#[tauri::command]
async fn git_status(repo_path: String) -> Result<Vec<FileStatus>, String>

#[tauri::command]
async fn git_stage(repo_path: String, files: Vec<String>) -> Result<(), String>

#[tauri::command]
async fn git_unstage(repo_path: String, files: Vec<String>) -> Result<(), String>

#[tauri::command]
async fn git_commit(repo_path: String, message: String) -> Result<CommitInfo, String>

#[tauri::command]
async fn git_diff(repo_path: String, file: Option<String>) -> Result<String, String>

#[tauri::command]
async fn git_log(repo_path: String, limit: u32) -> Result<Vec<CommitInfo>, String>

#[tauri::command]
async fn git_branch_list(repo_path: String) -> Result<Vec<BranchInfo>, String>

#[tauri::command]
async fn git_checkout(repo_path: String, branch: String) -> Result<(), String>

#[tauri::command]
async fn git_create_branch(repo_path: String, name: String) -> Result<(), String>
```

#### Key Dependencies

- `git2-rs` (libgit2 Rust bindings) for native Git operations
- `keyring-rs` for credential storage
- SSH key handling via libssh2

#### Risk: Authentication

Start with token auth via system keyring. Defer SSH key management to Phase 2.

#### Risk: Merge Conflicts

Defer merge conflict resolution UI to Phase 2. Use external tools initially.

**E2E Test**: `testing/tauri/tests/ui-e2e/50-git-scm-panel.sh` (10+ test scenarios)

---

### Debugger UI (P1 - Weeks 15-20)

#### Architecture

```
Frontend (Debug Service Override)
         ↓ Tauri IPC
Rust DAP Router
         ↓ stdin/stdout JSON-RPC
Debug Adapters (js-debug, debugpy, codelldb)
```

#### Implementation Requirements

1. Rust backend spawns debug adapters as child processes
2. Route DAP JSON-RPC messages between WebView and adapter
3. Handle `runInTerminal` requests using existing PTY integration
4. Session management for multiple simultaneous debug sessions

#### Blocker

Node.js debug adapter (js-debug) requires Node.js runtime. Use existing sidecar.

**E2E Test**: `testing/tauri/tests/ui-e2e/51-debugger.sh` (12+ test scenarios)

---

### Testing Panel (P1 - Weeks 21-25)

#### Frontend Implementation

```typescript
const controller = vscode.tests.createTestController('blink', 'Blink Tests');

controller.resolveHandler = async (item) => {
  // Call Tauri backend for test discovery
  const tests = await invoke('discover_tests', { path: item?.uri?.path });
  // Build test tree from discovery results
};

controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, async (request, token) => {
  const run = controller.createTestRun(request);
  for (const test of request.include ?? []) {
    run.started(test);
    const result = await invoke('run_test', { testId: test.id });
    result.passed ? run.passed(test) : run.failed(test, new vscode.TestMessage(result.error));
  }
  run.end();
});
```

#### Backend: Language-Specific Adapters

| Framework   | Parser        | Output Format |
| ----------- | ------------- | ------------- |
| cargo test  | Parse stdout  | Text          |
| pytest      | `--json` flag | JSON          |
| jest/vitest | `--json` flag | JSON          |
| JUnit       | Parse output  | XML           |

**Estimated effort per framework**: 1 week

**E2E Test**: `testing/tauri/tests/ui-e2e/52-testing-panel.sh` (10+ test scenarios)

---

## monaco-vscode-api Service Override Map

| Service Override              | Required For        | Status           |
| ----------------------------- | ------------------- | ---------------- |
| `base-service-override`       | Everything          | Required         |
| `workbench-service-override`  | Full VS Code layout | Required         |
| `extensions-service-override` | Extension support   | Working          |
| `files-service-override`      | File system access  | Working          |
| `textmate-service-override`   | Syntax highlighting | Working          |
| `theme-service-override`      | VS Code themes      | Working          |
| `terminal-service-override`   | Terminal panel      | Working          |
| `scm-service-override`        | Git/SCM panel       | **Need backend** |
| `debug-service-override`      | Debugger UI         | **Need backend** |
| `testing-service-override`    | Test explorer       | **Need backend** |
| `chat-service-override`       | Inline chat         | AI works        |
| `search-service-override`     | File/text search    | Verify           |
| `markers-service-override`    | Problems panel      | Verify           |

**Critical**: All packages must be identical versions. Check with `npm list @codingame/monaco-vscode-api`.

---

## Extension Host Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           Blink (Tauri v2)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              WebView + monaco-vscode-api                   │  │
│  │  - Web Worker Extension Host (themes, grammars, snippets) │  │
│  │  - Chat UI, Diff Editor, All panels                       │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │ WebSocket/Tauri IPC                  │
│  ┌────────────────────────▼──────────────────────────────────┐  │
│  │                    Rust Core                               │  │
│  │  - File system ops (git2-rs, tokio-fs)                    │  │
│  │  - DAP router for debugging                                │  │
│  │  - Process management                                      │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │ stdin/stdout JSON-RPC                │
│  ┌────────────────────────▼──────────────────────────────────┐  │
│  │              Node.js Sidecar (pkg binary)                  │  │
│  │  - Node.js Extension Host (debuggers, linters, LSP)       │  │
│  │  - Language servers (typescript, pyright, rust-analyzer)  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Extension Compatibility

- **Web Worker safe (~60%)**: Color themes, TextMate grammars, snippets, icon themes
- **Node.js required (~40%)**: Debuggers, linters (ESLint), language servers, Git extensions

---

## Implementation Schedule

| Week  | Focus             | Deliverable                  | E2E Test File            |
| ----- | ----------------- | ---------------------------- | ------------------------ |
| 1-2   | Tab autocomplete  | Ghost text with multi-line   | `40-tab-autocomplete.sh` |
| 3-4   | Inline editing    | Ctrl+K → edit → diff → apply | `41-inline-edit.sh`      |
| 5-6   | Context system    | @file, @codebase mentions    | `42-context-mentions.sh` |
| 7-8   | Diff review UX    | Accept/reject per-change     | `43-diff-review.sh`      |
| 9-14  | **Git/SCM panel** | Full git2-rs integration     | `50-git-scm-panel.sh`    |
| 15-20 | **Debugger UI**   | DAP router + adapters        | `51-debugger.sh`         |
| 21-25 | **Testing panel** | cargo test + pytest          | `52-testing-panel.sh`    |
| 26+   | Agent mode        | Multi-step autonomous        | `60-agent-mode.sh`       |

**Critical Path**: Git/SCM should come before Debugger because it's more universally needed and less technically risky.

---

## Blockers and Risks

| Risk                                     | Severity | Mitigation                                       |
| ---------------------------------------- | -------- | ------------------------------------------------ |
| SharedArrayBuffer for TS IntelliSense    | High     | Set COOP/COEP headers or use `coi-serviceworker` |
| Debug adapters require Node.js           | Medium   | Sidecar already handles this                     |
| Git authentication complexity            | Medium   | Start with token auth, add SSH later             |
| Large repository performance             | Medium   | Lazy status checking, pagination                 |
| Extension version mismatch crashes       | High     | Lock all @codingame packages                     |
| Merge conflict resolution UI             | Low      | Defer to Phase 2                                 |
| **Technical debt (164 unwraps/expects)** | High     | May cause cascading failures                     |
| **Security vulnerabilities**             | Critical | Fix before any deployment                        |

---

## Resources

- **monaco-vscode-api demo**: https://monaco-vscode-api.netlify.app/
- **Service overrides list**: https://github.com/CodinGame/monaco-vscode-api/wiki/List-of-service-overrides
- **DAP specification**: https://microsoft.github.io/debug-adapter-protocol/
- **git2-rs documentation**: https://docs.rs/git2/latest/git2/
- **Tauri sidecar guide**: https://v2.tauri.app/develop/sidecar/

---

## Success Metrics

| Milestone                 | Target Date | Key Indicator                   | Buffer Date |
| ------------------------- | ----------- | ------------------------------- | ----------- |
| Tab autocomplete works    | Week 2      | Ghost text appears < 500ms      | Week 3      |
| Inline edit flow complete | Week 4      | Diff preview renders correctly  | Week 6      |
| Context mentions working  | Week 6      | @file injects content           | Week 9      |
| Git panel functional      | Week 14     | Stage, commit, push work        | Week 20     |
| Debugger functional       | Week 20     | Breakpoints hit, variables show | Week 28     |
| Test panel functional     | Week 25     | Tests discovered and run        | Week 35     |
| Cursor parity             | Week 30     | All P0/P1 features with tests   | Week 45+    |

---

## Maintaining This Roadmap

### After Completing a Milestone

1. **Update Success Metrics table**: Add actual completion date
2. **Update Implementation Schedule**: Mark week as complete
3. **Update FEATURES.md**: Change feature status to ✅ DONE
4. **Note blockers encountered**: Add to Blockers and Risks if new issues found

### When Milestones Slip

1. Update Target Date and Buffer Date columns
2. Document reason for delay in this section
3. Reassess downstream milestone dates
4. Consider scope reduction if pattern of slippage

### When Adding New Features

1. Assign to appropriate priority tier (P0/P1/P2)
2. Add Implementation Details section with:
   - File paths
   - Architecture diagram (if complex)
   - E2E test file reference
3. Add to Implementation Schedule with week estimate
4. Add to Success Metrics table

### Weekly Status Update Template

```markdown
## Week N Status (Date)

### Completed

- [ Feature ] - E2E tests passing

### In Progress

- [ Feature ] - X% complete, blocked by Y

### Blockers

- [ Issue ] - Impact, mitigation plan

### Next Week

- [ Planned work ]
```

---

## Related Documents

- [FEATURES.md](../FEATURES.md) - Complete feature checklist with E2E test scenarios
- [TECHNICAL_DEBT.md](../TECHNICAL_DEBT.md) - Code health issues (fix security first!)
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
