/**
 * Plan Mode Service
 *
 * Enables "strategy first" approach where the AI outlines its plan
 * before making changes. Users can review, approve, or modify the plan.
 *
 * P1 Feature - Plan Mode (Strategy First)
 *
 * Features:
 *   - Plan generation from natural language requests
 *   - Step-by-step plan display in chat
 *   - Plan approval/rejection workflow
 *   - Execute approved plans with diff preview
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
import { writeTextFile, readTextFile, remove, exists, mkdir } from '@tauri-apps/plugin-fs';
import { join, dirname } from '@tauri-apps/api/path';
import { showDiffReview } from './diffReview';
import { runTerminalAIFromChat } from './terminalAI';

// Track disposables for cleanup
const disposables: IDisposable[] = [];

// ============================================================================
// Types
// ============================================================================

export interface PlanStep {
  id: number;
  action: 'create' | 'modify' | 'delete' | 'read' | 'run' | 'other';
  description: string;
  target?: string; // File path or command
  details?: string;
}

export interface Plan {
  id: string;
  title: string;
  summary: string;
  steps: PlanStep[];
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed';
  createdAt: number;
}

// Current plan state
let currentPlan: Plan | null = null;

// ============================================================================
// Plan Generation
// ============================================================================

/**
 * Get workspace context for planning
 */
function getWorkspaceContext(): string {
  const folder = localStorage.getItem('blink-workspace-folder') || '~';
  return `Current workspace: ${folder}`;
}

/**
 * Generate a plan from natural language request
 */
async function generatePlan(
  request: string,
  onProgress?: (partial: string) => void
): Promise<Plan | null> {
  const provider = getActiveModelProvider();

  if (!provider) {
    console.log('[PlanMode] No model provider configured');
    return null;
  }

  if (!provider.isAuthenticated()) {
    console.log('[PlanMode] Model provider not authenticated');
    return null;
  }

  const context = getWorkspaceContext();

  const prompt = `You are a software development planner. Analyze the following request and create a detailed action plan.

${context}

IMPORTANT RULES:
1. Output a structured plan in the following format:
   TITLE: <brief title for the plan>
   SUMMARY: <1-2 sentence summary>

   STEPS:
   1. [ACTION] Description
      TARGET: <file path or command if applicable>
      DETAILS: <additional details>
   2. [ACTION] Description
      ...

2. ACTION types are: CREATE, MODIFY, DELETE, READ, RUN, OTHER
3. Be specific about file paths and what changes will be made
4. For code changes, describe the modification clearly
5. If the request is unclear, ask for clarification in the SUMMARY
6. Keep the plan concise but complete

User Request: ${request}

Plan:`;

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
      console.error('[PlanMode] Provider error:', error.message);
      hasError = true;
    },
  };

  try {
    await provider.getCompletion([{ role: 'user', content: prompt }], callbacks);
  } catch (error) {
    console.error('[PlanMode] Request failed:', error);
    return null;
  }

  if (hasError) {
    return null;
  }

  return parsePlanResponse(result.trim());
}

/**
 * Parse the AI response into a structured plan
 */
function parsePlanResponse(response: string): Plan {
  const plan: Plan = {
    id: `plan-${Date.now()}`,
    title: 'Untitled Plan',
    summary: '',
    steps: [],
    status: 'pending',
    createdAt: Date.now(),
  };

  const lines = response.split('\n');
  let currentStep: Partial<PlanStep> | null = null;
  let stepId = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Parse title
    if (trimmed.startsWith('TITLE:')) {
      plan.title = trimmed.substring(6).trim();
      continue;
    }

    // Parse summary
    if (trimmed.startsWith('SUMMARY:')) {
      plan.summary = trimmed.substring(8).trim();
      continue;
    }

    // Parse step
    const stepMatch = trimmed.match(/^(\d+)\.\s*\[(\w+)\]\s*(.+)$/);
    if (stepMatch) {
      // Save previous step
      if (currentStep && currentStep.description) {
        plan.steps.push(currentStep as PlanStep);
      }

      stepId++;
      const actionType = stepMatch[2].toLowerCase() as PlanStep['action'];
      currentStep = {
        id: stepId,
        action: ['create', 'modify', 'delete', 'read', 'run'].includes(actionType)
          ? actionType as PlanStep['action']
          : 'other',
        description: stepMatch[3].trim(),
      };
      continue;
    }

    // Parse target
    if (trimmed.startsWith('TARGET:') && currentStep) {
      currentStep.target = trimmed.substring(7).trim();
      continue;
    }

    // Parse details
    if (trimmed.startsWith('DETAILS:') && currentStep) {
      currentStep.details = trimmed.substring(8).trim();
      continue;
    }
  }

  // Save last step
  if (currentStep && currentStep.description) {
    plan.steps.push(currentStep as PlanStep);
  }

  // If no structured content was parsed, use the response as summary
  if (!plan.summary && plan.steps.length === 0) {
    plan.summary = response;
    plan.steps.push({
      id: 1,
      action: 'other',
      description: 'Review the AI response above',
    });
  }

  return plan;
}

