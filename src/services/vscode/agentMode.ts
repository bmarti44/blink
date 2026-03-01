/**
 * Agent Mode Service
 *
 * Enables multi-step autonomous execution with tool-use loops.
 * The agent can read files, write code, run commands, and verify its work.
 *
 * P1 Feature - Agent Mode (Multi-step Autonomous)
 *
 * Features:
 *   - Multi-step tool-use loop
 *   - Self-correction on errors
 *   - Verification of changes
 *   - Parallel task execution
 *   - Streaming progress updates
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
import { writeTextFile, readTextFile, exists, mkdir, readDir } from '@tauri-apps/plugin-fs';
import { join, dirname } from '@tauri-apps/api/path';
import { showDiffReview } from './diffReview';
import { executeInTerminal } from './terminalAI';

// Track disposables for cleanup
const disposables: IDisposable[] = [];

// ============================================================================
// Types
// ============================================================================

export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'list_directory'
  | 'search_files'
  | 'run_command'
  | 'ask_user'
  | 'complete';

export interface ToolCall {
  tool: ToolName;
  params: Record<string, string>;
  reasoning: string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface AgentStep {
  id: number;
  toolCall: ToolCall;
  result: ToolResult | null;
  timestamp: number;
}

export interface AgentSession {
  id: string;
  task: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  steps: AgentStep[];
  startedAt: number;
  completedAt?: number;
  summary?: string;
}

// Active session
let currentSession: AgentSession | null = null;
let sessionCancelled = false;

// Max iterations to prevent infinite loops
const MAX_ITERATIONS = 50;
const MAX_FILE_SIZE = 100000; // 100KB

// ============================================================================
// Tool Definitions (for LLM context)
// ============================================================================

const TOOL_DEFINITIONS = `
You have access to the following tools:

1. read_file(path: string) - Read the contents of a file
   - Use this to understand existing code before modifying
   - Returns file content or error message

2. write_file(path: string, content: string) - Write content to a file
   - Creates parent directories if needed
   - User will be shown a diff review before changes are applied
   - Returns success/failure message

3. list_directory(path: string) - List files and folders in a directory
   - Returns directory contents with file types
   - Use this to explore project structure

4. search_files(pattern: string, query: string) - Search for text in files
   - pattern: glob pattern (e.g., "*.ts", "src/**/*.js")
   - query: text or regex to search for
   - Returns matching file paths and line numbers

5. run_command(command: string) - Run a shell command
   - Use for build, test, lint, or other commands
   - Command must be safe and non-destructive
   - Returns command output

6. ask_user(question: string) - Ask the user for clarification
   - Use when you need more information to proceed
   - Returns user's response

7. complete(summary: string) - Mark the task as complete
   - Use when all work is done
   - Include a summary of what was accomplished
