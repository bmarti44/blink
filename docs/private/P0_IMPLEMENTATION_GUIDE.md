# P0 Feature Implementation Guide

**Purpose**: Step-by-step instructions for implementing P0 features that a less capable AI can follow autonomously.

**For each feature, this guide provides**:

1. Prerequisites and dependencies
2. Exact files to create/modify with line numbers
3. Complete code templates
4. Build, test, and verify commands
5. Troubleshooting for common failures

---

## Before You Start

### Environment Verification

Run these commands to verify your environment is ready:

```bash
# 1. Verify Node.js version (must be >= 18)
node --version
# Expected: v18.x.x or higher

# 2. Verify Rust is installed
rustc --version
# Expected: rustc 1.x.x

# 3. Verify dependencies are installed
cd /Users/briamart/github/blink
npm install

# 4. Start the development server
npm run tauri:dev

# 5. Wait for app to start, then verify test server
curl http://localhost:9999/health
# Expected: {"status":"ok","bridge_connected":true,...}
```

### Running Tests

```bash
# Run all tests
./testing/tauri/run-tests.sh

# Run specific test file
./testing/tauri/tests/ui-e2e/40-tab-autocomplete.sh

# Run with debug output
DEBUG=1 ./testing/tauri/run-tests.sh
```

---

## Feature Dependencies

```
┌─────────────────────────────────────────────────────────────────┐
│                     DEPENDENCY GRAPH                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  AI Provider (DONE — configure via Command Palette)            │
│       │                                                          │
│       ├──► Tab Autocomplete ──► Ghost text in editor            │
│       │                                                          │
│       ├──► Inline Edit (Ctrl+K) ──► Diff preview               │
│       │         │                                                │
│       │         └──► Diff Review ──► Accept/Reject changes      │
│       │                                                          │
│       └──► Context Mentions (@file) ──► Chat with context       │
│                                                                  │
│  Extension Host (DONE)                                          │
│       │                                                          │
│       └──► Git Panel ──► requires git2-rs backend (TODO)        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

IMPLEMENTATION ORDER:
1. Tab Autocomplete (no new dependencies)
2. Inline Edit (depends on: Tab Autocomplete patterns)
3. Diff Review (depends on: Inline Edit)
4. Context Mentions (no new dependencies)
5. Git Panel (depends on: Rust backend work)
```

---

## 1. Tab Autocomplete (Ghost Text)

### Prerequisites

- [ ] AI provider configured (`src/services/vscode/ai/aiProviderService.ts` exists)
- [ ] Workbench initializing successfully

### Step 1: Create the Provider File

Create file: `src/services/vscode/tabAutocomplete.ts`

````typescript
/**
 * Tab Autocomplete Provider
 * Provides ghost text completions using AI
 */

import * as vscode from 'vscode';
import { isAIProviderConfigured, streamChat, ConversationMessage } from './ai/aiProviderService';

// Debounce delay in milliseconds
const DEBOUNCE_MS = 300;

// Track pending requests for cancellation
let pendingRequest: AbortController | null = null;

export class TabAutocompleteProvider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | null> {
    // Cancel any pending request
    if (pendingRequest) {
      pendingRequest.abort();
    }
    pendingRequest = new AbortController();

    // Don't complete in comments or strings (basic check)
    const lineText = document.lineAt(position.line).text;
    const textBefore = lineText.substring(0, position.character);

    // Skip if line is empty or just whitespace
    if (textBefore.trim().length < 3) {
      return null;
    }

