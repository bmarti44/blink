/**
 * Context Mentions Provider (@file, @folder, @codebase)
 *
 * Provides context chip functionality for the AI chat.
 * Users can reference files, folders, and codebase searches using @ mentions.
 *
 * P0 Feature - Critical for AI IDE functionality
 *
 * Usage in chat:
 *   @file:/path/to/file.ts - Include file contents in context
 *   @folder:/path/to/dir - Include folder structure in context
 *   @codebase:searchQuery - Search codebase and include results
 */

import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import type { ITextModel } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/model';
import { Position } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/core/position';
import type { CancellationToken } from '@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation';
import type { CompletionItemProvider, CompletionList, CompletionContext } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/languages';
import { CompletionItemKind } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/languages';
import { ILanguageFeaturesService } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/services/languageFeatures.service';
import { ICodeEditorService } from '@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/codeEditorService.service';
import { IEditorService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service';
import { getService } from '@codingame/monaco-vscode-api/services';
import { readFile, readDir, exists, stat, readTextFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

// For workspace folder access, we'll use a different approach
const getWorkspaceFolder = (): string | null => {
  return localStorage.getItem('blink-workspace-folder');
};

// ============================================================================
// Types
// ============================================================================

export interface ContextMention {
  type: 'file' | 'folder' | 'codebase' | 'selection' | 'symbol';
  path?: string;
  query?: string;
  content?: string;
  resolved?: boolean;
  error?: string;
}

export interface ParsedMessage {
  mentions: ContextMention[];
  cleanText: string;
  originalText: string;
}

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse @ mentions from input text
 */
export function parseMentions(text: string): ParsedMessage {
  const mentions: ContextMention[] = [];
  let cleanText = text;

  // Match @file:path (with optional quotes for paths with spaces)
  const fileRegex = /@file:(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    const path = match[1] || match[2] || match[3];
    mentions.push({ type: 'file', path, resolved: false });
    cleanText = cleanText.replace(match[0], '');
  }

  // Match @folder:path
  const folderRegex = /@folder:(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
  while ((match = folderRegex.exec(text)) !== null) {
    const path = match[1] || match[2] || match[3];
    mentions.push({ type: 'folder', path, resolved: false });
    cleanText = cleanText.replace(match[0], '');
  }

  // Match @codebase:query
  const codebaseRegex = /@codebase:(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
  while ((match = codebaseRegex.exec(text)) !== null) {
    const query = match[1] || match[2] || match[3];
    mentions.push({ type: 'codebase', query, resolved: false });
    cleanText = cleanText.replace(match[0], '');
  }

  // Match @selection (current editor selection)
  if (text.includes('@selection')) {
    mentions.push({ type: 'selection', resolved: false });
    cleanText = cleanText.replace(/@selection/g, '');
  }

  // Match @symbol:name (find symbol definition)
  const symbolRegex = /@symbol:([^\s]+)/g;
  while ((match = symbolRegex.exec(text)) !== null) {
    mentions.push({ type: 'symbol', query: match[1], resolved: false });
    cleanText = cleanText.replace(match[0], '');
  }

  return {
    mentions,
    cleanText: cleanText.trim(),
    originalText: text,
  };
}

// ============================================================================
// Resolution Functions
// ============================================================================

/**
 * Resolve file content for a mention
 */
async function resolveFileContent(filePath: string): Promise<string> {
  try {
    // Expand relative paths using workspace folder from local storage
    let fullPath = filePath;
    if (!filePath.startsWith('/')) {
      const workspaceFolder = getWorkspaceFolder();
      if (workspaceFolder) {
        fullPath = await join(workspaceFolder, filePath);
      }
    }

    // Check if file exists
    const fileExists = await exists(fullPath);
    if (!fileExists) {
      return `[File not found: ${filePath}]`;
    }

    // Read file content
    const content = await readFile(fullPath);
    const decoder = new TextDecoder();
    const text = decoder.decode(content);

    // Limit content size (max 10KB per file for context)
    const MAX_SIZE = 10 * 1024;
    if (text.length > MAX_SIZE) {
      return text.substring(0, MAX_SIZE) + '\n... [truncated]';
    }

    return text;
  } catch (error) {
    console.error('[ContextMentions] Failed to read file:', filePath, error);
    return `[Error reading file: ${filePath}]`;
  }
}

/**
 * Resolve folder structure for a mention
 */
async function resolveFolderContent(folderPath: string, _depth: number = 2): Promise<string> {
  try {
    // Expand relative paths using workspace folder from local storage
    let fullPath = folderPath;
    if (!folderPath.startsWith('/')) {
      const workspaceFolder = getWorkspaceFolder();
      if (workspaceFolder) {
        fullPath = await join(workspaceFolder, folderPath);
      }
    }

    // Check if folder exists
    const folderExists = await exists(fullPath);
    if (!folderExists) {
      return `[Folder not found: ${folderPath}]`;
    }

    const folderStat = await stat(fullPath);
    if (!folderStat.isDirectory) {
      return `[Not a folder: ${folderPath}]`;
    }

    // Read folder contents
    const entries = await readDir(fullPath);
    const lines: string[] = [`Folder: ${folderPath}/`];

    // Sort: directories first, then files
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted.slice(0, 50)) {
      // Limit to 50 entries
      const icon = entry.isDirectory ? '[DIR]' : '[FILE]';
      lines.push(`  ${icon} ${entry.name}`);
    }

    if (sorted.length > 50) {
      lines.push(`  ... and ${sorted.length - 50} more items`);
    }

    return lines.join('\n');
  } catch (error) {
    console.error('[ContextMentions] Failed to read folder:', folderPath, error);
    return `[Error reading folder: ${folderPath}]`;
  }
}

/**
 * Resolve current editor selection using ICodeEditorService
 */
async function resolveSelection(): Promise<string> {
  try {
    const codeEditorService = await getService(ICodeEditorService);
    if (!codeEditorService) {
      console.warn('[ContextMentions] Code editor service not available');
      return '[Selection context not available - editor service not ready]';
    }

    // First try to get focused editor
    let editor = codeEditorService.getFocusedCodeEditor();

    // If no focused editor, try to get the active editor (even when not focused)
    if (!editor) {
      try {
        const editorService = await getService(IEditorService);
        if (editorService && editorService.activeTextEditorControl) {
          // activeTextEditorControl might be a diff editor or code editor
          const activeEditor = editorService.activeTextEditorControl;
          if ('getSelection' in activeEditor && 'getModel' in activeEditor) {
            editor = activeEditor as any;
          }
        }
      } catch (e) {
        console.warn('[ContextMentions] Could not get active editor:', e);
      }
    }

    // Also try the list of all code editors
    if (!editor) {
      const allEditors = codeEditorService.listCodeEditors();
      if (allEditors && allEditors.length > 0) {
        // Get the most recently used editor with a selection
        for (const ed of allEditors) {
          const sel = ed.getSelection();
          if (sel && !sel.isEmpty()) {
            editor = ed;
            break;
          }
        }
        // If no editor with selection, use the first one
        if (!editor && allEditors[0]) {
          editor = allEditors[0];
        }
      }
    }

    if (!editor) {
      return '[No active editor - open a file first]';
    }

    const model = editor.getModel();
    if (!model) {
      return '[No document open in active editor]';
    }

    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      return '[No text selected - select some code first]';
    }

    const selectedText = model.getValueInRange(selection);
    if (!selectedText.trim()) {
      return '[Selected text is empty]';
    }

    // Get file info for context
    const uri = model.uri;
    const fileName = uri.path.split('/').pop() || 'unknown';
    const language = model.getLanguageId();

    // Limit selection size (max 5KB)
    const MAX_SIZE = 5 * 1024;
    let text = selectedText;
    if (text.length > MAX_SIZE) {
      text = text.substring(0, MAX_SIZE) + '\n... [selection truncated]';
    }

    const lineInfo = `Lines ${selection.startLineNumber}-${selection.endLineNumber}`;

    return `--- Selected Code (${fileName}, ${language}, ${lineInfo}) ---\n${text}\n---`;
  } catch (error) {
    console.error('[ContextMentions] Failed to get selection:', error);
    return '[Error getting selection from editor]';
  }
}

/**
 * Search codebase for symbols/patterns using recursive file search
 */
async function searchCodebase(query: string): Promise<string> {
  try {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return `[No workspace folder open - cannot search codebase]`;
    }

    const results: string[] = [`Search results for: "${query}"`, ''];
    const matches: { file: string; line: number; content: string }[] = [];

    // File extensions to search
    const searchableExtensions = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java',
      '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.html',
      '.css', '.scss', '.json', '.yaml', '.yml', '.md', '.sh',
      '.sql', '.xml', '.vue', '.svelte',
    ]);

    // Folders to skip
    const skipFolders = new Set([
      'node_modules', '.git', 'dist', 'build', 'target', '__pycache__',
      '.next', '.nuxt', 'coverage', '.cache', 'vendor',
    ]);

    // Recursive search function
    async function searchDir(dirPath: string, depth: number = 0): Promise<void> {
      if (depth > 5 || matches.length >= 20) return; // Limit depth and results

      try {
        const entries = await readDir(dirPath);

        for (const entry of entries) {
          if (matches.length >= 20) break;

          const entryPath = await join(dirPath, entry.name);

          if (entry.isDirectory) {
            // Skip excluded folders
            if (!skipFolders.has(entry.name) && !entry.name.startsWith('.')) {
              await searchDir(entryPath, depth + 1);
            }
          } else {
            // Check file extension
            const ext = '.' + entry.name.split('.').pop()?.toLowerCase();
            if (!searchableExtensions.has(ext)) continue;

            try {
              const content = await readTextFile(entryPath);
              const lines = content.split('\n');

              for (let i = 0; i < lines.length && matches.length < 20; i++) {
                if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                  // Get relative path (workspaceFolder is guaranteed to be non-null here)
                  const relativePath = entryPath.replace(workspaceFolder!, '').replace(/^\//, '');
                  matches.push({
                    file: relativePath,
                    line: i + 1,
                    content: lines[i].trim().substring(0, 150),
                  });
                }
              }
            } catch {
              // Skip files that can't be read
            }
          }
        }
      } catch {
        // Skip directories that can't be read
      }
    }

    await searchDir(workspaceFolder);

    if (matches.length === 0) {
      results.push(`No matches found for "${query}" in the workspace.`);
      results.push('');
      results.push('Tip: Try a different search term or use @file:path to include a specific file.');
    } else {
      results.push(`Found ${matches.length} match${matches.length > 1 ? 'es' : ''}:`);
      results.push('');

      for (const match of matches) {
        results.push(`${match.file}:${match.line}`);
        results.push(`  ${match.content}`);
        results.push('');
      }

      if (matches.length >= 20) {
        results.push('... (showing first 20 results)');
      }
    }

    return results.join('\n');
  } catch (error) {
    console.error('[ContextMentions] Codebase search failed:', error);
    return `[Error searching codebase: ${query}]`;
  }
}

