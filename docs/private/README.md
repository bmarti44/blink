# Blink - AI Developer Documentation

This documentation is for AI assistants helping develop Blink. It contains implementation details, feature status, and guidelines for development.

---

## CRITICAL: Read Before Any Work

### Security Vulnerabilities (Fix Before Any Deployment)

| Issue                            | Severity     | File                        |
| -------------------------------- | ------------ | --------------------------- |
| CSP completely disabled          | **CRITICAL** | `tauri.conf.json`           |
| `unsafe-inline` in CSP patch     | **CRITICAL** | `scripts/patch-webview.py`  |
| Path injection in extension host | **CRITICAL** | `extension_host_manager.rs` |
| Code-server auth disabled        | **HIGH**     | `vscode_server.rs`          |
| Empty updater public key         | **HIGH**     | `tauri.conf.json`           |

**See [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) for full details and fixes.**

### Current Code Health Grade: D+

- **164 `.unwrap()`/`.expect()` calls** in Rust - will panic on any error
- **105 `as any`** casts in TypeScript - type safety bypassed
- **0 unit tests** - only E2E tests exist
- **6 memory leaks** - intervals/observers never cleaned up
- **5 race conditions** - concurrent access bugs

---

## Documentation Index

| Document                                                   | Description                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| [DEVELOPMENT.md](./DEVELOPMENT.md)                         | **START HERE** - Setup, running, testing, building                      |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                       | System architecture and key components                                  |
| [FEATURES.md](./FEATURES.md)                               | **Feature checklist with E2E test scenarios**                           |
| [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md)                   | **CRITICAL** - Code health issues and security vulnerabilities          |
| [TESTING.md](./TESTING.md)                                 | Testing requirements and E2E test guidelines                            |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md)                   | Implementation patterns and guidelines                                  |
| [P0_IMPLEMENTATION_GUIDE.md](./P0_IMPLEMENTATION_GUIDE.md) | **FOR AI** - Step-by-step P0 feature implementation with code templates |

### Implementation Plans

| Document                                                             | Description                                         |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| [plan/AI_IDE_ROADMAP.md](./plan/AI_IDE_ROADMAP.md)                   | AI IDE feature implementation roadmap (25-30 weeks) |
| [plan/ai-integration-plan-v2.md](./plan/ai-integration-plan-v2.md) | Blink Code Assist integration (✅ COMPLETED)       |
| [plan/document-editing-plan.md](./plan/document-editing-plan.md)     | Office document editing implementation              |

## Quick Reference

### Project Structure

```
blink/
├── src/
│   ├── components/         # React UI components
│   │   ├── pages/IDE/      # Main IDE component (legacy)
│   │   ├── ide/            # Custom IDE components
│   │   └── office/         # Office document components
│   └── services/
│       ├── vscode/         # VS Code Workbench integration
│       │   ├── workbench.ts              # Main workbench init
│       │   ├── extensionServiceOverride.ts # Extension patches
│       │   ├── tauriFileSystemProvider.ts  # Tauri FS bridge
│       │   ├── tauriExtensionManagementService.ts # Extension mgmt
│       │   ├── ai/aiProviderService.ts   # AI client (BYOK)
│       │   └── ai/chatProvider.ts        # AI chat agent
│       ├── aiChat.ts       # AI chat service
│       └── settings.ts     # Settings persistence
├── src-tauri/              # Tauri Rust backend
│   └── src/
│       ├── main.rs         # App entry point
│       ├── services/
│       │   ├── ai.rs      # AI OAuth callback server
│       │   └── ...
│       ├── test_server/    # Debug test server (E2E)
│       └── sidecar/        # AI sidecar process
├── testing/tauri/          # E2E test suite
│   ├── lib/test-client.sh  # Test utilities
│   ├── tests/functional/   # Functional tests
│   └── tests/ui-e2e/       # User-centric E2E tests
└── docs/
    ├── public/             # User documentation
    └── private/            # AI developer documentation
```

### Key Technologies

- **Frontend**: React + TypeScript
- **Editor**: monaco-vscode-api (VS Code Workbench)
- **Desktop**: Tauri v2 (Rust backend)
- **AI**: BYOK via `aiProviderService.ts` (Anthropic, OpenAI, custom)
- **Testing**: Bash E2E tests with HTTP test server

### Development Commands

```bash
# Start development (includes test server on port 9999)
npm run tauri:dev

# Run ALL tests (MANDATORY before completing any feature)
./testing/tauri/run-tests.sh

# Run AI-specific tests
npm run test:tauri:ai

# Production build
npm run tauri:build
```

### Mandatory Testing Loop

## CRITICAL MANDATE

**ALWAYS write an E2E test to reproduce an issue BEFORE attempting to fix it. This is non-negotiable.**

**For New Features:**

```
1. npm run tauri:dev              # Start the app
2. Write E2E test first           # Test will fail (feature doesn't exist)
3. Implement the feature
4. ./testing/tauri/run-tests.sh   # ALL tests must pass
5. Update FEATURES.md status      # Mark as DONE only if tests pass
```

**For Bug Fixes (TEST FIRST - ALWAYS!):**

```
1. npm run tauri:dev              # Start the app
2. FIRST: Write E2E test that reproduces bug  # MUST FAIL
3. Verify test fails for right reason
4. THEN: Fix the bug in code
5. ./testing/tauri/run-tests.sh   # Test should pass now
6. Update FEATURES.md status
```

**If you can't write a failing test for a bug, you don't understand the bug.**
**Never skip the test-first step. Ever.**

See [DEVELOPMENT.md](./DEVELOPMENT.md) for complete setup and workflow details.

## Critical Development Guidelines

### 1. Feature Verification is MANDATORY

Every implemented feature MUST have E2E tests that verify the feature works from a user's perspective. Tests must use user-centric interactions (clicks, typing) - not programmatic API calls.

### 2. VS Code Service Patching

When modifying VS Code services, understand the service hierarchy:

```
IExtensionManagementService (low-level)
    ↓ uses
IWorkbenchExtensionManagementService (workspace-aware)
    ↓ uses
IExtensionsWorkbenchService (UI-facing, has installed/local arrays)
```

The `extensionServiceOverride.ts` file patches these services for Tauri compatibility.

### 3. Event-Driven UI Updates

VS Code uses the Emitter/Event pattern for state changes:

```typescript
// Fire event to notify listeners
this._onDidChange.fire();

// Listen for changes
service.onChange(() => {
  /* update UI */
});
```

Cache invalidation requires:

1. Clear cached arrays (`_installed`, `_local`)
2. Fire change events
3. Wait for UI to re-query data

### 4. Extension Service State

The extension panel has multiple state layers:

- `tauriServer`: Actual installed extensions (source of truth)
- `fakeLocalExtensions`: Bridging object for VS Code compatibility
- `workbenchService`: UI state with caching

Keep these in sync via event handlers in `extensionServiceOverride.ts`.

### 5. AI Integration (BYOK)

AI is integrated via:

- `src/services/vscode/ai/aiProviderService.ts` - API client (Anthropic/OpenAI/custom)
- `src/services/vscode/ai/chatProvider.ts` - VS Code chat agent
- `src/services/vscode/ai/configureProviderCommand.ts` - "Configure AI Provider" command

Configuration: User runs "Blink: Configure AI Provider" from Command Palette, enters API key. Config stored in `localStorage` under `blink-ai-provider-config`.