    // Skip if in a string literal (basic heuristic)
    const quoteCount = (textBefore.match(/['"]/g) || []).length;
    if (quoteCount % 2 !== 0) {
      return null;
    }

    try {
      // Get context: current line + some preceding lines
      const startLine = Math.max(0, position.line - 20);
      const contextRange = new vscode.Range(startLine, 0, position.line, position.character);
      const contextText = document.getText(contextRange);

      // Build prompt for completion
      const prompt = `Complete this code. Only provide the completion, no explanation:
\`\`\`${document.languageId}
${contextText}`;

      // Check AI is configured
      if (!isAIProviderConfigured()) {
        return null;
      }

      // Request completion
      let completion = '';
      const messages: ConversationMessage[] = [{ role: 'user', content: prompt }];
      await streamChat(messages, {
        onToken: (chunk: string) => {
          if (!token.isCancellationRequested) {
            completion += chunk;
          }
        },
        onComplete: () => {},
        onError: (error: Error) => {
          console.error('[TabAutocomplete] Error:', error);
        },
      });

      // Clean up completion (remove markdown code blocks if present)
      completion = completion
        .replace(/^```[\w]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();

      if (!completion || token.isCancellationRequested) {
        return null;
      }

      // Create inline completion item
      const item = new vscode.InlineCompletionItem(completion, new vscode.Range(position, position));

      return new vscode.InlineCompletionList([item]);
    } catch (error) {
      console.error('[TabAutocomplete] Failed:', error);
      return null;
    } finally {
      pendingRequest = null;
    }
  }
}

let disposable: vscode.Disposable | null = null;

/**
 * Register the tab autocomplete provider
 * Call this from workbench.ts after initialization
 */
export function registerTabAutocomplete(): void {
  if (disposable) {
    disposable.dispose();
  }

  const provider = new TabAutocompleteProvider();

  // Register for common file types
  disposable = vscode.languages.registerInlineCompletionItemProvider(
    [
      { language: 'javascript' },
      { language: 'typescript' },
      { language: 'javascriptreact' },
      { language: 'typescriptreact' },
      { language: 'python' },
      { language: 'rust' },
      { language: 'go' },
      { language: 'java' },
      { language: 'c' },
      { language: 'cpp' },
      { language: 'csharp' },
      { language: 'html' },
      { language: 'css' },
      { language: 'json' },
      { language: 'markdown' },
    ],
    provider
  );

  console.log('[TabAutocomplete] Provider registered');
}

/**
 * Dispose the provider
 */
export function disposeTabAutocomplete(): void {
  if (disposable) {
    disposable.dispose();
    disposable = null;
  }
}
````

### Step 2: Register in Workbench

Edit file: `src/services/vscode/workbench.ts`

Find the `doInitializeWorkbench` function (around line 200-250). Add the import at the top of the file:

```typescript
// Add this import near the top with other imports
import { registerTabAutocomplete } from './tabAutocomplete';
```

Then add the registration call inside `doInitializeWorkbench`, after the workbench is initialized (look for where other services are registered, typically after line 450):

```typescript
// Add this after other service registrations
// Around line 455-460 inside doInitializeWorkbench()
registerTabAutocomplete();
console.log('[Workbench] Tab autocomplete registered');
```

### Step 3: Create the E2E Test

Create file: `testing/tauri/tests/ui-e2e/40-tab-autocomplete.sh`

```bash
#!/bin/bash
set -e

# Load test utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

echo "=== Tab Autocomplete E2E Tests ==="

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

test_01_ghost_text_appears_on_typing() {
    echo "Test 1: Ghost text appears on typing..."

    # Arrange: Wait for workbench
    wait_for_workbench 60

    # Create a test file
    local test_file="/tmp/test-autocomplete-$$.js"
    echo "// Test file" > "$test_file"

    # Open the file via test server
    test_js "
        const uri = window.require('vscode').Uri.file('$test_file');
        window.require('vscode').workspace.openTextDocument(uri).then(doc => {
            window.require('vscode').window.showTextDocument(doc);
        });
        'opening'
    "
    sleep 2

    # Type some code that should trigger completion
    test_js "
        const editor = window.require('vscode').window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                editBuilder.insert(new (window.require('vscode').Position)(1, 0), 'function hello() {\\n  console.lo');
            });
            'typed'
        } else {
            'no-editor'
        }
    "

    # Wait for ghost text to appear
    sleep 3

    # Check for ghost text element
    local result=$(test_js "
        const ghostText = document.querySelector('.ghost-text, .suggest-preview-text, [class*=\"inline-completion\"]');
        ghostText ? 'found' : 'not-found'
    ")

    local status=$(echo "$result" | jq -r '.result // "error"')
    if [ "$status" = "found" ]; then
        echo "  ✓ Ghost text appeared"
        ((TESTS_PASSED++))
    else
        echo "  ✗ Ghost text did not appear (got: $status)"
        echo "    Note: This may fail if AI is not authenticated"
        ((TESTS_FAILED++))
    fi

    # Cleanup
    rm -f "$test_file"
}

test_02_tab_accepts_completion() {
    echo "Test 2: Tab accepts completion..."

    # This test requires ghost text to be visible from test_01
    # Send Tab key
    test_js "
        const event = new KeyboardEvent('keydown', {
            key: 'Tab',
            code: 'Tab',
            keyCode: 9,
            which: 9,
            bubbles: true
        });
        document.activeElement?.dispatchEvent(event);
        'sent'
    "

    sleep 1

    # Verify ghost text is gone (accepted)
    local result=$(test_js "
        const ghostText = document.querySelector('.ghost-text, .suggest-preview-text');
        ghostText ? 'still-visible' : 'accepted'
    ")

    local status=$(echo "$result" | jq -r '.result // "error"')
    if [ "$status" = "accepted" ]; then
        echo "  ✓ Tab accepted completion"
        ((TESTS_PASSED++))
    else
        echo "  ✗ Tab did not accept completion (got: $status)"
        ((TESTS_FAILED++))
    fi
}

test_03_escape_dismisses_completion() {
    echo "Test 3: Escape dismisses completion..."

    # Type more to trigger new completion
    test_js "
        const editor = window.require('vscode').window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                const pos = editor.selection.active;
                editBuilder.insert(pos, '\\n  const x = ');
            });
            'typed'
        } else {
            'no-editor'
        }
    "

    sleep 3

    # Send Escape key
    test_js "
        const event = new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true
        });
        document.activeElement?.dispatchEvent(event);
        'sent'
    "