// ============================================================================
// Main Resolution Function
// ============================================================================

/**
 * Resolve all mentions and build context string
 */
export async function resolveAllMentions(
  mentions: ContextMention[]
): Promise<{ resolvedMentions: ContextMention[]; contextString: string }> {
  const resolvedMentions: ContextMention[] = [];
  const contextParts: string[] = [];

  for (const mention of mentions) {
    const resolved: ContextMention = { ...mention, resolved: true };

    try {
      switch (mention.type) {
        case 'file':
          if (mention.path) {
            resolved.content = await resolveFileContent(mention.path);
            contextParts.push(`--- File: ${mention.path} ---\n${resolved.content}\n---`);
          }
          break;

        case 'folder':
          if (mention.path) {
            resolved.content = await resolveFolderContent(mention.path);
            contextParts.push(resolved.content);
          }
          break;

        case 'codebase':
          if (mention.query) {
            resolved.content = await searchCodebase(mention.query);
            contextParts.push(resolved.content);
          }
          break;

        case 'selection':
          resolved.content = await resolveSelection();
          contextParts.push(resolved.content);
          break;

        case 'symbol':
          if (mention.query) {
            resolved.content = await searchCodebase(mention.query);
            contextParts.push(resolved.content);
          }
          break;
      }
    } catch (error) {
      resolved.error = error instanceof Error ? error.message : String(error);
      resolved.content = `[Error resolving ${mention.type}: ${resolved.error}]`;
      contextParts.push(resolved.content);
    }

    resolvedMentions.push(resolved);
  }

  return {
    resolvedMentions,
    contextString: contextParts.join('\n\n'),
  };
}

