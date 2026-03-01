/**
 * Tab Autocomplete Provider (Ghost Text)
 *
 * Provides inline completion suggestions using Blink Code Assist.
 * Shows "ghost text" that can be accepted with Tab or dismissed with Escape.
 *
 * P0 Feature - Critical for AI IDE functionality
 *
 * Uses monaco-vscode-api's ILanguageFeaturesService for registration.
 */

import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import type { ITextModel } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/model';
import { Position } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/core/position';
import { Range } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/core/range';
import type { CancellationToken } from '@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation';
import type {
  InlineCompletionsProvider,
  InlineCompletions,
  InlineCompletionContext,
  InlineCompletion,
} from '@codingame/monaco-vscode-api/vscode/vs/editor/common/languages';
import { InlineCompletionTriggerKind } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/languages';
import { ILanguageFeaturesService } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/services/languageFeatures.service';
import { getService } from '@codingame/monaco-vscode-api/services';
import { getActiveModelProvider, type StreamingCallbacks } from './ai/index';

// Configuration
const DEBOUNCE_MS = 300;
const MAX_CONTEXT_LINES = 50;
const MIN_PREFIX_LENGTH = 3;

// Track pending requests for cancellation
let pendingAbortController: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Clean up AI response to extract just the code completion
 */
function cleanCompletionResponse(response: string): string {
  let cleaned = response;

  // Remove markdown code blocks if present
  cleaned = cleaned.replace(/^```[\w]*\n?/g, '');
  cleaned = cleaned.replace(/\n?```$/g, '');

  // Remove common prefixes the model might add
  cleaned = cleaned.replace(/^(Here's the completion:|Completion:|Output:)\s*/i, '');

  // Trim whitespace but preserve intentional indentation at start
  cleaned = cleaned.trimEnd();

  return cleaned;
}

/**
 * Check if position is inside a string literal (basic heuristic)
 */
function isInsideString(lineText: string, position: number): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;

  for (let i = 0; i < position; i++) {
    const char = lineText[i];
    const prevChar = i > 0 ? lineText[i - 1] : '';

    if (prevChar === '\\') continue; // Skip escaped characters

    if (char === "'" && !inDoubleQuote && !inTemplate) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && !inTemplate) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
      inTemplate = !inTemplate;
    }
  }

  return inSingleQuote || inDoubleQuote || inTemplate;
}

/**
 * Check if position is inside a comment (basic heuristic)
 */
function isInsideComment(lineText: string, position: number): boolean {
  const textBefore = lineText.substring(0, position);

  // Single-line comment
  if (textBefore.includes('//')) return true;

  // Hash comment (Python, Ruby, etc.)
  if (textBefore.includes('#') && !textBefore.includes('#include')) return true;

  return false;
}

/**
 * Build context for the completion request
 */
function buildContext(
  model: ITextModel,
  position: Position
): { prefix: string; suffix: string; language: string } {
  const startLine = Math.max(1, position.lineNumber - MAX_CONTEXT_LINES);
  const endLine = Math.min(model.getLineCount(), position.lineNumber + 10);

  // Get prefix (code before cursor)
  const prefixRange = new Range(startLine, 1, position.lineNumber, position.column);
  const prefix = model.getValueInRange(prefixRange);

  // Get suffix (code after cursor, limited)
  const suffixRange = new Range(position.lineNumber, position.column, endLine, model.getLineMaxColumn(endLine));
  const suffix = model.getValueInRange(suffixRange).substring(0, 500);

  // Get language from model
  const language = model.getLanguageId();

  return {
    prefix,
    suffix,
    language,
  };
}

/**
 * TabAutocompleteProvider - Provides inline completions using AI provider
 * Implements the Monaco InlineCompletionsProvider interface
 */
class TabAutocompleteProvider implements InlineCompletionsProvider {
  async provideInlineCompletions(
    model: ITextModel,
    position: Position,
    context: InlineCompletionContext,
    token: CancellationToken
  ): Promise<InlineCompletions | null> {
    // Cancel any pending request
    if (pendingAbortController) {
      pendingAbortController.abort();
      pendingAbortController = null;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Get line text for analysis
    const lineText = model.getLineContent(position.lineNumber);
    const textBefore = lineText.substring(0, position.column - 1);

    // Skip if not enough context
    if (textBefore.trim().length < MIN_PREFIX_LENGTH) {
      return null;
    }

    // Skip in comments and strings
    if (isInsideComment(lineText, position.column - 1)) {
      return null;
    }

    if (isInsideString(lineText, position.column - 1)) {
      return null;
    }

    // Skip if trigger is explicit (user pressed Ctrl+Space) - let regular completions handle it
    if (context.triggerKind === InlineCompletionTriggerKind.Explicit) {
      return null;
    }

    // Debounce: wait for user to stop typing
    return new Promise((resolve) => {
      debounceTimer = setTimeout(async () => {
        if (token.isCancellationRequested) {
          resolve(null);
          return;
        }

        try {
          const completion = await this.getCompletion(model, position, token);
          resolve(completion);
        } catch (error) {
          console.error('[TabAutocomplete] Error getting completion:', error);
          resolve(null);
        }
      }, DEBOUNCE_MS);

      // Handle cancellation
      token.onCancellationRequested(() => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        resolve(null);
      });
    });
  }