`;

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

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Read file tool
 */
async function toolReadFile(params: Record<string, string>): Promise<ToolResult> {
  const { path } = params;
  if (!path) {
    return { success: false, output: '', error: 'Missing path parameter' };
  }

  try {
    const filePath = await resolveFilePath(path);
    const fileExists = await exists(filePath);

    if (!fileExists) {
      return { success: false, output: '', error: `File not found: ${path}` };
    }

    const content = await readTextFile(filePath);

    if (content.length > MAX_FILE_SIZE) {
      return {
        success: true,
        output: content.substring(0, MAX_FILE_SIZE) + '\n...[truncated]...',
      };
    }

    return { success: true, output: content };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Write file tool with diff review
 */
async function toolWriteFile(params: Record<string, string>): Promise<ToolResult> {
  const { path, content } = params;
  if (!path || content === undefined) {
    return { success: false, output: '', error: 'Missing path or content parameter' };
  }

  try {
    const filePath = await resolveFilePath(path);

    // Read existing content for diff
    let originalContent = '';
    const fileExists = await exists(filePath);
    if (fileExists) {
      originalContent = await readTextFile(filePath);
    }

    // Ensure parent directory exists
    const parentDir = await dirname(filePath);
    const dirExists = await exists(parentDir);
    if (!dirExists) {
      await mkdir(parentDir, { recursive: true });
    }

    // Show diff review
    const accepted = await showDiffReview(
      originalContent,
      content,
      path,
      fileExists ? `Modify: ${path}` : `Create: ${path}`
    );

    if (!accepted) {
      return { success: false, output: '', error: 'User rejected the changes' };
    }

    // Write file
    await writeTextFile(filePath, content);
    return {
      success: true,
      output: fileExists
        ? `Successfully modified ${path}`
        : `Successfully created ${path}`,
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * List directory tool
 */
async function toolListDirectory(params: Record<string, string>): Promise<ToolResult> {
  const { path } = params;
  const dirPath = path || '.';

  try {
    const resolvedPath = await resolveFilePath(dirPath);
    const dirExists = await exists(resolvedPath);

    if (!dirExists) {
      return { success: false, output: '', error: `Directory not found: ${dirPath}` };
    }

    const entries = await readDir(resolvedPath);
    const lines: string[] = [];

    for (const entry of entries) {
      const type = entry.isDirectory ? '[DIR]' : '[FILE]';
      lines.push(`${type} ${entry.name}`);
    }

    return { success: true, output: lines.join('\n') || '(empty directory)' };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Search files tool
 */
async function toolSearchFiles(params: Record<string, string>): Promise<ToolResult> {
  const { pattern, query } = params;
  if (!query) {
    return { success: false, output: '', error: 'Missing query parameter' };
  }

  try {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return { success: false, output: '', error: 'No workspace folder set' };
    }

    const results: string[] = [];
    // TODO: Implement glob pattern filtering with searchPattern
    const _searchPattern = pattern || '**/*';
    void _searchPattern; // Suppress unused warning until implemented
    const queryLower = query.toLowerCase();

    // Simple recursive search
    async function searchDir(dirPath: string, depth: number = 0): Promise<void> {
      if (depth > 5 || results.length >= 50) return;

      try {
        const entries = await readDir(dirPath);
        for (const entry of entries) {
          if (results.length >= 50) break;

          const fullPath = await join(dirPath, entry.name);

          if (entry.isDirectory) {
            // Skip node_modules, .git, etc.
            if (!['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) {
              await searchDir(fullPath, depth + 1);
            }
          } else {
            // Check if file matches pattern (simplified)
            const ext = entry.name.split('.').pop() || '';
            const searchableExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'json', 'yaml', 'md'];

            if (searchableExts.includes(ext)) {
              try {
                const content = await readTextFile(fullPath);
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].toLowerCase().includes(queryLower)) {
                    // workspaceFolder is checked non-null at function start
                    const relativePath = fullPath.replace(workspaceFolder!, '').replace(/^\//, '');
                    results.push(`${relativePath}:${i + 1}: ${lines[i].trim().substring(0, 100)}`);
                    if (results.length >= 50) break;
                  }
                }
              } catch {
                // Skip files that can't be read
              }
            }
          }
        }
      } catch {
        // Skip directories that can't be read
      }
    }

    await searchDir(workspaceFolder);

    if (results.length === 0) {
      return { success: true, output: `No matches found for "${query}"` };
    }

    return { success: true, output: results.join('\n') };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Run command tool - executes shell commands in the terminal
 */
async function toolRunCommand(params: Record<string, string>): Promise<ToolResult> {
  const { command } = params;
  if (!command) {
    return { success: false, output: '', error: 'Missing command parameter' };
  }

  // Safety check - block dangerous commands
  const dangerousPatterns = [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf *',
    'sudo rm',
    'chmod 777 /',
    '> /dev/sda',
    'mkfs.',
    'dd if=',
    ':(){:|:&};:',
    'wget | sh',
    'curl | sh',
  ];

  for (const pattern of dangerousPatterns) {
    if (command.includes(pattern)) {
      return {
        success: false,
        output: '',
        error: `Blocked potentially dangerous command: ${command}`,
      };
    }
  }

  try {
    // Execute in terminal (creates new terminal for agent commands)
    await executeInTerminal(command, true);

    return {
      success: true,
      output: `Command executed in terminal: ${command}\n(Check terminal for output)`,
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Ask user tool
 */
async function toolAskUser(
  params: Record<string, string>,
  quickInputService: IQuickInputService | null
): Promise<ToolResult> {
  const { question } = params;
  if (!question) {
    return { success: false, output: '', error: 'Missing question parameter' };
  }

  if (!quickInputService) {
    return { success: false, output: '', error: 'Quick input service not available' };
  }

  try {
    const response = await quickInputService.input({
      prompt: question,
      placeHolder: 'Enter your response',
    });

    if (!response) {
      return { success: false, output: '', error: 'User cancelled' };
    }

    return { success: true, output: response };
  } catch {
    return { success: false, output: '', error: 'Failed to get user input' };
  }
}

/**
 * Execute a tool call
 */
async function executeTool(
  toolCall: ToolCall,
  quickInputService: IQuickInputService | null
): Promise<ToolResult> {
  console.log('[AgentMode] Executing tool:', toolCall.tool, toolCall.params);

  switch (toolCall.tool) {
    case 'read_file':
      return toolReadFile(toolCall.params);
    case 'write_file':
      return toolWriteFile(toolCall.params);
    case 'list_directory':
      return toolListDirectory(toolCall.params);
    case 'search_files':
      return toolSearchFiles(toolCall.params);
    case 'run_command':
      return toolRunCommand(toolCall.params);
    case 'ask_user':
      return toolAskUser(toolCall.params, quickInputService);
    case 'complete':
      return { success: true, output: toolCall.params.summary || 'Task completed' };
    default:
      return { success: false, output: '', error: `Unknown tool: ${toolCall.tool}` };
  }
}

// ============================================================================
// Agent Loop
// ============================================================================

/**
 * Parse tool call from LLM response
 */
function parseToolCall(response: string): ToolCall | null {
  // Look for tool call in format:
  // TOOL: tool_name
  // PARAMS:
  // param1: value1
  // param2: value2
  // REASONING: why this tool is being called

  const toolMatch = response.match(/TOOL:\s*(\w+)/i);
  if (!toolMatch) {
    return null;
  }

  const tool = toolMatch[1].toLowerCase() as ToolName;
  const validTools: ToolName[] = [
    'read_file',
    'write_file',
    'list_directory',
    'search_files',
    'run_command',
    'ask_user',
    'complete',
  ];

  if (!validTools.includes(tool)) {
    return null;
  }

  // Parse parameters
  const params: Record<string, string> = {};
  const paramsSection = response.match(/PARAMS:\s*([\s\S]*?)(?=REASONING:|$)/i);

  if (paramsSection) {
    const paramLines = paramsSection[1].split('\n');
    for (const line of paramLines) {
      const paramMatch = line.match(/^\s*(\w+):\s*(.+)$/);
      if (paramMatch) {
        params[paramMatch[1]] = paramMatch[2].trim();
      }
    }
  }

  // Handle multi-line content parameter (for write_file)
  if (tool === 'write_file') {
    const contentMatch = response.match(/content:\s*```[\w]*\n?([\s\S]*?)```/i);
    if (contentMatch) {
      params.content = contentMatch[1].trim();
    }
  }

  // Parse reasoning
  const reasoningMatch = response.match(/REASONING:\s*(.+)/i);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : '';

  return { tool, params, reasoning };
}

/**
 * Build conversation context for the agent
 */
function buildAgentContext(session: AgentSession): string {
  const workspaceFolder = getWorkspaceFolder() || '(no workspace)';

  let context = `You are an AI coding assistant executing a task autonomously.

