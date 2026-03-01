/**
 * Settings Service
 *
 * Manages user preferences and application settings.
 * Uses localStorage for now, can be extended to use Tauri's file system.
 */

import { readTextFile, writeTextFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { appConfigDir, join } from '@tauri-apps/api/path';

// ============================================================================
// Settings Schema Definition
// ============================================================================

export type SettingType = 'boolean' | 'number' | 'string' | 'enum';

export interface SettingDefinition<T = unknown> {
  key: string;
  type: SettingType;
  default: T;
  label: string;
  description: string;
  category: string;
  order?: number;
  enum?: T[];
  enumLabels?: string[];
  min?: number;
  max?: number;
  step?: number;
  when?: string;
}

export interface SettingCategory {
  id: string;
  label: string;
  order: number;
}

export const SETTING_CATEGORIES: SettingCategory[] = [
  { id: 'editor', label: 'Editor', order: 1 },
  { id: 'display', label: 'Display', order: 2 },
  { id: 'saving', label: 'Saving', order: 3 },
  { id: 'terminal', label: 'Terminal', order: 4 },
  { id: 'ai', label: 'AI Assistant', order: 5 },
];

export const SETTINGS_SCHEMA: SettingDefinition[] = [
  // Editor settings
  {
    key: 'editor.fontSize',
    type: 'number',
    default: 14,
    label: 'Font Size',
    description: 'Controls the font size in pixels for the editor.',
    category: 'editor',
    order: 1,
    min: 8,
    max: 32,
    step: 1,
  },
  {
    key: 'editor.fontFamily',
    type: 'enum',
    default: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
    label: 'Font Family',
    description: 'Controls the font family used in the editor.',
    category: 'editor',
    order: 2,
    enum: [
      "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
      "'Fira Code', Menlo, Monaco, monospace",
      "Menlo, Monaco, 'Courier New', monospace",
      "Monaco, Menlo, 'Courier New', monospace",
      "'SF Mono', Menlo, Monaco, monospace",
      "'Cascadia Code', Menlo, Monaco, monospace",
    ],
    enumLabels: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'SF Mono', 'Cascadia Code'],
  },
  {
    key: 'editor.tabSize',
    type: 'enum',
    default: 2,
    label: 'Tab Size',
    description: 'The number of spaces a tab is equal to.',
    category: 'editor',
    order: 3,
    enum: [2, 4, 8],
    enumLabels: ['2 spaces', '4 spaces', '8 spaces'],
  },
  {
    key: 'editor.wordWrap',
    type: 'enum',
    default: 'off',
    label: 'Word Wrap',
    description: 'Controls how lines should wrap.',
    category: 'editor',
    order: 4,
    enum: ['off', 'on', 'wordWrapColumn'],
    enumLabels: ['Off', 'On', 'Wrap at Column'],
  },
  {
    key: 'editor.lineNumbers',
    type: 'enum',
    default: 'on',
    label: 'Line Numbers',
    description: 'Controls the display of line numbers.',
    category: 'editor',
    order: 5,
    enum: ['on', 'off', 'relative'],
    enumLabels: ['On', 'Off', 'Relative'],
  },

  // Display settings
  {
    key: 'display.minimap',
    type: 'boolean',
    default: true,
    label: 'Minimap',
    description: 'Show the minimap on the right side of the editor.',
    category: 'display',
    order: 1,
  },
  {
    key: 'display.bracketPairColorization',
    type: 'boolean',
    default: true,
    label: 'Bracket Pair Colorization',
    description: 'Colorize matching brackets for easier identification.',
    category: 'display',
    order: 2,
  },
  {
    key: 'display.renderWhitespace',
    type: 'enum',
    default: 'selection',
    label: 'Render Whitespace',
    description: 'Controls how whitespace characters are rendered.',
    category: 'display',
    order: 3,
    enum: ['none', 'boundary', 'selection', 'all'],
    enumLabels: ['None', 'Boundary', 'Selection', 'All'],
  },
  {
    key: 'display.smoothScrolling',
    type: 'boolean',
    default: true,
    label: 'Smooth Scrolling',
    description: 'Enable smooth scrolling in the editor.',
    category: 'display',
    order: 4,
  },

  // Saving settings
  {
    key: 'saving.formatOnSave',
    type: 'boolean',
    default: true,
    label: 'Format On Save',
    description: 'Automatically format the file when saving.',
    category: 'saving',
    order: 1,
  },
  {
    key: 'saving.autoSave',
    type: 'enum',
    default: 'off',
    label: 'Auto Save',
    description: 'Controls auto save of editors.',
    category: 'saving',
    order: 2,
    enum: ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'],
    enumLabels: ['Off', 'After Delay', 'On Focus Change', 'On Window Change'],
  },
  {
    key: 'saving.autoSaveDelay',
    type: 'number',
    default: 1000,
    label: 'Auto Save Delay',
    description: 'Delay in milliseconds before auto saving.',
    category: 'saving',
    order: 3,
    min: 100,
    max: 10000,
    step: 100,
    when: 'saving.autoSave === "afterDelay"',
  },

  // Terminal settings
  {
    key: 'terminal.fontSize',
    type: 'number',
    default: 14,
    label: 'Terminal Font Size',
    description: 'Controls the font size in the terminal.',
    category: 'terminal',
    order: 1,
    min: 8,
    max: 32,
    step: 1,
  },
  {
    key: 'terminal.fontFamily',
    type: 'enum',
    default: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
    label: 'Terminal Font Family',
    description: 'Controls the font family in the terminal.',
    category: 'terminal',
    order: 2,
    enum: [
      "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
      "'Fira Code', Menlo, Monaco, monospace",
      "Menlo, Monaco, 'Courier New', monospace",
    ],
    enumLabels: ['JetBrains Mono', 'Fira Code', 'Menlo'],
  },
  {
    key: 'terminal.cursorBlink',
    type: 'boolean',
    default: true,
    label: 'Terminal Cursor Blink',
    description: 'Enable cursor blinking in the terminal.',
    category: 'terminal',
    order: 3,
  },

  // AI settings
  {
    key: 'ai.enabled',
    type: 'boolean',
    default: true,
    label: 'Enable AI Assistant',
    description: 'Enable or disable the AI assistant features.',
    category: 'ai',
    order: 1,
  },
  {
    key: 'ai.streamResponses',
    type: 'boolean',
    default: true,
    label: 'Stream Responses',
    description: 'Stream AI responses as they are generated.',
    category: 'ai',
    order: 2,
  },
];

