/**
 * Inline Edit Service (Ctrl+K)
 *
 * Provides inline code editing with AI assistance.
 * User selects code, presses Ctrl+K, describes the change, and gets a diff preview.
 *
 * P0 Feature - Critical for AI IDE functionality
 */

import { registerAction2, Action2 } from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions';
import { KeyCode, KeyMod } from '@codingame/monaco-vscode-api/vscode/vs/base/common/keyCodes';
import { KeybindingWeight } from '@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry';
import type { ServicesAccessor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { ICodeEditorService } from '@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/codeEditorService.service';
import { IQuickInputService } from '@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service';
import { INotificationService } from '@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service';
import Severity from '@codingame/monaco-vscode-api/vscode/vs/base/common/severity';
import { getActiveModelProvider, type StreamingCallbacks } from './ai/index';
import { showDiffReview } from './diffReview';

// Track disposables for cleanup
const disposables: IDisposable[] = [];

/**
 * Clean up AI response to extract just the code
 */
function cleanCodeResponse(response: string): string {
  let cleaned = response;

  // Remove markdown code blocks if present
  cleaned = cleaned.replace(/^```[\w]*\n?/g, '');
  cleaned = cleaned.replace(/\n?```$/g, '');

  // Remove common prefixes the model might add
  cleaned = cleaned.replace(/^(Here's the modified code:|Modified code:|Output:)[\s\n]*/i, '');

  return cleaned.trimEnd();
}

/**
 * Get AI edit for the selected code
 */
async function getAIEdit(
  originalCode: string,
  instruction: string,
  language: string
): Promise<string | null> {
  const provider = getActiveModelProvider();

  if (!provider) {
    console.log('[InlineEdit] No model provider configured');
    return null;
  }

  if (!provider.isAuthenticated()) {
    console.log('[InlineEdit] Model provider not authenticated');
    return null;
  }

  const prompt = `You are a code editing assistant. Modify the following ${language} code according to the instruction.
IMPORTANT: Only output the modified code. No explanations, no markdown formatting, just the raw code.

Original code:
\`\`\`${language}
${originalCode}
\`\`\`

Instruction: ${instruction}

Modified code:`;

  let result = '';
  let hasError = false;

  const callbacks: StreamingCallbacks = {
    onToken: (chunk: string) => {
      result += chunk;
    },
    onComplete: () => {},
    onError: (error: Error) => {
      console.error('[InlineEdit] Provider error:', error.message);
      hasError = true;
    },
  };

  try {
    await provider.getCompletion([{ role: 'user', content: prompt }], callbacks);
  } catch (error) {
    console.error('[InlineEdit] Request failed:', error);
    return null;
  }

  if (hasError) {
    return null;
  }

  return cleanCodeResponse(result);
}

/**
 * Inline Edit Action - Ctrl+K to edit selected code with AI
 */
class InlineEditAction extends Action2 {
  constructor() {
    super({
      id: 'blink.inlineEdit',
      title: { value: 'Inline Edit with AI', original: 'Inline Edit with AI' },
      category: { value: 'AI', original: 'AI' },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.EditorContrib,
        primary: KeyMod.CtrlCmd | KeyCode.KeyK,
      },
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const codeEditorService = accessor.get(ICodeEditorService);
    const quickInputService = accessor.get(IQuickInputService);
    const notificationService = accessor.get(INotificationService);

    // Get the active editor
    const editor = codeEditorService.getFocusedCodeEditor();
    if (!editor) {
      notificationService.notify({
        severity: Severity.Warning,
        message: 'No active editor. Open a file first.',
      });
      return;
    }

    const model = editor.getModel();
    if (!model) {
      notificationService.notify({
        severity: Severity.Warning,
        message: 'No document open.',
      });
      return;
    }

    // Get selection or current line
    const selection = editor.getSelection();
    if (!selection) {
      notificationService.notify({
        severity: Severity.Warning,
        message: 'No selection or cursor position.',
      });
      return;
    }

    let range = selection;
    if (selection.isEmpty()) {
      // If no selection, use the current line
      const lineNumber = selection.startLineNumber;
      range = {
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: model.getLineMaxColumn(lineNumber),
      } as any;
    }

    const originalText = model.getValueInRange(range);
    if (!originalText.trim()) {
      notificationService.notify({
        severity: Severity.Warning,
        message: 'Please select some code to edit.',
      });
      return;
    }

    // Get instruction from user via quick input
    const instruction = await quickInputService.input({
      placeHolder: 'Describe the change (e.g., "Add error handling", "Make this async")',
      prompt: 'Inline Edit - Describe how to modify the selected code',
    });

    if (!instruction) {
      return; // User cancelled
    }

    // Show notification while generating
    const handle = notificationService.notify({
      severity: Severity.Info,
      message: 'Generating edit...',
    });

    try {
      // Get AI edit
      const newText = await getAIEdit(
        originalText,
        instruction,
        model.getLanguageId()
      );

      handle.close();

      if (!newText) {
        notificationService.notify({
          severity: Severity.Error,
          message: 'Failed to generate edit. Check AI provider authentication.',
        });
        return;
      }

      // Check if the AI returned the same code
      if (newText.trim() === originalText.trim()) {
        notificationService.notify({
          severity: Severity.Info,
          message: 'No changes needed for this instruction.',
        });
        return;
      }

      // Get file path for diff review
      const filePath = model.uri.path || 'untitled';

      // Show diff review for user to accept/reject changes
      console.log('[InlineEdit] Showing diff review for:', instruction);

      const accepted = await showDiffReview(
        originalText,
        newText,
        filePath,
        `Inline Edit: ${instruction}`
      );

      if (accepted) {
        // Apply the edit
        editor.executeEdits('inlineEdit', [
          {
            range: range,
            text: newText,
            forceMoveMarkers: true,
          },
        ]);

        notificationService.notify({
          severity: Severity.Info,
          message: 'Inline edit applied successfully.',
        });

        console.log('[InlineEdit] Edit applied:', instruction);
      } else {
        notificationService.notify({
          severity: Severity.Info,
          message: 'Inline edit cancelled.',
        });
        console.log('[InlineEdit] Edit rejected by user');
      }
    } catch (error) {
      handle.close();
      console.error('[InlineEdit] Error:', error);
      notificationService.notify({
        severity: Severity.Error,
        message: 'Failed to apply inline edit.',
      });
    }
  }
}

/**
 * Register inline edit command and keybinding
 * Call this from workbench.ts after AI is initialized
 */
export function registerInlineEdit(): IDisposable {
  // Dispose existing registrations
  disposeInlineEdit();

  // Register the action
  const disposable = registerAction2(InlineEditAction);
  disposables.push(disposable);

  console.log('[InlineEdit] Command registered (Ctrl+K)');

  // Expose for testing
  (window as any).__INLINE_EDIT_REGISTERED__ = true;

  // Return a disposable that cleans up everything
  return {
    dispose: disposeInlineEdit,
  };
}

/**
 * Dispose inline edit resources
 */
export function disposeInlineEdit(): void {
  for (const d of disposables) {
    try {
      d.dispose();
    } catch (e) {
      // Ignore disposal errors
    }
  }
  disposables.length = 0;
  (window as any).__INLINE_EDIT_REGISTERED__ = false;
  console.log('[InlineEdit] Disposed');
}