/**
 * Format a plan for display
 */
export function formatPlanForDisplay(plan: Plan): string {
  const lines: string[] = [];

  lines.push(`## ${plan.title}`);
  lines.push('');
  lines.push(`*${plan.summary}*`);
  lines.push('');
  lines.push('### Steps:');
  lines.push('');

  for (const step of plan.steps) {
    const icon = getStepIcon(step.action);
    lines.push(`${step.id}. ${icon} **[${step.action.toUpperCase()}]** ${step.description}`);
    if (step.target) {
      lines.push(`   - Target: \`${step.target}\``);
    }
    if (step.details) {
      lines.push(`   - ${step.details}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get icon for step action type
 */
function getStepIcon(action: PlanStep['action']): string {
  switch (action) {
    case 'create': return '➕';
    case 'modify': return '✏️';
    case 'delete': return '🗑️';
    case 'read': return '📖';
    case 'run': return '▶️';
    default: return '📋';
  }
}

// ============================================================================
// Plan Execution
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
 * Generate file content using AI
 */
async function generateFileContent(
  description: string,
  filePath: string,
  existingContent?: string
): Promise<string | null> {
  const provider = getActiveModelProvider();
  if (!provider || !provider.isAuthenticated()) {
    return null;
  }

  const fileExt = filePath.split('.').pop() || '';
  const language = getLanguageFromExt(fileExt);

  let prompt: string;
  if (existingContent) {
    prompt = `You are a code assistant. Modify the following ${language} file according to the instruction.
IMPORTANT: Output ONLY the complete modified file content. No explanations, no markdown.

File: ${filePath}

Current content:
\`\`\`${language}
${existingContent}
\`\`\`

Instruction: ${description}

Modified file content:`;
  } else {
    prompt = `You are a code assistant. Create a new ${language} file according to the instruction.
IMPORTANT: Output ONLY the file content. No explanations, no markdown.

File to create: ${filePath}

Instruction: ${description}

File content:`;
  }

  let result = '';
  let hasError = false;

  const callbacks: StreamingCallbacks = {
    onToken: (chunk: string) => {
      result += chunk;
    },
    onComplete: () => {},
    onError: () => {
      hasError = true;
    },
  };

  try {
    await provider.getCompletion([{ role: 'user', content: prompt }], callbacks);
  } catch {
    return null;
  }

  if (hasError) return null;

  // Clean up markdown code blocks
  let cleaned = result.trim();
  cleaned = cleaned.replace(/^```[\w]*\n?/g, '');
  cleaned = cleaned.replace(/\n?```$/g, '');

  return cleaned;
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

/**
 * Execute a single plan step
 */
async function executeStep(
  step: PlanStep,
  onProgress: (message: string) => void
): Promise<boolean> {
  onProgress(`Executing step ${step.id}: ${step.description}`);
  console.log('[PlanMode] Executing step:', step);

  try {
    switch (step.action) {
      case 'create': {
        if (!step.target) {
          onProgress(`Step ${step.id}: No target file specified for CREATE`);
          return false;
        }

        const filePath = await resolveFilePath(step.target);

        // Check if file already exists
        const fileExists = await exists(filePath);
        if (fileExists) {
          onProgress(`Step ${step.id}: File already exists: ${step.target}`);
          // Continue anyway - will overwrite
        }

        // Ensure parent directory exists
        const parentDir = await dirname(filePath);
        const dirExists = await exists(parentDir);
        if (!dirExists) {
          await mkdir(parentDir, { recursive: true });
          onProgress(`Created directory: ${parentDir}`);
        }

        // Generate content
        const content = await generateFileContent(step.description, step.target);
        if (!content) {
          onProgress(`Step ${step.id}: Failed to generate file content`);
          return false;
        }

        // Show diff review for new file (empty vs new content)
        const accepted = await showDiffReview(
          '',
          content,
          step.target,
          `Create: ${step.target}`
        );

        if (!accepted) {
          onProgress(`Step ${step.id}: File creation rejected by user`);
          return false;
        }

        // Write file
        await writeTextFile(filePath, content);
        onProgress(`Created file: ${step.target}`);
        return true;
      }

      case 'modify': {
        if (!step.target) {
          onProgress(`Step ${step.id}: No target file specified for MODIFY`);
          return false;
        }

        const filePath = await resolveFilePath(step.target);

        // Read existing content
        const fileExists = await exists(filePath);
        if (!fileExists) {
          onProgress(`Step ${step.id}: File not found: ${step.target}`);
          return false;
        }

        const originalContent = await readTextFile(filePath);

        // Generate modified content
        const newContent = await generateFileContent(
          step.description,
          step.target,
          originalContent
        );

        if (!newContent) {
          onProgress(`Step ${step.id}: Failed to generate modified content`);
          return false;
        }

        // Check if content actually changed
        if (newContent.trim() === originalContent.trim()) {
          onProgress(`Step ${step.id}: No changes needed`);
          return true;
        }

        // Show diff review
        const accepted = await showDiffReview(
          originalContent,
          newContent,
          step.target,
          `Modify: ${step.description}`
        );

        if (!accepted) {
          onProgress(`Step ${step.id}: Modification rejected by user`);
          return false;
        }

        // Write modified content
        await writeTextFile(filePath, newContent);
        onProgress(`Modified file: ${step.target}`);
        return true;
      }

      case 'delete': {
        if (!step.target) {
          onProgress(`Step ${step.id}: No target file specified for DELETE`);
          return false;
        }

        const filePath = await resolveFilePath(step.target);

        // Check if file exists
        const fileExists = await exists(filePath);
        if (!fileExists) {
          onProgress(`Step ${step.id}: File not found: ${step.target}`);
          return true; // Consider it success if already deleted
        }

        // Read content for diff review
        const content = await readTextFile(filePath);

        // Show diff review (content vs empty)
        const accepted = await showDiffReview(
          content,
          '',
          step.target,
          `Delete: ${step.target}`
        );

        if (!accepted) {
          onProgress(`Step ${step.id}: Deletion rejected by user`);
          return false;
        }

        // Delete file
        await remove(filePath);
        onProgress(`Deleted file: ${step.target}`);
        return true;
      }

      case 'run': {
        // Use terminal AI to generate and run command
        const description = step.target || step.description;
        onProgress(`Generating command for: ${description}`);

        const result = await runTerminalAIFromChat(description, false);

        if (!result.command) {
          onProgress(`Step ${step.id}: Failed to generate command`);
          return false;
        }

        if (result.command.startsWith('[BLOCKED]')) {
          onProgress(`Step ${step.id}: Command blocked for safety: ${result.command}`);
          return false;
        }

        onProgress(`Generated command: ${result.command}`);
        onProgress(`(Command execution in terminal - check terminal for results)`);
        return true;
      }

      case 'read': {
        if (!step.target) {
          onProgress(`Step ${step.id}: No target file specified for READ`);
          return false;
        }

        const filePath = await resolveFilePath(step.target);

        const fileExists = await exists(filePath);
        if (!fileExists) {
          onProgress(`Step ${step.id}: File not found: ${step.target}`);
          return false;
        }

        const content = await readTextFile(filePath);
        onProgress(`Read file: ${step.target} (${content.length} bytes)`);
        return true;
      }

      case 'other':
      default:
        onProgress(`Step ${step.id}: Manual step - ${step.description}`);
        return true;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    onProgress(`Step ${step.id} failed: ${errorMessage}`);
    console.error('[PlanMode] Step execution error:', error);
    return false;
  }
}

/**
 * Execute the current plan
 */
export async function executePlan(
  plan: Plan,
  onProgress: (message: string) => void
): Promise<boolean> {
  if (plan.status !== 'approved') {
    console.error('[PlanMode] Cannot execute unapproved plan');
    return false;
  }

  plan.status = 'executing';
  currentPlan = plan;

  try {
    for (const step of plan.steps) {
      const success = await executeStep(step, onProgress);
      if (!success) {
        onProgress(`Step ${step.id} failed`);
        return false;
      }
    }

    plan.status = 'completed';
    onProgress('Plan completed successfully!');
    return true;
  } catch (error) {
    console.error('[PlanMode] Execution error:', error);
    onProgress(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Plan Mode Action - Ctrl+Shift+P to enter plan mode
 */
class PlanModeAction extends Action2 {
  constructor() {
    super({
      id: 'blink.planMode',
      title: { value: 'AI: Plan Mode', original: 'AI: Plan Mode' },
      category: { value: 'AI', original: 'AI' },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP,
      },
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const quickInputService = accessor.get(IQuickInputService);
    const notificationService = accessor.get(INotificationService);

    // Get task description from user
    const input = await quickInputService.input({
      placeHolder: 'Describe what you want to accomplish',
      prompt: 'Plan Mode - What would you like to do?',
    });

    if (!input) {
      return; // User cancelled
    }

    // Show generating notification
    const handle = notificationService.notify({
      severity: Severity.Info,
      message: 'Generating plan...',
    });

    try {
      // Generate the plan
      const plan = await generatePlan(input);

      handle.close();

      if (!plan) {
        notificationService.notify({
          severity: Severity.Error,
          message: 'Failed to generate plan. Check AI provider authentication.',
        });
        return;
      }

      currentPlan = plan;

      // Show plan and ask for approval
      const formattedPlan = formatPlanForDisplay(plan);

      const choice = await quickInputService.pick(
        [
          { label: '$(check) Approve Plan', description: 'Execute this plan', id: 'approve' },
          { label: '$(edit) Modify Request', description: 'Change your request', id: 'modify' },
          { label: '$(copy) Copy Plan', description: 'Copy plan to clipboard', id: 'copy' },
          { label: '$(close) Cancel', id: 'cancel' },
        ],
        {
          placeHolder: plan.title,
          title: 'Review Plan',
        }
      );

      if (!choice || choice.id === 'cancel') {
        plan.status = 'rejected';
        return;
      }

      if (choice.id === 'copy') {
        await navigator.clipboard.writeText(formattedPlan);
        notificationService.notify({
          severity: Severity.Info,
          message: 'Plan copied to clipboard.',
        });
        return;
      }

      if (choice.id === 'modify') {
        // Re-run with modified input
        const newInput = await quickInputService.input({
          value: input,
          prompt: 'Modify your request',
        });

        if (newInput) {
          // Recursively generate new plan
          return this.run(accessor);
        }
        return;
      }

      // Approve and execute
      plan.status = 'approved';

      notificationService.notify({
        severity: Severity.Info,
        message: 'Executing plan...',
      });

      const success = await executePlan(plan, (message) => {
        console.log('[PlanMode]', message);
      });

      if (success) {
        notificationService.notify({
          severity: Severity.Info,
          message: 'Plan executed successfully!',
        });
      } else {
        notificationService.notify({
          severity: Severity.Warning,
          message: 'Plan execution completed with warnings.',
        });
      }
    } catch (error) {
      handle.close();
      console.error('[PlanMode] Error:', error);
      notificationService.notify({
        severity: Severity.Error,
        message: 'Failed to process plan.',
      });
    }
  }
}

// ============================================================================
// Chat Integration
// ============================================================================

/**
 * Generate a plan from chat (for /plan slash command)
 */
export async function runPlanFromChat(
  request: string
): Promise<{ plan: Plan | null; formatted: string | null }> {
  const plan = await generatePlan(request);

  if (!plan) {
    return { plan: null, formatted: null };
  }

  currentPlan = plan;
  const formatted = formatPlanForDisplay(plan);

  return { plan, formatted };
}

/**
 * Approve the current plan from chat
 */
export async function approvePlanFromChat(): Promise<boolean> {
  if (!currentPlan || currentPlan.status !== 'pending') {
    return false;
  }

  currentPlan.status = 'approved';
  return await executePlan(currentPlan, console.log);
}

/**
 * Get the current plan
 */
export function getCurrentPlan(): Plan | null {
  return currentPlan;
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register plan mode commands
 * Call this from workbench.ts after initialization
 */
export function registerPlanMode(): IDisposable {
  // Dispose existing registrations
  disposePlanMode();

  // Register the action
  const actionDisposable = registerAction2(PlanModeAction);
  disposables.push(actionDisposable);

  console.log('[PlanMode] Commands registered (Ctrl+Shift+P)');

  // Expose for testing
  (window as any).__PLAN_MODE_REGISTERED__ = true;
  (window as any).__RUN_PLAN_FROM_CHAT__ = runPlanFromChat;
  (window as any).__APPROVE_PLAN__ = approvePlanFromChat;
  (window as any).__GET_CURRENT_PLAN__ = getCurrentPlan;

  return {
    dispose: disposePlanMode,
  };
}

/**
 * Dispose plan mode resources
 */
export function disposePlanMode(): void {
  for (const d of disposables) {
    try {
      d.dispose();
    } catch {
      // Ignore disposal errors
    }
  }
  disposables.length = 0;
  (window as any).__PLAN_MODE_REGISTERED__ = false;
  console.log('[PlanMode] Disposed');
}
