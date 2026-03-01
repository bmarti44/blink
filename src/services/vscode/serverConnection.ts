/**
 * Server Connection Service
 *
 * Provides IPC communication with the Rust backend for extension host operations.
 * This service acts as a bridge between the frontend and the extension host manager.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ============================================================================
// Types
// ============================================================================

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  sortText?: string;
  filterText?: string;
  textEdit?: TextEdit;
  additionalTextEdits?: TextEdit[];
}

export interface CompletionList {
  isIncomplete: boolean;
  items: CompletionItem[];
}

export interface Hover {
  contents: Array<string | { language: string; value: string }>;
  range?: Range;
}

export interface Diagnostic {
  range: Range;
  message: string;
  severity: number;
  source?: string;
  code?: string;
}

export interface DocumentSymbol {
  name: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  detail?: string;
  children?: DocumentSymbol[];
}

export interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  command?: Command;
}

export interface Command {
  title: string;
  command: string;
  arguments?: unknown[];
}

export interface WorkspaceEdit {
  changes: Record<string, TextEdit[]>;
}

export interface SignatureHelp {
  signatures: SignatureInformation[];
  activeSignature: number;
  activeParameter: number;
}

export interface SignatureInformation {
  label: string;
  documentation?: string;
  parameters?: ParameterInformation[];
}

export interface ParameterInformation {
  label: string;
  documentation?: string;
}

export interface ExtensionHostEvent {
  type: string;
  [key: string]: unknown;
}

export interface ServerConnectionOptions {
  autoReconnect?: boolean;
  reconnectDelay?: number;
  timeout?: number;
}

// ============================================================================
// Service
// ============================================================================

class ServerConnectionService {
  private listeners: Map<string, UnlistenFn[]> = new Map();
  private isConnected = false;
  private options: Required<ServerConnectionOptions>;

  constructor(options: ServerConnectionOptions = {}) {
    this.options = {
      autoReconnect: options.autoReconnect ?? true,
      reconnectDelay: options.reconnectDelay ?? 1000,
      timeout: options.timeout ?? 30000,
    };
  }

  // ========== Connection Management ==========

  /**
   * Start extension host and establish connection
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log('[ServerConnection] Already connected');
      return;
    }

    console.log('[ServerConnection] Starting extension host...');
    await invoke('start_extension_host');
    this.isConnected = true;

    // Wait for ready event
    await this.waitForReady();
    console.log('[ServerConnection] Extension host ready');
  }

  /**
   * Wait for extension host to be ready
   */
  private async waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for extension host to be ready'));
      }, this.options.timeout);

      const checkReady = async () => {
        try {
          const ready = await invoke<boolean>('is_extension_host_ready');
          if (ready) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkReady, 100);
          }
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };
      checkReady();
    });
  }

  /**
   * Disconnect from extension host
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    console.log('[ServerConnection] Stopping extension host...');
    await invoke('stop_extension_host');
    this.isConnected = false;

    // Clean up listeners
    for (const unlisteners of this.listeners.values()) {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    }
    this.listeners.clear();
    console.log('[ServerConnection] Disconnected');
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  // ========== Workspace ==========

  /**
   * Set workspace folder
   */
  async setWorkspaceFolder(path: string): Promise<void> {
    const requestId = this.generateRequestId();
    await invoke('set_extension_host_workspace', { requestId, path });
    await this.waitForResponse(requestId);
  }

  // ========== Extension Management ==========

  /**
   * Activate an extension
   */
  async activateExtension(extensionPath: string, extensionId: string): Promise<void> {
    const requestId = this.generateRequestId();
    await invoke('activate_extension', { requestId, extensionPath, extensionId });
    await this.waitForResponse(requestId);
  }

  /**
   * Deactivate an extension
   */
  async deactivateExtension(extensionId: string): Promise<void> {
    const requestId = this.generateRequestId();
    await invoke('deactivate_extension', { requestId, extensionId });
    await this.waitForResponse(requestId);
  }

  /**
   * Get list of activated extensions
   */
  async getActivatedExtensions(): Promise<string[]> {
    const requestId = this.generateRequestId();
    await invoke('get_activated_extensions', { requestId });
    const response = await this.waitForResponse(requestId);
    return (response as { extensions?: string[] }).extensions || [];
  }

  /**
   * Execute an extension command
   */
  async executeCommand<T = unknown>(command: string, ...args: unknown[]): Promise<T> {
    const requestId = this.generateRequestId();
    await invoke('execute_extension_command', { requestId, command, args });
    const response = await this.waitForResponse(requestId);
    return response as T;
  }

  // ========== Document Management ==========

  /**
   * Open document in extension host
   */
  async openDocument(path: string): Promise<void> {
    const requestId = this.generateRequestId();
    await invoke('extension_host_open_document', { requestId, path });
    await this.waitForResponse(requestId);
  }

  /**
   * Update document in extension host
   */
  async updateDocument(uri: string, content: string): Promise<void> {
    const requestId = this.generateRequestId();
    await invoke('extension_host_update_document', { requestId, uri, content });
    await this.waitForResponse(requestId);
  }

  /**
   * Close document in extension host
   */
  async closeDocument(uri: string): Promise<void> {
    const requestId = this.generateRequestId();
    await invoke('extension_host_close_document', { requestId, uri });
    await this.waitForResponse(requestId);
  }

  // ========== Language Features ==========

  /**
   * Request completions
   */
  async provideCompletionItems(
    uri: string,
    line: number,
    character: number,
    triggerCharacter?: string
  ): Promise<CompletionItem[]> {
    const requestId = this.generateRequestId();
    await invoke('request_completion', {
      requestId,
      uri,
      line,
      character,
      triggerCharacter,
    });

    const response = await this.waitForResponse(requestId);
    return (response as { items?: CompletionItem[] }).items || [];
  }

  /**
   * Request hover
   */
  async provideHover(uri: string, line: number, character: number): Promise<Hover | null> {
    const requestId = this.generateRequestId();
    await invoke('request_hover', { requestId, uri, line, character });

    const response = await this.waitForResponse(requestId);
    const items = (response as { items?: Hover[] }).items;
    return items?.[0] || null;
  }

  /**
   * Request definition
   */
  async provideDefinition(uri: string, line: number, character: number): Promise<Location[]> {
    const requestId = this.generateRequestId();
    await invoke('request_definition', { requestId, uri, line, character });

    const response = await this.waitForResponse(requestId);
    return (response as { items?: Location[] }).items || [];
  }

  /**
   * Request type definition
   */
  async provideTypeDefinition(uri: string, line: number, character: number): Promise<Location[]> {
    const requestId = this.generateRequestId();
    await invoke('request_type_definition', { requestId, uri, line, character });

    const response = await this.waitForResponse(requestId);
    return (response as { items?: Location[] }).items || [];
  }

  /**
   * Request references
   */
  async provideReferences(
    uri: string,
    line: number,
    character: number,
    includeDeclaration = true
  ): Promise<Location[]> {
    const requestId = this.generateRequestId();
    await invoke('request_references', {
      requestId,
      uri,
      line,
      character,
      includeDeclaration,
    });

    const response = await this.waitForResponse(requestId);
    return (response as { items?: Location[] }).items || [];
  }

  /**
   * Request document symbols
   */
  async provideDocumentSymbols(uri: string): Promise<DocumentSymbol[]> {
    const requestId = this.generateRequestId();
    await invoke('request_document_symbols', { requestId, uri });

    const response = await this.waitForResponse(requestId);
    return (response as { items?: DocumentSymbol[] }).items || [];
  }

  /**
   * Request code actions
   */
  async provideCodeActions(
    uri: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
    only?: string[]
  ): Promise<CodeAction[]> {
    const requestId = this.generateRequestId();
    await invoke('request_code_actions', {
      requestId,
      uri,
      startLine,
      startCharacter,
      endLine,
      endCharacter,
      only,
    });

    const response = await this.waitForResponse(requestId);
    return (response as { items?: CodeAction[] }).items || [];
  }

  /**
   * Request formatting
   */
  async provideFormatting(
    uri: string,
    tabSize?: number,
    insertSpaces?: boolean
  ): Promise<TextEdit[]> {
    const requestId = this.generateRequestId();
    await invoke('request_formatting', { requestId, uri, tabSize, insertSpaces });

    const response = await this.waitForResponse(requestId);
    return (response as { items?: TextEdit[] }).items || [];
  }

  /**
   * Request signature help
   */
  async provideSignatureHelp(
    uri: string,
    line: number,
    character: number
  ): Promise<SignatureHelp | null> {
    const requestId = this.generateRequestId();
    await invoke('request_signature_help', { requestId, uri, line, character });

    const response = await this.waitForResponse(requestId);
    const items = (response as { items?: SignatureHelp[] }).items;
    return items?.[0] || null;
  }

  // ========== Event Subscriptions ==========

  /**
   * Subscribe to extension host events
   */
  async onEvent(
    eventName: string,
    callback: (event: ExtensionHostEvent) => void
  ): Promise<() => void> {
    const unlisten = await listen<ExtensionHostEvent>(eventName, (event) => {
      callback(event.payload);
    });

    const listeners = this.listeners.get(eventName) || [];
    listeners.push(unlisten);
    this.listeners.set(eventName, listeners);

    return unlisten;
  }

  /**
   * Subscribe to diagnostics
   */
  async onDiagnostics(
    callback: (uri: string, diagnostics: Diagnostic[]) => void
  ): Promise<() => void> {
    return this.onEvent('extension-host-diagnostics', (event) => {
      callback(event.uri as string, event.diagnostics as Diagnostic[]);
    });
  }

  /**
   * Subscribe to notifications
   */
  async onNotification(
    callback: (level: string, message: string) => void
  ): Promise<() => void> {
    return this.onEvent('extension-host-notification', (event) => {
      callback(event.level as string, event.message as string);
    });
  }

  /**
   * Subscribe to output channel
   */
  async onOutput(callback: (channel: string, text: string) => void): Promise<() => void> {
    return this.onEvent('extension-host-output', (event) => {
      callback(event.channel as string, event.text as string);
    });
  }

  /**
   * Subscribe to provider registration
   */
  async onProviderRegistered(
    callback: (kind: string, id: string, selector: unknown) => void
  ): Promise<() => void> {
    return this.onEvent('extension-host-register-provider', (event) => {
      callback(event.kind as string, event.id as string, event.selector);
    });
  }

  /**
   * Subscribe to command registration
   */
  async onCommandRegistered(callback: (command: string) => void): Promise<() => void> {
    return this.onEvent('extension-host-register-command', (event) => {
      callback(event.command as string);
    });
  }

  /**
   * Subscribe to ready event
   */
  async onReady(callback: () => void): Promise<() => void> {
    return this.onEvent('extension-host-ready', callback);
  }

  /**
   * Subscribe to exit event
   */
  async onExit(callback: () => void): Promise<() => void> {
    return this.onEvent('extension-host-exit', callback);
  }

  // ========== Helpers ==========

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private async waitForResponse(requestId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const eventName = `extension-host-response-${requestId}`;
      const timeout = setTimeout(() => {
        reject(new Error('Request timed out'));
      }, this.options.timeout);

      listen(eventName, (event) => {
        clearTimeout(timeout);
        const payload = event.payload as {
          success?: boolean;
          error?: string;
          [key: string]: unknown;
        };
        if (payload.error) {
          reject(new Error(payload.error));
        } else {
          resolve(payload);
        }
      });
    });
  }
}

