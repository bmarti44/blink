/**
 * Terminal AI Service
 *
 * Converts natural language to shell commands and executes them in the terminal.
 * Users describe what they want to do, and the AI generates the appropriate command.
 *
 * P1 Feature - Terminal AI commands
 *
 * Features:
 *   - Natural language to shell command translation
 *   - Command preview before execution
 *   - Execute in active or new terminal
 *   - Command history for learning
 */

import { registerAction2, Action2 } from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions';
import { KeyCode, KeyMod } from '@codingame/monaco-vscode-api/vscode/vs/base/common/keyCodes';
import { KeybindingWeight } from '@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry';
import type { ServicesAccessor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { IQuickInputService } from '@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service';
import { INotificationService } from '@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service';
import { ITerminalService } from '@codingame/monaco-vscode-terminal-service-override';
import { getService } from '@codingame/monaco-vscode-api/services';
import Severity from '@codingame/monaco-vscode-api/vscode/vs/base/common/severity';
import { getActiveModelProvider, type StreamingCallbacks } from './ai/index';

// Track disposables for cleanup
const disposables: IDisposable[] = [];

// ============================================================================
// Command Generation
// ============================================================================

/**
 * Get the current operating system for context
 */
function getOSContext(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) return 'macOS';
  if (platform.includes('win')) return 'Windows';
  if (platform.includes('linux')) return 'Linux';
  return 'Unix-like';
}

/**
 * Get current working directory from localStorage
 */
function getCurrentWorkingDirectory(): string {
  return localStorage.getItem('blink-workspace-folder') || '~';
}

/**
 * Generate a shell command from natural language
 */
async function generateShellCommand(
  naturalLanguage: string,
  onProgress?: (partial: string) => void
): Promise<string | null> {
  const provider = getActiveModelProvider();

  if (!provider) {
    console.log('[TerminalAI] No model provider configured');
    return null;
  }

  if (!provider.isAuthenticated()) {
    console.log('[TerminalAI] Model provider not authenticated');
    return null;
  }

  const os = getOSContext();
  const cwd = getCurrentWorkingDirectory();

  const prompt = `You are a shell command expert. Convert the following natural language request into a shell command.

Operating System: ${os}
Current Directory: ${cwd}
Shell: ${os === 'Windows' ? 'PowerShell' : 'bash/zsh'}

IMPORTANT RULES:
1. Output ONLY the command, nothing else
2. No explanations, no markdown, no code blocks
3. Use appropriate flags for the OS
4. If the request is dangerous (rm -rf /, format disk, etc.), output: DANGEROUS: <reason>
5. If the request is unclear, output: UNCLEAR: <what's needed>
6. For complex operations, you may output multiple commands separated by && or ;

User Request: ${naturalLanguage}

Command:`;

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
      console.error('[TerminalAI] Provider error:', error.message);
      hasError = true;
    },
  };

  try {
    await provider.getCompletion([{ role: 'user', content: prompt }], callbacks);
  } catch (error) {
    console.error('[TerminalAI] Request failed:', error);
    return null;
  }

  if (hasError) {
    return null;
  }

  // Clean up the result
  result = result.trim();

  // Remove any markdown code blocks if present
  result = result.replace(/^```[\w]*\n?/g, '').replace(/\n?```$/g, '');

  // Remove common prefixes
  result = result.replace(/^(Command:|Output:|Result:)\s*/i, '');

  return result.trim();
}

/**
 * Check if a command is marked as dangerous
 */
function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  if (command.startsWith('DANGEROUS:')) {
    return { dangerous: true, reason: command.replace('DANGEROUS:', '').trim() };
  }

  // Additional safety checks
  const dangerousPatterns = [
    /rm\s+(-rf?|--recursive)\s+[\/~]/i,
    /rm\s+-rf?\s+\*/i,
    /mkfs\./i,
    /dd\s+if=.*of=\/dev/i,
    /:\(\)\{\s*:\|:\s*&\s*\};:/,  // Fork bomb
    /chmod\s+-R\s+777\s+\//i,
    />\s*\/dev\/sd[a-z]/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return { dangerous: true, reason: 'This command could cause system damage' };
    }
  }

  return { dangerous: false };
}

/**
 * Check if command is unclear
 */
function isUnclearCommand(command: string): { unclear: boolean; reason?: string } {
  if (command.startsWith('UNCLEAR:')) {
    return { unclear: true, reason: command.replace('UNCLEAR:', '').trim() };
  }
  return { unclear: false };
}

// ============================================================================
// Terminal Execution
// ============================================================================

/**
 * Execute a command in the terminal
 * Exported for use by Agent Mode and other services
 */
