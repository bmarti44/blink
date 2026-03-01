/**
 * OpenAI Model Provider
 *
 * Implements the ModelProvider interface for OpenAI API.
 * Allows users to use OpenAI models (GPT-4, etc.) using API keys.
 */

import type {
  ModelProvider,
  ModelInfo,
  ConversationMessage,
  StreamingCallbacks,
  CompletionOptions,
  ProviderConfig,
} from './modelProvider';

// ============================================================================
// Types
// ============================================================================

interface OpenAIConfig {
  apiKey: string;
  endpoint?: string;
  defaultModel?: string;
  organization?: string;
}

// ============================================================================
// OpenAI Provider Implementation
// ============================================================================

export class OpenAIModelProvider implements ModelProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';

  private config: OpenAIConfig = {
    apiKey: '',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
  };

  private currentAbortController: AbortController | null = null;

  /** Storage keys */
  private readonly API_KEY_STORAGE = 'blink-openai-api-key';
  private readonly MODEL_STORAGE = 'blink-openai-model';

  constructor() {
    // Load saved config from localStorage
    const savedApiKey = localStorage.getItem(this.API_KEY_STORAGE);
    const savedModel = localStorage.getItem(this.MODEL_STORAGE);

    if (savedApiKey) {
      this.config.apiKey = savedApiKey;
    }
    if (savedModel) {
      this.config.defaultModel = savedModel;
    }
  }

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  isAuthenticated(): boolean {
    // OpenAI uses API key auth, so configured = authenticated
    return this.isConfigured();
  }

  async authenticate(): Promise<void> {
    // OpenAI doesn't have OAuth flow - just need API key
    // This would be handled via settings UI
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key not configured. Please set it in settings.');
    }
  }

  async getModels(): Promise<ModelInfo[]> {
    if (!this.isConfigured()) {
      return [];
    }

    // Return common OpenAI models
    // Could fetch from API: GET https://api.openai.com/v1/models
    return [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'Most capable model for complex tasks',
        contextWindow: 128000,
        provider: this.id,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Fast and efficient for simpler tasks',
        contextWindow: 128000,
        provider: this.id,
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        description: 'High performance with vision capabilities',
        contextWindow: 128000,
        provider: this.id,
      },
      {
        id: 'o1-preview',
        name: 'o1 Preview',
        description: 'Advanced reasoning model',
        contextWindow: 128000,
        provider: this.id,
      },
    ];
  }

  async getCompletion(
    messages: ConversationMessage[],
    callbacks: StreamingCallbacks,
    options?: CompletionOptions
  ): Promise<string> {
    if (!this.isConfigured()) {
      callbacks.onError(new Error('OpenAI API key not configured'));
      return '';
    }

    this.currentAbortController = new AbortController();

    const body = JSON.stringify({
      model: options?.model || this.config.defaultModel,
      messages,
      stream: true,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      stop: options?.stopSequences,
    });

    try {
      const response = await fetch(this.config.endpoint!, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          ...(this.config.organization && { 'OpenAI-Organization': this.config.organization }),
        },
        body,
        signal: this.currentAbortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
      }

      let result = '';
      let previousChunk = '';

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          const lines = (previousChunk + text).split('\n');

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);

            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              previousChunk = '';

              const content = parsed?.choices?.[0]?.delta?.content || '';
              if (content) {
                result += content;
                callbacks.onToken(content);
              }
            } catch {
              previousChunk += line;
            }
          }
        }
      }

      callbacks.onComplete(result);
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[OpenAI] Request cancelled');
        return '';
      }

      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      return '';
    } finally {
      this.currentAbortController = null;
    }
  }

  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  configure(config: Partial<ProviderConfig>): void {
    if (config.apiKey !== undefined) {
      this.config.apiKey = config.apiKey;
      localStorage.setItem(this.API_KEY_STORAGE, config.apiKey);
    }
    if (config.endpoint) {
      this.config.endpoint = config.endpoint;
    }
    if (config.defaultModel) {
      this.config.defaultModel = config.defaultModel;
      localStorage.setItem(this.MODEL_STORAGE, config.defaultModel);
    }
    if (config['organization']) {
      this.config.organization = config['organization'] as string;
    }
  }

  /**
   * Set API key (convenience method for settings UI)
   */
  setApiKey(apiKey: string): void {
    this.configure({ apiKey });
    console.log('[OpenAI] API key configured');
  }

  /**
   * Clear API key (for logout)
   */
  clearApiKey(): void {
    this.config.apiKey = '';
    localStorage.removeItem(this.API_KEY_STORAGE);
    console.log('[OpenAI] API key cleared');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let providerInstance: OpenAIModelProvider | null = null;

/**
 * Get or create the OpenAI model provider
 */
export function getOpenAIModelProvider(): OpenAIModelProvider {
  if (!providerInstance) {
    providerInstance = new OpenAIModelProvider();
  }
  return providerInstance;
}