// Export singleton
export const serverConnection = new ServerConnectionService();

// Export class for custom instances
export { ServerConnectionService };

// ============================================================================
// Channel-based Connection (uses new channel router)
// ============================================================================

export interface ChannelCallResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Channel-based connection service using the openvscode-server style channel router.
 * This provides a more flexible IPC mechanism compared to direct invoke calls.
 */
class ChannelConnectionService {
  private connectionId: string | null = null;
  private listeners: Map<string, UnlistenFn[]> = new Map();
  private isInitialized = false;

  /**
   * Initialize the channel router
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    await invoke('init_channel_router');
    this.isInitialized = true;
    console.log('[ChannelConnection] Router initialized');
  }

  /**
   * Spawn a new extension host connection
   */
  async spawnConnection(connectionId?: string): Promise<string> {
    await this.initialize();
    const id = await invoke<string>('spawn_extension_host_connection', { connectionId });
    this.connectionId = id;
    console.log('[ChannelConnection] Spawned connection:', id);
    return id;
  }

  /**
   * Terminate an extension host connection
   */
  async terminateConnection(connectionId?: string): Promise<void> {
    const id = connectionId ?? this.connectionId;
    if (!id) {
      throw new Error('No connection to terminate');
    }
    await invoke('terminate_extension_host_connection', { connectionId: id });
    if (id === this.connectionId) {
      this.connectionId = null;
    }
    console.log('[ChannelConnection] Terminated connection:', id);
  }

