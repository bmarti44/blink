/**
 * Model Provider Abstraction Layer
 *
 * Provides a unified interface for AI model providers.
 * Allows switching between Anthropic, OpenAI, Anthropic, local models, etc.
 *
 * P0 Feature - Critical for model provider flexibility
 */

// ============================================================================
// Types
// ============================================================================

export interface ConversationMessage {
  role: 'user' | 'system' | 'assistant';
  content: string;
}

export interface StreamingCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  provider: string;
}

export interface ProviderConfig {
  enabled: boolean;
  apiKey?: string;
  endpoint?: string;
  defaultModel?: string;
  [key: string]: unknown;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

// ============================================================================
// Model Provider Interface
// ============================================================================

/**
 * Interface that all model providers must implement
 */
export interface ModelProvider {
  /** Unique identifier for the provider */
  readonly id: string;

  /** Display name for the provider */
  readonly name: string;

  /** Check if provider is configured and ready */
  isConfigured(): boolean;

  /** Check if provider is authenticated (if auth required) */
  isAuthenticated(): boolean;

  /** Start authentication flow (if required) */
  authenticate(): Promise<void>;

  /** Get list of available models */
  getModels(): Promise<ModelInfo[]>;

  /** Send a prompt and receive streaming response */
  getCompletion(
    messages: ConversationMessage[],
    callbacks: StreamingCallbacks,
    options?: CompletionOptions
  ): Promise<string>;

  /** Cancel current request */
  cancel(): void;

  /** Update provider configuration */
  configure(config: Partial<ProviderConfig>): void;
}

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Registry for managing model providers
 */
class ModelProviderRegistry {
  private providers: Map<string, ModelProvider> = new Map();
  private activeProviderId: string | null = null;

  /** Storage key for active provider */
  private readonly STORAGE_KEY = 'blink-active-model-provider';

  constructor() {
    // Load saved active provider preference
    this.activeProviderId = localStorage.getItem(this.STORAGE_KEY);
  }

  /**
   * Register a new provider
   */
  register(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
    console.log(`[ModelProvider] Registered provider: ${provider.id}`);

    // If no active provider and this one is configured, make it active
    if (!this.activeProviderId && provider.isConfigured()) {
      this.setActiveProvider(provider.id);
    }
  }

  /**
   * Unregister a provider
   */
  unregister(providerId: string): void {
    this.providers.delete(providerId);
    if (this.activeProviderId === providerId) {
      this.activeProviderId = null;
      localStorage.removeItem(this.STORAGE_KEY);
    }
    console.log(`[ModelProvider] Unregistered provider: ${providerId}`);
  }

  /**
   * Get a provider by ID
   */
  getProvider(providerId: string): ModelProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): ModelProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get configured (ready to use) providers
   */
  getConfiguredProviders(): ModelProvider[] {
    return this.getAllProviders().filter((p) => p.isConfigured());
  }

  /**
   * Set the active provider
   */
  setActiveProvider(providerId: string): boolean {
    const provider = this.providers.get(providerId);
    if (!provider) {
      console.warn(`[ModelProvider] Provider not found: ${providerId}`);
      return false;
    }

    this.activeProviderId = providerId;
    localStorage.setItem(this.STORAGE_KEY, providerId);
    console.log(`[ModelProvider] Active provider set to: ${providerId}`);
    return true;
  }

  /**
   * Get the active provider
   */
  getActiveProvider(): ModelProvider | null {
    if (!this.activeProviderId) {
      // Return first configured provider as fallback
      const configured = this.getConfiguredProviders();
      return configured[0] || null;
    }
    return this.providers.get(this.activeProviderId) || null;
  }

  /**
   * Get active provider ID
   */
  getActiveProviderId(): string | null {
    return this.activeProviderId || this.getActiveProvider()?.id || null;
  }

  /**
   * Check if any provider is configured
   */
  hasConfiguredProvider(): boolean {
    return this.getConfiguredProviders().length > 0;
  }

  /**
   * Get all available models across all configured providers
   */
  async getAllModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    const providers = this.getConfiguredProviders();

    for (const provider of providers) {
      try {
        const providerModels = await provider.getModels();
        models.push(...providerModels);
      } catch (error) {
        console.warn(`[ModelProvider] Failed to get models from ${provider.id}:`, error);
      }
    }

    return models;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let registryInstance: ModelProviderRegistry | null = null;

/**
 * Get the model provider registry
 */
export function getModelProviderRegistry(): ModelProviderRegistry {
  if (!registryInstance) {
    registryInstance = new ModelProviderRegistry();
  }
  return registryInstance;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get the active model provider
 */
export function getActiveModelProvider(): ModelProvider | null {
  return getModelProviderRegistry().getActiveProvider();
}

/**
 * Check if any model provider is configured
 */
export function hasModelProvider(): boolean {
  return getModelProviderRegistry().hasConfiguredProvider();
}

/**
 * Get completion from active provider
 */
export async function getCompletion(
  messages: ConversationMessage[],
  callbacks: StreamingCallbacks,
  options?: CompletionOptions
): Promise<string> {
  const provider = getActiveModelProvider();
  if (!provider) {
    callbacks.onError(new Error('No model provider configured'));
    return '';
  }

  if (!provider.isAuthenticated()) {
    callbacks.onError(new Error('Model provider not authenticated'));
    return '';
  }

  return provider.getCompletion(messages, callbacks, options);
}

/**
 * Cancel current request from active provider
 */
export function cancelCompletion(): void {
  const provider = getActiveModelProvider();
  provider?.cancel();
}
