# Blink - Technical Debt & Code Health Report

**Last Updated**: January 2026
**Assessment Grade**: D+ (Functional but Fragile)

> This document consolidates findings from a comprehensive code review. Issues are prioritized by severity and grouped by category. **Every item here represents real risk that will manifest as production bugs.**

---

## Executive Summary

| Category                | Grade  | Critical Issues                                        |
| ----------------------- | ------ | ------------------------------------------------------ |
| **Security**            | **F**  | CSP disabled, unsafe-inline, path injection            |
| **Rust Backend**        | **D**  | 164 unwraps/expects, zombie processes, race conditions |
| **TypeScript Frontend** | **D+** | 105 `as any`, memory leaks, unhandled errors           |
| **Testing**             | **D**  | 0 unit tests, flaky e2e, test coverage gaps            |
| **Architecture**        | **D**  | No DI, 4 singletons, scattered state                   |
| **Build/Config**        | **C-** | Outdated deps, redundant code, Node 16 EOL             |

**Verdict: NOT PRODUCTION-READY. Fix security issues before any deployment.**

---

## CRITICAL SECURITY VULNERABILITIES

### FIX IMMEDIATELY - Deploy Nothing Until These Are Resolved

#### 1. CSP is COMPLETELY DISABLED

**File**: `src-tauri/tauri.conf.json`

```json
"security": { "csp": null }
```

- **Impact**: Any JavaScript can execute. Combined with `withGlobalTauri: true`, malicious scripts can access filesystem and execute commands.
- **Fix**: Re-enable CSP with proper values:
  ```json
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src * data:; font-src 'self'"
  ```

#### 2. unsafe-inline CSP Replacement

**File**: `scripts/patch-webview.py:74-78`

```python
csp_replacement = "script-src 'unsafe-inline' 'self'"
```

- **Impact**: Defeats entire CSP protection. XSS vulnerabilities fully exploitable.
- **Fix**: Solve the underlying DOMContentLoaded timing issue instead of disabling CSP. Use nonce-based CSP if inline scripts are necessary.

#### 3. Path Injection in Extension Host

**File**: `src-tauri/src/services/extension_host_manager.rs`

```rust
extension_path: String,  // Takes ANY string from frontend
Command::new("node").arg(&sidecar_path)  // No validation
```

- **Impact**: Attacker can inject arbitrary paths like `../../etc/passwd` as arguments.
- **Fix**: Validate and canonicalize all paths. Ensure paths are within allowed directories.

#### 4. Code-Server with Auth Disabled

**File**: `src-tauri/src/commands/vscode_server.rs:110`

```rust
"--auth", "none"
```

- **Impact**: Anyone on network can access VS Code with no authentication.
- **Fix**: Enable authentication or document why it's disabled in a controlled environment.

#### 5. Empty Updater Public Key

**File**: `src-tauri/tauri.conf.json`

```json
"updater": { "pubkey": "" }
```

- **Impact**: App updates are not verified. Arbitrary code can be deployed.
- **Fix**: Generate keypair with `tauri signer generate` and configure signing.

---

## Rust Backend Issues

### Memory Leaks & Zombie Processes

| Issue                                       | Location                    | Impact                          | Fix                                       |
| ------------------------------------------- | --------------------------- | ------------------------------- | ----------------------------------------- |
| Detached threads hold Arc refs indefinitely | `extension_host.rs:315-410` | Memory never freed              | Use tokio::spawn with proper cleanup      |
| Child processes not reaped                  | `extension_host.rs:420-422` | Zombie processes accumulate     | Call `wait()` after `kill()`              |
| Channels created but receivers dropped      | `router.rs:180`             | Dead subscriptions waste memory | Remove subscription when receiver dropped |
| MutationObserver never disconnected         | `workbench.ts:306`          | Observer runs forever           | Add cleanup in component unmount          |

### Race Conditions (5 Critical)

1. **ExtensionHostState process/stdin inconsistency** (`extension_host.rs:228-243`)
   - Thread A locks `process` and checks for Some
   - Thread B steals the `stdin`
   - Thread A writes to None stdin, panics

2. **Reader thread/command handler race** (`extension_host.rs:328`)
   - No synchronization between state change and ready signal

3. **Pending requests race with timeout** (`extension_host_manager.rs:330-333`)
   - Both reader thread and timeout can handle same response

4. **Workspace folder changed while awaiting** (`extension_host_manager.rs:472-483`)
   - Uses stale workspace value after await

5. **Channel router subscriptions leak** (`router.rs:177-189`)
   - Creates channels but immediately drops receiver

### Error Handling Failures

- **164 `.unwrap()`/`.expect()` calls** - Will panic on any error
- **50+ silent emit() failures** - `let _ = app.emit()` ignores all errors
- **JSON serialization errors become null** - `extension_host.rs:69`
- **Blocking operations in async context** - `blocking_send()` in reader threads

