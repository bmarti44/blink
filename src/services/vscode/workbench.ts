/**
 * VS Code Workbench Initialization
 *
 * This module provides the full VS Code workbench UI including:
 * - Activity bar (left vertical nav)
 * - Sidebar (explorer, search, etc.)
 * - Editor area with tabs
 * - Panel (terminal, problems, output)
 * - Status bar
 *
 * NOTE: MonacoEnvironment is configured by workerSetupEntry.ts which loads
 * as a separate entry point BEFORE this module.
 *
 * IMPORTANT: Extension imports are LAZY-LOADED inside doInitializeWorkbench()
 * to ensure MonacoEnvironment is fully set up before any extensions try to use workers.
 * DO NOT add static imports for @codingame/monaco-vscode-*-default-extension here!
 */

import * as monaco from 'monaco-editor';
import { initialize, IFileDialogService, getService } from '@codingame/monaco-vscode-api/services';
import { IWebviewWorkbenchService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService.service';
import type { WebviewInitInfo } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/webview/browser/webview';
import { initUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override';
import { initializeTauriFileSystem } from './tauriFileSystemProvider';
import { initializeVSCodeUserDataProvider } from './vsCodeUserDataProvider';
// Note: AI chat is only in auxiliary bar (right side)
import { registerAIChatAgent } from './aiChatAgent';
import { getBlinkThemeCSS } from './blinkDarkTheme';
import { registerWorkspaceCommands } from './workspaceCommands';
import { registerExtensionCommands } from './extensionCommands';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { TauriFileDialogService } from './tauriFileDialogService';
import { patchExtensionServices } from './extensionServiceOverride';
import { vscodeServerService } from './vscodeServerService';
import { initializeExtensionHost } from './extensionHostIntegration';
import { registerTabAutocomplete } from './tabAutocomplete';
import { registerInlineEdit } from './inlineEdit';
import { registerContextMentions } from './contextMentions';
import { registerDiffReview } from './diffReview';
import { registerTerminalAI } from './terminalAI';
import { registerPlanMode } from './planMode';
import { registerAgentMode } from './agentMode';
import { registerMultiFileEdit } from './multiFileEdit';
import { registerPersistentMemory } from './persistentMemory';
import { getChatEntitlementService } from './chatEntitlementService';
import { registerConfigureProviderCommand } from './ai/configureProviderCommand';
// Terminal provider is dynamically imported to avoid evaluating vscode types before API is ready

// Import user configuration
import userConfiguration from './userConfiguration.json';

// Storage key for workspace folder
const WORKSPACE_FOLDER_KEY = 'blink-workspace-folder';

// Service overrides for workbench
import getWorkbenchServiceOverride from '@codingame/monaco-vscode-workbench-service-override';
import getAccessibilityServiceOverride from '@codingame/monaco-vscode-accessibility-service-override';
import getAiServiceOverride from '@codingame/monaco-vscode-ai-service-override';
import getAuthenticationServiceOverride from '@codingame/monaco-vscode-authentication-service-override';
import getChatServiceOverride from '@codingame/monaco-vscode-chat-service-override';
import { IChatEntitlementService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/chat/common/chatEntitlementService.service';
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override';
import getDebugServiceOverride from '@codingame/monaco-vscode-debug-service-override';
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override';
import getEnvironmentServiceOverride from '@codingame/monaco-vscode-environment-service-override';
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override';
import getExtensionGalleryServiceOverride from '@codingame/monaco-vscode-extension-gallery-service-override';
import getExtensionsServiceOverride from '@codingame/monaco-vscode-extensions-service-override';
import getFilesServiceOverride from '@codingame/monaco-vscode-files-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override';
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override';
import getMarkersServiceOverride from '@codingame/monaco-vscode-markers-service-override';
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override';
import getNotificationsServiceOverride from '@codingame/monaco-vscode-notifications-service-override';
import getOutlineServiceOverride from '@codingame/monaco-vscode-outline-service-override';
import getOutputServiceOverride from '@codingame/monaco-vscode-output-service-override';
import getPreferencesServiceOverride from '@codingame/monaco-vscode-preferences-service-override';
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override';
import getRemoteAgentServiceOverride from '@codingame/monaco-vscode-remote-agent-service-override';
import getScmServiceOverride from '@codingame/monaco-vscode-scm-service-override';
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override';
import getSecretStorageServiceOverride from '@codingame/monaco-vscode-secret-storage-service-override';
import getSnippetsServiceOverride from '@codingame/monaco-vscode-snippets-service-override';
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override';
import getTerminalServiceOverride, { ITerminalInstanceService, ITerminalService } from '@codingame/monaco-vscode-terminal-service-override';
import { Registry } from '@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform';
import { TerminalExtensions } from '@codingame/monaco-vscode-api/vscode/vs/platform/terminal/common/terminal';
import { getTauriTerminalBackend } from './tauriTerminalBackend';
import getTestingServiceOverride from '@codingame/monaco-vscode-testing-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import getTimelineServiceOverride from '@codingame/monaco-vscode-timeline-service-override';
import getWorkspaceTrustServiceOverride from '@codingame/monaco-vscode-workspace-trust-service-override';
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override';
import getLocalizationServiceOverride from '@codingame/monaco-vscode-localization-service-override';
import getMcpServiceOverride from '@codingame/monaco-vscode-mcp-service-override';
import getBannerServiceOverride from '@codingame/monaco-vscode-view-banner-service-override';
import getStatusBarServiceOverride from '@codingame/monaco-vscode-view-status-bar-service-override';
import getTitleBarServiceOverride from '@codingame/monaco-vscode-view-title-bar-service-override';
import getViewCommonServiceOverride from '@codingame/monaco-vscode-view-common-service-override';
import { registerAssets } from '@codingame/monaco-vscode-api/assets';
// Custom Tauri update service
import { IUpdateService } from '@codingame/monaco-vscode-api/vscode/vs/platform/update/common/update.service';
import { SyncDescriptor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors';
import { TauriUpdateService } from './tauriUpdateService';

// Override webview asset URLs to use our patched files
// This is called AFTER view-common-service-override imports (which registers default assets)
// so our registration takes precedence
const webviewBasePath = `${window.location.origin}/vs/workbench/contrib/webview/browser/pre/`;
registerAssets({
  'vs/workbench/contrib/webview/browser/pre/index.html': () => `${webviewBasePath}index.html`,
  'vs/workbench/contrib/webview/browser/pre/fake.html': () => `${webviewBasePath}fake.html`,
  'vs/workbench/contrib/webview/browser/pre/service-worker.js': () => `${webviewBasePath}service-worker.js`,
});
console.log('[Workbench] Registered patched webview assets at:', webviewBasePath);

let workbenchInitialized = false;
let workbenchPromise: Promise<void> | null = null;
let servicesAlreadyInitialized = false;

// Check if monaco services were already initialized by another module (e.g., initialize.ts)
function checkMonacoServicesInitialized(): boolean {
  try {
    const isSet = !!(window as any).__MONACO_SERVICES_INITIALIZED__;
    console.log('[Workbench] checkMonacoServicesInitialized:', isSet);
    return isSet;
  } catch {
    console.log('[Workbench] checkMonacoServicesInitialized: error checking, returning false');
    return false;
  }
}

function markMonacoServicesInitialized(): void {
  (window as any).__MONACO_SERVICES_INITIALIZED__ = true;
}

/**
 * Decode a path that may be URL-encoded
 * Handles %20, %28, %29, etc. and ensures we get a proper file path
 */
function decodeFilePath(path: string): string {
  try {
    // Decode URI components to handle spaces (%20), parentheses (%28, %29), etc.
    const decoded = decodeURIComponent(path);
    // Validate the path doesn't contain remaining % sequences that look encoded
    // This catches double-encoding issues
    if (decoded.includes('%') && /%[0-9A-Fa-f]{2}/.test(decoded)) {
      // Try decoding again for double-encoded paths
      return decodeURIComponent(decoded);
    }
    return decoded;
  } catch {
    // If decoding fails, return the original path
    return path;
  }
}

/**
 * Get the workspace folder path from URL parameter or localStorage
 */
function getStoredWorkspaceFolder(): string | null {
  // First check URL parameter (for new windows)
  // With hash routing, params are in the hash: /#/vscode?folder=...
  const hash = window.location.hash;
  const hashQueryIndex = hash.indexOf('?');
  if (hashQueryIndex !== -1) {
    const hashParams = new URLSearchParams(hash.substring(hashQueryIndex));
    const folderFromHash = hashParams.get('folder');
    if (folderFromHash) {
      // Decode the path to handle spaces and special characters
      const decodedPath = decodeFilePath(folderFromHash);
      console.log('[Workbench] Folder from URL hash:', decodedPath);
      return decodedPath;
    }
  }

  // Also check regular query params (fallback)
  const urlParams = new URLSearchParams(window.location.search);
  const folderFromUrl = urlParams.get('folder');
  if (folderFromUrl) {
    // Decode the path to handle spaces and special characters
    return decodeFilePath(folderFromUrl);
  }

  // Fall back to localStorage (also decode in case it was stored encoded before fix)
  const storedPath = localStorage.getItem(WORKSPACE_FOLDER_KEY);
  return storedPath ? decodeFilePath(storedPath) : null;
}

/**
 * Store the workspace folder path
 */
function setStoredWorkspaceFolder(folderPath: string | null): void {
  if (folderPath) {
    localStorage.setItem(WORKSPACE_FOLDER_KEY, folderPath);
  } else {
    localStorage.removeItem(WORKSPACE_FOLDER_KEY);
  }
}

/**
 * Open a folder picker dialog and return the selected path
 */
async function pickFolder(): Promise<string | null> {
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Open Folder',
    });

    if (selected && typeof selected === 'string') {
      return selected;
    }
    return null;
  } catch (err) {
    console.error('[Workbench] Failed to open folder dialog:', err);
    return null;
  }
}

/**
 * Initialize the VS Code workbench into a container element
 */
export async function initializeWorkbench(container: HTMLElement): Promise<void> {
  if (workbenchPromise) {
    return workbenchPromise;
  }

  if (workbenchInitialized) {
    return;
  }

  // If monaco services were already initialized (e.g., from another route),
  // we can't initialize again - just mark as complete
  if (servicesAlreadyInitialized) {
    console.log('[Workbench] Services already initialized from previous session, skipping');
    workbenchInitialized = true;
    return;
  }

  console.log('[Workbench] Starting doInitializeWorkbench...');
  workbenchPromise = doInitializeWorkbench(container);
  await workbenchPromise;
  console.log('[Workbench] doInitializeWorkbench completed');
}

async function doInitializeWorkbench(container: HTMLElement): Promise<void> {
  try {
    console.log('[Workbench] Initializing VS Code workbench...');

    // Check if services were already initialized (e.g., by HMR or another module)
    const alreadyInitialized = checkMonacoServicesInitialized();
    if (alreadyInitialized) {
      console.warn('[Workbench] Monaco services were already initialized - this is unexpected on fresh load');
      console.warn('[Workbench] This usually means HMR or another module called initialize() first');
      console.warn('[Workbench] Attempting to continue, but the UI may not render correctly');
      servicesAlreadyInitialized = true;
    }

    // MonacoEnvironment is already set up at module load (top of this file)
    console.log('[Workbench] MonacoEnvironment ready:', !!window.MonacoEnvironment);

    // CRITICAL: Initialize vscode-userdata provider BEFORE other services
    // This ensures chat sessions, settings, and workspace storage work correctly
    const provider = initializeVSCodeUserDataProvider();
    try {
      await provider.whenReady();
      console.log('[Workbench] VS Code user data provider initialized');
    } catch (e) {
      console.warn('[Workbench] VS Code user data provider init deferred:', e);
    }

    // NOTE: Extensions are loaded AFTER initialize() to avoid triggering auto-initialization
    // See loadDefaultExtensions() call after initialize() completes

    try {
      const origin = window.location.origin;
      const base = `${origin}/extensions-web/builtin/blink-office-custom-editors`;
      const manifestUrl = `${base}/package.json`;
      const codeUrl = `${base}/extension.js`;
      const manifest = await (await fetch(manifestUrl)).json();
      manifest.name = manifest.name || 'blink-office-custom-editors-web';
      manifest.publisher = manifest.publisher || 'blink';
      manifest.version = manifest.version || '0.0.1';
      manifest.browser = manifest.browser || './extension.js';
      const { registerExtension, ExtensionHostKind } = await import('@codingame/monaco-vscode-api/extensions');
      const { registerFileUrl, whenReady } = registerExtension(manifest as any, ExtensionHostKind.LocalWebWorker, { system: false, path: base });
      registerFileUrl('./extension.js', codeUrl);
      registerFileUrl('package.json', manifestUrl);
      await whenReady();
      console.log('[Workbench] Registered Blink Office Custom Editors extension manifest');
    } catch (e) {
      console.warn('[Workbench] Could not register Custom Editors extension', e);
    }

    try {
      const tryPatchIframe = (ifr: HTMLIFrameElement) => {
        try {
          const src = (ifr as any).src || '';
          if (!src || src.indexOf('webWorkerExtensionHostIframe') === -1) return;
          const w: any = (ifr as any).contentWindow;
          const d: any = (ifr as any).contentDocument || (w && w.document);
          if (!w || !d) return;
          if ((w as any).__OB_MONACO_PATCHED__) return;
          (w as any).MonacoEnvironment = (w as any).MonacoEnvironment || (window as any).MonacoEnvironment;
          const s = d.createElement('script');
          s.textContent = 'window.MonacoEnvironment = window.MonacoEnvironment || (parent && parent.MonacoEnvironment)';
          d.head && d.head.appendChild(s);
          (w as any).__OB_MONACO_PATCHED__ = true;
        } catch {}
      };
      const scan = () => Array.from(document.querySelectorAll('iframe')).forEach((ifr: any) => tryPatchIframe(ifr));
      const mo = new MutationObserver(() => scan());
      mo.observe(document.documentElement, { childList: true, subtree: true });
      setInterval(scan, 1000);
      scan();
    } catch {}

    // Get stored workspace folder or undefined for empty workspace
    const storedFolder = getStoredWorkspaceFolder();
    const initialWorkspace = storedFolder ? { folderUri: monaco.Uri.file(storedFolder) } : undefined;

    console.log('[Workbench] Initial workspace:', storedFolder || '(none)');

    // Initialize with workbench service override (instead of views)
    // Skip if services were already initialized (e.g., HMR or previous navigation)
    if (!alreadyInitialized) {
      // Initialize user configuration FIRST (for theme to prevent flicker)
      // Must be called before initialize() per monaco-vscode-api docs
      try {
        await initUserConfiguration(JSON.stringify(userConfiguration));
        console.log('[Workbench] User configuration initialized');
      } catch (e) {
        console.warn('[Workbench] User configuration init failed:', e);
      }

      // Note: Extension services are patched after initialize() via patchExtensionServices()
      console.log('[Workbench] Calling initialize() with workbench service override...');
      console.log('[Workbench] Container element:', container);
      try {
        await initialize(
          {
            // Core services
            ...getLogServiceOverride(),
          ...getFilesServiceOverride(),
          ...getExtensionsServiceOverride({ enableWorkerExtensionHost: true }),
          // webOnly: false allows non-web extensions to appear in search results
          // The actual install button enabling is done by patchExtensionServices()
          ...getExtensionGalleryServiceOverride({ webOnly: false }),
          ...getModelServiceOverride(),
          ...getStorageServiceOverride(),
          ...getLifecycleServiceOverride(),
          ...getEnvironmentServiceOverride(),
          ...getRemoteAgentServiceOverride({ scanRemoteExtensions: true }),
          ...getWorkspaceTrustServiceOverride(),
          // Configuration and keybindings
          ...getConfigurationServiceOverride(),
          ...getKeybindingsServiceOverride(),
          // Theme and syntax
          ...getThemeServiceOverride(),
          ...getTextmateServiceOverride(),
          ...getLanguagesServiceOverride(),
          // UI services - WORKBENCH instead of views
          ...getWorkbenchServiceOverride(),
          ...getDialogsServiceOverride(),
          ...getNotificationsServiceOverride(),
          ...getQuickAccessServiceOverride(),
          ...getBannerServiceOverride(),
          ...getStatusBarServiceOverride(),
          ...getTitleBarServiceOverride(),
          // Webview service for extension README/CHANGELOG rendering
          ...getViewCommonServiceOverride(),
          // Feature services
          ...getAccessibilityServiceOverride(),
          ...getAuthenticationServiceOverride(),
          ...getDebugServiceOverride(),
          ...getPreferencesServiceOverride(),
          ...getOutlineServiceOverride(),
          ...getTimelineServiceOverride(),
          ...getSnippetsServiceOverride(),
          ...getOutputServiceOverride(),
          // Terminal service with Tauri PTY backend
          // getTerminalServiceOverride(backend) registers the backend with the registry internally
          ...getTerminalServiceOverride(getTauriTerminalBackend()),
          ...getSearchServiceOverride(),
          ...getMarkersServiceOverride(),
          ...getWorkingCopyServiceOverride(),
          ...getScmServiceOverride(),
          ...getTestingServiceOverride(),
          ...getChatServiceOverride(),
          // Custom entitlement service - bypasses VS Code's Copilot login UI
          [IChatEntitlementService.toString()]: getChatEntitlementService(),
          ...getAiServiceOverride(),
          ...getMcpServiceOverride(),
          ...getExplorerServiceOverride(),
          ...getLocalizationServiceOverride({
            availableLanguages: [],
            async clearLocale() {},
            async setLocale() {},
          }),
          ...getSecretStorageServiceOverride(),
          // Custom Tauri file dialog service
          [IFileDialogService.toString()]: new TauriFileDialogService(),
          // Custom Tauri update service (uses Tauri's native updater plugin)
          [IUpdateService.toString()]: new SyncDescriptor(TauriUpdateService, [], true),
        },
        container,
        {
          // Product configuration for extension marketplace
          productConfiguration: {
            nameShort: 'Blink',
            nameLong: 'Blink IDE',
            extensionsGallery: {
              serviceUrl: 'https://open-vsx.org/vscode/gallery',
              resourceUrlTemplate: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
              extensionUrlTemplate: 'https://open-vsx.org/extension/{publisher}/{name}',
              controlUrl: '',
              nlsBaseUrl: '',
            },
          },
          // Configure webview to use local resources instead of CDN
          // This enables extension DETAILS/CHANGELOG markdown rendering
          webviewEndpoint: `${window.location.origin}/vs/workbench/contrib/webview/browser/pre/`,
          workspaceProvider: {
            trusted: true,
            workspace: initialWorkspace,
            async open(workspace, _options) {
              // Handle opening a new workspace
              if (workspace && 'folderUri' in workspace) {
                const folderPath = workspace.folderUri.fsPath || workspace.folderUri.path;
                console.log('[Workbench] Opening folder:', folderPath);
                setStoredWorkspaceFolder(folderPath);
                // Reload the page to apply the new workspace
                window.location.reload();
                return true;
              }

              // If no workspace specified, prompt user to pick a folder
              const selectedFolder = await pickFolder();
              if (selectedFolder) {
                console.log('[Workbench] User selected folder:', selectedFolder);
                setStoredWorkspaceFolder(selectedFolder);
                // Reload the page to apply the new workspace
                window.location.reload();
                return true;
              }

              return false;
            },
          },
        }
      );
      console.log('[Workbench] initialize() completed successfully!');
      // Mark services as initialized after successful initialize()
      markMonacoServicesInitialized();

      // Load default extensions AFTER initialize() to avoid triggering auto-initialization
      console.log('[Workbench] Loading default extensions...');
      const extensionImports = [
        // Theme (critical)
        { name: 'theme-defaults', import: () => import('@codingame/monaco-vscode-theme-defaults-default-extension') },
        // Language syntax highlighting (basics)
        { name: 'typescript-basics', import: () => import('@codingame/monaco-vscode-typescript-basics-default-extension') },
        { name: 'javascript', import: () => import('@codingame/monaco-vscode-javascript-default-extension') },
        { name: 'json', import: () => import('@codingame/monaco-vscode-json-default-extension') },
        { name: 'html', import: () => import('@codingame/monaco-vscode-html-default-extension') },
        { name: 'css', import: () => import('@codingame/monaco-vscode-css-default-extension') },
        { name: 'markdown-basics', import: () => import('@codingame/monaco-vscode-markdown-basics-default-extension') },
        // Language features (intellisense, completions, go to definition, etc.)
        { name: 'typescript-language-features', import: () => import('@codingame/monaco-vscode-typescript-language-features-default-extension') },
        { name: 'json-language-features', import: () => import('@codingame/monaco-vscode-json-language-features-default-extension') },
        { name: 'html-language-features', import: () => import('@codingame/monaco-vscode-html-language-features-default-extension') },
        { name: 'css-language-features', import: () => import('@codingame/monaco-vscode-css-language-features-default-extension') },
        { name: 'markdown-language-features', import: () => import('@codingame/monaco-vscode-markdown-language-features-default-extension') },
      ];

      const extResults = await Promise.allSettled(extensionImports.map(async (ext) => {
        try {
          await ext.import();
          return { name: ext.name, success: true };
        } catch (e) {
          console.warn(`[Workbench] Failed to load extension ${ext.name}:`, e);
          return { name: ext.name, success: false, error: e };
        }
      }));

      const extLoaded = extResults.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
      const extFailed = extResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !(r.value as any).success)).length;
      console.log(`[Workbench] Default extensions: ${extLoaded} loaded, ${extFailed} failed`);

      try {
        const { loadBuiltinExtensions } = await import('./loadBuiltinExtensions');
        await loadBuiltinExtensions();
        console.log('[Workbench] Builtin extensions loaded');
      } catch (e) {
        console.warn('[Workbench] Builtin extensions load skipped', e);
      }

      } catch (initError) {
        console.error('[Workbench] initialize() threw an error:', initError);
        // Check if this is the "Services are already initialized" error
        const errorMessage = initError instanceof Error ? initError.message : String(initError);
        if (errorMessage.includes('already initialized') || errorMessage.includes('Services are already')) {
          console.log('[Workbench] Monaco services were already initialized, continuing...');
          servicesAlreadyInitialized = true;
          markMonacoServicesInitialized();
          // Continue with the rest of initialization since services exist
        } else {
          // Re-throw other errors
          throw initError;
        }
      }
    } else {
      console.log('[Workbench] Skipping initialize() - services already initialized');
    }

    // CRITICAL: Notify terminal instance service that our backend is registered
    // This MUST happen IMMEDIATELY after initialize() - before ANY other initialization
    // The terminal service's getBackend() waits for didRegisterBackend() to resolve
    // NOTE: Using static imports (defined at top of file) to avoid dynamic import issues

    // Initialize debug trace object for terminal initialization
    (window as any).__TERMINAL_INIT_TRACE__ = {
      step: 'starting',
      timestamp: Date.now(),
      error: null,
    };

    try {
      (window as any).__TERMINAL_INIT_TRACE__.step = 'getting_services';

      // getService is async - must await to get actual service, not Promise
      const terminalService = await getService(ITerminalService);
      const terminalInstanceService = await getService(ITerminalInstanceService);

      (window as any).__TERMINAL_INIT_TRACE__.step = 'getting_registry';

      // Get our backend from the registry (registered with remoteAuthority: undefined -> key: '')
      // Cast to any because the registry typing is complex
      const backendRegistry = Registry.as(TerminalExtensions.Backend) as any;
      const backend = backendRegistry?.getTerminalBackend?.(undefined);

      (window as any).__TERMINAL_INIT_TRACE__.step = 'backend_lookup_complete';
      (window as any).__TERMINAL_INIT_TRACE__.hasBackend = !!backend;
      (window as any).__TERMINAL_INIT_TRACE__.hasService = !!terminalService;
      (window as any).__TERMINAL_INIT_TRACE__.hasInstanceService = !!terminalInstanceService;

      console.log('[Workbench] Terminal backend lookup:', {
        hasBackend: !!backend,
        hasTerminalService: !!terminalService,
        hasInstanceService: !!terminalInstanceService,
        backendRemoteAuthority: backend?.remoteAuthority,
      });

      if (backend && terminalInstanceService) {
        (window as any).__TERMINAL_INIT_TRACE__.step = 'calling_didRegisterBackend';
        // Call didRegisterBackend to resolve the registration promise
        // This allows the terminal service's getBackend() to return our backend
        (terminalInstanceService as any).didRegisterBackend(backend);
        (window as any).__TERMINAL_INIT_TRACE__.step = 'completed';
        console.log('[Workbench] Terminal backend registration notified - terminals can now start');
      } else {
        (window as any).__TERMINAL_INIT_TRACE__.step = 'failed_no_backend_or_service';
        console.error('[Workbench] CRITICAL: Could not notify terminal backend registration:', {
          hasBackend: !!backend,
          hasInstanceService: !!terminalInstanceService,
        });
      }

      // Expose terminal services for debugging
      (window as any).__TERMINAL_SERVICE__ = terminalService;
      (window as any).__TERMINAL_INSTANCE_SERVICE__ = terminalInstanceService;
      (window as any).__TERMINAL_BACKEND_REGISTRY__ = backendRegistry;
    } catch (e) {
      (window as any).__TERMINAL_INIT_TRACE__.step = 'error';
      (window as any).__TERMINAL_INIT_TRACE__.error = e instanceof Error ? e.message : String(e);
      console.error('[Workbench] Failed to initialize terminal services:', e);
    }

    // CRITICAL: Patch extension services IMMEDIATELY after initialization
    // This must happen before any extension UI is rendered
    try {
      await patchExtensionServices();
      console.log('[Workbench] Extension services patched successfully');
    } catch (error) {
      console.error('[Workbench] Failed to patch extension services:', error);
    }

    // Initialize Tauri filesystem provider
    initializeTauriFileSystem();
    console.log('[Workbench] Tauri filesystem provider initialized');

    // Register workspace commands (Open Folder, Close Folder)
    registerWorkspaceCommands();

    // Register extension commands (Install from VSIX)
    registerExtensionCommands();

    // Register configure AI provider command
    try {
      await registerConfigureProviderCommand();
    } catch (e) {
      console.warn('[Workbench] Failed to register configureAIProvider command:', e);
    }

    // Register Blink AI as a chat agent for the auxiliary bar chat panel (right side)
    try {
      await registerAIChatAgent();
      console.log('[Workbench] AI chat agent registered');
    } catch (e) {
      console.warn('[Workbench] Failed to register AI chat agent:', e);
    }

    // Initialize model provider abstraction layer
    try {
      const { initializeModelProviders } = await import('./ai/index');
      initializeModelProviders();
      console.log('[Workbench] Model providers initialized');
    } catch (e) {
      console.warn('[Workbench] Failed to initialize model providers:', e);
    }

    // Register Tab Autocomplete (Ghost Text) provider for AI code completions
    try {
      const tabAutocompleteDisposable = await registerTabAutocomplete();
      (window as any).__TAB_AUTOCOMPLETE_DISPOSABLE__ = tabAutocompleteDisposable;
      console.log('[Workbench] Tab autocomplete registered');
    } catch (e) {
      console.warn('[Workbench] Failed to register tab autocomplete:', e);
    }

    // Register Inline Edit (Ctrl+K) command for AI-assisted code editing
    try {
      const inlineEditDisposable = registerInlineEdit();
      (window as any).__INLINE_EDIT_DISPOSABLE__ = inlineEditDisposable;
      console.log('[Workbench] Inline edit registered');
    } catch (e) {
      console.warn('[Workbench] Failed to register inline edit:', e);
    }

    // Register Context Mentions (@file, @folder, @codebase) provider
    try {
      const contextMentionsDisposable = await registerContextMentions();
      (window as any).__CONTEXT_MENTIONS_DISPOSABLE__ = contextMentionsDisposable;
      console.log('[Workbench] Context mentions registered');
    } catch (e) {
      console.warn('[Workbench] Failed to register context mentions:', e);
    }

    // Register Diff Review for accepting/rejecting AI-generated changes
    try {
      const diffReviewDisposable = registerDiffReview();
      (window as any).__DIFF_REVIEW_DISPOSABLE__ = diffReviewDisposable;
      console.log('[Workbench] Diff review registered');
    } catch (e) {
      console.warn('[Workbench] Failed to register diff review:', e);
    }

    // Register Terminal AI for natural language to shell command conversion
    try {
      const terminalAIDisposable = registerTerminalAI();
      (window as any).__TERMINAL_AI_DISPOSABLE__ = terminalAIDisposable;
      console.log('[Workbench] Terminal AI registered');
    } catch (e) {
      console.warn('[Workbench] Failed to register terminal AI:', e);
    }

    // Register Plan Mode for strategy-first AI planning
    try {
      const planModeDisposable = registerPlanMode();
      (window as any).__PLAN_MODE_DISPOSABLE__ = planModeDisposable;
      console.log('[Workbench] Plan mode registered');
    } catch (e) {
      console.warn('[Workbench] Failed to register plan mode:', e);
    }

    // Register Agent Mode for multi-step autonomous AI execution
    try {
      const agentModeDisposable = registerAgentMode();
      (window as any).__AGENT_MODE_DISPOSABLE__ = agentModeDisposable;
      console.log('[Workbench] Agent mode registered');
    } catch (e) {
      console.warn('[Workbench] Failed to register agent mode:', e);
    }

    // Register Multi-file Edit (Composer) for batch file changes
    try {
      const multiFileEditDisposable = registerMultiFileEdit();
      (window as any).__MULTI_FILE_EDIT_DISPOSABLE__ = multiFileEditDisposable;
      console.log('[Workbench] Multi-file edit registered');
    } catch (e) {
      console.warn('[Workbench] Failed to register multi-file edit:', e);
    }

    // Register Persistent Memory for project rules and context
    try {
      const persistentMemoryDisposable = registerPersistentMemory();
      (window as any).__PERSISTENT_MEMORY_DISPOSABLE__ = persistentMemoryDisposable;
      console.log('[Workbench] Persistent memory registered');
    } catch (e) {
      console.warn('[Workbench] Failed to register persistent memory:', e);
    }

    try {
      const host = (window.location && window.location.hostname) || '';
      (window as any).__DOCX_TIPTAP_DEV__ = host === 'localhost' || host === '127.0.0.1';
      const { registerDocxResolver, openDocxForTest } = await import('./editorResolverDocx');
      await registerDocxResolver();
      (window as any).__OPEN_DOCX_FOR_TEST__ = openDocxForTest;
      (window as any).__OPEN_DOCX_WEBVIEW_RAW__ = async (path: string) => {
        const svc: any = await getService(IWebviewWorkbenchService as any);
        const title = `Word: ${path.split('/').pop() || path}`;
        const init: WebviewInitInfo = {
          id: `blink-word-${  Math.random().toString(36).slice(2)}`,
          options: { enableScripts: true },
          html: `<html><body><div id=doc></div><script>var vs=acquireVsCodeApi&&acquireVsCodeApi();window.addEventListener('message',e=>{var m=e.data||{};if(m.type==='render')document.getElementById('doc').innerHTML=m.html||''});vs&&vs.postMessage({type:'ready'})</script></body></html>`,
          extension: undefined as any,
        } as any;
        const input = svc.openWebview(init as any, 'blink.wordEditor', title, undefined, { preserveFocus: false });
        const webview = (input as any).webview || (input && (input as any)._webview);
        const mod = await import('./testOpeners');
        const h = await mod.render(path);
        webview?.postMessage({ type: 'render', html: h });
        return true;
      };
      console.log('[Workbench] Docx resolver registered');

      try {
        const { registerXlsxResolver, openXlsxForTest, setXlsxCellForTest } = await import('./editorResolverXlsx');
        await registerXlsxResolver();
        (window as any).__OPEN_XLSX_FOR_TEST__ = openXlsxForTest;
        (window as any).__XLSX_SET_CELL_FOR_TEST__ = setXlsxCellForTest;
        console.log('[Workbench] Xlsx resolver registered');
      } catch (e) {
        console.warn('[Workbench] Xlsx resolver not registered', e);
      }

      try {
        const { registerPptxResolver, openPptxForTest, setPptxTitleForTest } = await import('./editorResolverPptx');
        await registerPptxResolver();
        (window as any).__OPEN_PPTX_FOR_TEST__ = openPptxForTest;
        (window as any).__PPTX_SET_TITLE_FOR_TEST__ = setPptxTitleForTest;
        console.log('[Workbench] Pptx resolver registered');
      } catch (e) {
        console.warn('[Workbench] Pptx resolver not registered', e);
      }
    } catch (e) {
      console.warn('[Workbench] Docx resolver not registered', e);
    }

    try {
      const { attachTestOpeners } = await import('./testOpeners');
      await attachTestOpeners();
    } catch (e) {
      console.warn('[Workbench] Test openers not attached', e);
    }

    // Initialize code-server if available (optional - requires: npm install -g code-server)
    // Code-server provides Coder's open-source VS Code server
    try {
      const serverInfo = await vscodeServerService.start();
      console.log('[Workbench] code-server started:', serverInfo.serverUrl);
      console.log('[Workbench] code-server port:', serverInfo.port);
    } catch (error) {
      // code-server is optional - log info message and continue
      console.log('[Workbench] code-server not available (optional):', error);
      console.log('[Workbench] Install with: npm install code-server');
    }

    // Initialize the extension host sidecar for extension support
    // This now blocks until the sidecar is ready, ensuring extensions are available
    try {
      await initializeExtensionHost(storedFolder || undefined);
      console.log('[Workbench] Extension host initialized successfully');
    } catch (error) {
      // Extension host is optional - log error but continue
      console.error('[Workbench] Extension host failed:', error);
      console.log('[Workbench] Continuing without extension host');
    }

    // Inject Blink theme CSS overrides (red and yellow accents)
    const styleEl = document.createElement('style');
    styleEl.id = 'blink-theme-overrides';
    styleEl.textContent = getBlinkThemeCSS();
    document.head.appendChild(styleEl);
    console.log('[Workbench] Blink theme CSS injected');

    workbenchInitialized = true;
    console.log('[Workbench] VS Code workbench initialized successfully');
  } catch (error) {
    console.error('[Workbench] Failed to initialize:', error);
    workbenchPromise = null;
    throw error;
  }
}

/**
 * Check if workbench is initialized
 */
export function isWorkbenchInitialized(): boolean {
  return workbenchInitialized || servicesAlreadyInitialized;
}

/**
 * Open a folder in the workbench
 * This will prompt the user to select a folder and reload the page
 */
export async function openFolder(): Promise<boolean> {
  const selectedFolder = await pickFolder();
  if (selectedFolder) {
    setStoredWorkspaceFolder(selectedFolder);
    window.location.reload();
    return true;
  }
  return false;
}

/**
 * Get the current workspace folder path
 */
export function getCurrentWorkspaceFolder(): string | null {
  return getStoredWorkspaceFolder();
}

/**
 * Close the current workspace (clear stored folder and reload)
 */
export function closeWorkspace(): void {
  setStoredWorkspaceFolder(null);
  window.location.reload();
}

export { monaco };