  private async getCompletion(
    model: ITextModel,
    position: Position,
    token: CancellationToken
  ): Promise<InlineCompletions | null> {
    // Get active model provider
    const provider = getActiveModelProvider();

    // Check if provider is available and authenticated
    if (!provider) {
      console.log('[TabAutocomplete] Skipping - no model provider configured');
      return null;
    }

    if (!provider.isAuthenticated()) {
      // Silently skip if not authenticated - don't spam errors
      console.log('[TabAutocomplete] Skipping - not authenticated');
      return null;
    }

    // Build context
    const { prefix, suffix, language } = buildContext(model, position);

    // Build prompt for completion
    const prompt = `You are a code completion assistant. Complete the following ${language} code.
IMPORTANT: Only output the completion text that should appear after the cursor. No explanations, no markdown, just the raw code to insert.

Code before cursor:
\`\`\`${language}
${prefix}
\`\`\`

Code after cursor:
\`\`\`${language}
${suffix}
\`\`\`

Complete the code at the cursor position. Output ONLY the completion text:`;

    // Create abort controller for this request
    pendingAbortController = new AbortController();

    // Request completion from active model provider
    let completion = '';
    let hasError = false;

    const callbacks: StreamingCallbacks = {
      onToken: (chunk: string) => {
        if (!token.isCancellationRequested) {
          completion += chunk;
        }
      },
      onComplete: () => {
        // Completion finished
      },
      onError: (error: Error) => {
        console.error('[TabAutocomplete] Provider error:', error.message);
        hasError = true;
      },
    };

    try {
      await provider.getCompletion([{ role: 'user', content: prompt }], callbacks);
    } catch (error) {
      console.error('[TabAutocomplete] Request failed:', error);
      return null;
    } finally {
      pendingAbortController = null;
    }

    // Check if cancelled or errored
    if (token.isCancellationRequested || hasError) {
      return null;
    }

    // Clean up the response
    completion = cleanCompletionResponse(completion);

    // Skip empty completions
    if (!completion || completion.trim().length === 0) {
      return null;
    }

    // Limit completion length (avoid huge completions)
    if (completion.length > 500) {
      // Find a good break point (end of line or statement)
      const breakPoints = ['\n\n', ';\n', '}\n', '\n'];
      for (const bp of breakPoints) {
        const idx = completion.indexOf(bp, 100);
        if (idx > 0 && idx < 400) {
          completion = completion.substring(0, idx + bp.length);
          break;
        }
      }
    }

    console.log('[TabAutocomplete] Suggesting:', completion.substring(0, 50) + (completion.length > 50 ? '...' : ''));

    // Create inline completion item
    const item: InlineCompletion = {
      insertText: completion,
      range: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
    };

    return {
      items: [item],
    };
  }

  // Required by interface - called when completions are no longer used
  disposeInlineCompletions(_completions: InlineCompletions): void {
    // Nothing to dispose for our simple completions
  }
}

// Provider registration
let providerDisposable: IDisposable | null = null;

/**
 * Register the tab autocomplete provider
 * Call this from workbench.ts after AI is initialized
 */
export async function registerTabAutocomplete(): Promise<IDisposable> {
  // Dispose existing if re-registering
  if (providerDisposable) {
    providerDisposable.dispose();
  }

  // Get the language features service
  const languageFeaturesService = await getService(ILanguageFeaturesService);

  const provider = new TabAutocompleteProvider();

  // Register for all file types using wildcard selector
  // The language selector '*' matches all languages
  providerDisposable = languageFeaturesService.inlineCompletionsProvider.register(
    { pattern: '**/*' },  // Match all files
    provider
  );

  console.log('[TabAutocomplete] Provider registered via ILanguageFeaturesService');

  // Expose for testing
  (window as any).__TAB_AUTOCOMPLETE_PROVIDER__ = provider;

  return providerDisposable;
}

/**
 * Dispose the tab autocomplete provider
 */
export function disposeTabAutocomplete(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (pendingAbortController) {
    pendingAbortController.abort();
    pendingAbortController = null;
  }

  if (providerDisposable) {
    providerDisposable.dispose();
    providerDisposable = null;
  }

  console.log('[TabAutocomplete] Provider disposed');
}
