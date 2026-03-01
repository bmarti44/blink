/**
 * Multi-file Editing Service (Composer)
 *
 * Enables batch editing of multiple files with diff tracking and preview.
 * Similar to Cursor's Composer feature for making coordinated changes.
 *
 * P1 Feature - Multi-file Editing
 *
 * Features:
 *   - Batch file changes with unified diff view
 *   - Preview all changes before applying
 *   - Accept/reject individual file changes
 *   - Rollback support
 */

import { registerAction2, Action2 } from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions';
import { KeyCode, KeyMod } from '@codingame/monaco-vscode-api/vscode/vs/base/common/keyCodes';
import { KeybindingWeight } from '@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry';
import type { ServicesAccessor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { IQuickInputService } from '@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service';
import { INotificationService } from '@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service';
import Severity from '@codingame/monaco-vscode-api/vscode/vs/base/common/severity';
import { getActiveModelProvider, type StreamingCallbacks } from './ai/index';
import { writeTextFile, readTextFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs';
import { join, dirname } from '@tauri-apps/api/path';
import { showDiffReview } from './diffReview';

// Track disposables for cleanup
const disposables: IDisposable[] = [];

// ============================================================================
// Types
// ============================================================================

export interface FileChange {
  path: string;
  originalContent: string;
  newContent: string;
  action: 'create' | 'modify' | 'delete';
  status: 'pending' | 'accepted' | 'rejected' | 'applied';
}

export interface ComposerSession {
  id: string;
  description: string;
  files: FileChange[];
  status: 'drafting' | 'reviewing' | 'applying' | 'completed' | 'cancelled';
  createdAt: number;
  completedAt?: number;
}

// Current session
let currentSession: ComposerSession | null = null;

// ============================================================================
// Workspace Utilities
// ============================================================================

/**
 * Get workspace folder path
 */
function getWorkspaceFolder(): string | null {
  return localStorage.getItem('blink-workspace-folder');
}

/**
 * Resolve a file path relative to workspace
 */
async function resolveFilePath(filePath: string): Promise<string> {
  if (filePath.startsWith('/')) {
    return filePath;
  }
  const workspaceFolder = getWorkspaceFolder();
  if (workspaceFolder) {
    return await join(workspaceFolder, filePath);
  }
  return filePath;
}

/**
 * Get language from file extension
 */
function getLanguageFromExt(ext: string): string {
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    html: 'html',
    css: 'css',
    json: 'json',
    yaml: 'yaml',
    md: 'markdown',
    sh: 'bash',
    sql: 'sql',
  };
  return langMap[ext] || 'plaintext';
}

// ============================================================================
// LLM Integration
// ============================================================================

/**
 * Parse file changes from LLM response
 */
function parseFileChanges(response: string): FileChange[] {
  const changes: FileChange[] = [];

  // Parse response format:
  // FILE: path/to/file.ts
  // ACTION: create|modify|delete
  // ```language
  // content
  // ```

  const fileBlocks = response.split(/(?=FILE:\s)/);

  for (const block of fileBlocks) {
    if (!block.trim()) continue;

    const pathMatch = block.match(/FILE:\s*(.+?)(?:\n|$)/);
    if (!pathMatch) continue;

    const path = pathMatch[1].trim();
    const actionMatch = block.match(/ACTION:\s*(create|modify|delete)/i);
    const action = (actionMatch?.[1]?.toLowerCase() || 'modify') as FileChange['action'];

    // Extract code content
    const codeMatch = block.match(/```[\w]*\n?([\s\S]*?)```/);
    const newContent = codeMatch ? codeMatch[1].trim() : '';

    changes.push({
      path,
      originalContent: '', // Will be filled in when applying
      newContent,
      action,
      status: 'pending',
    });
  }

  return changes;
}

/**
 * Generate multi-file changes from description
 */
async function generateFileChanges(
  description: string,
  existingFiles: { path: string; content: string }[],
  onProgress?: (partial: string) => void
): Promise<FileChange[]> {
  const provider = getActiveModelProvider();

  if (!provider || !provider.isAuthenticated()) {
    console.log('[MultiFileEdit] No authenticated model provider');
    return [];
  }

  const workspaceFolder = getWorkspaceFolder() || '(no workspace)';

  // Build context from existing files
  let fileContext = '';
  for (const file of existingFiles.slice(0, 10)) {
    // Limit context
    const ext = file.path.split('.').pop() || '';
    const lang = getLanguageFromExt(ext);
    fileContext += `\n\n--- ${file.path} ---\n\`\`\`${lang}\n${file.content.substring(0, 5000)}\n\`\`\``;
  }

  const prompt = `You are a code assistant that makes changes to multiple files.

WORKSPACE: ${workspaceFolder}

EXISTING FILES:${fileContext || '\n(no files provided)'}

TASK: ${description}

OUTPUT FORMAT:
For each file that needs to be changed, output:

FILE: <relative path>
ACTION: create|modify|delete
\`\`\`<language>
<complete file content>
\`\`\`

RULES:
1. Output the complete file content, not just diffs
2. Use relative paths from the workspace root
3. For delete actions, no code block is needed
4. Be precise about file paths
5. Make minimal necessary changes

Generate the file changes:`;

  let result = '';
  let hasError = false;

  const callbacks: StreamingCallbacks = {
    onToken: (chunk: string) => {
      result += chunk;
      if (onProgress) {
        onProgress(result);
      }
    },
    onComplete: () => {},
    onError: (error: Error) => {
      console.error('[MultiFileEdit] Provider error:', error.message);
      hasError = true;
    },
  };

  try {
    await provider.getCompletion([{ role: 'user', content: prompt }], callbacks);
  } catch (error) {
    console.error('[MultiFileEdit] Request failed:', error);
    return [];
  }

  if (hasError) {
    return [];
  }

  return parseFileChanges(result);
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new composer session
 */
export function createComposerSession(description: string): ComposerSession {
  const session: ComposerSession = {
    id: `composer-${Date.now()}`,
    description,
    files: [],
    status: 'drafting',
    createdAt: Date.now(),
  };

  currentSession = session;
  return session;
}

/**
 * Get the current session
 */
export function getCurrentComposerSession(): ComposerSession | null {
  return currentSession;
}

/**
 * Read existing file contents for context
 */
async function readExistingFiles(paths: string[]): Promise<{ path: string; content: string }[]> {
  const results: { path: string; content: string }[] = [];

  for (const path of paths) {
    try {
      const fullPath = await resolveFilePath(path);
      const fileExists = await exists(fullPath);
      if (fileExists) {
        const content = await readTextFile(fullPath);
        results.push({ path, content });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return results;
}

/**
 * Apply a single file change
 */
async function applyFileChange(change: FileChange): Promise<boolean> {
  try {
    const fullPath = await resolveFilePath(change.path);

    if (change.action === 'delete') {
      // For delete, show diff (content vs empty)
      const accepted = await showDiffReview(
        change.originalContent,
        '',
        change.path,
        `Delete: ${change.path}`
      );

      if (!accepted) {
        change.status = 'rejected';
        return false;
      }

      // Actually delete the file
      const fileExists = await exists(fullPath);
      if (fileExists) {
        await remove(fullPath);
        console.log('[MultiFileEdit] Deleted file:', change.path);
      }

      change.status = 'applied';
      return true;
    }

    // For create/modify, show diff
    const accepted = await showDiffReview(
      change.originalContent,
      change.newContent,
      change.path,
      change.action === 'create' ? `Create: ${change.path}` : `Modify: ${change.path}`
    );

    if (!accepted) {
      change.status = 'rejected';
      return false;
    }

    // Ensure parent directory exists
    const parentDir = await dirname(fullPath);
    const dirExists = await exists(parentDir);
    if (!dirExists) {
      await mkdir(parentDir, { recursive: true });
    }

    // Write file
    await writeTextFile(fullPath, change.newContent);
    change.status = 'applied';
    return true;
  } catch (error) {
    console.error('[MultiFileEdit] Failed to apply change:', error);
    change.status = 'rejected';
    return false;
  }
}

/**
 * Apply all pending changes in the session
 */
export async function applyComposerChanges(
  onProgress: (message: string) => void
): Promise<{ applied: number; rejected: number }> {
  if (!currentSession || currentSession.status !== 'reviewing') {
    return { applied: 0, rejected: 0 };
  }

  currentSession.status = 'applying';
  let applied = 0;
  let rejected = 0;

  for (const change of currentSession.files) {
    if (change.status !== 'pending') continue;

    onProgress(`Applying: ${change.path}`);
    const success = await applyFileChange(change);

    if (success) {
      applied++;
      onProgress(`Applied: ${change.path}`);
    } else {
      rejected++;
      onProgress(`Rejected: ${change.path}`);
    }
  }

  currentSession.status = 'completed';
  currentSession.completedAt = Date.now();
  onProgress(`Completed: ${applied} applied, ${rejected} rejected`);

  return { applied, rejected };
}

/**
 * Format session for display
 */
export function formatComposerSession(session: ComposerSession): string {
  const lines: string[] = [];

  lines.push(`## Multi-file Edit: ${session.description}`);
  lines.push('');
  lines.push(`**Status:** ${session.status}`);
  lines.push(`**Files:** ${session.files.length}`);
  lines.push('');

  for (const file of session.files) {
    const icon = file.action === 'create' ? '➕' : file.action === 'delete' ? '🗑️' : '✏️';
    const statusIcon =
      file.status === 'applied' ? '✅' : file.status === 'rejected' ? '❌' : '⏳';
    lines.push(`${icon} ${statusIcon} **${file.path}** (${file.action})`);
  }

  return lines.join('\n');
}

// ============================================================================
// Chat Integration
// ============================================================================

/**
 * Run composer from chat (/compose slash command)
 */
export async function runComposerFromChat(
  description: string,
  contextFiles: string[],
  onProgress: (message: string) => void
): Promise<ComposerSession | null> {
  // Create session
  const session = createComposerSession(description);
  onProgress(`Creating multi-file edit: ${description}`);

  // Read existing file contents for context
  const existingFiles = await readExistingFiles(contextFiles);
  onProgress(`Read ${existingFiles.length} files for context`);

  // Generate changes
  onProgress('Generating file changes...');
  const changes = await generateFileChanges(description, existingFiles, (partial) => {
    // Could show streaming progress here
    console.log('[MultiFileEdit] Generating...', partial.length, 'chars');
  });

  if (changes.length === 0) {
    session.status = 'cancelled';
    onProgress('No file changes generated');
    return null;
  }

  // Fill in original content for existing files
  for (const change of changes) {
    const existing = existingFiles.find((f) => f.path === change.path);
    if (existing) {
      change.originalContent = existing.content;
    }
  }

  session.files = changes;
  session.status = 'reviewing';

  onProgress(formatComposerSession(session));
  onProgress('\n\nUse `/apply` to apply all changes, or review each file individually.');

  return session;
}

/**
 * Apply composer changes from chat
 */
export async function applyComposerFromChat(
  onProgress: (message: string) => void
): Promise<boolean> {
  if (!currentSession) {
    onProgress('No composer session active. Use `/compose <description>` first.');
    return false;
  }

  if (currentSession.status !== 'reviewing') {
    onProgress(`Cannot apply: session status is ${currentSession.status}`);
    return false;
  }

  const result = await applyComposerChanges(onProgress);
  return result.applied > 0;
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Composer Action - Ctrl+Shift+M for multi-file edit
 */
class ComposerAction extends Action2 {
  constructor() {
    super({
      id: 'blink.composer',
      title: { value: 'AI: Multi-file Edit (Composer)', original: 'AI: Multi-file Edit (Composer)' },
      category: { value: 'AI', original: 'AI' },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyM,
      },
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const quickInputService = accessor.get(IQuickInputService);
    const notificationService = accessor.get(INotificationService);

    // Get description from user
    const description = await quickInputService.input({
      placeHolder: 'Describe the changes you want to make across files',
      prompt: 'Multi-file Edit - What changes do you want to make?',
    });

    if (!description) {
      return;
    }

    notificationService.notify({
      severity: Severity.Info,
      message: 'Generating multi-file changes...',
    });

    // Run composer
    const session = await runComposerFromChat(description, [], (message) => {
      console.log('[MultiFileEdit]', message);
    });

    if (!session || session.files.length === 0) {
      notificationService.notify({
        severity: Severity.Warning,
        message: 'No file changes generated.',
      });
      return;
    }

    // Ask to apply
    const choice = await quickInputService.pick(
      [
        { label: '$(check) Apply All Changes', id: 'apply' },
        { label: '$(eye) Review in Chat', id: 'review' },
        { label: '$(close) Cancel', id: 'cancel' },
      ],
      {
        placeHolder: `${session.files.length} files to change`,
        title: 'Multi-file Edit',
      }
    );

    if (!choice || choice.id === 'cancel') {
      session.status = 'cancelled';
      return;
    }

    if (choice.id === 'review') {
      notificationService.notify({
        severity: Severity.Info,
        message: 'Use /apply in chat to apply changes.',
      });
      return;
    }

    // Apply changes
    const result = await applyComposerChanges((message) => {
      console.log('[MultiFileEdit]', message);
    });

    notificationService.notify({
      severity: result.applied > 0 ? Severity.Info : Severity.Warning,
      message: `Applied ${result.applied} files, rejected ${result.rejected} files.`,
    });
  }
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register multi-file edit commands
 */
export function registerMultiFileEdit(): IDisposable {
  // Dispose existing
  disposeMultiFileEdit();

  // Register action
  const actionDisposable = registerAction2(ComposerAction);
  disposables.push(actionDisposable);

  console.log('[MultiFileEdit] Commands registered (Ctrl+Shift+M)');

  // Expose for testing
  (window as any).__MULTI_FILE_EDIT_REGISTERED__ = true;
  (window as any).__RUN_COMPOSER__ = runComposerFromChat;
  (window as any).__APPLY_COMPOSER__ = applyComposerFromChat;
  (window as any).__GET_COMPOSER_SESSION__ = getCurrentComposerSession;

  return {
    dispose: disposeMultiFileEdit,
  };
}

/**
 * Dispose multi-file edit resources
 */
export function disposeMultiFileEdit(): void {
  for (const d of disposables) {
    try {
      d.dispose();
    } catch {
      // Ignore disposal errors
    }
  }
  disposables.length = 0;
  currentSession = null;
  (window as any).__MULTI_FILE_EDIT_REGISTERED__ = false;
  console.log('[MultiFileEdit] Disposed');
}