TASK: ${session.task}

WORKSPACE: ${workspaceFolder}

${TOOL_DEFINITIONS}

INSTRUCTIONS:
1. Analyze the task and decide which tool to use
2. Execute one tool at a time
3. After each tool result, decide the next action
4. If you encounter an error, try to fix it
5. When done, use the complete tool with a summary

OUTPUT FORMAT (required):
TOOL: <tool_name>
PARAMS:
<param>: <value>
REASONING: <why you're using this tool>

For write_file with code content:
TOOL: write_file
PARAMS:
path: <file_path>
content: \`\`\`<language>
<code content here>
\`\`\`
REASONING: <explanation>
`;

  // Add execution history
  if (session.steps.length > 0) {
    context += '\n\nEXECUTION HISTORY:\n';
    for (const step of session.steps) {
      context += `\nStep ${step.id}: ${step.toolCall.tool}`;
      if (step.toolCall.params.path) {
        context += ` (${step.toolCall.params.path})`;
      }
      if (step.result) {
        if (step.result.success) {
          const output = step.result.output.substring(0, 500);
          context += `\nResult: Success\n${output}${step.result.output.length > 500 ? '...[truncated]' : ''}`;
        } else {
          context += `\nResult: Failed - ${step.result.error}`;
        }
      }
      context += '\n';
    }
    context += '\nContinue with the next step:';
  }

  return context;
}