### Design Problems

| Problem                         | Impact                                 | Location                                                       |
| ------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| Deprecated API still registered | Confusion, maintenance burden          | Both old and new extension host APIs in `lib.rs`               |
| String errors lose context      | Cannot debug production issues         | `extension_host_error.rs` defines types but converts to String |
| `eprintln!()` for logging       | No structured logs, performance impact | 20+ instances across codebase                                  |

---

## TypeScript Frontend Issues

### Type Safety Violations (40+)

| File                          | Lines                  | Issue                                   |
| ----------------------------- | ---------------------- | --------------------------------------- |
| `workbench.ts`                | 114, 124, 278, 290-296 | Extensive `as any` casts                |
| `extensionServiceOverride.ts` | 154, 171-174, 204, 232 | Unsafe service casts without validation |
| `extensionHostService.ts`     | 300                    | Double-cast `as unknown as { items }`   |

### Memory Leaks (6 Critical)

```typescript
// workbench.ts:306 - Never cleared
setInterval(scan, 1000);

// workbench.ts:304 - Never disconnected
const mo = new MutationObserver(() => scan());
mo.observe(document.documentElement, { childList: true, subtree: true });

// extensionHostIntegration.ts:166-240 - Never unregistered
extensionHostService.onNotification((notification) => {...});
```

### Unhandled Promise Rejections (8+)

- `extensionHostIntegration.ts:249-254` - No `.catch()` on showErrorMessage
- `extensionServiceOverride.ts:142-145` - Swallows errors and continues
- `extensionHostService.ts:603-607` - Chaining `.then()` in catch block

### Race Conditions

- `workbench.ts:216-234`: Double-checked locking with race window
- `extensionHostIntegration.ts:75-93`: Timeout race with ready check
- `extensionHostService.ts:583-617`: Response/timeout race can call unlisten twice

---

## Testing Infrastructure Failures

### Critical Bug: Undefined Functions Called

```bash
# 33-extension-install-flow.sh:64
wait_for_extension_results 5  # UNDEFINED - silently fails

# 33-extension-install-flow.sh:177
ui_wait_for_extension_visible "$EXT_ID" 5  # UNDEFINED - silently fails
```

**These tests silently pass when they should fail.**

### Test Quality Issues

| Problem                      | Count | Impact                      |
| ---------------------------- | ----- | --------------------------- |
| Hard-coded sleeps            | 30+   | Flaky on CI                 |
| `skip_test` masking failures | 43    | False confidence            |
| Fragile DOM selectors        | Many  | Break on UI changes         |
| Silent setup failures        | Many  | Tests run against bad state |

### Coverage Gaps

- **0 unit tests** in TypeScript codebase
- **No negative path tests** - Error conditions not tested
- **No performance tests** - No baseline metrics
- **No load/stress tests**

**Estimated confidence from test suite: ~40%**

---

## Architecture Problems

### No Dependency Injection

```typescript
// 4 independent singletons - impossible to test in isolation
export const extensionHostService = new ExtensionHostService();
export const vscodeServerService = new CodeServerService();
export const serverConnection = new ServerConnectionService();
export const channelConnection = new ChannelConnectionService();
```

### Scattered State Management

| Problem                            | Location              | Risk                     |
| ---------------------------------- | --------------------- | ------------------------ |
| File-based + localStorage settings | `settings.ts`         | Can diverge              |
| 79 `window.` references            | Throughout codebase   | Global pollution         |
| Multiple independent caches        | Various services      | No invalidation strategy |
| Fake `process` object injection    | `workerSetupEntry.ts` | Hidden behavior          |

### God Objects

| File                          | Lines | Concerns                     |
| ----------------------------- | ----- | ---------------------------- |
| `extensionServiceOverride.ts` | 3,650 | 5+ distinct responsibilities |
| `workbench.ts`                | 730   | Entire VS Code orchestration |
| `channel_router.rs`           | 732   | Single IPC bottleneck        |

### Tight Coupling

- 38 Tauri `invoke()` imports scattered across services
- No centralized adapter pattern
- Every layer knows implementation details of next

---

## Build Configuration Issues

### package.json Problems

| Issue            | Current             | Should Be                  |
| ---------------- | ------------------- | -------------------------- |
| Node requirement | `>=16.9.1`          | `>=18.0.0` (16 is EOL)     |
| Monaco packages  | 66 at exact version | Consider bundling strategy |
| faker-js         | v7                  | v8+ (current)              |
| eslint           | v8                  | v9 (current)               |

### Webpack Config

