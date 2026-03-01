/**
 * Blink AI Chat Service
 *
 * Thin wrapper that exposes the same interface as the old chat service
 * but delegates all AI calls to aiProviderService (API-key based).
 */

import {
  streamChat,
  isAIProviderConfigured,
  clearAIProviderConfig,
  type ConversationMessage,
  type StreamCallbacks,
} from './aiProviderService';

// Re-export types consumed by other modules
export type { ConversationMessage, StreamCallbacks };

export interface AIServiceConfig {
  model?: string;
}

export class AIError extends Error {
  status: number;
  statusText: string;
  body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`AI request failed with status ${status}: ${statusText}`);
    this.name = 'AIError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// AIService
// ---------------------------------------------------------------------------

export class AIService {
  private currentAbortController: AbortController | null = null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: AIServiceConfig = {}) {}

  isConfigured(): boolean {
    return isAIProviderConfigured();
  }

  hasValidToken(): boolean {
    return isAIProviderConfigured();
  }

  clearTokens(): void {
    clearAIProviderConfig();
  }

  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  async getPromptResponse(
    prompt: string | ConversationMessage[],
    callbacks: StreamCallbacks,
    _model?: string,
  ): Promise<string> {
    this.currentAbortController = new AbortController();
    const messages: ConversationMessage[] =
      typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt;

    try {
      return await streamChat(messages, callbacks, this.currentAbortController.signal);
    } finally {
      this.currentAbortController = null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateConfig(_config: Partial<AIServiceConfig>): void {}
}

// ---------------------------------------------------------------------------
// Singleton + convenience exports
// ---------------------------------------------------------------------------

let serviceInstance: AIService | null = null;

export function getAIService(config?: AIServiceConfig): AIService {
  if (!serviceInstance) {
    serviceInstance = new AIService(config);
  }
  return serviceInstance;
}

export function isAIConfigured(): boolean {
  return isAIProviderConfigured();
}

/**
 * Prompt the user to configure a provider via the Command Palette.
 */
export async function promptConfigureAIProvider(): Promise<void> {
  try {
    const { commands } = await import('vscode');
    await commands.executeCommand('blink.configureAIProvider');
  } catch {
    throw new Error(
      'No AI provider configured. Open the Command Palette and run "Blink: Configure AI Provider".',
    );
  }
}

export function clearAIConfig(): void {
  clearAIProviderConfig();
}
