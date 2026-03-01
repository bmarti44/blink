/**
 * AI Chat Agent for VS Code Chat Panel
 *
 * Registers Blink Code Assist as a chat agent in the VS Code auxiliary bar.
 * This replaces the default "Build with Agent" welcome message with Blink AI.
 */

import { getService } from '@codingame/monaco-vscode-api/services';
import { IChatAgentService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/chat/common/chatAgents.service';
import { IChatSlashCommandService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/chat/common/chatSlashCommands.service';
import { ChatAgentLocation } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/chat/common/constants';
import { ExtensionIdentifier } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions';
import type { CancellationToken } from '@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation';
import type {
  IChatAgentData,
  IChatAgentImplementation,
  IChatAgentRequest,
  IChatAgentResult,
  IChatAgentHistoryEntry,
} from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/chat/common/chatAgents';
import type { IChatProgress, IChatFollowup } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/chat/common/chatService';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { getAIService, isAIConfigured, promptConfigureAIProvider, type ConversationMessage } from './ai/chatService';
import { processMessageWithContext, type ContextMention } from './contextMentions';
import { runTerminalAIFromChat } from './terminalAI';
import { runPlanFromChat, approvePlanFromChat, getCurrentPlan } from './planMode';
import { runAgentFromChat, cancelAgent, getCurrentAgentSession } from './agentMode';
import { runComposerFromChat, applyComposerFromChat, getCurrentComposerSession } from './multiFileEdit';
import { handleRememberCommand, handleForgetCommand, handleRulesCommand, getContextForPrompt } from './persistentMemory';

const AGENT_ID = 'blink-code-assist';
const AGENT_NAME = 'Blink Code Assist';

/**
 * AI Chat Agent Implementation
 * Handles chat requests using Blink Code Assist
 */
class AIChatAgentImpl implements IChatAgentImplementation {
  private aiService = getAIService();
  private currentAbortController: AbortController | null = null;

  async invoke(
    request: IChatAgentRequest,
    progress: (parts: IChatProgress[]) => void,
    history: IChatAgentHistoryEntry[],
    token: CancellationToken
  ): Promise<IChatAgentResult> {
    console.log('[AI Agent] Invoke called with message:', request.message);

    // Handle /run slash command for terminal AI
    if (request.message.startsWith('/run ')) {
      const naturalLanguage = request.message.substring(5).trim();
      if (!naturalLanguage) {
        progress([{
          kind: 'markdownContent',
          content: { value: '**Usage:** `/run <description>`\n\nExample: `/run find all .ts files modified today`' },
        }]);
        return {};
      }

      progress([{
        kind: 'markdownContent',
        content: { value: `**Generating command for:** ${naturalLanguage}\n\n` },
      }]);

      try {
        const result = await runTerminalAIFromChat(naturalLanguage, false);

        if (!result.command) {
          progress([{
            kind: 'markdownContent',
            content: { value: '❌ Failed to generate command. Check AI provider authentication.\n\nUse `Ctrl+Shift+\\`` to configure providers.' },
          }]);
          return { errorDetails: { message: 'Failed to generate command' } };
        }

        if (result.command.startsWith('[BLOCKED]')) {
          progress([{
            kind: 'markdownContent',
            content: { value: `⚠️ **Dangerous command blocked**\n\n\`\`\`\n${result.command.replace('[BLOCKED] ', '')}\n\`\`\`\n\nThis command was blocked for safety reasons.` },
          }]);
          return {};
        }

        if (result.command.startsWith('UNCLEAR:')) {
          progress([{
            kind: 'markdownContent',
            content: { value: `❓ **Need more information**\n\n${result.command.replace('UNCLEAR:', '').trim()}` },
          }]);
          return {};
        }

        progress([{
          kind: 'markdownContent',
          content: { value: `**Generated command:**\n\`\`\`bash\n${result.command}\n\`\`\`\n\nUse \`Ctrl+Shift+\\\`\` to run this in the terminal, or copy and paste it.` },
        }]);

        return {};
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        progress([{
          kind: 'markdownContent',
          content: { value: `❌ Error generating command: ${errorMessage}` },
        }]);
        return { errorDetails: { message: errorMessage } };
      }
    }

    // Handle /plan slash command for strategy-first planning
    if (request.message.startsWith('/plan ')) {
      const planRequest = request.message.substring(6).trim();
      if (!planRequest) {
        progress([{
          kind: 'markdownContent',
          content: { value: '**Usage:** `/plan <what you want to accomplish>`\n\nExample: `/plan add user authentication to the app`' },
        }]);
        return {};
      }

      progress([{
        kind: 'markdownContent',
        content: { value: `**Creating plan for:** ${planRequest}\n\n` },
      }]);

      try {
        const result = await runPlanFromChat(planRequest);

        if (!result.plan || !result.formatted) {
          progress([{
            kind: 'markdownContent',
            content: { value: '❌ Failed to generate plan. Check AI provider authentication.' },
          }]);
          return { errorDetails: { message: 'Failed to generate plan' } };
        }

        progress([{
          kind: 'markdownContent',
          content: { value: result.formatted },
        }]);

        progress([{
          kind: 'markdownContent',
          content: { value: '\n\n---\n\nType `/approve` to execute this plan, or `/plan <new request>` to create a different plan.' },
        }]);

        return {};
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        progress([{
          kind: 'markdownContent',
          content: { value: `❌ Error generating plan: ${errorMessage}` },
        }]);
        return { errorDetails: { message: errorMessage } };
      }
    }

    // Handle /agent slash command for multi-step autonomous execution
    if (request.message.startsWith('/agent ')) {
      const agentTask = request.message.substring(7).trim();
      if (!agentTask) {
        progress([{
          kind: 'markdownContent',
          content: { value: '**Usage:** `/agent <task description>`\n\nExample: `/agent implement a function to validate email addresses`' },
        }]);
        return {};
      }

      // Check if an agent is already running
      if (getCurrentAgentSession()) {
        progress([{
          kind: 'markdownContent',
          content: { value: '⚠️ An agent is already running. Use `/cancel` to stop it first.' },
        }]);
        return {};
      }

      progress([{
        kind: 'markdownContent',
        content: { value: `**Starting agent for:** ${agentTask}\n\n*Use \`/cancel\` to stop the agent at any time.*\n\n---\n\n` },
      }]);

      try {
        const session = await runAgentFromChat(agentTask, (message) => {
          progress([{
            kind: 'markdownContent',
            content: { value: message + '\n' },
          }]);
        });

        progress([{
          kind: 'markdownContent',
          content: { value: `\n---\n\n**Agent ${session.status}**\n\n${session.summary || ''}` },
        }]);

        if (session.status === 'completed') {
          progress([{
            kind: 'markdownContent',
            content: { value: `\n\n*Completed ${session.steps.length} steps in ${((session.completedAt || Date.now()) - session.startedAt) / 1000}s*` },
          }]);
        }

        return {};
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        progress([{
          kind: 'markdownContent',
          content: { value: `❌ Agent error: ${errorMessage}` },
        }]);
        return { errorDetails: { message: errorMessage } };
      }
    }

    // Handle /cancel slash command for stopping agent
    if (request.message.trim() === '/cancel') {
      const session = getCurrentAgentSession();
      if (!session) {
        progress([{
          kind: 'markdownContent',
          content: { value: '❌ No agent running to cancel.' },
        }]);
        return {};
      }

      cancelAgent();
      progress([{
        kind: 'markdownContent',
        content: { value: '⏹️ Cancelling agent...' },
      }]);
      return {};
    }

    // Handle /compose slash command for multi-file editing
    if (request.message.startsWith('/compose ')) {
      const description = request.message.substring(9).trim();
      if (!description) {
        progress([{
          kind: 'markdownContent',
          content: { value: '**Usage:** `/compose <description of changes>`\n\nExample: `/compose add error handling to all API endpoints`' },
        }]);
        return {};
      }

      progress([{
        kind: 'markdownContent',
        content: { value: `**Multi-file Edit:** ${description}\n\n` },
      }]);

      try {
        const session = await runComposerFromChat(description, [], (message) => {
          progress([{
            kind: 'markdownContent',
            content: { value: message + '\n' },
          }]);
        });

        if (!session) {
          progress([{
            kind: 'markdownContent',
            content: { value: '❌ Failed to generate file changes.' },
          }]);
          return { errorDetails: { message: 'Failed to generate changes' } };
        }

        return {};
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        progress([{
          kind: 'markdownContent',
          content: { value: `❌ Composer error: ${errorMessage}` },
        }]);
        return { errorDetails: { message: errorMessage } };
      }
    }

    // Handle /apply slash command for applying composer changes
    if (request.message.trim() === '/apply') {
      const session = getCurrentComposerSession();
      if (!session) {
        progress([{
          kind: 'markdownContent',
          content: { value: '❌ No composer session active. Use `/compose <description>` first.' },
        }]);
        return {};
      }

      progress([{
        kind: 'markdownContent',
        content: { value: '**Applying changes...**\n\n' },
      }]);

      try {
        const success = await applyComposerFromChat((message) => {
          progress([{
            kind: 'markdownContent',
            content: { value: message + '\n' },
          }]);
        });

        if (success) {
          progress([{
            kind: 'markdownContent',
            content: { value: '✅ Changes applied successfully!' },
          }]);
        } else {
          progress([{
            kind: 'markdownContent',
            content: { value: '⚠️ Some changes were not applied.' },
          }]);
        }

        return {};
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        progress([{
          kind: 'markdownContent',
          content: { value: `❌ Apply error: ${errorMessage}` },
        }]);
        return { errorDetails: { message: errorMessage } };
      }
    }

    // Handle /remember slash command for persistent memory
    if (request.message.startsWith('/remember ')) {
      const content = request.message.substring(10).trim();
      const result = await handleRememberCommand(content);
      progress([{
        kind: 'markdownContent',
        content: { value: result },
      }]);
      return {};
    }

    // Handle /forget slash command to clear memory
    if (request.message.trim() === '/forget') {
      const result = await handleForgetCommand();
      progress([{
        kind: 'markdownContent',
        content: { value: result },
      }]);
      return {};
    }

    // Handle /rules slash command for project rules
    if (request.message.startsWith('/rules')) {
      const args = request.message.substring(6).trim() || undefined;
      const result = await handleRulesCommand(args);
      progress([{
        kind: 'markdownContent',
        content: { value: result },
      }]);
      return {};
    }

    // Handle /approve slash command for executing approved plans
    if (request.message.trim() === '/approve') {
      const plan = getCurrentPlan();

      if (!plan) {
        progress([{
          kind: 'markdownContent',
          content: { value: '❌ No plan to approve. Use `/plan <request>` to create a plan first.' },
        }]);
        return {};
      }

      if (plan.status !== 'pending') {
        progress([{
          kind: 'markdownContent',
          content: { value: `❌ Plan cannot be approved (status: ${plan.status}). Create a new plan with \`/plan\`.` },
        }]);
        return {};
      }

      progress([{
        kind: 'markdownContent',
        content: { value: `**Executing plan:** ${plan.title}\n\n` },
      }]);

      try {
        const success = await approvePlanFromChat();

        if (success) {
          progress([{
            kind: 'markdownContent',
            content: { value: '✅ Plan executed successfully!' },
          }]);
        } else {
          progress([{
            kind: 'markdownContent',
            content: { value: '⚠️ Plan execution completed with warnings. Check the output above.' },
          }]);
        }

        return {};
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        progress([{
          kind: 'markdownContent',
          content: { value: `❌ Error executing plan: ${errorMessage}` },
        }]);
        return { errorDetails: { message: errorMessage } };
      }
    }

    // Check authentication
    if (!isAIConfigured()) {
      progress([{
        kind: 'markdownContent',
        content: { value: '**Authentication Required**\n\nA browser window will open for Blink Code Assist authentication.\n\n*Please complete the sign-in process in your browser...*' },
      }]);

      try {
        await promptConfigureAIProvider();
        progress([{
          kind: 'markdownContent',
          content: { value: '\n\n**Connected to Blink Code Assist**\n\n' },
        }]);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        progress([{
          kind: 'markdownContent',
          content: { value: `\n\n**Authentication Failed**\n\n${errorMessage}\n\nPlease try again or check your network connection.` },
        }]);
        return {
          errorDetails: {
            message: `Authentication failed: ${errorMessage}`,
          },
        };
      }
    }

    // Build conversation history
    const conversationHistory: ConversationMessage[] = [];
    for (const entry of history) {
      if (entry.request.message) {
        conversationHistory.push({
          role: 'user',
          content: entry.request.message,
        });
      }
      // Extract assistant response from history
      const responseContent = entry.response
        .filter((r): r is { kind: 'markdownContent'; content: { value: string } } =>
          'kind' in r && r.kind === 'markdownContent' && 'content' in r
        )
        .map((r) => r.content.value)
        .join('');
      if (responseContent) {
        conversationHistory.push({
          role: 'assistant',
          content: responseContent,
        });
      }
    }

    // Process context mentions in the message (@file:, @folder:, etc.)
    let processedMessage = request.message;
    let resolvedMentions: ContextMention[] = [];

    try {
      const contextResult = await processMessageWithContext(request.message);
      processedMessage = contextResult.prompt;
      resolvedMentions = contextResult.mentions;

      // Show context resolution status if mentions were found
      if (resolvedMentions.length > 0) {
        const mentionSummary = resolvedMentions
          .map((m) => `@${m.type}${m.path ? ':' + m.path : m.query ? ':' + m.query : ''}`)
          .join(', ');
        progress([{
          kind: 'markdownContent',
          content: { value: `*Including context: ${mentionSummary}*\n\n` },
        }]);
      }
    } catch (error) {
      console.warn('[AI Agent] Context resolution failed:', error);
      // Continue with original message if context resolution fails
    }

    // Inject project rules and memory context
    let projectContext = '';
    try {
      projectContext = await getContextForPrompt(request.message);
      if (projectContext.trim()) {
        // Prepend project context to the message
        processedMessage = `${projectContext}\n\n---\n\nUser Request:\n${processedMessage}`;
        console.log('[AI Agent] Injected project context');
      }
    } catch (error) {
      console.warn('[AI Agent] Failed to get project context:', error);
    }

    // Add processed message with context
    conversationHistory.push({
      role: 'user',
      content: processedMessage,
    });

    // Handle cancellation
    this.currentAbortController = new AbortController();
    const disposable = token.onCancellationRequested(() => {
      console.log('[AI Agent] Cancellation requested');
      this.aiService.cancel();
      this.currentAbortController?.abort();
    });

    try {
      let fullResponse = '';

      await this.aiService.getPromptResponse(conversationHistory, {
        onToken: (tokenText) => {
          fullResponse += tokenText;
          progress([{
            kind: 'markdownContent',
            content: { value: tokenText },
          }]);
        },
        onComplete: (response) => {
          console.log('[AI Agent] Response complete, length:', response?.length || fullResponse.length);
        },
        onError: (error) => {
          console.error('[AI Agent] Error:', error);
          throw error;
        },
      });

      return {
        timings: {
          totalElapsed: Date.now(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[AI Agent] Request failed:', errorMessage);
      return {
        errorDetails: {
          message: errorMessage,
        },
      };
    } finally {
      disposable.dispose();
      this.currentAbortController = null;
    }
  }

  async provideFollowups(
    _request: IChatAgentRequest,
    _result: IChatAgentResult,
    _history: IChatAgentHistoryEntry[],
    _token: CancellationToken
  ): Promise<IChatFollowup[]> {
    // Provide some helpful follow-up suggestions
    return [
      { kind: 'reply', message: 'Explain this code', agentId: AGENT_ID, title: 'Explain' },
      { kind: 'reply', message: 'Find potential bugs', agentId: AGENT_ID, title: 'Find bugs' },
      { kind: 'reply', message: 'Suggest improvements', agentId: AGENT_ID, title: 'Improve' },
    ];
  }

  async provideChatTitle(history: IChatAgentHistoryEntry[]): Promise<string | undefined> {
    if (history.length === 0) return undefined;
    // Use first user message as title (truncated)
    const firstMessage = history[0]?.request?.message || '';
    return firstMessage.length > 50 ? firstMessage.substring(0, 47) + '...' : firstMessage;
  }
}

/**
 * Inject CSS to customize the chat panel for AI branding
 */
function injectChatStyles(): void {
  const styleId = 'blink-chat-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Override the default "Build with Agent" title */
    #workbench\\.parts\\.auxiliarybar .chat-welcome-view-title {
      font-size: 0 !important;
    }
    #workbench\\.parts\\.auxiliarybar .chat-welcome-view-title::after {
      content: "Blink Code Assist";
      font-size: 20px;
    }

    /* Style the chat welcome icon */
    #workbench\\.parts\\.auxiliarybar .chat-welcome-view-icon .codicon-chat-sparkle::before {
      content: "\\eb99"; /* sparkle icon */
      color: #c74634; /* Blink red */
    }

    /* Update the disclaimer */
    #workbench\\.parts\\.auxiliarybar .chat-welcome-view-disclaimer {
      font-size: 0 !important;
    }
    #workbench\\.parts\\.auxiliarybar .chat-welcome-view-disclaimer::after {
      content: "Powered by Blink Code Assist. Ask questions about your code.";
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Register global slash commands with IChatSlashCommandService
 * These appear in the autocomplete popup when typing /
 */
async function registerGlobalSlashCommands(): Promise<IDisposable[]> {
  const disposables: IDisposable[] = [];

  try {
    const slashCommandService = await getService(IChatSlashCommandService);
    if (!slashCommandService) {
      console.warn('[AI Agent] Slash command service not available');
      return disposables;
    }

    // Register /run command
    const runDisposable = slashCommandService.registerSlashCommand(
      {
        command: 'run',
        detail: 'Generate and run a shell command from natural language',
        sortText: 'a_run', // Sort early in the list
        locations: [ChatAgentLocation.Chat],
      },
      async (prompt, progress, _history, _location, _token) => {
        console.log('[AI Slash] /run command invoked with:', prompt);

        if (!prompt || !prompt.trim()) {
          progress.report({
            kind: 'markdownContent',
            content: { value: '**Usage:** `/run <description>`\n\nExample: `/run find all .ts files modified today`' },
          });
          return;
        }

        progress.report({
          kind: 'markdownContent',
          content: { value: `**Generating command for:** ${prompt}\n\n` },
        });

        try {
          const result = await runTerminalAIFromChat(prompt, false);

          if (!result.command) {
            progress.report({
              kind: 'markdownContent',
              content: { value: '❌ Failed to generate command. Check AI provider authentication.\n\nUse `Ctrl+Shift+\\`` to configure providers.' },
            });
            return;
          }

          if (result.command.startsWith('[BLOCKED]')) {
            progress.report({
              kind: 'markdownContent',
              content: { value: `⚠️ **Dangerous command blocked**\n\n\`\`\`\n${result.command.replace('[BLOCKED] ', '')}\n\`\`\`\n\nThis command was blocked for safety reasons.` },
            });
            return;
          }

          if (result.command.startsWith('UNCLEAR:')) {
            progress.report({
              kind: 'markdownContent',
              content: { value: `❓ **Need more information**\n\n${result.command.replace('UNCLEAR:', '').trim()}` },
            });
            return;
          }

          progress.report({
            kind: 'markdownContent',
            content: { value: `**Generated command:**\n\`\`\`bash\n${result.command}\n\`\`\`\n\nUse \`Ctrl+Shift+\\\`\` to run this in the terminal, or copy and paste it.` },
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          progress.report({
            kind: 'markdownContent',
            content: { value: `❌ Error generating command: ${errorMessage}` },
          });
        }
      }
    );
    disposables.push(runDisposable);
    console.log('[AI Agent] Registered /run slash command');

    // Register /plan command
    const planDisposable = slashCommandService.registerSlashCommand(
      {
        command: 'plan',
        detail: 'Create a step-by-step plan before making changes',
        sortText: 'a_plan',
        locations: [ChatAgentLocation.Chat],
      },
      async (prompt, progress, _history, _location, _token) => {
        console.log('[AI Slash] /plan command invoked with:', prompt);

        if (!prompt || !prompt.trim()) {
          progress.report({
            kind: 'markdownContent',
            content: { value: '**Usage:** `/plan <what you want to accomplish>`\n\nExample: `/plan add user authentication to the app`' },
          });
          return;
        }

        progress.report({
          kind: 'markdownContent',
          content: { value: `**Creating plan for:** ${prompt}\n\n` },
        });

        try {
          const result = await runPlanFromChat(prompt);

          if (!result.plan || !result.formatted) {
            progress.report({
              kind: 'markdownContent',
              content: { value: '❌ Failed to generate plan. Check AI provider authentication.' },
            });
            return;
          }

          progress.report({
            kind: 'markdownContent',
            content: { value: result.formatted },
          });

          progress.report({
            kind: 'markdownContent',
            content: { value: '\n\n---\n\nType `/approve` to execute this plan, or `/plan <new request>` to create a different plan.' },
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          progress.report({
            kind: 'markdownContent',
            content: { value: `❌ Error generating plan: ${errorMessage}` },
          });
        }
      }
    );
    disposables.push(planDisposable);
    console.log('[AI Agent] Registered /plan slash command');

    // Register /approve command
    const approveDisposable = slashCommandService.registerSlashCommand(
      {
        command: 'approve',
        detail: 'Approve and execute the current plan',
        sortText: 'a_approve',
        locations: [ChatAgentLocation.Chat],
      },
      async (_prompt, progress, _history, _location, _token) => {
        console.log('[AI Slash] /approve command invoked');

        const plan = getCurrentPlan();

        if (!plan) {
          progress.report({
            kind: 'markdownContent',
            content: { value: '❌ No plan to approve. Use `/plan <request>` to create a plan first.' },
          });
          return;
        }

        if (plan.status !== 'pending') {
          progress.report({
            kind: 'markdownContent',
            content: { value: `❌ Plan cannot be approved (status: ${plan.status}). Create a new plan with \`/plan\`.` },
          });
          return;
        }

        progress.report({
          kind: 'markdownContent',
          content: { value: `**Executing plan:** ${plan.title}\n\n` },
        });

        try {
          const success = await approvePlanFromChat();

          if (success) {
            progress.report({
              kind: 'markdownContent',
              content: { value: '✅ Plan executed successfully!' },
            });
          } else {
            progress.report({
              kind: 'markdownContent',
              content: { value: '⚠️ Plan execution completed with warnings. Check the output above.' },
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          progress.report({
            kind: 'markdownContent',
            content: { value: `❌ Error executing plan: ${errorMessage}` },
          });
        }
      }
    );
    disposables.push(approveDisposable);
    console.log('[AI Agent] Registered /approve slash command');

    // Register /agent command for multi-step autonomous execution
    const agentDisposable = slashCommandService.registerSlashCommand(
      {
        command: 'agent',
        detail: 'Start an autonomous agent to complete a multi-step task',
        sortText: 'a_agent',
        locations: [ChatAgentLocation.Chat],
      },
      async (prompt, progress, _history, _location, _token) => {
        console.log('[AI Slash] /agent command invoked with:', prompt);

        if (!prompt || !prompt.trim()) {
          progress.report({
            kind: 'markdownContent',
            content: { value: '**Usage:** `/agent <task description>`\n\nExample: `/agent implement a function to validate email addresses`' },
          });
          return;
        }

        // Check if an agent is already running
        if (getCurrentAgentSession()) {
          progress.report({
            kind: 'markdownContent',
            content: { value: '⚠️ An agent is already running. Use `/cancel` to stop it first.' },
          });
          return;
        }

        progress.report({
          kind: 'markdownContent',
          content: { value: `**Starting agent for:** ${prompt}\n\n*Use \`/cancel\` to stop the agent at any time.*\n\n---\n\n` },
        });

        try {
          const session = await runAgentFromChat(prompt, (message) => {
            progress.report({
              kind: 'markdownContent',
              content: { value: message + '\n' },
            });
          });

          progress.report({
            kind: 'markdownContent',
            content: { value: `\n---\n\n**Agent ${session.status}**\n\n${session.summary || ''}` },
          });

          if (session.status === 'completed') {
            progress.report({
              kind: 'markdownContent',
              content: { value: `\n\n*Completed ${session.steps.length} steps in ${((session.completedAt || Date.now()) - session.startedAt) / 1000}s*` },
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          progress.report({
            kind: 'markdownContent',
            content: { value: `❌ Agent error: ${errorMessage}` },
          });
        }
      }
    );
    disposables.push(agentDisposable);
    console.log('[AI Agent] Registered /agent slash command');

    // Register /cancel command for stopping the agent
    const cancelDisposable = slashCommandService.registerSlashCommand(
      {
        command: 'cancel',
        detail: 'Cancel the currently running agent',
        sortText: 'a_cancel',
        locations: [ChatAgentLocation.Chat],
      },
      async (_prompt, progress, _history, _location, _token) => {
        console.log('[AI Slash] /cancel command invoked');

        const session = getCurrentAgentSession();
        if (!session) {
          progress.report({
            kind: 'markdownContent',
            content: { value: '❌ No agent running to cancel.' },
          });
          return;
        }

        cancelAgent();
        progress.report({
          kind: 'markdownContent',
          content: { value: '⏹️ Cancelling agent...' },
        });
      }
    );
    disposables.push(cancelDisposable);
    console.log('[AI Agent] Registered /cancel slash command');

    // Register /compose command for multi-file editing
    const composeDisposable = slashCommandService.registerSlashCommand(
      {
        command: 'compose',
        detail: 'Make coordinated changes across multiple files',
        sortText: 'a_compose',
        locations: [ChatAgentLocation.Chat],
      },
      async (prompt, progress, _history, _location, _token) => {
        console.log('[AI Slash] /compose command invoked with:', prompt);

        if (!prompt || !prompt.trim()) {
          progress.report({
            kind: 'markdownContent',
            content: { value: '**Usage:** `/compose <description of changes>`\n\nExample: `/compose add error handling to all API endpoints`' },
          });
          return;
        }

        progress.report({
          kind: 'markdownContent',
          content: { value: `**Multi-file Edit:** ${prompt}\n\n` },
        });

        try {
          const session = await runComposerFromChat(prompt, [], (message) => {
            progress.report({
              kind: 'markdownContent',
              content: { value: message + '\n' },
            });
          });

          if (!session) {
            progress.report({
              kind: 'markdownContent',
              content: { value: '❌ Failed to generate file changes.' },
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          progress.report({
            kind: 'markdownContent',
            content: { value: `❌ Composer error: ${errorMessage}` },
          });
        }
      }
    );
    disposables.push(composeDisposable);
    console.log('[AI Agent] Registered /compose slash command');

    // Register /apply command for applying composer changes
    const applyDisposable = slashCommandService.registerSlashCommand(
      {
        command: 'apply',
        detail: 'Apply pending multi-file changes',
        sortText: 'a_apply',
        locations: [ChatAgentLocation.Chat],
      },
      async (_prompt, progress, _history, _location, _token) => {
        console.log('[AI Slash] /apply command invoked');

        const session = getCurrentComposerSession();
        if (!session) {
          progress.report({
            kind: 'markdownContent',
            content: { value: '❌ No composer session active. Use `/compose <description>` first.' },
          });
          return;
        }

        progress.report({
          kind: 'markdownContent',
          content: { value: '**Applying changes...**\n\n' },
        });

        try {
          const success = await applyComposerFromChat((message) => {
            progress.report({
              kind: 'markdownContent',
              content: { value: message + '\n' },
            });
          });

          if (success) {
            progress.report({
              kind: 'markdownContent',
              content: { value: '✅ Changes applied successfully!' },
            });
          } else {
            progress.report({
              kind: 'markdownContent',
              content: { value: '⚠️ Some changes were not applied.' },
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          progress.report({
            kind: 'markdownContent',
            content: { value: `❌ Apply error: ${errorMessage}` },
          });
        }
      }
    );
    disposables.push(applyDisposable);
    console.log('[AI Agent] Registered /apply slash command');

    // Register /remember command for persistent memory
    const rememberDisposable = slashCommandService.registerSlashCommand(
      {
        command: 'remember',
        detail: 'Remember a fact or preference for this project',
        sortText: 'a_remember',
        locations: [ChatAgentLocation.Chat],
      },
      async (prompt, progress, _history, _location, _token) => {
        console.log('[AI Slash] /remember command invoked with:', prompt);
        const result = await handleRememberCommand(prompt || '');
        progress.report({
          kind: 'markdownContent',
          content: { value: result },
        });
      }
    );
    disposables.push(rememberDisposable);
    console.log('[AI Agent] Registered /remember slash command');

    // Register /forget command to clear memory
    const forgetDisposable = slashCommandService.registerSlashCommand(
      {
        command: 'forget',
        detail: 'Clear all project memory',
        sortText: 'a_forget',
        locations: [ChatAgentLocation.Chat],
      },
      async (_prompt, progress, _history, _location, _token) => {
        console.log('[AI Slash] /forget command invoked');
        const result = await handleForgetCommand();
        progress.report({
          kind: 'markdownContent',
          content: { value: result },
        });
      }
    );
    disposables.push(forgetDisposable);
    console.log('[AI Agent] Registered /forget slash command');

    // Register /rules command for project rules
    const rulesDisposable = slashCommandService.registerSlashCommand(
      {
        command: 'rules',
        detail: 'Show or manage project rules',
        sortText: 'a_rules',
        locations: [ChatAgentLocation.Chat],
      },
      async (prompt, progress, _history, _location, _token) => {
        console.log('[AI Slash] /rules command invoked with:', prompt);
        const result = await handleRulesCommand(prompt || undefined);
        progress.report({
          kind: 'markdownContent',
          content: { value: result },
        });
      }
    );
    disposables.push(rulesDisposable);
    console.log('[AI Agent] Registered /rules slash command');

    // Expose handlers on window for testing
    (window as any).__RUN_TERMINAL_AI__ = runTerminalAIFromChat;
    (window as any).__RUN_PLAN_FROM_CHAT__ = runPlanFromChat;
    (window as any).__APPROVE_PLAN__ = approvePlanFromChat;
    (window as any).__RUN_AGENT__ = runAgentFromChat;
    (window as any).__CANCEL_AGENT__ = cancelAgent;
    (window as any).__GET_AGENT_SESSION__ = getCurrentAgentSession;
    (window as any).__RUN_COMPOSER__ = runComposerFromChat;
    (window as any).__APPLY_COMPOSER__ = applyComposerFromChat;
    (window as any).__GET_COMPOSER_SESSION__ = getCurrentComposerSession;
    (window as any).__HANDLE_REMEMBER__ = handleRememberCommand;
    (window as any).__HANDLE_FORGET__ = handleForgetCommand;
    (window as any).__HANDLE_RULES__ = handleRulesCommand;
    (window as any).__GET_CONTEXT_FOR_PROMPT__ = getContextForPrompt;

  } catch (error) {
    console.error('[AI Agent] Failed to register slash commands:', error);
  }

  return disposables;
}

/**
 * Register Blink Code Assist as a VS Code chat agent
 */
export async function registerAIChatAgent(): Promise<IDisposable | null> {
  // Inject custom styles for AI branding
  injectChatStyles();

  try {
    const chatAgentService = await getService(IChatAgentService);

    if (!chatAgentService) {
      console.warn('[AI Agent] Chat agent service not available');
      return null;
    }

    // Register global slash commands first (so they appear in autocomplete)
    const slashDisposables = await registerGlobalSlashCommands();

    const agentData: IChatAgentData = {
      id: AGENT_ID,
      name: AGENT_NAME,
      fullName: 'Blink Code Assist',
      description: 'AI coding assistant powered by Blink Code Assist',
      extensionId: new ExtensionIdentifier('blink.code-assist'),
      extensionVersion: '1.0.0',
      extensionPublisherId: 'blink',
      extensionDisplayName: 'Blink Code Assist',
      publisherDisplayName: 'Blink',
      isDefault: true,
      isDynamic: true,
      isCore: false,
      metadata: {
        themeIcon: { id: 'sparkle' },
        sampleRequest: 'Explain this code',
        helpTextPrefix: 'Ask Blink Code Assist about your code',
        isSticky: true,
      },
      slashCommands: [
        {
          name: 'explain',
          description: 'Explain the selected code',
        },
        {
          name: 'fix',
          description: 'Fix bugs in the selected code',
        },
        {
          name: 'refactor',
          description: 'Refactor the selected code',
        },
        {
          name: 'doc',
          description: 'Generate documentation',
        },
      ],
      locations: [ChatAgentLocation.Chat],
      modes: [],
      disambiguation: [],
    };

    const agentImpl = new AIChatAgentImpl();

    const agentDisposable = chatAgentService.registerDynamicAgent(agentData, agentImpl);
    console.log('[AI Agent] Registered Blink Code Assist as chat agent');

    // Mark as registered on window for testing
    (window as any).__AI_CHAT_AGENT_REGISTERED__ = true;

    // Return a combined disposable
    return {
      dispose: () => {
        agentDisposable.dispose();
        slashDisposables.forEach(d => d.dispose());
      }
    };
  } catch (error) {
    console.error('[AI Agent] Failed to register chat agent:', error);
    return null;
  }
}