/**
 * Get next action from LLM
 */
async function getNextAction(session: AgentSession): Promise<ToolCall | null> {
  const provider = getActiveModelProvider();

  if (!provider || !provider.isAuthenticated()) {
    console.log('[AgentMode] No authenticated model provider');
    return null;
  }

  const context = buildAgentContext(session);
  let result = '';
  let hasError = false;

  const callbacks: StreamingCallbacks = {
    onToken: (chunk: string) => {
      result += chunk;
    },
    onComplete: () => {},
    onError: (error: Error) => {
      console.error('[AgentMode] Provider error:', error.message);
      hasError = true;
    },
  };

  try {
    await provider.getCompletion([{ role: 'user', content: context }], callbacks);
  } catch (error) {
    console.error('[AgentMode] Request failed:', error);
    return null;
  }

  if (hasError) {
    return null;
  }

  return parseToolCall(result);
}

/**
 * Run the agent loop
 */
export async function runAgentLoop(
  task: string,
  onProgress: (message: string, step?: AgentStep) => void,
  quickInputService: IQuickInputService | null
): Promise<AgentSession> {
  // Create session
  const session: AgentSession = {
    id: `agent-${Date.now()}`,
    task,
    status: 'running',
    steps: [],
    startedAt: Date.now(),
  };

  currentSession = session;
  sessionCancelled = false;

  onProgress(`Starting agent for task: ${task}`);
  console.log('[AgentMode] Starting session:', session.id);

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // Check for cancellation
      if (sessionCancelled) {
        session.status = 'cancelled';
        session.summary = 'Cancelled by user';
        onProgress('Agent cancelled by user');
        break;
      }

      // Get next action from LLM
      onProgress(`Thinking... (step ${iteration + 1})`);
      const toolCall = await getNextAction(session);

      if (!toolCall) {
        session.status = 'failed';
        session.summary = 'Failed to determine next action';
        onProgress('Error: Failed to determine next action');
        break;
      }

      // Create step
      const step: AgentStep = {
        id: session.steps.length + 1,
        toolCall,
        result: null,
        timestamp: Date.now(),
      };

      onProgress(`Step ${step.id}: ${toolCall.tool} - ${toolCall.reasoning}`);

      // Check for completion
      if (toolCall.tool === 'complete') {
        step.result = { success: true, output: toolCall.params.summary || 'Task completed' };
        session.steps.push(step);
        session.status = 'completed';
        session.summary = toolCall.params.summary || 'Task completed successfully';
        session.completedAt = Date.now();
        onProgress(`Completed: ${session.summary}`, step);
        break;
      }

      // Execute tool
      const result = await executeTool(toolCall, quickInputService);
      step.result = result;
      session.steps.push(step);

      if (result.success) {
        onProgress(`Step ${step.id} succeeded: ${result.output.substring(0, 200)}`, step);
      } else {
        onProgress(`Step ${step.id} failed: ${result.error}`, step);
        // Don't fail the whole session - let the agent try to recover
      }

      // Small delay to prevent rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Check if we hit max iterations
    if (session.status === 'running') {
      session.status = 'failed';
      session.summary = 'Reached maximum iteration limit';
      onProgress('Error: Reached maximum iteration limit');
    }
  } catch (error) {
    console.error('[AgentMode] Agent loop error:', error);
    session.status = 'failed';
    session.summary = `Error: ${error instanceof Error ? error.message : String(error)}`;
    onProgress(`Error: ${session.summary}`);
  }

  session.completedAt = Date.now();
  currentSession = null;

  return session;
}

/**
 * Cancel the current agent session
 */