    sleep 0.5

    # Verify ghost text is dismissed
    local result=$(test_js "
        const ghostText = document.querySelector('.ghost-text, .suggest-preview-text');
        ghostText ? 'still-visible' : 'dismissed'
    ")

    local status=$(echo "$result" | jq -r '.result // "error"')
    if [ "$status" = "dismissed" ]; then
        echo "  ✓ Escape dismissed completion"
        ((TESTS_PASSED++))
    else
        echo "  ✗ Escape did not dismiss completion (got: $status)"
        ((TESTS_FAILED++))
    fi
}

# Run all tests
test_01_ghost_text_appears_on_typing
test_02_tab_accepts_completion
test_03_escape_dismisses_completion

# Report results
echo ""
echo "=== Results ==="
echo "Passed: $TESTS_PASSED"
echo "Failed: $TESTS_FAILED"

echo "TEST_RESULTS: $TESTS_PASSED passed, $TESTS_FAILED failed"

if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi
```

### Step 4: Build and Test

```bash
# 1. Rebuild the frontend
cd /Users/briamart/github/blink
npm run build

# 2. Start dev server (if not running)
npm run tauri:dev

# 3. Wait for app to be ready
sleep 30
curl http://localhost:9999/health

# 4. Run the specific test
chmod +x testing/tauri/tests/ui-e2e/40-tab-autocomplete.sh
./testing/tauri/tests/ui-e2e/40-tab-autocomplete.sh

# 5. If tests pass, run full test suite
./testing/tauri/run-tests.sh
```

### Step 5: Verify

After implementation, verify these criteria:

| Criterion           | How to Verify                                             | Expected                            |
| ------------------- | --------------------------------------------------------- | ----------------------------------- |
| Provider registered | Check console for "[TabAutocomplete] Provider registered" | Message appears on startup          |
| Ghost text appears  | Type `console.lo` in .js file, wait 2s                    | Gray completion text appears        |
| Tab accepts         | Press Tab when ghost text visible                         | Text becomes real, ghost disappears |
| Escape dismisses    | Press Escape when ghost text visible                      | Ghost text disappears               |
| No crash            | Use for 5 minutes                                         | No errors in console                |

### Troubleshooting

**Ghost text not appearing?**

1. Check AI provider is configured:

```bash
curl -X POST http://localhost:9999/js \
  -H "Content-Type: application/json" \
  -d '{"code": "!!JSON.parse(localStorage.getItem(\"blink-ai-provider-config\") || \"null\")"}'
```

If `false`, open the Command Palette and run "Blink: Configure AI Provider".

2. Check provider is registered:

```bash
curl http://localhost:9999/console | jq '.logs[] | select(contains("TabAutocomplete"))'
```

Look for "Provider registered" message.

3. Check for errors:

```bash
curl http://localhost:9999/errors | jq .
```

**Ghost text appears but Tab doesn't accept?**

The Monaco editor may need specific key handling. Check if the inline completion widget is focused.

---

## 2. Inline Edit (Ctrl+K)

### Prerequisites

- [ ] Tab Autocomplete working (proves AI integration works)
- [ ] Monaco diff editor available

### Step 1: Create the Inline Edit Service

Create file: `src/services/vscode/inlineEdit.ts`

````typescript
/**
 * Inline Edit Service
 * Provides Ctrl+K inline editing with diff preview
 */

import * as vscode from 'vscode';
import { isAIProviderConfigured, streamChat, ConversationMessage } from './ai/aiProviderService';

interface InlineEditSession {
  originalText: string;
  originalRange: vscode.Range;
  editor: vscode.TextEditor;
  inputBox: vscode.InputBox;
}

let currentSession: InlineEditSession | null = null;

/**
 * Show the inline edit input box
 */
async function showInlineEditInput(editor: vscode.TextEditor): Promise<string | undefined> {
  const inputBox = vscode.window.createInputBox();
  inputBox.placeholder = 'Describe the change (e.g., "Add error handling")';
  inputBox.prompt = 'Inline Edit';

  return new Promise((resolve) => {
    inputBox.onDidAccept(() => {
      const value = inputBox.value;
      inputBox.dispose();
      resolve(value);
    });

    inputBox.onDidHide(() => {
      inputBox.dispose();
      resolve(undefined);
    });

    inputBox.show();
  });
}

/**
 * Get AI-generated edit for the selected code
 */
async function getAIEdit(originalCode: string, instruction: string, languageId: string): Promise<string | null> {
  if (!isAIProviderConfigured()) {
    vscode.window.showErrorMessage('No AI provider configured. Run "Blink: Configure AI Provider" from the Command Palette.');
    return null;
  }

  const prompt = `Edit this ${languageId} code according to the instruction.
Return ONLY the modified code, no explanations.

Instruction: ${instruction}

Original code:
\`\`\`${languageId}
${originalCode}
\`\`\`

Modified code:`;

