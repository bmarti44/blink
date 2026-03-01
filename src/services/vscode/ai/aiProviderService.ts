/**
 * Generic AI Provider Service
 *
 * Supports Anthropic, OpenAI, and any OpenAI-compatible provider via API key.
 * Config is stored in localStorage and managed via the "Blink: Configure AI Provider" command.
 */

const STORAGE_KEY = 'blink-ai-provider-config';

export type ProviderType = 'anthropic' | 'openai' | 'custom';

export interface AIProviderConfig {
  type: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string; // required for 'custom', optional override for others
}

export const PROVIDER_DEFAULTS: Record<ProviderType, { label: string; baseUrl: string; defaultModel: string }> = {
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-4-6',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4o',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    defaultModel: 'gpt-4o',
  },
};

export interface ConversationMessage {
  role: 'user' | 'system' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Config storage
// ---------------------------------------------------------------------------

export function getAIProviderConfig(): AIProviderConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as AIProviderConfig;
  } catch {
    return null;
  }
}

export function setAIProviderConfig(config: AIProviderConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  console.log('[AIProvider] Config saved, provider:', config.type, 'model:', config.model);
}

export function clearAIProviderConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
  console.log('[AIProvider] Config cleared');
}

export function isAIProviderConfigured(): boolean {
  const config = getAIProviderConfig();
  return !!(config?.apiKey);
}

// ---------------------------------------------------------------------------
// Streaming chat
// ---------------------------------------------------------------------------

export async function streamChat(
  messages: ConversationMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<string> {
  const config = getAIProviderConfig();
  if (!config?.apiKey) {
    callbacks.onError(
      new Error('No AI provider configured. Open the Command Palette and run "Blink: Configure AI Provider".'),
    );
    return '';
  }

  try {
    if (config.type === 'anthropic') {
      return await streamAnthropic(messages, config, callbacks, signal);
    } else {
      return await streamOpenAI(messages, config, callbacks, signal);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return '';
    }
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    return '';
  }
}

// ---------------------------------------------------------------------------
// Anthropic streaming
// ---------------------------------------------------------------------------

async function streamAnthropic(
  messages: ConversationMessage[],
  config: AIProviderConfig,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<string> {
  const systemMessages = messages.filter(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const system = systemMessages.map(m => m.content).join('\n') || undefined;

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: 8096,
    stream: true,
    messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
  };
  if (system) body.system = system;

  const baseUrl = config.baseUrl || PROVIDER_DEFAULTS.anthropic.baseUrl;
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    callbacks.onError(new Error(`Anthropic API error ${res.status}: ${text}`));
    return '';
  }

  return readSSEStream(res, callbacks, (data) => {
    // Anthropic SSE format: event: content_block_delta / data: {"delta":{"text":"..."}}
    return data?.delta?.text ?? '';
  });
}

// ---------------------------------------------------------------------------
// OpenAI / custom streaming
// ---------------------------------------------------------------------------

async function streamOpenAI(
  messages: ConversationMessage[],
  config: AIProviderConfig,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = config.baseUrl || PROVIDER_DEFAULTS[config.type as 'openai' | 'custom']?.baseUrl || 'https://api.openai.com';

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    callbacks.onError(new Error(`API error ${res.status}: ${text}`));
    return '';
  }

  return readSSEStream(res, callbacks, (data) => {
    // OpenAI SSE format: data: {"choices":[{"delta":{"content":"..."}}]}
    return data?.choices?.[0]?.delta?.content ?? '';
  });
}

// ---------------------------------------------------------------------------
// Shared SSE reader
// ---------------------------------------------------------------------------

async function readSSEStream(
  res: Response,
  callbacks: StreamCallbacks,
  extractText: (parsed: unknown) => string,
): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const parsed = JSON.parse(raw);
        const text = extractText(parsed);
        if (text) {
          full += text;
          callbacks.onToken(text);
        }
      } catch {
        // incomplete JSON chunk — skip
      }
    }
  }

  callbacks.onComplete(full);
  return full;
}
