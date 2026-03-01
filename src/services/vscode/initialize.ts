/**
 * VS Code API Initialization Service
 *
 * This module initializes the monaco-vscode-api services required for
 * VS Code extension support. Must be called before creating any editors.
 *
 * Based on: https://github.com/CodinGame/monaco-vscode-api demo
 */

// Import default theme extension FIRST (before anything else)
import '@codingame/monaco-vscode-theme-defaults-default-extension';

// Monaco editor imports
import * as monaco from 'monaco-editor';

// Utilities to override Monaco services
import { initialize } from '@codingame/monaco-vscode-api';

// All 60 service overrides from the demo
import getAccessibilityServiceOverride from '@codingame/monaco-vscode-accessibility-service-override';
import getAiServiceOverride from '@codingame/monaco-vscode-ai-service-override';
import getAssignmentServiceOverride from '@codingame/monaco-vscode-assignment-service-override';
import getAuthenticationServiceOverride from '@codingame/monaco-vscode-authentication-service-override';
import getChatServiceOverride from '@codingame/monaco-vscode-chat-service-override';
import getCommentsServiceOverride from '@codingame/monaco-vscode-comments-service-override';
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override';
import getDebugServiceOverride from '@codingame/monaco-vscode-debug-service-override';
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override';
import getEditSessionsServiceOverride from '@codingame/monaco-vscode-edit-sessions-service-override';
import getEmmetServiceOverride from '@codingame/monaco-vscode-emmet-service-override';
import getEnvironmentServiceOverride from '@codingame/monaco-vscode-environment-service-override';
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override';
import getExtensionGalleryServiceOverride from '@codingame/monaco-vscode-extension-gallery-service-override';
import getExtensionsServiceOverride from '@codingame/monaco-vscode-extensions-service-override';
import getFilesServiceOverride from '@codingame/monaco-vscode-files-service-override';
import getImageResizeServiceOverride from '@codingame/monaco-vscode-image-resize-service-override';
import getInteractiveServiceOverride from '@codingame/monaco-vscode-interactive-service-override';
import getIssueServiceOverride from '@codingame/monaco-vscode-issue-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getLanguageDetectionWorkerServiceOverride from '@codingame/monaco-vscode-language-detection-worker-service-override';
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override';
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getLocalizationServiceOverride from '@codingame/monaco-vscode-localization-service-override';
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override';
import getMarkersServiceOverride from '@codingame/monaco-vscode-markers-service-override';
import getMcpServiceOverride from '@codingame/monaco-vscode-mcp-service-override';
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override';
import getMultiDiffEditorServiceOverride from '@codingame/monaco-vscode-multi-diff-editor-service-override';
import getNotebookServiceOverride from '@codingame/monaco-vscode-notebook-service-override';
import getNotificationsServiceOverride from '@codingame/monaco-vscode-notifications-service-override';
import getOutlineServiceOverride from '@codingame/monaco-vscode-outline-service-override';
import getOutputServiceOverride from '@codingame/monaco-vscode-output-service-override';
import getPerformanceServiceOverride from '@codingame/monaco-vscode-performance-service-override';
import getPreferencesServiceOverride from '@codingame/monaco-vscode-preferences-service-override';
import getProcessControllerServiceOverride from '@codingame/monaco-vscode-process-explorer-service-override';
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override';
import getRelauncherServiceOverride from '@codingame/monaco-vscode-relauncher-service-override';
import getRemoteAgentServiceOverride from '@codingame/monaco-vscode-remote-agent-service-override';
import getScmServiceOverride from '@codingame/monaco-vscode-scm-service-override';
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override';
import getSecretStorageServiceOverride from '@codingame/monaco-vscode-secret-storage-service-override';
import getShareServiceOverride from '@codingame/monaco-vscode-share-service-override';
import getSnippetsServiceOverride from '@codingame/monaco-vscode-snippets-service-override';
import getSpeechServiceOverride from '@codingame/monaco-vscode-speech-service-override';
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override';
import getSurveyServiceOverride from '@codingame/monaco-vscode-survey-service-override';
import getTaskServiceOverride from '@codingame/monaco-vscode-task-service-override';
import getTelemetryServiceOverride from '@codingame/monaco-vscode-telemetry-service-override';
import getTerminalServiceOverride from '@codingame/monaco-vscode-terminal-service-override';
import getTestingServiceOverride from '@codingame/monaco-vscode-testing-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import getTimelineServiceOverride from '@codingame/monaco-vscode-timeline-service-override';
import getTreeSitterServiceOverride from '@codingame/monaco-vscode-treesitter-service-override';
// Custom Tauri update service - VS Code's update service is for updating the VS Code app,
// not extensions. In Tauri, app updates are handled by Tauri's updater plugin.
import { IUpdateService } from '@codingame/monaco-vscode-api/vscode/vs/platform/update/common/update.service';
import { SyncDescriptor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors';
import { TauriUpdateService } from './tauriUpdateService';
import getUserDataProfileServiceOverride from '@codingame/monaco-vscode-user-data-profile-service-override';
import getUserDataSyncServiceOverride from '@codingame/monaco-vscode-user-data-sync-service-override';
import getBannerServiceOverride from '@codingame/monaco-vscode-view-banner-service-override';
import getStatusBarServiceOverride from '@codingame/monaco-vscode-view-status-bar-service-override';
import getTitleBarServiceOverride from '@codingame/monaco-vscode-view-title-bar-service-override';
import getViewsServiceOverride from '@codingame/monaco-vscode-views-service-override';
import getWalkthroughServiceOverride from '@codingame/monaco-vscode-walkthrough-service-override';
import getWelcomeServiceOverride from '@codingame/monaco-vscode-welcome-service-override';
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override';
import getWorkspaceTrustServiceOverride from '@codingame/monaco-vscode-workspace-trust-service-override';

let initialized = false;
let initializationPromise: Promise<void> | null = null;

// Check if monaco services were already initialized by another module (e.g., workbench.ts)
function checkMonacoServicesInitialized(): boolean {
  try {
    // If window has our marker, services are initialized
    return !!(window as any).__MONACO_SERVICES_INITIALIZED__;
  } catch {
    return false;
  }
}

function markMonacoServicesInitialized(): void {
  (window as any).__MONACO_SERVICES_INITIALIZED__ = true;
}

/**
 * Initialize all VS Code services
 * This must be called once before creating any Monaco editors
 */
export async function initializeVSCodeServices(): Promise<void> {
  // Return existing promise if already initializing
  if (initializationPromise) {
    return initializationPromise;
  }

  // Return immediately if already initialized
  if (initialized) {
    return;
  }

  initializationPromise = doInitialize();
  await initializationPromise;
}

async function doInitialize(): Promise<void> {
  try {
    // Check if another module already initialized services
    if (checkMonacoServicesInitialized()) {
      console.log('[VSCode] Services already initialized by another module, skipping');
      initialized = true;
      return;
    }

    console.log('[VSCode] Initializing services...');

    if (!window.MonacoEnvironment) {
      window.MonacoEnvironment = {
        getWorker(_moduleId: string, label: string) {
          switch (label) {
            case 'extensionHostWorkerMain':
              return new Worker(new URL('@codingame/monaco-vscode-api/workers/extensionHost.worker', import.meta.url), { type: 'module' });
            default:
              return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' });
          }
        },
        getWorkerUrl(_workerId: string, label: string): string | undefined {
          if (label === 'extensionHostWorkerMain') {
            try {
              return new URL('@codingame/monaco-vscode-api/workers/extensionHost.worker', import.meta.url).toString();
            } catch {
              return undefined;
            }
          }
          return undefined;
        },
      } as any;
    }

    // Initialize with all 60 service overrides (following demo pattern exactly)
    await initialize({
      ...getAuthenticationServiceOverride(),
      ...getLogServiceOverride(),
      ...getExtensionsServiceOverride(),
      ...getExtensionGalleryServiceOverride({ webOnly: false }),
      ...getModelServiceOverride(),
      ...getNotificationsServiceOverride(),
      ...getDialogsServiceOverride(),
      ...getConfigurationServiceOverride(),
      ...getKeybindingsServiceOverride(),
      ...getTextmateServiceOverride(),
      ...getTreeSitterServiceOverride(),
      ...getThemeServiceOverride(),
      ...getLanguagesServiceOverride(),
      ...getDebugServiceOverride(),
      ...getPreferencesServiceOverride(),
      ...getOutlineServiceOverride(),
      ...getTimelineServiceOverride(),
      ...getBannerServiceOverride(),
      ...getStatusBarServiceOverride(),
      ...getTitleBarServiceOverride(),
      ...getSnippetsServiceOverride(),
      ...getOutputServiceOverride(),
      ...getTerminalServiceOverride(),
      ...getSearchServiceOverride(),
      ...getMarkersServiceOverride(),
      ...getAccessibilityServiceOverride(),
      ...getLanguageDetectionWorkerServiceOverride(),
      ...getStorageServiceOverride(),
      ...getRemoteAgentServiceOverride(),
      ...getLifecycleServiceOverride(),
      ...getEnvironmentServiceOverride(),
      ...getWorkspaceTrustServiceOverride(),
      ...getFilesServiceOverride(),
      ...getWorkingCopyServiceOverride(),
      ...getScmServiceOverride(),
      ...getTestingServiceOverride(),
      ...getChatServiceOverride(),
      ...getNotebookServiceOverride(),
      ...getWelcomeServiceOverride(),
      ...getWalkthroughServiceOverride(),
      ...getUserDataProfileServiceOverride(),
      ...getUserDataSyncServiceOverride(),
      ...getAiServiceOverride(),
      ...getTaskServiceOverride(),
      ...getCommentsServiceOverride(),
      ...getEditSessionsServiceOverride(),
      ...getEmmetServiceOverride(),
      ...getInteractiveServiceOverride(),
      ...getIssueServiceOverride(),
      ...getMultiDiffEditorServiceOverride(),
      ...getPerformanceServiceOverride(),
      ...getRelauncherServiceOverride(),
      ...getShareServiceOverride(),
      ...getSpeechServiceOverride(),
      ...getSurveyServiceOverride(),
      // Custom Tauri update service (app updates handled by Tauri, not VS Code)
      [IUpdateService.toString()]: new SyncDescriptor(TauriUpdateService, [], true),
      ...getExplorerServiceOverride(),
      ...getLocalizationServiceOverride({
        availableLanguages: [],
        async clearLocale() {},
        async setLocale() {},
      }),
      ...getSecretStorageServiceOverride(),
      ...getTelemetryServiceOverride(),
      ...getMcpServiceOverride(),
      ...getProcessControllerServiceOverride(),
      ...getImageResizeServiceOverride(),
      ...getAssignmentServiceOverride(),
      ...getQuickAccessServiceOverride(),
      ...getViewsServiceOverride(),
    });

    initialized = true;
    markMonacoServicesInitialized();
    console.log('[VSCode] Services initialized successfully');
  } catch (error) {
    // Check if this is the "Services are already initialized" error
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('already initialized') || errorMessage.includes('Services are already')) {
      console.log('[VSCode] Services were already initialized, continuing...');
      initialized = true;
      markMonacoServicesInitialized();
      return;
    }
    console.error('[VSCode] Failed to initialize services:', error);
    initializationPromise = null;
    throw error;
  }
}

/**
 * Check if VS Code services are initialized
 */
export function isVSCodeInitialized(): boolean {
  return initialized;
}

/**
 * Wait for VS Code services to be ready
 */
export async function waitForVSCode(): Promise<void> {
  if (initialized) {
    return;
  }
  if (initializationPromise) {
    await initializationPromise;
  } else {
    await initializeVSCodeServices();
  }
}

// Re-export monaco for convenience
export { monaco };
