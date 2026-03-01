/**
 * AI Chat Service
 *
 * This service provides AI chat functionality via the Node.js sidecar
 *
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// Chat types (previously imported from ChatPanel component)
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'sending' | 'streaming' | 'complete' | 'error';
}

export interface SelectedCodeContext {
  file: string;
  code: string;
  startLine: number;
  endLine: number;
}

export interface ChatContext {
  conversationId?: string;
  workspaceFolder?: string;
  activeFile?: string;
  files?: string[];
  selectedCode?: SelectedCodeContext;
}

export interface AIServiceConfig {
  modelId?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ToolUseEvent {
  tool: string;
  parameters: Record<string, unknown>;
}

export interface ToolResultEvent {
  tool: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface DocumentEditEvent {
  file: string;
  edits: Array<Record<string, unknown>>;
}

export interface StreamingCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
  onToolUse?: (event: ToolUseEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onDocumentEdit?: (event: DocumentEditEvent) => void;
}

// System prompt exported for reference
export const SYSTEM_PROMPT = `You are an AI coding assistant integrated into Blink, a desktop application for editing and working with files. You can help users:

- Understand and explain code
- Find and fix bugs
- Refactor and improve code quality
- Write documentation
- Suggest best practices
- Help with implementation tasks

When provided with file context, analyze the code carefully and provide specific, actionable advice. Format code blocks with appropriate language tags for syntax highlighting.

Be concise but thorough. If you need more context to provide a good answer, ask clarifying questions.`;

interface FileContextForSidecar {
  name: string;
  content: string;
}

interface ChatHistoryItem {
  role: string;
  content: string;
}

interface SidecarContext {
  files?: FileContextForSidecar[];
  selectedCode?: {
    file: string;
    code: string;
    startLine: number;
    endLine: number;
  };
}

/**
 * AI Chat Service class for managing chat interactions via sidecar
 */
export class AIChatService {
  private config: AIServiceConfig;
  private isReady: boolean = false;
  private currentRequestId: string | null = null;
  private unlisteners: UnlistenFn[] = [];
  private workingDirectory: string | null = null;

  constructor(config: AIServiceConfig = {}) {
    this.config = {
      modelId: config.modelId || 'blink-code-assist',
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.7,
    };
  }

  /**
   * Start the AI sidecar process
   */
  async start(): Promise<void> {
    try {
      // Check if already ready
      const ready = await invoke<boolean>('is_ai_sidecar_ready');
      if (ready) {
        this.isReady = true;
        return;
      }

      // Listen for ready event
      const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Sidecar startup timeout'));
        }, 30000);