/**
 * Process a message with mentions and return enhanced prompt
 */
export async function processMessageWithContext(
  message: string
): Promise<{ prompt: string; mentions: ContextMention[] }> {
  const parsed = parseMentions(message);

  if (parsed.mentions.length === 0) {
    return { prompt: message, mentions: [] };
  }

  const { resolvedMentions, contextString } = await resolveAllMentions(parsed.mentions);

  // Build enhanced prompt with context
  const prompt = `${contextString}\n\nUser message: ${parsed.cleanText}`;

  return { prompt, mentions: resolvedMentions };
}

// ============================================================================
// Completion Provider
// ============================================================================

// Provider registration
let providerDisposable: IDisposable | null = null;

/**
 * Context Mentions Completion Provider
 * Provides @file, @folder, @codebase completions
 */
class ContextMentionsProvider implements CompletionItemProvider {
  _debugDisplayName = 'ContextMentionsProvider';
  triggerCharacters = ['@'];

  provideCompletionItems(
    model: ITextModel,
    position: Position,
    _context: CompletionContext,
    _token: CancellationToken
  ): CompletionList | null {
    const lineText = model.getLineContent(position.lineNumber);
    const textBefore = lineText.substring(0, position.column - 1);

    // Only trigger after @
    if (!textBefore.endsWith('@')) {
      return null;
    }

    const items = [
      {
        label: '@file:',
        kind: CompletionItemKind.Reference,
        detail: 'Include file contents',
        insertText: 'file:',
        documentation: { value: 'Reference a file to include its contents in context' },
      },
      {
        label: '@folder:',
        kind: CompletionItemKind.Folder,
        detail: 'Include folder structure',
        insertText: 'folder:',
        documentation: { value: 'Reference a folder to include its structure in context' },
      },
      {
        label: '@codebase:',
        kind: CompletionItemKind.Reference,
        detail: 'Search codebase',
        insertText: 'codebase:',
        documentation: { value: 'Search the codebase for symbols or patterns' },
      },
      {
        label: '@selection',
        kind: CompletionItemKind.Text,
        detail: 'Current selection',
        insertText: 'selection',
        documentation: { value: 'Include the current editor selection in context' },
      },
      {
        label: '@symbol:',
        kind: CompletionItemKind.Interface,
        detail: 'Find symbol',
        insertText: 'symbol:',
        documentation: { value: 'Search for a symbol definition in the codebase' },
      },
    ];

    return {
      suggestions: items.map((item, index) => ({
        label: item.label,
        kind: item.kind,
        detail: item.detail,
        insertText: item.insertText,
        documentation: item.documentation,
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
        sortText: String(index).padStart(2, '0'),
      })),
    };
  }
}

/**
 * Register completion provider for @ mentions
 * Uses ILanguageFeaturesService for monaco-vscode-api compatibility
 */
export async function registerContextMentions(): Promise<IDisposable> {
  // Dispose existing if re-registering
  if (providerDisposable) {
    providerDisposable.dispose();
  }

  // Get the language features service
  const languageFeaturesService = await getService(ILanguageFeaturesService);

  const provider = new ContextMentionsProvider();

  // Register for all file types
  providerDisposable = languageFeaturesService.completionProvider.register(
    { pattern: '**/*' },  // Match all files
    provider
  );

  console.log('[ContextMentions] Provider registered via ILanguageFeaturesService');

  // Expose for testing
  (window as any).__CONTEXT_MENTIONS_PROVIDER__ = provider;

  return providerDisposable;
}

/**
 * Dispose the context mentions provider
 */
export function disposeContextMentions(): void {
  if (providerDisposable) {
    providerDisposable.dispose();
    providerDisposable = null;
  }
  console.log('[ContextMentions] Disposed');
}