```javascript
// ojet.config.js - Duplicate lines (dead code)
config.output.filename = '[name].js';
config.output.chunkFilename = '[name].chunk.js';
config.output.filename = '[name].js'; // DUPLICATE
config.output.chunkFilename = '[name].chunk.js'; // DUPLICATE
```

### Script Quality

| Script                | Issue                              | Risk                    |
| --------------------- | ---------------------------------- | ----------------------- | ---------------------- | --------------- |
| `dev.sh`              | `                                  |                         | true` masks all errors | Silent failures |
| `dev.sh`              | No timeout on wait loops           | Can hang forever        |
| `build-extensions.sh` | Operator precedence bugs           | Unreliable builds       |
| All scripts           | No validation of required commands | Breaks on missing tools |

---

## Priority Fix Schedule

### WEEK 1 - Security (CRITICAL - BLOCKS EVERYTHING)

| #   | Task                     | Files                                           |
| --- | ------------------------ | ----------------------------------------------- |
| 1   | Re-enable CSP            | `tauri.conf.json`                               |
| 2   | Remove unsafe-inline     | `patch-webview.py`, fix underlying timing       |
| 3   | Add path validation      | `extension_host_manager.rs`, all Tauri commands |
| 4   | Enable code-server auth  | `vscode_server.rs`                              |
| 5   | Generate updater keypair | `tauri.conf.json`, CI/CD                        |

### WEEK 2 - Stability

| #   | Task                          | Files                        |
| --- | ----------------------------- | ---------------------------- |
| 6   | Fix zombie processes          | All `Command::spawn()` calls |
| 7   | Clear intervals/observers     | `workbench.ts`               |
| 8   | Define missing test functions | `test-client.sh`             |
| 9   | Replace hard-coded sleeps     | All test files               |
| 10  | Update Node requirement       | `package.json`               |

### MONTH 1 - Quality

| #   | Task                   | Scope                          |
| --- | ---------------------- | ------------------------------ |
| 11  | Remove 162 unwraps     | All Rust files                 |
| 12  | Create TauriAdapter    | Centralize invoke() calls      |
| 13  | Add unit tests         | Mock Tauri, test services      |
| 14  | Remove deprecated APIs | Choose one extension host impl |
| 15  | Fix race conditions    | Proper synchronization         |

### MONTH 2 - Architecture

| #   | Task                           | Scope                                         |
| --- | ------------------------------ | --------------------------------------------- |
| 16  | Implement dependency injection | Service layer                                 |
| 17  | Split god objects              | `workbench.ts`, `extensionServiceOverride.ts` |
| 18  | Consolidate state management   | Single source of truth                        |
| 19  | Add structured logging         | Replace console.log                           |
| 20  | Document critical paths        | Architecture docs                             |

---

## Technical Debt Tracking

### Metrics to Track

| Metric                              | Current         | Target |
| ----------------------------------- | --------------- | ------ |
| `unwrap()`/`expect()` calls in Rust | 164             | 0      |
| `as any` in TypeScript              | 105             | 0      |
| Test coverage (unit)                | 0%              | 60%+   |
| E2E test pass rate                  | ~40% confidence | 95%+   |
| Security score (CSP)                | F               | A      |
| Memory leaks (observers/timers)     | 6+              | 0      |

### Definition of "Fixed"

An issue is fixed when:

1. Code change is made
2. Unit test covers the specific fix
3. E2E test verifies user-facing behavior
4. No regression in existing tests
5. Documentation updated if needed

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture (add issues section)
- [FEATURES.md](./FEATURES.md) - Feature checklist with E2E requirements
- [AI_IDE_ROADMAP.md](./plan/AI_IDE_ROADMAP.md) - AI IDE feature implementation plan
- [TESTING.md](./TESTING.md) - Testing guidelines

---

## Appendix: Full Issue Counts by File

### Rust Files with Most Issues

| File                        | unwrap | expect | emit ignored | Threads |
| --------------------------- | ------ | ------ | ------------ | ------- |
| `extension_host_manager.rs` | 23     | 8      | 12           | 3       |
| `extension_host.rs`         | 18     | 5      | 15           | 2       |
| `terminal.rs`               | 12     | 4      | 8            | 2       |
| `channel_router.rs`         | 8      | 3      | 6            | 1       |
| `ai_chat.rs`                | 7      | 2      | 4            | 1       |

### TypeScript Files with Most Issues

| File                          | `as any` | Missing null checks | Memory leaks |
| ----------------------------- | -------- | ------------------- | ------------ |
| `extensionServiceOverride.ts` | 15+      | 20+                 | 2            |
| `workbench.ts`                | 12+      | 10+                 | 2            |
| `extensionHostService.ts`     | 8+       | 8+                  | 1            |
| `extensionHostIntegration.ts` | 3        | 5+                  | 1            |