// ============================================================================
// Default Settings
// ============================================================================

export function getDefaultSettings(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const setting of SETTINGS_SCHEMA) {
    defaults[setting.key] = setting.default;
  }
  return defaults;
}

export function getSettingsByCategory(): Map<SettingCategory, SettingDefinition[]> {
  const grouped = new Map<SettingCategory, SettingDefinition[]>();
  for (const category of SETTING_CATEGORIES) {
    const settings = SETTINGS_SCHEMA.filter((s) => s.category === category.id).sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );
    if (settings.length > 0) {
      grouped.set(category, settings);
    }
  }
  return grouped;
}

// ============================================================================
// File-based Settings (JSON file in app config directory)
// ============================================================================

const SETTINGS_FILE_NAME = 'settings.json';
let cachedConfigDir: string | null = null;
let cachedSettings: Record<string, unknown> | null = null;

export async function getSettingsFilePath(): Promise<string> {
  if (!cachedConfigDir) {
    cachedConfigDir = await appConfigDir();
  }
  return join(cachedConfigDir, SETTINGS_FILE_NAME);
}

async function ensureConfigDir(): Promise<void> {
  if (!cachedConfigDir) {
    cachedConfigDir = await appConfigDir();
  }
  const dirExists = await exists(cachedConfigDir);
  if (!dirExists) {
    await mkdir(cachedConfigDir, { recursive: true });
  }
}

export async function loadSettingsFromFile(): Promise<Record<string, unknown>> {
  if (cachedSettings) {
    return { ...cachedSettings };
  }

  const defaults = getDefaultSettings();

  try {
    const filePath = await getSettingsFilePath();
    const fileExists = await exists(filePath);

    if (!fileExists) {
      cachedSettings = defaults;
      return { ...defaults };
    }

    const content = await readTextFile(filePath);
    const userSettings = JSON.parse(content);
    const merged = { ...defaults, ...userSettings };
    cachedSettings = merged;
    return { ...merged };
  } catch (err) {
    console.error('Failed to load settings from file:', err);
    cachedSettings = defaults;
    return { ...defaults };
  }
}

export async function saveSettingsToFile(settings: Record<string, unknown>): Promise<void> {
  try {
    await ensureConfigDir();
    const filePath = await getSettingsFilePath();
    const defaults = getDefaultSettings();

    // Only save non-default values
    const toSave: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings)) {
      if (defaults[key] !== value) {
        toSave[key] = value;
      }
    }

    const content = JSON.stringify(toSave, null, 2);
    await writeTextFile(filePath, content);
    cachedSettings = { ...defaults, ...toSave };
  } catch (err) {
    console.error('Failed to save settings to file:', err);
    throw err;
  }
}

export function clearSettingsCache(): void {
  cachedSettings = null;
}

// ============================================================================
// Legacy Terminal Settings API (for backwards compatibility)
// ============================================================================

export interface TerminalSettings {
  shell: string;
  fontSize: number;
  fontFamily: string;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  scrollback: number;
}

export interface AppSettings {
  terminal: TerminalSettings;
  theme: 'dark' | 'light';
}

const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  shell: '',
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  terminal: DEFAULT_TERMINAL_SETTINGS,
  theme: 'dark',
};

const LEGACY_STORAGE_KEY = 'blink-settings';

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_APP_SETTINGS,
        ...parsed,
        terminal: {
          ...DEFAULT_TERMINAL_SETTINGS,
          ...parsed.terminal,
        },
      };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return DEFAULT_APP_SETTINGS;
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

export function getTerminalSettings(): TerminalSettings {
  return loadSettings().terminal;
}

export function updateTerminalSettings(updates: Partial<TerminalSettings>): AppSettings {
  const current = loadSettings();
  const newSettings: AppSettings = {
    ...current,
    terminal: {
      ...current.terminal,
      ...updates,
    },
  };
  saveSettings(newSettings);
  return newSettings;
}

export function resetSettings(): AppSettings {
  saveSettings(DEFAULT_APP_SETTINGS);
  return DEFAULT_APP_SETTINGS;
}