        listen('ai-sidecar-ready', () => {
          clearTimeout(timeout);
          this.isReady = true;
          resolve();
        }).then((unlisten) => {
          this.unlisteners.push(unlisten);
        });
      });

      // Start the sidecar
      await invoke('start_ai_sidecar');

      await readyPromise;
    } catch (error) {
      console.error('[AI Service] Failed to start sidecar:', error);
      throw error;
    }
  }

  /**
   * Stop the AI sidecar process
   */
  async stop(): Promise<void> {
    try {
      await invoke('stop_ai_sidecar');
      this.isReady = false;

      // Clean up listeners
      for (const unlisten of this.unlisteners) {
        unlisten();
      }
      this.unlisteners = [];
    } catch (error) {
      console.error('[AI Service] Failed to stop sidecar:', error);
    }
  }

  /**
   * Send a message and receive a streaming response
   */
  async sendMessage(
    message: string,
    context: ChatContext,
    previousMessages: ChatMessage[],
    fileContents: Map<string, string>,
    callbacks: StreamingCallbacks
  ): Promise<void> {
    // Ensure sidecar is running
    if (!this.isReady) {
      try {
        await this.start();
      } catch (error) {
        callbacks.onError(
          error instanceof Error ? error : new Error('Failed to start AI service')
        );
        return;
      }
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.currentRequestId = requestId;

    // Build context for sidecar
    const sidecarContext: SidecarContext = {};

    if (context.files && context.files.length > 0) {
      sidecarContext.files = context.files.map((filePath) => ({
        name: filePath.split('/').pop() || filePath,
        content: fileContents.get(filePath) || '',
      }));
    }

    if (context.selectedCode) {
      sidecarContext.selectedCode = context.selectedCode;
    }

    // Build history for sidecar
    const history: ChatHistoryItem[] = previousMessages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

    // Set up event listeners
    const localUnlisteners: UnlistenFn[] = [];
    let fullResponse = '';

    try {
      // Listen for tokens
      const unlistenToken = await listen<string>(`ai-token-${requestId}`, (event) => {
        fullResponse += event.payload;
        callbacks.onToken(event.payload);
      });
      localUnlisteners.push(unlistenToken);

      // Listen for tool usage events
      if (callbacks.onToolUse) {
        const unlistenToolUse = await listen<ToolUseEvent>(`ai-tool-use-${requestId}`, (event) => {
          callbacks.onToolUse?.(event.payload);
        });
        localUnlisteners.push(unlistenToolUse);
      }

      // Listen for tool result events
      if (callbacks.onToolResult) {
        const unlistenToolResult = await listen<ToolResultEvent>(`ai-tool-result-${requestId}`, (event) => {
          callbacks.onToolResult?.(event.payload);
        });
        localUnlisteners.push(unlistenToolResult);
      }

      // Listen for document edit events
      if (callbacks.onDocumentEdit) {
        const unlistenDocEdit = await listen<DocumentEditEvent>(`ai-document-edit-${requestId}`, (event) => {
          callbacks.onDocumentEdit?.(event.payload);
        });
        localUnlisteners.push(unlistenDocEdit);
      }

      // Listen for completion
      const completePromise = new Promise<void>((resolve, reject) => {
        listen<string | null>(`ai-complete-${requestId}`, () => {
          resolve();
        }).then((unlisten) => localUnlisteners.push(unlisten));

        listen<string | null>(`ai-error-${requestId}`, (event) => {
          reject(new Error(event.payload || 'Unknown AI error'));
        }).then((unlisten) => localUnlisteners.push(unlisten));

        listen(`ai-cancelled-${requestId}`, () => {
          resolve();
        }).then((unlisten) => localUnlisteners.push(unlisten));
      });

      // Send the request
      await invoke('send_ai_chat', {
        requestId,
        message,
        context: Object.keys(sidecarContext).length > 0 ? sidecarContext : null,
        history: history.length > 0 ? history : null,
        workingDirectory: this.workingDirectory,
      });

      // Wait for completion
      await completePromise;

      callbacks.onComplete(fullResponse);
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      // Clean up local listeners
      for (const unlisten of localUnlisteners) {
        unlisten();
      }
      this.currentRequestId = null;
    }
  }

  /**
   * Cancel the current streaming response
   */
  async cancel(): Promise<void> {
    if (this.currentRequestId) {
      try {
        await invoke('cancel_ai_chat', { requestId: this.currentRequestId });
      } catch (error) {
        console.error('[AI Service] Failed to cancel request:', error);
      }
      this.currentRequestId = null;
    }
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<AIServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set the working directory for file operations
   */
  setWorkingDirectory(directory: string | null): void {
    this.workingDirectory = directory;
  }

  /**
   * Get the current working directory
   */
  getWorkingDirectory(): string | null {
    return this.workingDirectory;
  }

  /**
   * Check if the service is ready
   */
  get ready(): boolean {
    return this.isReady;
  }
}

// Singleton instance for easy access
let serviceInstance: AIChatService | null = null;

export function getAIChatService(config?: AIServiceConfig): AIChatService {
  if (!serviceInstance) {
    serviceInstance = new AIChatService(config);
  } else if (config) {
    serviceInstance.updateConfig(config);
  }
  return serviceInstance;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new user message
 */
export function createUserMessage(content: string, _context?: ChatContext): ChatMessage {
  return {
    id: generateMessageId(),
    role: 'user',
    content,
    timestamp: Date.now(),
    status: 'complete',
  };
}

/**
 * Create a new assistant message (initially empty for streaming)
 */
export function createAssistantMessage(initialContent: string = ''): ChatMessage {
  return {
    id: generateMessageId(),
    role: 'assistant',
    content: initialContent,
    timestamp: Date.now(),
    status: 'streaming',
  };
}