  let result = '';
  const messages: ConversationMessage[] = [{ role: 'user', content: prompt }];

  try {
    await streamChat(messages, {
      onToken: (chunk: string) => { result += chunk; },
      onComplete: () => {},
      onError: (error: Error) => { throw error; },
    });

    // Clean up response
    result = result
      .replace(/^```[\w]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    return result;
  } catch (error) {
    console.error('[InlineEdit] AI request failed:', error);
    vscode.window.showErrorMessage('Failed to get AI edit. Please try again.');
    return null;
  }
}

/**
 * Show diff and let user accept/reject
 */
async function showDiffPreview(editor: vscode.TextEditor, originalRange: vscode.Range, originalText: string, newText: string): Promise<boolean> {
  // Create temporary documents for diff
  const originalUri = vscode.Uri.parse('inline-edit-original:' + encodeURIComponent(originalText));
  const modifiedUri = vscode.Uri.parse('inline-edit-modified:' + encodeURIComponent(newText));

  // Show diff editor
  await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, 'Inline Edit Preview (Accept: Enter, Reject: Escape)');

  // Wait for user decision via quick pick
  const choice = await vscode.window.showQuickPick(['✓ Accept Changes', '✗ Reject Changes'], { placeHolder: 'Apply these changes?' });

  return choice?.startsWith('✓') ?? false;
}

/**
 * Execute inline edit command
 */
async function executeInlineEdit(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  // Get selection or current line
  let range = editor.selection;
  if (range.isEmpty) {
    // If no selection, use current line
    const line = editor.document.lineAt(range.start.line);
    range = line.range;
  }

  const originalText = editor.document.getText(range);
  if (!originalText.trim()) {
    vscode.window.showWarningMessage('Please select some code to edit');
    return;
  }

  // Get instruction from user
  const instruction = await showInlineEditInput(editor);
  if (!instruction) {
    return; // User cancelled
  }

  // Show progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating edit...',
      cancellable: true,
    },
    async (progress, token) => {
      // Get AI edit
      const newText = await getAIEdit(originalText, instruction, editor.document.languageId);

      if (!newText || token.isCancellationRequested) {
        return;
      }

      // Show diff and get user decision
      const accepted = await showDiffPreview(editor, range, originalText, newText);

      if (accepted) {
        // Apply the edit
        await editor.edit((editBuilder) => {
          editBuilder.replace(range, newText);
        });
        vscode.window.showInformationMessage('Edit applied');
      } else {
        vscode.window.showInformationMessage('Edit rejected');
      }
    }
  );
}

let disposables: vscode.Disposable[] = [];

/**
 * Register inline edit command
 */
export function registerInlineEdit(): void {
  // Dispose existing
  disposables.forEach((d) => d.dispose());
  disposables = [];

  // Register Ctrl+K command
  const cmdDisposable = vscode.commands.registerCommand('blink.inlineEdit', executeInlineEdit);
  disposables.push(cmdDisposable);

  // Register keybinding (Ctrl+K / Cmd+K)
  // Note: Keybindings should also be added to package.json or keybindings.json

  console.log('[InlineEdit] Command registered');
}

/**
 * Dispose inline edit
 */
export function disposeInlineEdit(): void {
  disposables.forEach((d) => d.dispose());
  disposables = [];
}
````

### Step 2: Register in Workbench

Edit file: `src/services/vscode/workbench.ts`

Add import:

```typescript
import { registerInlineEdit } from './inlineEdit';
```

Add registration (after registerTabAutocomplete):

```typescript
registerInlineEdit();
console.log('[Workbench] Inline edit registered');
```

### Step 3: Add Keybinding

The keybinding needs to be registered. Add to the workbench initialization:

```typescript
// Register Ctrl+K keybinding
vscode.commands.registerCommand('blink.triggerInlineEdit', () => {
  vscode.commands.executeCommand('blink.inlineEdit');
});
```

### Step 4: Create E2E Test

Create file: `testing/tauri/tests/ui-e2e/41-inline-edit.sh`

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

echo "=== Inline Edit E2E Tests ==="

TESTS_PASSED=0
TESTS_FAILED=0

test_01_ctrlk_opens_input() {
    echo "Test 1: Ctrl+K opens input box..."

    wait_for_workbench 60

    # Create and open test file
    local test_file="/tmp/test-inline-edit-$$.js"
    echo -e "function add(a, b) {\n  return a + b;\n}" > "$test_file"

    test_js "
        const uri = window.require('vscode').Uri.file('$test_file');
        window.require('vscode').workspace.openTextDocument(uri).then(doc => {
            window.require('vscode').window.showTextDocument(doc);
        });
        'opening'
    "
    sleep 2

    # Select the function body
    test_js "
        const editor = window.require('vscode').window.activeTextEditor;
        if (editor) {
            const selection = new (window.require('vscode').Selection)(0, 0, 2, 1);
            editor.selection = selection;
            'selected'
        } else {
            'no-editor'
        }
    "

    # Trigger inline edit command
    test_js "
        window.require('vscode').commands.executeCommand('blink.inlineEdit');
        'triggered'
    "

    sleep 1

    # Check for input box
    local result=$(test_js "
        const inputBox = document.querySelector('.quick-input-widget:not(.hidden), .inputBox');
        inputBox ? 'found' : 'not-found'
    ")

    local status=$(echo "$result" | jq -r '.result // "error"')
    if [ "$status" = "found" ]; then
        echo "  ✓ Input box opened"
        ((TESTS_PASSED++))
    else
        echo "  ✗ Input box did not open (got: $status)"
        ((TESTS_FAILED++))
    fi

    rm -f "$test_file"
}

# Run tests
test_01_ctrlk_opens_input

echo ""
echo "=== Results ==="
echo "Passed: $TESTS_PASSED"
echo "Failed: $TESTS_FAILED"
echo "TEST_RESULTS: $TESTS_PASSED passed, $TESTS_FAILED failed"

[ $TESTS_FAILED -eq 0 ]
```

### Step 5: Build, Test, Verify

```bash
# Build
npm run build

# Test
./testing/tauri/tests/ui-e2e/41-inline-edit.sh

# Verify manually:
# 1. Open a code file
# 2. Select some code
# 3. Press Ctrl+K (or Cmd+K on Mac)
# 4. Type "Add error handling"
# 5. Verify diff preview appears
# 6. Click Accept or Reject
```

---

## 3. Context Mentions (@file, @codebase)

### Prerequisites

- [ ] AI Chat working
- [ ] File system access working

### Step 1: Create Context Provider

Create file: `src/services/vscode/contextMentions.ts`

```typescript
/**
 * Context Mentions Provider
 * Handles @file, @folder, @codebase mentions in chat
 */

import * as vscode from 'vscode';
import { readFile, readDir } from '@tauri-apps/plugin-fs';

export interface ContextChip {
  type: 'file' | 'folder' | 'codebase';
  path?: string;
  query?: string;
  content?: string;
}

/**
 * Parse mentions from input text
 */
export function parseMentions(text: string): { mentions: ContextChip[]; cleanText: string } {
  const mentions: ContextChip[] = [];
  let cleanText = text;

  // Match @file:path
  const fileRegex = /@file:([^\s]+)/g;
  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    mentions.push({ type: 'file', path: match[1] });
    cleanText = cleanText.replace(match[0], '');
  }

  // Match @folder:path
  const folderRegex = /@folder:([^\s]+)/g;
  while ((match = folderRegex.exec(text)) !== null) {
    mentions.push({ type: 'folder', path: match[1] });
    cleanText = cleanText.replace(match[0], '');
  }

  // Match @codebase:query
  const codebaseRegex = /@codebase:([^\s]+)/g;
  while ((match = codebaseRegex.exec(text)) !== null) {
    mentions.push({ type: 'codebase', query: match[1] });
    cleanText = cleanText.replace(match[0], '');
  }

  return { mentions, cleanText: cleanText.trim() };
}

/**
 * Resolve file content for a mention
 */
export async function resolveFileContent(path: string): Promise<string> {
  try {
    const content = await readFile(path);
    const decoder = new TextDecoder();
    return decoder.decode(content);
  } catch (error) {
    console.error('[ContextMentions] Failed to read file:', path, error);
    return `[Error reading file: ${path}]`;
  }
}

/**
 * Resolve folder structure for a mention
 */
export async function resolveFolderContent(path: string): Promise<string> {
  try {
    const entries = await readDir(path);
    const structure = entries.map((e) => `${e.isDirectory ? '📁' : '📄'} ${e.name}`).join('\n');
    return `Contents of ${path}:\n${structure}`;
  } catch (error) {
    console.error('[ContextMentions] Failed to read folder:', path, error);
    return `[Error reading folder: ${path}]`;
  }
}

/**
 * Build context string from mentions
 */
export async function buildContextString(mentions: ContextChip[]): Promise<string> {
  const parts: string[] = [];

  for (const mention of mentions) {
    switch (mention.type) {
      case 'file':
        if (mention.path) {
          const content = await resolveFileContent(mention.path);
          parts.push(`--- File: ${mention.path} ---\n${content}\n---`);
        }
        break;
      case 'folder':
        if (mention.path) {
          const content = await resolveFolderContent(mention.path);
          parts.push(content);
        }
        break;
      case 'codebase':
        // TODO: Implement semantic search
        parts.push(`[Codebase search for: ${mention.query}]`);
        break;
    }
  }

  return parts.join('\n\n');
}

/**
 * Register context mention completions
 */
export function registerContextMentions(): vscode.Disposable {
  // Register completion provider for @ mentions
  const provider = vscode.languages.registerCompletionItemProvider(
    { pattern: '**' }, // All files
    {
      provideCompletionItems(document, position) {
        const lineText = document.lineAt(position).text;
        const textBefore = lineText.substring(0, position.character);

        // Only trigger after @
        if (!textBefore.endsWith('@')) {
          return [];
        }

        return [
          new vscode.CompletionItem('@file:', vscode.CompletionItemKind.Reference),
          new vscode.CompletionItem('@folder:', vscode.CompletionItemKind.Folder),
          new vscode.CompletionItem('@codebase:', vscode.CompletionItemKind.Reference),
        ];
      },
    },
    '@'
  );

  console.log('[ContextMentions] Provider registered');
  return provider;
}
```

### Step 2: Integrate with AI Chat Agent

Edit file: `src/services/vscode/ai/chatProvider.ts`

Add import:

```typescript
import { parseMentions, buildContextString } from './contextMentions';
```

Modify the message handling to include context:

```typescript
// Before sending to AI, parse mentions and build context
const { mentions, cleanText } = parseMentions(userMessage);
let contextString = '';
if (mentions.length > 0) {
  contextString = await buildContextString(mentions);
}

const fullPrompt = contextString ? `Context:\n${contextString}\n\nUser question: ${cleanText}` : cleanText;

// Send fullPrompt to AI instead of userMessage
```

### Step 3: Create E2E Test

Create file: `testing/tauri/tests/ui-e2e/42-context-mentions.sh`

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

echo "=== Context Mentions E2E Tests ==="

TESTS_PASSED=0
TESTS_FAILED=0

test_01_at_symbol_shows_dropdown() {
    echo "Test 1: @ symbol shows mention dropdown..."

    wait_for_workbench 60

    # Open chat panel
    test_js "
        window.require('vscode').commands.executeCommand('workbench.action.chat.open');
        'opened'
    "
    sleep 2

    # Type @ in chat input
    test_js "
        const input = document.querySelector('[data-testid=\"chat-input\"], .chat-input-area textarea, .interactive-input textarea');
        if (input) {
            input.focus();
            input.value = '@';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            'typed'
        } else {
            'no-input'
        }
    "

    sleep 1

    # Check for autocomplete dropdown
    local result=$(test_js "
        const dropdown = document.querySelector('.suggest-widget:not(.hidden), .monaco-list, [class*=\"mention\"]');
        dropdown ? 'found' : 'not-found'
    ")

    local status=$(echo "$result" | jq -r '.result // "error"')
    if [ "$status" = "found" ]; then
        echo "  ✓ Mention dropdown appeared"
        ((TESTS_PASSED++))
    else
        echo "  ✗ Mention dropdown did not appear (got: $status)"
        ((TESTS_FAILED++))
    fi
}

# Run tests
test_01_at_symbol_shows_dropdown

echo ""
echo "=== Results ==="
echo "Passed: $TESTS_PASSED"
echo "Failed: $TESTS_FAILED"
echo "TEST_RESULTS: $TESTS_PASSED passed, $TESTS_FAILED failed"

[ $TESTS_FAILED -eq 0 ]
```

---

## Integration Points Quick Reference

| Feature          | File to Create                  | File to Modify    | Line Number | What to Add                 |
| ---------------- | ------------------------------- | ----------------- | ----------- | --------------------------- |
| Tab Autocomplete | `tabAutocomplete.ts`            | `workbench.ts`    | ~455        | `registerTabAutocomplete()` |
| Inline Edit      | `inlineEdit.ts`                 | `workbench.ts`    | ~458        | `registerInlineEdit()`      |
| Context Mentions | `contextMentions.ts`            | `ai/chatProvider.ts` | ~89      | Context parsing             |
| Diff Review      | `diffReview.ts`                 | `workbench.ts`    | ~461        | `registerDiffReview()`      |
| Git Panel        | `src-tauri/src/services/git.rs` | `lib.rs`          | handlers    | Git commands                |

---

## Autonomous Verification Workflow

After implementing any feature, run this verification sequence:

```bash
#!/bin/bash
# Save as: scripts/verify-feature.sh

FEATURE="${1:-all}"

echo "=== Feature Verification: $FEATURE ==="

# 1. Build
echo "Step 1: Building..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi
echo "✓ Build passed"

# 2. Start app if not running
if ! curl -s http://localhost:9999/health > /dev/null 2>&1; then
    echo "Step 2: Starting app..."
    npm run tauri:dev &
    sleep 30
fi

# 3. Verify health
echo "Step 3: Checking health..."
HEALTH=$(curl -s http://localhost:9999/health)
if ! echo "$HEALTH" | jq -e '.status == "ok"' > /dev/null; then
    echo "❌ Health check failed"
    exit 1
fi
echo "✓ Health check passed"

# 4. Run feature-specific tests
echo "Step 4: Running tests..."
if [ "$FEATURE" = "all" ]; then
    ./testing/tauri/run-tests.sh
else
    ./testing/tauri/tests/ui-e2e/*-${FEATURE}*.sh
fi

if [ $? -ne 0 ]; then
    echo "❌ Tests failed"
    exit 1
fi
echo "✓ Tests passed"

# 5. Check for console errors
echo "Step 5: Checking for errors..."
ERRORS=$(curl -s http://localhost:9999/errors | jq '.errors | length')
if [ "$ERRORS" -gt 0 ]; then
    echo "⚠️ $ERRORS errors found in console"
    curl -s http://localhost:9999/errors | jq '.errors'
fi

echo ""
echo "=== Verification Complete ==="
```

Usage:

```bash
# Verify specific feature
./scripts/verify-feature.sh tab-autocomplete

# Verify all features
./scripts/verify-feature.sh all
```

---

## Troubleshooting Decision Trees

### Feature Not Working

```
Is the app running?
├─ NO → Run: npm run tauri:dev
│       Wait 30 seconds
│       Check: curl http://localhost:9999/health
│
└─ YES → Is there a build error?
         ├─ YES → Run: npm run build
         │        Fix TypeScript errors
         │        Rebuild
         │
         └─ NO → Is the feature registered?
                 ├─ NO → Check workbench.ts for registration call
                 │       Add: console.log('[Feature] registered')
                 │       Rebuild and check console
                 │
                 └─ YES → Is AI provider configured?
                          ├─ NO → Run "Blink: Configure AI Provider"
                          │       Check localStorage: blink-ai-provider-config
                          │
                          └─ YES → Check errors:
                                   curl http://localhost:9999/errors | jq .
```

### Test Failing

```
Does the test file exist?
├─ NO → Create it following the template
│
└─ YES → Is the test executable?
         ├─ NO → Run: chmod +x path/to/test.sh
         │
         └─ YES → Run with debug:
                  DEBUG=1 ./path/to/test.sh

                  What's the error?
                  ├─ "element not found" → Selector may have changed
                  │                        Check actual DOM with:
                  │                        curl http://localhost:9999/query -d '{"selector":".your-selector"}'
                  │
                  ├─ "timeout" → Increase timeout or check if feature is loading
                  │
                  └─ "assertion failed" → Check expected vs actual values
                                          Run test_js to inspect state
```

---

## Related Documents

- [FEATURES.md](./FEATURES.md) - Full feature checklist
- [TESTING.md](./TESTING.md) - Testing guidelines
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) - General implementation patterns
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
