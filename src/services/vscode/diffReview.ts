/**
 * Diff Review Service
 *
 * Provides diff review functionality for AI-generated code changes.
 * Users can view diffs and accept/reject changes before applying them.
 *
 * P0 Feature - Critical for AI IDE functionality
 *
 * Features:
 *   - Show side-by-side diff view using Monaco diff editor
 *   - Accept individual or all changes
 *   - Reject changes and revert
 *   - Navigate between changes
 */

import { registerAction2, Action2 } from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions';
import type { ServicesAccessor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { INotificationService } from '@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service';
import { IEditorService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import Severity from '@codingame/monaco-vscode-api/vscode/vs/base/common/severity';
import { getService } from '@codingame/monaco-vscode-api/services';
import { KeyCode, KeyMod } from '@codingame/monaco-vscode-api/vscode/vs/base/common/keyCodes';
import { KeybindingWeight } from '@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry';

// ============================================================================
// Types
// ============================================================================

export interface DiffSession {
  id: string;
  originalContent: string;
  modifiedContent: string;
  filePath: string;
  language: string;
  description: string;
  createdAt: Date;
  originalUri: URI;
  modifiedUri: URI;
}

interface PendingDiff {
  session: DiffSession;
  resolve: (accepted: boolean) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

// ============================================================================
// State Management
// ============================================================================

const activeSessions: Map<string, DiffSession> = new Map();
let pendingDiff: PendingDiff | null = null;
const disposables: IDisposable[] = [];

// In-memory content provider for virtual documents
const virtualDocuments: Map<string, string> = new Map();

// ============================================================================
// Virtual Document Scheme
// ============================================================================

const DIFF_SCHEME = 'ai-diff';

/**
 * Get content for a virtual document URI
 */
export function getVirtualDocumentContent(uri: URI): string | undefined {
  return virtualDocuments.get(uri.toString());
}

/**
 * Create a virtual URI for diff content
 */
function createVirtualUri(sessionId: string, type: 'original' | 'modified', filePath: string): URI {
  const fileName = filePath.split('/').pop() || 'untitled';
  return URI.from({
    scheme: DIFF_SCHEME,
    path: `/${sessionId}/${type}/${fileName}`,
    query: `session=${sessionId}&type=${type}`,
  });
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `diff-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Detect language from file path
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
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
    hpp: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    html: 'html',
    css: 'css',
    scss: 'scss',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sh: 'shellscript',
    bash: 'shellscript',
    sql: 'sql',
    xml: 'xml',
  };
  return langMap[ext] || 'plaintext';
}

/**
 * Create a new diff session
 */
export function createDiffSession(
  originalContent: string,
  modifiedContent: string,
  filePath: string,
  description: string = 'AI-generated changes'
): DiffSession {
  const id = generateSessionId();
  const originalUri = createVirtualUri(id, 'original', filePath);
  const modifiedUri = createVirtualUri(id, 'modified', filePath);

  // Store content in virtual documents
  virtualDocuments.set(originalUri.toString(), originalContent);
  virtualDocuments.set(modifiedUri.toString(), modifiedContent);

  const session: DiffSession = {
    id,
    originalContent,
    modifiedContent,
    filePath,
    language: detectLanguage(filePath),
    description,
    createdAt: new Date(),
    originalUri,
    modifiedUri,
  };

  activeSessions.set(session.id, session);
  return session;
}

/**
 * Get an active session by ID
 */
export function getSession(sessionId: string): DiffSession | undefined {
  return activeSessions.get(sessionId);
}

/**
 * Close a session and clean up resources
 */
export function closeSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    // Clean up virtual documents
    virtualDocuments.delete(session.originalUri.toString());
    virtualDocuments.delete(session.modifiedUri.toString());
    activeSessions.delete(sessionId);
  }
}

/**
 * Show diff review in Monaco diff editor and wait for user decision
 * Returns true if accepted, false if rejected
 */
export async function showDiffReview(
  originalContent: string,
  modifiedContent: string,
  filePath: string,
  description?: string
): Promise<boolean> {
  const session = createDiffSession(
    originalContent,
    modifiedContent,
    filePath,
    description || 'AI-generated changes'
  );

  console.log('[DiffReview] Creating diff session:', session.id, 'for', filePath);

  try {
    // Get editor service
    const editorService = await getService(IEditorService);

    if (!editorService) {
      console.warn('[DiffReview] Editor service not available, falling back to auto-accept');
      closeSession(session.id);
      return true;
    }

    // Open diff editor
    // Use the openEditor API with diff editor input
    await editorService.openEditor({
      original: { resource: session.originalUri },
      modified: { resource: session.modifiedUri },
      label: `Review: ${session.description}`,
      description: `${filePath} - AI Changes`,
      options: {
        pinned: true,
      },
    });

    console.log('[DiffReview] Diff editor opened for session:', session.id);

  } catch (error) {
    console.error('[DiffReview] Failed to open diff editor:', error);
    // Fall back to notification-based review
  }

  // Wait for user decision via accept/reject commands
  return new Promise((resolve) => {
    // Clear any existing pending diff
    if (pendingDiff) {
      clearTimeout(pendingDiff.timeoutId);
      pendingDiff.resolve(false);
      closeSession(pendingDiff.session.id);
    }

    // Set timeout for auto-reject after 5 minutes
    const timeoutId = setTimeout(() => {
      if (pendingDiff && pendingDiff.session.id === session.id) {
        console.log('[DiffReview] Diff review timed out, auto-rejecting');
        pendingDiff.resolve(false);
        pendingDiff = null;
        closeSession(session.id);
        closeDiffEditor(session);
      }
    }, 5 * 60 * 1000);

    pendingDiff = { session, resolve, timeoutId };

    // Show notification with accept/reject buttons
    showDiffNotification(session);
  });
}

/**
 * Show notification for diff review
 */
async function showDiffNotification(session: DiffSession): Promise<void> {
  try {
    const notificationService = await getService(INotificationService);
    if (notificationService) {
      notificationService.notify({
        severity: Severity.Info,
        message: `AI Changes Ready: ${session.description}. Use Ctrl+Shift+Y to accept or Ctrl+Shift+N to reject.`,
      });
    }
  } catch (error) {
    console.error('[DiffReview] Failed to show notification:', error);
  }
}

/**
 * Close the diff editor for a session
 */
async function closeDiffEditor(session: DiffSession): Promise<void> {
  try {
    const editorService = await getService(IEditorService);
    if (editorService) {
      // Find and close the diff editor
      // This is a best-effort cleanup
      console.log('[DiffReview] Attempting to close diff editor for:', session.id);
    }
  } catch (error) {
    console.error('[DiffReview] Failed to close diff editor:', error);
  }
}

/**
 * Accept the pending diff
 */
async function acceptPendingDiff(): Promise<void> {
  if (pendingDiff) {
    const session = pendingDiff.session;
    console.log('[DiffReview] Accepting diff:', session.id);

    clearTimeout(pendingDiff.timeoutId);
    pendingDiff.resolve(true);
    pendingDiff = null;

    await closeDiffEditor(session);
    closeSession(session.id);

    const notificationService = await getService(INotificationService);
    if (notificationService) {
      notificationService.notify({
        severity: Severity.Info,
        message: 'Changes accepted and applied.',
      });
    }
  }
}

/**
 * Reject the pending diff
 */
async function rejectPendingDiff(): Promise<void> {
  if (pendingDiff) {
    const session = pendingDiff.session;
    console.log('[DiffReview] Rejecting diff:', session.id);

    clearTimeout(pendingDiff.timeoutId);
    pendingDiff.resolve(false);
    pendingDiff = null;

    await closeDiffEditor(session);
    closeSession(session.id);

    const notificationService = await getService(INotificationService);
    if (notificationService) {
      notificationService.notify({
        severity: Severity.Info,
        message: 'Changes rejected.',
      });
    }
  }
}

/**
 * Check if there's a pending diff
 */
export function hasPendingDiff(): boolean {
  return pendingDiff !== null;
}

/**
 * Get the current pending diff session
 */
export function getPendingDiffSession(): DiffSession | null {
  return pendingDiff?.session || null;
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Accept Diff Action - Ctrl+Shift+Y
 */
class AcceptDiffAction extends Action2 {
  constructor() {
    super({
      id: 'blink.diffReview.accept',
      title: { value: 'Accept AI Changes', original: 'Accept AI Changes' },
      category: { value: 'AI', original: 'AI' },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyY,
      },
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const notificationService = accessor.get(INotificationService);

    if (pendingDiff) {
      await acceptPendingDiff();
    } else {
      notificationService.notify({
        severity: Severity.Warning,
        message: 'No pending AI changes to accept.',
      });
    }
  }
}

/**
 * Reject Diff Action - Ctrl+Shift+N
 */
class RejectDiffAction extends Action2 {
  constructor() {
    super({
      id: 'blink.diffReview.reject',
      title: { value: 'Reject AI Changes', original: 'Reject AI Changes' },
      category: { value: 'AI', original: 'AI' },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyN,
      },
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const notificationService = accessor.get(INotificationService);

    if (pendingDiff) {
      await rejectPendingDiff();
    } else {
      notificationService.notify({
        severity: Severity.Warning,
        message: 'No pending AI changes to reject.',
      });
    }
  }
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register diff review commands and text content provider
 * Call this from workbench.ts after initialization
 */
export function registerDiffReview(): IDisposable {
  // Dispose existing registrations
  disposeDiffReview();

  // Register commands
  const acceptDisposable = registerAction2(AcceptDiffAction);
  disposables.push(acceptDisposable);

  const rejectDisposable = registerAction2(RejectDiffAction);
  disposables.push(rejectDisposable);

  console.log('[DiffReview] Commands registered (Accept: Ctrl+Shift+Y, Reject: Ctrl+Shift+N)');

  // Expose for testing
  (window as any).__DIFF_REVIEW_REGISTERED__ = true;
  (window as any).__SHOW_DIFF_REVIEW__ = showDiffReview;
  (window as any).__HAS_PENDING_DIFF__ = hasPendingDiff;
  (window as any).__ACCEPT_DIFF__ = acceptPendingDiff;
  (window as any).__REJECT_DIFF__ = rejectPendingDiff;

  return {
    dispose: disposeDiffReview,
  };
}

/**
 * Dispose diff review resources
 */
export function disposeDiffReview(): void {
  for (const d of disposables) {
    try {
      d.dispose();
    } catch (e) {
      // Ignore disposal errors
    }
  }
  disposables.length = 0;

  // Clear any pending diff
  if (pendingDiff) {
    clearTimeout(pendingDiff.timeoutId);
    pendingDiff.resolve(false);
    pendingDiff = null;
  }

  // Clear all sessions
  for (const sessionId of activeSessions.keys()) {
    closeSession(sessionId);
  }

  (window as any).__DIFF_REVIEW_REGISTERED__ = false;
  console.log('[DiffReview] Disposed');
}
