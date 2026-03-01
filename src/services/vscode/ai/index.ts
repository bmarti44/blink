/**
 * Blink AI Module
 *
 * Provides model provider abstraction and implementations.
 */

// Model Provider Abstraction
export {
  type ModelProvider,
  type ModelInfo,
  type ConversationMessage,
  type StreamingCallbacks,
  type CompletionOptions,
  type ProviderConfig,
  getModelProviderRegistry,
  getActiveModelProvider,
  hasModelProvider,
  getCompletion,
  cancelCompletion,
} from './modelProvider';

// AI Chat Service
export {
  AIService,
  getAIService,
  isAIConfigured,
  promptConfigureAIProvider,
  clearAIConfig,
  type AIServiceConfig,
  AIError,
} from './chatService';

// Re-export streaming types
export type { ConversationMessage as ChatMessage, StreamCallbacks } from './chatService';

// Default AI Provider
export { AIModelProvider, getDefaultAIProvider } from './chatProvider';

// OpenAI Provider
export { OpenAIModelProvider, getOpenAIModelProvider } from './openaiProvider';

// AI Provider Service (config storage + streaming)
export {
  getAIProviderConfig,
  setAIProviderConfig,
  clearAIProviderConfig,
  isAIProviderConfigured,
  streamChat,
  PROVIDER_DEFAULTS,
  type AIProviderConfig,
  type ProviderType,
} from './aiProviderService';

// ============================================================================
// Initialization
// ============================================================================

import { getModelProviderRegistry } from './modelProvider';
import { getDefaultAIProvider } from './chatProvider';
import { getOpenAIModelProvider } from './openaiProvider';

let initialized = false;

/**
 * Initialize and register all model providers
 * Call this during workbench startup
 */
export function initializeModelProviders(): void {
  if (initialized) {
    return;
  }

  const registry = getModelProviderRegistry();

  // Register default AI provider
  registry.register(getDefaultAIProvider());

  // Register OpenAI provider (optional, needs API key)
  registry.register(getOpenAIModelProvider());

  initialized = true;
  console.log('[AI] Model providers initialized');

  // Expose for testing
  (window as any).__MODEL_PROVIDER_REGISTRY__ = registry;
}

/**
 * Get provider by ID (for settings UI)
 */
export function getProviderById(id: string) {
  return getModelProviderRegistry().getProvider(id);
}

/**
 * List all available providers (for settings UI)
 */
export function listProviders() {
  return getModelProviderRegistry().getAllProviders().map((p) => ({
    id: p.id,
    name: p.name,
    configured: p.isConfigured(),
    authenticated: p.isAuthenticated(),
  }));
}

/**
 * Switch active provider (for settings UI)
 */
export function switchProvider(providerId: string): boolean {
  return getModelProviderRegistry().setActiveProvider(providerId);
}
