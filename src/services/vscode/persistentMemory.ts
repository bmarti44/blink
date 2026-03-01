/**
 * Persistent Memory / Rules Service
 *
 * Enables persistent project-specific rules and context that the AI remembers.
 * Uses .blinkrules and .blinkmem files in the workspace root.
 *
 * P1 Feature - Persistent Memory/Rules
 *
 * Features:
 *   - .blinkrules - Project-specific instructions for the AI
 *   - .blinkmem - Conversation memory/learned context
 *   - Automatic context injection into prompts
 *   - Memory management commands
 */

import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

// ============================================================================
// Types
// ============================================================================

export interface ProjectRules {
  version: number;
  rules: string[];
  codeStyle?: {
    language?: string;
    indentation?: 'tabs' | 'spaces';
    indentSize?: number;
    quotes?: 'single' | 'double';
    semicolons?: boolean;
    trailingComma?: boolean;
  };
  preferences?: {
    testFramework?: string;
    componentStyle?: string;
    stateManagement?: string;
    errorHandling?: string;
  };
  doNot?: string[];
  alwaysDo?: string[];
}

export interface MemoryEntry {
  id: string;
  type: 'fact' | 'preference' | 'context' | 'error' | 'solution';
  content: string;
  timestamp: number;
  relevance: number; // 0-1 score for how relevant this is
}

export interface ProjectMemory {
  version: number;
  entries: MemoryEntry[];
  lastUpdated: number;
}

// File paths
const RULES_FILE = '.blinkrules';
const MEMORY_FILE = '.blinkmem';

// Cache
let cachedRules: ProjectRules | null = null;
let cachedMemory: ProjectMemory | null = null;
let workspacePath: string | null = null;

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
 * Initialize with workspace path
 */
export function initializePersistentMemory(): void {
  workspacePath = getWorkspaceFolder();
  cachedRules = null;
  cachedMemory = null;
  console.log('[PersistentMemory] Initialized with workspace:', workspacePath);
}

// ============================================================================
// Rules Management
// ============================================================================

/**
 * Get the default rules template
 */
function getDefaultRules(): ProjectRules {
  return {
    version: 1,
    rules: [
      'Follow existing code patterns and conventions',
      'Write clear, self-documenting code',
      'Add comments only for complex logic',
      'Handle errors gracefully',
    ],
    codeStyle: {
      indentation: 'spaces',
      indentSize: 2,
      quotes: 'single',
      semicolons: true,
    },
    preferences: {},
    doNot: ['Add unnecessary dependencies', 'Change unrelated code', 'Remove existing tests'],
    alwaysDo: ['Run tests before committing', 'Update types when changing interfaces'],
  };
}

/**
 * Load project rules from .blinkrules file
 */
export async function loadProjectRules(): Promise<ProjectRules> {
  if (cachedRules) {
    return cachedRules;
  }

  const workspace = workspacePath || getWorkspaceFolder();
  if (!workspace) {
    return getDefaultRules();
  }

  try {
    const rulesPath = await join(workspace, RULES_FILE);
    const fileExists = await exists(rulesPath);

    if (!fileExists) {
      // Return defaults if no rules file
      cachedRules = getDefaultRules();
      return cachedRules;
    }

    const content = await readTextFile(rulesPath);

    // Try to parse as JSON first
    try {
      cachedRules = JSON.parse(content) as ProjectRules;
      return cachedRules;
    } catch {
      // If not JSON, treat as plain text rules
      cachedRules = {
        version: 1,
        rules: content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#')),
      };
      return cachedRules;
    }
  } catch (error) {
    console.warn('[PersistentMemory] Failed to load rules:', error);
    cachedRules = getDefaultRules();
    return cachedRules;
  }
}

/**
 * Save project rules to .blinkrules file
 */
export async function saveProjectRules(rules: ProjectRules): Promise<boolean> {
  const workspace = workspacePath || getWorkspaceFolder();
  if (!workspace) {
    console.warn('[PersistentMemory] No workspace folder set');
    return false;
  }

  try {
    const rulesPath = await join(workspace, RULES_FILE);
    await writeTextFile(rulesPath, JSON.stringify(rules, null, 2));
    cachedRules = rules;
    console.log('[PersistentMemory] Rules saved');
    return true;
  } catch (error) {
    console.error('[PersistentMemory] Failed to save rules:', error);
    return false;
  }
}

/**
 * Format rules for prompt injection
 */
