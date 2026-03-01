/**
 * AI Chat View Provider for VS Code Workbench
 *
 * Registers a custom view in the activity bar for AI chat functionality.
 * Uses Blink AI for AI responses.
 */

import {
  registerCustomView,
  ViewContainerLocation,
  type CustomViewOption,
  DomScrollableElement,
} from '@codingame/monaco-vscode-workbench-service-override';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { createUserMessage, createAssistantMessage, type ChatMessage } from '../aiChat';
import { getAIService, isAIConfigured, promptConfigureAIProvider, type ConversationMessage } from './ai/chatService';

const AI_CHAT_VIEW_ID = 'blink.aiChat';

/**
 * Simple chat UI rendered in the VS Code sidebar
 * Uses Blink AI for AI responses
 */
class ChatViewUI {
  private container: HTMLElement;
  private messagesContainer: HTMLElement;
  private inputContainer: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private loginButton: HTMLButtonElement | null = null;
  private messages: ChatMessage[] = [];
  private aiService = getAIService();
  private isStreaming = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.className = 'ai-chat-view';
    this.container.innerHTML = '';

    // Create styles
    this.injectStyles();

    // Create messages container
    this.messagesContainer = document.createElement('div');
    this.messagesContainer.className = 'ai-chat-messages';
    this.container.appendChild(this.messagesContainer);

    // Create input container
    this.inputContainer = document.createElement('div');
    this.inputContainer.className = 'ai-chat-input-container';

    this.input = document.createElement('textarea');
    this.input.className = 'ai-chat-input';
    this.input.placeholder = 'Ask a question about your code...';
    this.input.rows = 2;

    this.sendButton = document.createElement('button');
    this.sendButton.className = 'ai-chat-send-btn';
    this.sendButton.textContent = 'Send';
    this.sendButton.onclick = () => this.handleSend();

