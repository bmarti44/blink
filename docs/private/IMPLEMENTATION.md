# Blink - Implementation Guidelines

## Development Workflow

### For New Features

1. **Check FEATURES.md** - Is this feature already implemented? What's the status?
2. **Understand the architecture** - Read ARCHITECTURE.md for context
3. **Write E2E test first** - Test will fail (feature doesn't exist yet)
4. **Implement the feature** - Follow existing patterns, add data-testid attributes
5. **Run tests** - Your new test should pass now
6. **Update FEATURES.md** - Change status from TODO to DONE

### For Bug Fixes (TEST FIRST!)

```
1. Reproduce the bug manually
        ↓
2. Write E2E test that reproduces the bug
        ↓
3. Run test - it MUST FAIL
        ↓
4. If test passes, you misunderstand the bug - go back to step 1
        ↓
5. Fix the bug in code
        ↓
6. Run test - should pass now
        ↓
7. Commit test and fix together
```

**Critical Rule**: If you cannot write a failing test for a bug, you do not understand the bug well enough to fix it. Go back and investigate more.

### During Implementation

1. **Follow existing patterns** - Look at similar features for code style
2. **Add data-testid attributes** - Every interactive element needs testability
3. **Update type definitions** - Keep TypeScript types accurate
4. **Handle errors gracefully** - Show user-friendly messages

## Implementation Patterns

### VS Code Service Extension

When adding new functionality to VS Code services:

```typescript
// src/services/vscode/myFeature.ts

import { StandaloneServices } from '@codingame/monaco-vscode-api/services';
import { IMyService } from 'vscode/some/path';

export function initializeMyFeature(): void {
  // Get service from VS Code's dependency injection
  const myService = StandaloneServices.get(IMyService);

  // Extend or override behavior
  const originalMethod = myService.doSomething.bind(myService);
  myService.doSomething = async (...args) => {
    // Custom logic
    console.log('[MyFeature] Doing something');

    // Call original if needed
    return originalMethod(...args);
  };
}
```

### Tauri Command Integration

When bridging to Tauri Rust commands:

```typescript
// src/services/myTauriFeature.ts

import { invoke } from '@tauri-apps/api/core';

export async function myTauriFunction(param: string): Promise<Result> {
  try {
    const result = await invoke<Result>('my_rust_command', { param });
    return result;
  } catch (error) {
    console.error('[MyFeature] Tauri command failed:', error);
    throw error;
  }
}
```

Corresponding Rust command:

```rust
// src-tauri/src/commands/my_command.rs

#[tauri::command]
pub async fn my_rust_command(param: String) -> Result<MyResult, String> {
    // Implementation
    Ok(MyResult { /* ... */ })
}
```

### Event-Driven Updates

When implementing features that need to notify the UI:

```typescript
import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';

class MyService {
  private _onDidChange = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChange.event;

  private _data: Data[] = [];

  get data(): Data[] {
    return this._data;
  }

  async updateData(): Promise<void> {
    this._data = await this.fetchData();
    // CRITICAL: Fire event to notify listeners
    this._onDidChange.fire();
  }
}

// Consumer
myService.onDidChange(() => {
  // React to changes
  refreshUI();
});
```

### Adding Testable Elements

```tsx
// Component with testability
function MyButton({ onClick }: Props) {
  return (
    <button data-testid="my-action-button" onClick={onClick} className="my-button">
      Click Me
    </button>
  );
}
```

Corresponding test:

```bash
test_01_my_button_works() {
    wait_for_element "[data-testid='my-action-button']" 10
    click_testid "my-action-button"
    wait_for_element ".success-indicator" 5
    echo "  ✓ Button click works"
}
```

---

## Blink Code Assist (AI) Integration

> **Note**: AI integration is COMPLETE. See `ai-integration-plan-v2.md` for implementation details.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend                                  │
│  ┌─────────────────┐     ┌────────────────────────┐            │
│  │  chatProvider   │────▶│   aiProviderService    │            │
│  │  (VS Code Chat) │     │ (BYOK API client)      │            │
│  └─────────────────┘     └────────────────────────┘            │
│                                                                  │
│  Config stored in localStorage (blink-ai-provider-config)       │
│  Managed via "Blink: Configure AI Provider" command             │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files

| File                                              | Purpose                              |
| ------------------------------------------------- | ------------------------------------ |
| `src/services/vscode/ai/aiProviderService.ts`     | AI API client, streaming, config     |
| `src/services/vscode/ai/chatProvider.ts`          | VS Code chat agent registration      |
| `src/services/vscode/ai/configureProviderCommand.ts` | "Configure AI Provider" command   |

### Configuration Flow

1. User opens Command Palette → "Blink: Configure AI Provider"
2. Selects provider: Anthropic, OpenAI, or custom OpenAI-compatible
3. Enters API key and model name
4. Config stored in `localStorage` under `blink-ai-provider-config`
5. `isAIProviderConfigured()` returns `true`
6. `streamChat()` is ready for requests

### Using AI in New Features

```typescript
import { isAIProviderConfigured, streamChat, ConversationMessage } from '../ai/aiProviderService';

async function myAIFeature(prompt: string): Promise<string> {
  if (!isAIProviderConfigured()) {
    throw new Error('No AI provider configured.');
  }

  const messages: ConversationMessage[] = [{ role: 'user', content: prompt }];
  let response = '';

  await streamChat(messages, {
    onToken: (chunk) => { response += chunk; },
    onComplete: () => {},
    onError: (error) => { throw error; },
  });

  return response;
}
```

---

## Common Tasks

### Adding a New VS Code Command

1. **Register the command**:

```typescript
// src/services/vscode/myCommands.ts
import { registerCommand } from '@codingame/monaco-vscode-api/services';

export function registerMyCommands(): void {
  registerCommand('myExtension.myCommand', async () => {
    // Command implementation
  });
}
```

2. **Add to keyboard shortcuts** (if needed):

```json
{
  "key": "cmd+shift+m",
  "command": "myExtension.myCommand"
}
```

3. **Call from workbench.ts**:

```typescript
// In doInitializeWorkbench()
import { registerMyCommands } from './myCommands';
registerMyCommands();
```

### Adding a Sidebar Panel

```typescript
// src/services/vscode/myViewProvider.ts
import { registerView } from '@codingame/monaco-vscode-api/services';

export function registerMyView(): void {
  registerView({
    id: 'myView',
    name: 'My View',
    location: ViewContainerLocation.Sidebar,
    render: (container) => {
      container.innerHTML = '<div>My View Content</div>';
    },
  });
}
```

### Adding AI Tool Handlers

```typescript
// In chatProvider.ts or a separate tool handler file
const toolHandlers = {
  create_file: async (params: { path: string; content: string }) => {
    await invoke('write_file', { path: params.path, content: params.content });
    return { success: true };
  },

  read_file: async (params: { path: string }) => {
    const content = await invoke<string>('read_file', { path: params.path });
    return { content };
  },
};
```

## File Organization

### Where to Put New Code

| Type of Code              | Location                  |
| ------------------------- | ------------------------- |
| VS Code service overrides | `src/services/vscode/`    |
| React components          | `src/components/`         |
| Tauri commands            | `src-tauri/src/commands/` |
| E2E tests                 | `testing/tauri/tests/`    |
| Type definitions          | `src/types/` or inline    |
| Utilities                 | `src/utils/`              |

### Naming Conventions

| Type          | Convention         | Example                       |
| ------------- | ------------------ | ----------------------------- |
| Service files | camelCase.ts       | `extensionServiceOverride.ts` |
| Components    | PascalCase.tsx     | `ChatPanel.tsx`               |
| Test files    | XX-feature-name.sh | `02-uninstall-ui-update.sh`   |
| Rust commands | snake_case         | `install_extension`           |
| CSS classes   | kebab-case         | `.extension-card`             |

### Test File Numbering

| Range | Category                                                               |
| ----- | ---------------------------------------------------------------------- |
| 01-05 | Core health, workbench, extensions, editor, error-check                |
| 10-13 | Terminal tests                                                         |
| 22-25 | AI integration                                                        |
| 30-39 | Extension panel tests                                                  |
| 40-49 | AI features (autocomplete, inline edit, context mentions, diff review) |
| 50-59 | VS Code features (Git, Debugger, Testing)                              |
| 60-69 | Agent/Composer features                                                |
| 70-93 | Document editing (docx, xlsx, pptx)                                    |

## Debugging

### Console Logging

Use prefixed logs for easier filtering:

```typescript
console.log('[FeatureName] Message here');
console.error('[FeatureName] Error:', error);
```

Enable debug mode in tests:

```bash
DEBUG=1 ./testing/tauri/run-tests.sh
```

### Inspecting VS Code Services

```typescript
// In browser console or via test server
const services = window.require('@codingame/monaco-vscode-api/services');
const myService = services.StandaloneServices.get(IMyService);
console.log(myService);
```

### Viewing Extension State

```bash
# Via test server
curl -X POST http://localhost:9999/js \
  -H "Content-Type: application/json" \
  -d '{"code": "JSON.stringify(window.__extWorkbenchService.installed.map(e => e.identifier.id))"}'
```

## Gotchas and Pitfalls

### 1. Service Initialization Order

VS Code services must be accessed AFTER `initialize()` completes:

```typescript
// BAD - service may not exist yet
const service = StandaloneServices.get(IMyService);
initialize({...});

// GOOD - access after init
await initialize({...});
const service = StandaloneServices.get(IMyService);
```

### 2. Event Timing

UI updates may not be immediate after firing events:

```typescript
// BAD - checking immediately
this._onChange.fire();
console.log(this.data); // May show old data

// GOOD - let listeners process
this._onChange.fire();
await new Promise((r) => setTimeout(r, 0));
console.log(this.data);
```

### 3. Tauri Async Commands

All Tauri commands are async from the frontend:

```typescript
// BAD - forgetting await
invoke('my_command'); // Returns immediately, result lost

// GOOD
const result = await invoke('my_command');
```

### 4. Test Flakiness

Wait for conditions, don't use fixed delays:

```bash
# BAD
sleep 5

# GOOD
wait_for_element ".my-element" 10
```

### 5. Cache Invalidation

VS Code services cache data aggressively. Clear caches after modifications:

```typescript
// After modifying data
service._cached = undefined;
service._onDidChange.fire();
```

---

## Maintaining Documentation

### After Completing a Feature

1. **Update FEATURES.md**:
   - Change status from ❌ TODO to ✅ DONE
   - Verify test file path matches actual file
   - Check all acceptance criteria boxes

2. **Update AI_IDE_ROADMAP.md** (if applicable):
   - Mark milestone as complete
   - Update "Current Status" section
   - Note any timeline deviations

3. **Update TECHNICAL_DEBT.md** (if applicable):
   - Remove resolved issues
   - Update metrics (unwrap count, as any count, etc.)

### After Discovering a Bug

1. **Update FEATURES.md**: Change ✅ DONE to 🔨 PARTIAL
2. **Add to TECHNICAL_DEBT.md**: Document the issue if it's architectural
3. **Write failing test first**: As per testing guidelines

### When Adding New Patterns

If you create a new implementation pattern (e.g., new service type, new Tauri command pattern):

1. Add an example to this document
2. Update ARCHITECTURE.md if it affects system design
3. Add any new gotchas to the "Gotchas and Pitfalls" section