  /**
   * Check if a connection is ready
   */
  async isConnectionReady(connectionId?: string): Promise<boolean> {
    const id = connectionId ?? this.connectionId;
    if (!id) return false;
    return await invoke<boolean>('is_extension_host_connection_ready', { connectionId: id });
  }

  /**
   * Get all active connections
   */
  async listConnections(): Promise<string[]> {
    return await invoke<string[]>('list_extension_host_connections');
  }

  /**
   * Call a channel method
   */
  async call<T = unknown>(
    channel: string,
    command: string,
    args: unknown[] = [],
    sessionId?: string
  ): Promise<T> {
    await this.initialize();
    const response = await invoke<ChannelCallResponse>('channel_call', {
      request: {
        channel,
        command,
        args,
        sessionId: sessionId ?? this.connectionId ?? 'default',
      },
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Channel call failed');
    }

    return response.data as T;
  }

  // ========== Extension Host Channel Methods ==========

  /**
   * Activate an extension via channel
   */
  async activateExtension(extensionPath: string, extensionId: string): Promise<void> {
    await this.call('extensionHost', 'activateExtension', [extensionPath, extensionId]);
  }

  /**
   * Deactivate an extension via channel
   */
  async deactivateExtension(extensionId: string): Promise<void> {
    await this.call('extensionHost', 'deactivateExtension', [extensionId]);
  }

  /**
   * Get activated extensions via channel
   */
  async getActivatedExtensions(): Promise<string[]> {
    const result = await this.call<{ extensions?: string[] }>(
      'extensionHost',
      'getActivatedExtensions'
    );
    return result.extensions ?? [];
  }

  /**
   * Execute command via channel
   */
  async executeCommand<T = unknown>(command: string, args: unknown[] = []): Promise<T> {
    return await this.call<T>('extensionHost', 'executeCommand', [command, args]);
  }

  /**
   * Open document via channel
   */
  async openDocument(path: string): Promise<void> {
    await this.call('extensionHost', 'openDocument', [path]);
  }

  /**
   * Update document via channel
   */
  async updateDocument(uri: string, content: string): Promise<void> {
    await this.call('extensionHost', 'updateDocument', [uri, content]);
  }

  /**
   * Close document via channel
   */
  async closeDocument(uri: string): Promise<void> {
    await this.call('extensionHost', 'closeDocument', [uri]);
  }

  /**
   * Provide completions via channel
   */
  async provideCompletionItems(
    uri: string,
    line: number,
    character: number,
    triggerCharacter?: string
  ): Promise<CompletionItem[]> {
    const result = await this.call<{ items?: CompletionItem[] }>(
      'extensionHost',
      'provideCompletionItems',
      [uri, line, character, triggerCharacter]
    );
    return result.items ?? [];
  }

  /**
   * Provide hover via channel
   */
  async provideHover(uri: string, line: number, character: number): Promise<Hover | null> {
    const result = await this.call<{ items?: Hover[] }>(
      'extensionHost',
      'provideHover',
      [uri, line, character]
    );
    return result.items?.[0] ?? null;
  }

  /**
   * Provide definition via channel
   */
  async provideDefinition(uri: string, line: number, character: number): Promise<Location[]> {
    const result = await this.call<{ items?: Location[] }>(
      'extensionHost',
      'provideDefinition',
      [uri, line, character]
    );
    return result.items ?? [];
  }

  /**
   * Provide references via channel
   */
  async provideReferences(
    uri: string,
    line: number,
    character: number,
    includeDeclaration = true
  ): Promise<Location[]> {
    const result = await this.call<{ items?: Location[] }>(
      'extensionHost',
      'provideReferences',
      [uri, line, character, includeDeclaration]
    );
    return result.items ?? [];
  }

  /**
   * Provide document symbols via channel
   */
  async provideDocumentSymbols(uri: string): Promise<DocumentSymbol[]> {
    const result = await this.call<{ items?: DocumentSymbol[] }>(
      'extensionHost',
      'provideDocumentSymbols',
      [uri]
    );
    return result.items ?? [];
  }

  /**
   * Provide code actions via channel
   */
  async provideCodeActions(
    uri: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
    only?: string[]
  ): Promise<CodeAction[]> {
    const result = await this.call<{ items?: CodeAction[] }>(
      'extensionHost',
      'provideCodeActions',
      [uri, startLine, startCharacter, endLine, endCharacter, only]
    );
    return result.items ?? [];
  }

  /**
   * Provide formatting via channel
   */
  async provideFormatting(
    uri: string,
    tabSize?: number,
    insertSpaces?: boolean
  ): Promise<TextEdit[]> {
    const result = await this.call<{ items?: TextEdit[] }>(
      'extensionHost',
      'provideFormatting',
      [uri, tabSize, insertSpaces]
    );
    return result.items ?? [];
  }

  /**
   * Provide signature help via channel
   */
  async provideSignatureHelp(
    uri: string,
    line: number,
    character: number
  ): Promise<SignatureHelp | null> {
    const result = await this.call<{ items?: SignatureHelp[] }>(
      'extensionHost',
      'provideSignatureHelp',
      [uri, line, character]
    );
    return result.items?.[0] ?? null;
  }

  /**
   * Set workspace folder via channel
   */
  async setWorkspaceFolder(path: string): Promise<void> {
    await this.call('extensionHost', 'setWorkspaceFolder', [path]);
  }

  /**
   * Ping extension host via channel
   */
  async ping(): Promise<boolean> {
    const result = await this.call<{ pong?: boolean }>('extensionHost', 'ping');
    return result.pong ?? false;
  }

  /**
   * Check if extension host is ready via channel
   */
  async isReady(): Promise<boolean> {
    return await this.call<boolean>('extensionHost', 'isReady');
  }

  // ========== Event Subscriptions ==========

  /**
   * Subscribe to extension host events
   */
  async onEvent(
    eventName: string,
    callback: (event: ExtensionHostEvent) => void
  ): Promise<() => void> {
    const unlisten = await listen<ExtensionHostEvent>(eventName, (event) => {
      callback(event.payload);
    });

    const listeners = this.listeners.get(eventName) || [];
    listeners.push(unlisten);
    this.listeners.set(eventName, listeners);

    return unlisten;
  }

  /**
   * Subscribe to ready event
   */
  async onReady(callback: (connectionId: string) => void): Promise<() => void> {
    return this.onEvent('extension-host-ready', (event) => {
      callback(event.connectionId as string);
    });
  }

  /**
   * Subscribe to exit event
   */
  async onExit(callback: (connectionId: string, code?: number) => void): Promise<() => void> {
    return this.onEvent('extension-host-exit', (event) => {
      callback(event.connectionId as string, event.code as number | undefined);
    });
  }

  /**
   * Subscribe to diagnostics
   */
  async onDiagnostics(
    callback: (uri: string, diagnostics: Diagnostic[]) => void
  ): Promise<() => void> {
    return this.onEvent('extension-host-diagnostics', (event) => {
      callback(event.uri as string, event.diagnostics as Diagnostic[]);
    });
  }

  /**
   * Subscribe to notifications
   */
  async onNotification(
    callback: (level: string, message: string) => void
  ): Promise<() => void> {
    return this.onEvent('extension-host-notification', (event) => {
      callback(event.level as string, event.message as string);
    });
  }

  /**
   * Subscribe to output
   */
  async onOutput(callback: (channel: string, text: string) => void): Promise<() => void> {
    return this.onEvent('extension-host-output', (event) => {
      callback(event.channel as string, event.text as string);
    });
  }

  /**
   * Subscribe to provider registration
   */
  async onProviderRegistered(
    callback: (kind: string, id: string, selector: unknown) => void
  ): Promise<() => void> {
    return this.onEvent('extension-host-register-provider', (event) => {
      callback(event.kind as string, event.id as string, event.selector);
    });
  }

  /**
   * Subscribe to command registration
   */
  async onCommandRegistered(callback: (command: string) => void): Promise<() => void> {
    return this.onEvent('extension-host-register-command', (event) => {
      callback(event.command as string);
    });
  }

  /**
   * Clean up all listeners
   */
  cleanup(): void {
    for (const unlisteners of this.listeners.values()) {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    }
    this.listeners.clear();
  }
}

// Export channel connection singleton
export const channelConnection = new ChannelConnectionService();

// Export class for custom instances
export { ChannelConnectionService };