    // Handle Enter to send (Shift+Enter for new line)
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    };

    this.inputContainer.appendChild(this.input);
    this.inputContainer.appendChild(this.sendButton);
    this.container.appendChild(this.inputContainer);

    // Show welcome message
    this.showWelcome();
  }

  private injectStyles(): void {
    const styleId = 'ai-chat-view-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .ai-chat-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--vscode-sideBar-background);
        color: var(--vscode-sideBar-foreground);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
      }

      .ai-chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }

      .ai-chat-message {
        margin-bottom: 12px;
        padding: 8px 12px;
        border-radius: 6px;
      }

      .ai-chat-message--user {
        background: var(--vscode-input-background);
        margin-left: 20px;
      }

      .ai-chat-message--assistant {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
      }

      .ai-chat-message--streaming::after {
        content: '▊';
        animation: blink 1s step-end infinite;
      }

      @keyframes blink {
        50% { opacity: 0; }
      }

      .ai-chat-message-role {
        font-size: 11px;
        font-weight: 600;
        margin-bottom: 4px;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
      }

      .ai-chat-message-content {
        white-space: pre-wrap;
        word-break: break-word;
      }

      .ai-chat-message-content code {
        background: var(--vscode-textCodeBlock-background);
        padding: 1px 4px;
        border-radius: 3px;
        font-family: var(--vscode-editor-font-family);
      }

      .ai-chat-message-content pre {
        background: var(--vscode-textCodeBlock-background);
        padding: 8px;
        border-radius: 4px;
        overflow-x: auto;
        margin: 8px 0;
      }

      .ai-chat-input-container {
        display: flex;
        gap: 8px;
        padding: 12px;
        border-top: 1px solid var(--vscode-panel-border);
      }

      .ai-chat-input {
        flex: 1;
        resize: none;
        padding: 8px;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border-radius: 4px;
        font-family: inherit;
        font-size: inherit;
      }

      .ai-chat-input:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
      }

      .ai-chat-send-btn {
        padding: 8px 16px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 500;
      }

      .ai-chat-send-btn:hover {
        background: var(--vscode-button-hoverBackground);
      }

      .ai-chat-send-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .ai-chat-welcome {
        text-align: center;
        padding: 24px;
        color: var(--vscode-descriptionForeground);
      }

      .ai-chat-welcome h3 {
        margin: 0 0 8px 0;
        color: var(--vscode-foreground);
      }
    `;
    document.head.appendChild(style);
  }

  private showWelcome(): void {
    const isAuthenticated = isAIConfigured();

    this.messagesContainer.innerHTML = `
      <div class="ai-chat-welcome">
        <h3>Blink Code Assist</h3>
        <p>Ask questions about your code, get help with debugging, or request code suggestions.</p>
        ${
          !isAuthenticated
            ? `
          <p style="margin-top: 12px; color: var(--vscode-editorWarning-foreground);">
            Please log in to Blink Code Assist to use this feature.
          </p>
        `
            : `
          <p style="margin-top: 12px; color: var(--vscode-editorInfo-foreground);">
            ✓ Connected to Blink Code Assist
          </p>
        `
        }
      </div>
    `;

    // Add login button if not authenticated
    if (!isAuthenticated) {
      const loginBtn = document.createElement('button');
      loginBtn.className = 'ai-chat-send-btn';
      loginBtn.style.margin = '12px auto';
      loginBtn.style.display = 'block';
      loginBtn.textContent = 'Login to Blink Code Assist';
      loginBtn.onclick = () => this.handleLogin();
      this.messagesContainer.querySelector('.ai-chat-welcome')?.appendChild(loginBtn);
      this.loginButton = loginBtn;
    }
  }

  private async handleLogin(): Promise<void> {
    if (this.loginButton) {
      this.loginButton.disabled = true;
      this.loginButton.textContent = 'Logging in...';
    }

    try {
      await promptConfigureAIProvider();
      this.showWelcome(); // Refresh to show connected status
    } catch (error) {
      console.error('[ChatView] Login failed:', error);
      if (this.loginButton) {
        this.loginButton.disabled = false;
        this.loginButton.textContent = 'Login Failed - Try Again';
      }
    }
  }

  private renderMessages(): void {
    if (this.messages.length === 0) {
      this.showWelcome();
      return;
    }

    this.messagesContainer.innerHTML = '';
    for (const msg of this.messages) {
      const msgEl = document.createElement('div');
      msgEl.className = `ai-chat-message ai-chat-message--${msg.role}`;
      if (msg.status === 'streaming') {
        msgEl.classList.add('ai-chat-message--streaming');
      }

      const roleEl = document.createElement('div');
      roleEl.className = 'ai-chat-message-role';
      roleEl.textContent = msg.role === 'user' ? 'You' : 'AI';

      const contentEl = document.createElement('div');
      contentEl.className = 'ai-chat-message-content';
      contentEl.textContent = msg.content;

      msgEl.appendChild(roleEl);
      msgEl.appendChild(contentEl);
      this.messagesContainer.appendChild(msgEl);
    }

    // Scroll to bottom
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private async handleSend(): Promise<void> {
    const content = this.input.value.trim();
    if (!content || this.isStreaming) return;

    // Check if authenticated
    if (!isAIConfigured()) {
      await this.handleLogin();
      if (!isAIConfigured()) {
        return; // Login failed or cancelled
      }
    }

    // Add user message
    const userMessage = createUserMessage(content);
    this.messages.push(userMessage);
    this.input.value = '';
    this.renderMessages();

    // Create assistant message for streaming
    const assistantMessage = createAssistantMessage();
    this.messages.push(assistantMessage);
    this.isStreaming = true;
    this.sendButton.disabled = true;
    this.sendButton.textContent = 'Cancel';
    this.sendButton.onclick = () => this.handleCancel();

    try {
      // Build conversation history
      const conversationHistory: ConversationMessage[] = this.messages
        .filter((msg) => msg.role !== 'system' && msg.status !== 'streaming')
        .slice(0, -1) // Exclude the current empty assistant message
        .map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }));

      // Add the current user message
      conversationHistory.push({ role: 'user', content });

      // Send with streaming
      await this.aiService.getPromptResponse(conversationHistory, {
        onToken: (token) => {
          assistantMessage.content += token;
          this.renderMessages();
        },
        onComplete: (fullResponse) => {
          assistantMessage.content = fullResponse || assistantMessage.content;
          assistantMessage.status = 'complete';
          this.renderMessages();
        },
        onError: (error) => {
          assistantMessage.content = `Error: ${error.message}`;
          assistantMessage.status = 'error';
          this.renderMessages();
        },
      });
    } catch (error) {
      assistantMessage.content = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      assistantMessage.status = 'error';
      this.renderMessages();
    } finally {
      this.isStreaming = false;
      this.sendButton.disabled = false;
      this.sendButton.textContent = 'Send';
      this.sendButton.onclick = () => this.handleSend();
    }
  }

  private handleCancel(): void {
    this.aiService.cancel();
    this.isStreaming = false;
    this.sendButton.disabled = false;
    this.sendButton.textContent = 'Send';
    this.sendButton.onclick = () => this.handleSend();

    // Mark current streaming message as complete
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage && lastMessage.status === 'streaming') {
      lastMessage.status = 'complete';
      if (!lastMessage.content) {
        lastMessage.content = '(Cancelled)';
      }
      this.renderMessages();
    }
  }

  dispose(): void {
    this.container.innerHTML = '';
  }
}

/**
 * Register the AI Chat view in VS Code's sidebar
 */
export function registerAIChatView(): IDisposable {
  let chatUI: ChatViewUI | null = null;

  const viewOptions: CustomViewOption = {
    id: AI_CHAT_VIEW_ID,
    name: 'AI Chat',
    location: ViewContainerLocation.Sidebar,
    icon: 'comment-discussion', // VS Code Codicon
    default: false,
    order: 100,
    canMoveView: true,
    renderBody: (container: HTMLElement, _scrollbar: DomScrollableElement) => {
      chatUI = new ChatViewUI(container);
      return {
        dispose: () => {
          if (chatUI) {
            chatUI.dispose();
            chatUI = null;
          }
        },
      };
    },
  };

  const disposable = registerCustomView(viewOptions);
  console.log('[ChatViewProvider] AI Chat view registered');

  return disposable;
}