export async function executeInTerminal(command: string, createNew: boolean = false): Promise<void> {
  try {
    const terminalService = await getService(ITerminalService);

    let terminal;

    if (createNew || !terminalService.activeInstance) {
      // Create a new terminal with config for the name
      terminal = await terminalService.createTerminal({
        config: {
          name: 'AI Command',
        },
      });
    } else {
      // Use the active terminal
      terminal = terminalService.activeInstance;
    }

    // Focus the terminal
    terminalService.setActiveInstance(terminal);
    await terminalService.focusActiveInstance();

    // Send the command (the terminal will execute it)
    terminal.sendText(command, true);

    console.log('[TerminalAI] Command executed:', command);
  } catch (error) {
    console.error('[TerminalAI] Failed to execute in terminal:', error);
    throw error;
  }
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Terminal AI Action - Ctrl+Shift+` to generate and run shell commands
 */
class TerminalAIAction extends Action2 {
  constructor() {
    super({
      id: 'blink.terminalAI',
      title: { value: 'AI: Generate Shell Command', original: 'AI: Generate Shell Command' },
      category: { value: 'Terminal', original: 'Terminal' },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Backquote,
      },
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const quickInputService = accessor.get(IQuickInputService);
    const notificationService = accessor.get(INotificationService);

    // Get natural language input from user
    const input = await quickInputService.input({
      placeHolder: 'Describe what you want to do (e.g., "find all .ts files modified today")',
      prompt: 'AI Terminal - Describe the command you need',
    });

    if (!input) {
      return; // User cancelled
    }

    // Show generating notification
    const handle = notificationService.notify({
      severity: Severity.Info,
      message: 'Generating command...',
    });

    try {
      // Generate the shell command
      const command = await generateShellCommand(input);

      handle.close();

      if (!command) {
        notificationService.notify({
          severity: Severity.Error,
          message: 'Failed to generate command. Check AI provider authentication.',
        });
        return;
      }

      // Check for dangerous command
      const { dangerous, reason: dangerReason } = isDangerousCommand(command);
      if (dangerous) {
        notificationService.notify({
          severity: Severity.Warning,
          message: `Dangerous command blocked: ${dangerReason}`,
        });
        return;
      }

      // Check for unclear request
      const { unclear, reason: unclearReason } = isUnclearCommand(command);
      if (unclear) {
        notificationService.notify({
          severity: Severity.Info,
          message: `Need more info: ${unclearReason}`,
        });
        return;
      }

      // Show command preview and ask for confirmation
      const choice = await quickInputService.pick(
        [
          { label: '$(terminal) Run in Terminal', description: command, id: 'run' },
          { label: '$(terminal-new) Run in New Terminal', description: command, id: 'run-new' },
          { label: '$(copy) Copy to Clipboard', description: 'Copy command without running', id: 'copy' },
          { label: '$(edit) Edit Command', description: 'Modify before running', id: 'edit' },
          { label: '$(close) Cancel', id: 'cancel' },
        ],
        {
          placeHolder: `Generated: ${command}`,
          title: 'AI Terminal Command',
        }
      );

      if (!choice || choice.id === 'cancel') {
        return;
      }

      let finalCommand = command;

      if (choice.id === 'edit') {
        // Let user edit the command
        const edited = await quickInputService.input({
          value: command,
          prompt: 'Edit the command before running',
        });

        if (!edited) {
          return;
        }

        finalCommand = edited;

        // Re-check edited command for safety
        const { dangerous: editDangerous } = isDangerousCommand(finalCommand);
        if (editDangerous) {
          notificationService.notify({
            severity: Severity.Warning,
            message: 'Edited command appears dangerous and was blocked.',
          });
          return;
        }
      }

      if (choice.id === 'copy') {
        // Copy to clipboard
        await navigator.clipboard.writeText(finalCommand);
        notificationService.notify({
          severity: Severity.Info,
          message: 'Command copied to clipboard.',
        });
        return;
      }

      // Execute in terminal
      await executeInTerminal(finalCommand, choice.id === 'run-new');

      notificationService.notify({
        severity: Severity.Info,
        message: 'Command sent to terminal.',
      });
    } catch (error) {
      handle.close();
      console.error('[TerminalAI] Error:', error);
      notificationService.notify({
        severity: Severity.Error,
        message: 'Failed to process command.',
      });
    }
  }
}

/**
 * Quick Terminal AI Action - For chat slash command integration
 */
export async function runTerminalAIFromChat(
  naturalLanguage: string,
  executeImmediately: boolean = false
): Promise<{ command: string | null; executed: boolean }> {
  const command = await generateShellCommand(naturalLanguage);

  if (!command) {
    return { command: null, executed: false };
  }

  const { dangerous } = isDangerousCommand(command);
  if (dangerous) {
    return { command: `[BLOCKED] ${command}`, executed: false };
  }

  const { unclear } = isUnclearCommand(command);
  if (unclear) {
    return { command, executed: false };
  }

  if (executeImmediately) {
    try {
      await executeInTerminal(command, false);
      return { command, executed: true };
    } catch {
      return { command, executed: false };
    }
  }

  return { command, executed: false };
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register terminal AI commands
 * Call this from workbench.ts after initialization
 */
export function registerTerminalAI(): IDisposable {
  // Dispose existing registrations
  disposeTerminalAI();

  // Register the action
  const actionDisposable = registerAction2(TerminalAIAction);
  disposables.push(actionDisposable);

  console.log('[TerminalAI] Commands registered (Ctrl+Shift+`)');

  // Expose for testing
  (window as any).__TERMINAL_AI_REGISTERED__ = true;
  (window as any).__RUN_TERMINAL_AI__ = runTerminalAIFromChat;

  return {
    dispose: disposeTerminalAI,
  };
}

/**
 * Dispose terminal AI resources
 */
export function disposeTerminalAI(): void {
  for (const d of disposables) {
    try {
      d.dispose();
    } catch {
      // Ignore disposal errors
    }
  }
  disposables.length = 0;
  (window as any).__TERMINAL_AI_REGISTERED__ = false;
  console.log('[TerminalAI] Disposed');
}