export function cancelAgent(): void {
  if (currentSession) {
    sessionCancelled = true;
    console.log('[AgentMode] Cancellation requested');
  }
}

/**
 * Get the current agent session
 */
export function getCurrentAgentSession(): AgentSession | null {
  return currentSession;
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Agent Mode Action - Ctrl+Shift+A to start agent
 */
class AgentModeAction extends Action2 {
  constructor() {
    super({
      id: 'blink.agentMode',
      title: { value: 'AI: Start Agent', original: 'AI: Start Agent' },
      category: { value: 'AI', original: 'AI' },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA,
      },
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const quickInputService = accessor.get(IQuickInputService);
    const notificationService = accessor.get(INotificationService);

    // Check if agent is already running
    if (currentSession) {
      notificationService.notify({
        severity: Severity.Warning,
        message: 'An agent is already running. Cancel it first with Ctrl+Shift+C.',
      });
      return;
    }

    // Get task from user
    const task = await quickInputService.input({
      placeHolder: 'Describe what you want the agent to do',
      prompt: 'Agent Mode - Enter your task',
    });

    if (!task) {
      return;
    }

    notificationService.notify({
      severity: Severity.Info,
      message: 'Agent started. Use Ctrl+Shift+C to cancel.',
    });

    // Run agent
    const session = await runAgentLoop(
      task,
      (message) => {
        console.log('[AgentMode]', message);
        // Could show in output panel or status bar
      },
      quickInputService
    );

    // Show result
    if (session.status === 'completed') {
      notificationService.notify({
        severity: Severity.Info,
        message: `Agent completed: ${session.summary}`,
      });
    } else if (session.status === 'cancelled') {
      notificationService.notify({
        severity: Severity.Warning,
        message: 'Agent cancelled.',
      });
    } else {
      notificationService.notify({
        severity: Severity.Error,
        message: `Agent failed: ${session.summary}`,
      });
    }
  }
}

/**
 * Cancel Agent Action - Ctrl+Shift+C
 */
class CancelAgentAction extends Action2 {
  constructor() {
    super({
      id: 'blink.cancelAgent',
      title: { value: 'AI: Cancel Agent', original: 'AI: Cancel Agent' },
      category: { value: 'AI', original: 'AI' },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
      },
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const notificationService = accessor.get(INotificationService);

    if (!currentSession) {
      notificationService.notify({
        severity: Severity.Info,
        message: 'No agent running.',
      });
      return;
    }

    cancelAgent();
    notificationService.notify({
      severity: Severity.Info,
      message: 'Cancelling agent...',
    });
  }
}

// ============================================================================
// Chat Integration
// ============================================================================

/**
 * Run agent from chat (/agent slash command)
 */
export async function runAgentFromChat(
  task: string,
  onProgress: (message: string) => void
): Promise<AgentSession> {
  return runAgentLoop(task, onProgress, null);
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register agent mode commands
 * Call this from workbench.ts after initialization
 */
export function registerAgentMode(): IDisposable {
  // Dispose existing registrations
  disposeAgentMode();

  // Register actions
  const agentDisposable = registerAction2(AgentModeAction);
  disposables.push(agentDisposable);

  const cancelDisposable = registerAction2(CancelAgentAction);
  disposables.push(cancelDisposable);

  console.log('[AgentMode] Commands registered (Start: Ctrl+Shift+A, Cancel: Ctrl+Shift+C)');

  // Expose for testing
  (window as any).__AGENT_MODE_REGISTERED__ = true;
  (window as any).__RUN_AGENT__ = runAgentFromChat;
  (window as any).__CANCEL_AGENT__ = cancelAgent;
  (window as any).__GET_AGENT_SESSION__ = getCurrentAgentSession;

  return {
    dispose: disposeAgentMode,
  };
}

/**
 * Dispose agent mode resources
 */
export function disposeAgentMode(): void {
  // Cancel any running session
  if (currentSession) {
    cancelAgent();
    currentSession = null;
  }

  for (const d of disposables) {
    try {
      d.dispose();
    } catch {
      // Ignore disposal errors
    }
  }
  disposables.length = 0;
  (window as any).__AGENT_MODE_REGISTERED__ = false;
  console.log('[AgentMode] Disposed');
}
