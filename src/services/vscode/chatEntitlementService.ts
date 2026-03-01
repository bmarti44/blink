/**
 * Blink Chat Entitlement Service
 *
 * Custom implementation of IChatEntitlementService that bypasses VS Code's
 * default Copilot authentication UI and uses Blink AI instead.
 *
 * This service tells VS Code that the user is "entitled" so it doesn't show
 * the GitHub/Google/Apple login overlay.
 */

import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import { Disposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import type { CancellationToken } from '@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation';
import type { IChatEntitlementService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/chat/common/chatEntitlementService.service';
import { ChatEntitlement, type IQuotas, type IChatSentiment } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/chat/common/chatEntitlementService';
import { isAIConfigured, promptConfigureAIProvider } from './ai/chatService';

export class ChatEntitlementService extends Disposable implements IChatEntitlementService {
  declare readonly _serviceBrand: undefined;

  private readonly _onDidChangeEntitlement = this._register(new Emitter<void>());
  readonly onDidChangeEntitlement: Event<void> = this._onDidChangeEntitlement.event;

  private readonly _onDidChangeQuotaExceeded = this._register(new Emitter<void>());
  readonly onDidChangeQuotaExceeded: Event<void> = this._onDidChangeQuotaExceeded.event;

  private readonly _onDidChangeQuotaRemaining = this._register(new Emitter<void>());
  readonly onDidChangeQuotaRemaining: Event<void> = this._onDidChangeQuotaRemaining.event;

  private readonly _onDidChangeSentiment = this._register(new Emitter<void>());
  readonly onDidChangeSentiment: Event<void> = this._onDidChangeSentiment.event;

  private readonly _onDidChangeAnonymous = this._register(new Emitter<void>());
  readonly onDidChangeAnonymous: Event<void> = this._onDidChangeAnonymous.event;

  // Use Enterprise level to bypass all Copilot-specific code paths
  readonly entitlementObs = {
    read: () => ChatEntitlement.Enterprise,
    get: () => ChatEntitlement.Enterprise,
  } as any;

  readonly sentimentObs = {
    read: () => this.sentiment,
    get: () => this.sentiment,
  } as any;

  readonly anonymousObs = {
    read: () => false,
    get: () => false,
  } as any;

  get entitlement(): ChatEntitlement {
    return ChatEntitlement.Enterprise;
  }

  get anonymous(): boolean {
    return false;
  }

  get isInternal(): boolean {
    return true;
  }

  get organisations(): string[] | undefined {
    return ['blink'];
  }

  get sku(): string | undefined {
    return 'blink-ai';
  }

  get quotas(): IQuotas {
    return {
      chat: {
        total: 999999,
        remaining: 999999,
        percentRemaining: 100,
        overageEnabled: false,
        overageCount: 0,
        unlimited: true,
      },
      completions: {
        total: 999999,
        remaining: 999999,
        percentRemaining: 100,
        overageEnabled: false,
        overageCount: 0,
        unlimited: true,
      },
    };
  }

  get sentiment(): IChatSentiment {
    return {
      installed: true,
      registered: true,
      hidden: false,
      disabled: false,
      untrusted: false,
      later: false,
    };
  }

  constructor() {
    super();
    console.log('[ChatEntitlement] Service initialized - bypassing Copilot auth UI');

    if (!isAIConfigured()) {
      console.log('[ChatEntitlement] No AI provider configured yet');
    } else {
      console.log('[ChatEntitlement] AI provider configured');
    }
  }

  async update(_token: CancellationToken): Promise<void> {
    console.log('[ChatEntitlement] Update called');

    if (!isAIConfigured()) {
      console.log('[ChatEntitlement] Prompting to configure AI provider...');
      try {
        await promptConfigureAIProvider();
        console.log('[ChatEntitlement] AI provider configured');
        this._onDidChangeEntitlement.fire();
      } catch (error) {
        console.error('[ChatEntitlement] AI provider configuration failed:', error);
      }
    }
  }
}

// Singleton instance
let instance: ChatEntitlementService | null = null;

export function getChatEntitlementService(): ChatEntitlementService {
  if (!instance) {
    instance = new ChatEntitlementService();
  }
  return instance;
}
