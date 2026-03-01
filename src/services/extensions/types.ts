/**
 * Extension Types
 *
 * TypeScript type definitions for VS Code extension support.
 */

/**
 * Extension manifest (package.json) structure
 */
export interface ExtensionManifest {
  name: string;
  displayName?: string;
  description?: string;
  version: string;
  publisher: string;
  engines?: {
    vscode?: string;
  };
  categories?: string[];
  keywords?: string[];
  icon?: string;
  main?: string;
  browser?: string;
  activationEvents?: string[];
  contributes?: ExtensionContributions;
  extensionDependencies?: string[];
  repository?: {
    type: string;
    url: string;
  };
  license?: string;
}

/**
 * Extension contributions (what the extension provides)
 */
export interface ExtensionContributions {
  commands?: ExtensionCommand[];
  languages?: ExtensionLanguage[];
  grammars?: ExtensionGrammar[];
  themes?: ExtensionTheme[];
  iconThemes?: ExtensionIconTheme[];
  snippets?: ExtensionSnippet[];
  configuration?: ExtensionConfiguration;
  keybindings?: ExtensionKeybinding[];
  menus?: Record<string, ExtensionMenuItem[]>;
  views?: Record<string, ExtensionView[]>;
  viewsContainers?: {
    activitybar?: ExtensionViewContainer[];
    panel?: ExtensionViewContainer[];
  };
}

export interface ExtensionCommand {
  command: string;
  title: string;
  category?: string;
  icon?: string | { light: string; dark: string };
}

export interface ExtensionLanguage {
  id: string;
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  configuration?: string;
  firstLine?: string;
  mimetypes?: string[];
}

export interface ExtensionGrammar {
  language?: string;
  scopeName: string;
  path: string;
  embeddedLanguages?: Record<string, string>;
  tokenTypes?: Record<string, string>;
  injectTo?: string[];
}

export interface ExtensionTheme {
  label: string;
  uiTheme: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  path: string;
}

export interface ExtensionIconTheme {
  id: string;
  label: string;
  path: string;
}

export interface ExtensionSnippet {
  language: string;
  path: string;
}

export interface ExtensionConfiguration {
  title?: string;
  properties?: Record<string, ExtensionConfigProperty>;
}

export interface ExtensionConfigProperty {
  type: string | string[];
  default?: unknown;
  description?: string;
  enum?: unknown[];
  enumDescriptions?: string[];
  minimum?: number;
  maximum?: number;
  scope?: 'application' | 'machine' | 'window' | 'resource' | 'language-overridable';
}

export interface ExtensionKeybinding {
  command: string;
  key: string;
  mac?: string;
  linux?: string;
  win?: string;
  when?: string;
}

export interface ExtensionMenuItem {
  command: string;
  when?: string;
  group?: string;
}

export interface ExtensionView {
  id: string;
  name: string;
  when?: string;
  icon?: string;
  contextualTitle?: string;
}

export interface ExtensionViewContainer {
  id: string;
  title: string;
  icon: string;
}

/**
 * Extension metadata stored in the registry
 */
export interface ExtensionInfo {
  /** Unique identifier: publisher.name */
  id: string;
  /** Extension name */
  name: string;
  /** Display name */
  displayName: string;
  /** Publisher ID */
  publisher: string;
  /** Version string */
  version: string;
  /** Description */
  description: string;
  /** Extension type */
  type: ExtensionType;
  /** Path to extension directory */
  extensionPath: string;
  /** Whether extension is enabled */
  enabled: boolean;
  /** Extension manifest */
  manifest: ExtensionManifest;
  /** Installation timestamp */
  installedAt: number;
  /** Last updated timestamp */
  updatedAt?: number;
}

/**
 * Extension type categories
 */
export type ExtensionType =
  | 'theme'
  | 'iconTheme'
  | 'language'
  | 'snippet'
  | 'lsp'
  | 'other';

/**
 * Extension installation status
 */
export type ExtensionStatus =
  | 'not-installed'
  | 'installing'
  | 'installed'
  | 'enabling'
  | 'enabled'
  | 'disabling'
  | 'disabled'
  | 'uninstalling'
  | 'error';

/**
 * Extension state for UI
 */
export interface ExtensionState {
  info: ExtensionInfo;
  status: ExtensionStatus;
  error?: string;
}

/**
 * Open VSX extension search result
 */
export interface OpenVSXExtension {
  namespace: string;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  downloadCount?: number;
  averageRating?: number;
  reviewCount?: number;
  files?: {
    download?: string;
    icon?: string;
    readme?: string;
    changelog?: string;
    manifest?: string;
  };
  categories?: string[];
  tags?: string[];
  license?: string;
  publishedBy?: {
    loginName: string;
    fullName?: string;
  };
  timestamp?: string;
}

/**
 * Open VSX search response
 */
export interface OpenVSXSearchResponse {
  offset: number;
  totalSize: number;
  extensions: OpenVSXExtension[];
}

/**
 * Extension event types
 */
export type ExtensionEventType =
  | 'installed'
  | 'uninstalled'
  | 'enabled'
  | 'disabled'
  | 'updated'
  | 'refreshed'
  | 'error';

/**
 * Extension event
 */
export interface ExtensionEvent {
  type: ExtensionEventType;
  extensionId: string;
  extension?: ExtensionInfo;
  error?: string;
  timestamp: number;
}

/**
 * Extension event listener
 */
export type ExtensionEventListener = (event: ExtensionEvent) => void;
