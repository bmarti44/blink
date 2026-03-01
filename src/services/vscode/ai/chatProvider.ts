/**
 * Default AI Model Provider
 *
 * Implements the ModelProvider interface using AIService.
 */

import type {
  ModelProvider,
  ModelInfo,
  ConversationMessage,
  StreamingCallbacks,
  CompletionOptions,
  ProviderConfig,
} from './modelProvider';
import { getAIService, type AIService, type AIServiceConfig } from './chatService';
import { getAIProviderConfig, PROVIDER_DEFAULTS } from './aiProviderService';

// ============================================================================
// AI Model Provider Implementation
// ============================================================================

export class AIModelProvider implements ModelProvider {
  readonly id = 'blink-ai';
  readonly name = 'Blink AI';

  private service: AIService;

  constructor(config?: AIServiceConfig) {
    this.service = getAIService(config);
  }

  isConfigured(): boolean {
    return this.service.isConfigured();
  }

  isAuthenticated(): boolean {
    return this.service.hasValidToken();
  }

  async authenticate(): Promise<void> {
    if (!this.service.isConfigured()) {
      throw new Error(
        'No AI provider configured. Open the Command Palette and run "Blink: Configure AI Provider".',
      );
    }
  }

  async getModels(): Promise<ModelInfo[]> {
    const config = getAIProviderConfig();
    if (!config) return [];

    const defaults = PROVIDER_DEFAULTS[config.type];
    return [
      {
        id: config.model,
        name: config.model,
        description: `${defaults.label} model`,
        provider: this.id,
      },
    ];
  }

  async getCompletion(
    messages: ConversationMessage[],
    callbacks: StreamingCallbacks,
    options?: CompletionOptions
  ): Promise<string> {
    return this.service.getPromptResponse(messages, callbacks, options?.model);
  }

  cancel(): void {
    this.service.cancel();
  }

  configure(config: Partial<ProviderConfig>): void {
    const serviceConfig: Partial<AIServiceConfig> = {};
    if (config.defaultModel) {
      serviceConfig.model = config.defaultModel;
    }
    this.service.updateConfig(serviceConfig);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let providerInstance: AIModelProvider | null = null;

export function getDefaultAIProvider(config?: AIServiceConfig): AIModelProvider {
  if (!providerInstance) {
    providerInstance = new AIModelProvider(config);
  }
  return providerInstance;
}