export function formatRulesForPrompt(rules: ProjectRules): string {
  const lines: string[] = ['## Project Rules\n'];

  if (rules.rules.length > 0) {
    lines.push('### Guidelines:');
    for (const rule of rules.rules) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  if (rules.codeStyle) {
    lines.push('### Code Style:');
    if (rules.codeStyle.language) lines.push(`- Language: ${rules.codeStyle.language}`);
    if (rules.codeStyle.indentation)
      lines.push(
        `- Indentation: ${rules.codeStyle.indentation}${rules.codeStyle.indentSize ? ` (${rules.codeStyle.indentSize})` : ''}`
      );
    if (rules.codeStyle.quotes) lines.push(`- Quotes: ${rules.codeStyle.quotes}`);
    if (rules.codeStyle.semicolons !== undefined)
      lines.push(`- Semicolons: ${rules.codeStyle.semicolons ? 'yes' : 'no'}`);
    lines.push('');
  }

  if (rules.doNot && rules.doNot.length > 0) {
    lines.push('### Do NOT:');
    for (const item of rules.doNot) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (rules.alwaysDo && rules.alwaysDo.length > 0) {
    lines.push('### Always:');
    for (const item of rules.alwaysDo) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Memory Management
// ============================================================================

/**
 * Get default empty memory
 */
function getDefaultMemory(): ProjectMemory {
  return {
    version: 1,
    entries: [],
    lastUpdated: Date.now(),
  };
}

/**
 * Load project memory from .blinkmem file
 */
export async function loadProjectMemory(): Promise<ProjectMemory> {
  if (cachedMemory) {
    return cachedMemory;
  }

  const workspace = workspacePath || getWorkspaceFolder();
  if (!workspace) {
    return getDefaultMemory();
  }

  try {
    const memoryPath = await join(workspace, MEMORY_FILE);
    const fileExists = await exists(memoryPath);

    if (!fileExists) {
      cachedMemory = getDefaultMemory();
      return cachedMemory;
    }

    const content = await readTextFile(memoryPath);
    cachedMemory = JSON.parse(content) as ProjectMemory;
    return cachedMemory;
  } catch (error) {
    console.warn('[PersistentMemory] Failed to load memory:', error);
    cachedMemory = getDefaultMemory();
    return cachedMemory;
  }
}

/**
 * Save project memory to .blinkmem file
 */
export async function saveProjectMemory(memory: ProjectMemory): Promise<boolean> {
  const workspace = workspacePath || getWorkspaceFolder();
  if (!workspace) {
    console.warn('[PersistentMemory] No workspace folder set');
    return false;
  }

  try {
    memory.lastUpdated = Date.now();
    const memoryPath = await join(workspace, MEMORY_FILE);
    await writeTextFile(memoryPath, JSON.stringify(memory, null, 2));
    cachedMemory = memory;
    console.log('[PersistentMemory] Memory saved with', memory.entries.length, 'entries');
    return true;
  } catch (error) {
    console.error('[PersistentMemory] Failed to save memory:', error);
    return false;
  }
}

/**
 * Add a memory entry
 */
export async function addMemoryEntry(
  type: MemoryEntry['type'],
  content: string,
  relevance: number = 0.5
): Promise<boolean> {
  const memory = await loadProjectMemory();

  const entry: MemoryEntry = {
    id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type,
    content,
    timestamp: Date.now(),
    relevance,
  };

  memory.entries.push(entry);

  // Keep memory manageable - remove old low-relevance entries if too many
  if (memory.entries.length > 100) {
    memory.entries.sort((a, b) => b.relevance - a.relevance || b.timestamp - a.timestamp);
    memory.entries = memory.entries.slice(0, 100);
  }

  return saveProjectMemory(memory);
}

/**
 * Get relevant memory entries for a query
 */
export async function getRelevantMemory(query: string, limit: number = 10): Promise<MemoryEntry[]> {
  const memory = await loadProjectMemory();
  const queryLower = query.toLowerCase();

  // Simple relevance scoring based on keyword matching
  const scored = memory.entries.map((entry) => {
    const contentLower = entry.content.toLowerCase();
    const words = queryLower.split(/\s+/);
    const matchCount = words.filter((word) => contentLower.includes(word)).length;
    const matchScore = matchCount / words.length;
    return { entry, score: entry.relevance * 0.5 + matchScore * 0.5 };
  });

  // Sort by combined score and return top entries
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

/**
 * Format memory entries for prompt injection
 */
export function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  const lines: string[] = ['## Project Context\n'];

  const facts = entries.filter((e) => e.type === 'fact');
  const preferences = entries.filter((e) => e.type === 'preference');
  const solutions = entries.filter((e) => e.type === 'solution');

  if (facts.length > 0) {
    lines.push('### Known Facts:');
    for (const fact of facts.slice(0, 5)) {
      lines.push(`- ${fact.content}`);
    }
    lines.push('');
  }

  if (preferences.length > 0) {
    lines.push('### Preferences:');
    for (const pref of preferences.slice(0, 5)) {
      lines.push(`- ${pref.content}`);
    }
    lines.push('');
  }

  if (solutions.length > 0) {
    lines.push('### Past Solutions:');
    for (const solution of solutions.slice(0, 3)) {
      lines.push(`- ${solution.content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Clear all memory entries
 */
export async function clearMemory(): Promise<boolean> {
  const memory = getDefaultMemory();
  return saveProjectMemory(memory);
}

// ============================================================================
// Context Injection
// ============================================================================

/**
 * Get full context to inject into AI prompts
 * This combines rules and relevant memory
 */
export async function getContextForPrompt(userQuery?: string): Promise<string> {
  const parts: string[] = [];

  // Load and format rules
  try {
    const rules = await loadProjectRules();
    const rulesText = formatRulesForPrompt(rules);
    if (rulesText.trim()) {
      parts.push(rulesText);
    }
  } catch (error) {
    console.warn('[PersistentMemory] Failed to load rules for context:', error);
  }

  // Load and format relevant memory
  if (userQuery) {
    try {
      const relevantMemory = await getRelevantMemory(userQuery);
      const memoryText = formatMemoryForPrompt(relevantMemory);
      if (memoryText.trim()) {
        parts.push(memoryText);
      }
    } catch (error) {
      console.warn('[PersistentMemory] Failed to load memory for context:', error);
    }
  }

  return parts.join('\n');
}

// ============================================================================
// Commands for Chat
// ============================================================================

/**
 * Handle /remember command to add memory
 */
export async function handleRememberCommand(content: string): Promise<string> {
  if (!content.trim()) {
    return 'Usage: `/remember <fact or preference to remember>`\n\nExample: `/remember This project uses Redux for state management`';
  }

  // Determine type from content
  let type: MemoryEntry['type'] = 'fact';
  if (content.toLowerCase().includes('prefer') || content.toLowerCase().includes('always')) {
    type = 'preference';
  } else if (content.toLowerCase().includes('solved') || content.toLowerCase().includes('fixed')) {
    type = 'solution';
  }

  const success = await addMemoryEntry(type, content, 0.8);

  if (success) {
    return `✅ Remembered: "${content}"`;
  } else {
    return '❌ Failed to save memory. Check if workspace is opened.';
  }
}

/**
 * Handle /forget command to clear memory
 */
export async function handleForgetCommand(): Promise<string> {
  const success = await clearMemory();

  if (success) {
    return '✅ Memory cleared.';
  } else {
    return '❌ Failed to clear memory.';
  }
}

/**
 * Handle /rules command to show or edit rules
 */
export async function handleRulesCommand(args?: string): Promise<string> {
  if (!args || args.trim() === 'show') {
    const rules = await loadProjectRules();
    const formatted = formatRulesForPrompt(rules);
    return `**Current Project Rules:**\n\n${formatted}\n\n*Edit \`.blinkrules\` in your workspace root to customize.*`;
  }

  if (args.trim() === 'reset') {
    const success = await saveProjectRules(getDefaultRules());
    if (success) {
      cachedRules = null;
      return '✅ Rules reset to defaults.';
    } else {
      return '❌ Failed to reset rules.';
    }
  }

  if (args.startsWith('add ')) {
    const newRule = args.substring(4).trim();
    const rules = await loadProjectRules();
    rules.rules.push(newRule);
    const success = await saveProjectRules(rules);
    if (success) {
      return `✅ Added rule: "${newRule}"`;
    } else {
      return '❌ Failed to add rule.';
    }
  }

  return 'Usage:\n- `/rules` or `/rules show` - Show current rules\n- `/rules add <rule>` - Add a new rule\n- `/rules reset` - Reset to defaults';
}

// ============================================================================
// Registration
// ============================================================================

const disposables: IDisposable[] = [];

/**
 * Register persistent memory service
 */
export function registerPersistentMemory(): IDisposable {
  // Dispose existing
  disposePersistentMemory();

  // Initialize
  initializePersistentMemory();

  console.log('[PersistentMemory] Service registered');

  // Expose for testing
  (window as any).__PERSISTENT_MEMORY_REGISTERED__ = true;
  (window as any).__GET_PROJECT_RULES__ = loadProjectRules;
  (window as any).__GET_PROJECT_MEMORY__ = loadProjectMemory;
  (window as any).__ADD_MEMORY__ = addMemoryEntry;
  (window as any).__GET_CONTEXT_FOR_PROMPT__ = getContextForPrompt;
  (window as any).__HANDLE_REMEMBER__ = handleRememberCommand;
  (window as any).__HANDLE_FORGET__ = handleForgetCommand;
  (window as any).__HANDLE_RULES__ = handleRulesCommand;

  return {
    dispose: disposePersistentMemory,
  };
}

/**
 * Dispose persistent memory resources
 */
export function disposePersistentMemory(): void {
  for (const d of disposables) {
    try {
      d.dispose();
    } catch {
      // Ignore
    }
  }
  disposables.length = 0;
  cachedRules = null;
  cachedMemory = null;
  (window as any).__PERSISTENT_MEMORY_REGISTERED__ = false;
  console.log('[PersistentMemory] Disposed');
}
