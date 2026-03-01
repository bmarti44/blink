/**
 * Blink Dark Theme for VS Code Workbench
 *
 * Custom dark theme with Blink brand colors.
 * Primary: Blink Red (#C74634)
 * Secondary: Blink Yellow (#F5A623) for highlights
 */

// Blink brand colors
const BLINK_RED = '#C74634';
const BLINK_RED_LIGHT = '#E85A4F';
const BLINK_RED_DARK = '#A33D2E';
const BLINK_YELLOW = '#F5A623';
const BLINK_YELLOW_LIGHT = '#FFB84D';

// Dark theme base colors
const DARK_FG = '#D4D4D4';
const DARK_BORDER = '#3C3C3C';

/**
 * Generate CSS overrides for Blink Dark theme
 */
export function getBlinkThemeCSS(): string {
  return `
/* Blink Dark Theme */

/* CSS Variables */
:root {
  --blink-red: ${BLINK_RED};
  --blink-red-light: ${BLINK_RED_LIGHT};
  --blink-red-dark: ${BLINK_RED_DARK};
  --blink-yellow: ${BLINK_YELLOW};
  --blink-yellow-light: ${BLINK_YELLOW_LIGHT};

  /* Focus & Borders */
  --vscode-focusBorder: ${BLINK_RED};
  --vscode-contrastBorder: transparent;
  --vscode-contrastActiveBorder: ${BLINK_RED};

  /* Buttons */
  --vscode-button-background: ${BLINK_RED};
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: ${BLINK_RED_LIGHT};
  --vscode-button-secondaryBackground: ${DARK_BORDER};
  --vscode-button-secondaryForeground: ${DARK_FG};

  /* Progress */
  --vscode-progressBar-background: ${BLINK_RED};

  /* Badges */
  --vscode-badge-background: ${BLINK_RED};
  --vscode-badge-foreground: #ffffff;

  /* Activity Bar */
  --vscode-activityBar-foreground: ${DARK_FG};
  --vscode-activityBar-activeBorder: ${BLINK_RED};
  --vscode-activityBar-activeBackground: #2D2D2D;
  --vscode-activityBarBadge-background: ${BLINK_RED};
  --vscode-activityBarBadge-foreground: #ffffff;

  /* Tabs */
  --vscode-tab-activeBorderTop: ${BLINK_RED};
  --vscode-tab-unfocusedActiveBorderTop: ${BLINK_RED_DARK};

  /* Panel */
  --vscode-panelTitle-activeBorder: ${BLINK_RED};

  /* Links */
  --vscode-textLink-foreground: ${BLINK_RED};
  --vscode-textLink-activeForeground: ${BLINK_RED_LIGHT};

  /* Editor */
  --vscode-editorCursor-foreground: ${BLINK_YELLOW};
  --vscode-editor-findMatchBackground: ${BLINK_YELLOW}66;
  --vscode-editor-findMatchHighlightBackground: ${BLINK_YELLOW}33;

  /* List */
  --vscode-list-highlightForeground: ${BLINK_YELLOW};
  --vscode-list-focusHighlightForeground: ${BLINK_YELLOW_LIGHT};

  /* Input */
  --vscode-inputOption-activeBorder: ${BLINK_RED};
  --vscode-inputOption-activeBackground: ${BLINK_RED}66;
  --vscode-inputValidation-errorBorder: ${BLINK_RED};

  /* Scrollbar */
  --vscode-scrollbarSlider-activeBackground: ${BLINK_RED}99;

  /* Sash (panel dividers) */
  --vscode-sash-hoverBorder: ${BLINK_YELLOW};
  --vscode-sash-activeBackground: ${BLINK_YELLOW};
  --vscode-sash-activeBorder: ${BLINK_YELLOW};

  /* Extensions */
  --vscode-extensionButton-prominentBackground: ${BLINK_RED};
  --vscode-extensionButton-prominentForeground: #ffffff;
  --vscode-extensionButton-prominentHoverBackground: ${BLINK_RED_LIGHT};

  /* Checkbox */
  --vscode-checkbox-background: ${DARK_BORDER};
  --vscode-checkbox-selectBackground: ${BLINK_RED};
  --vscode-checkbox-selectBorder: ${BLINK_RED};

  /* Settings */
  --vscode-settings-modifiedItemIndicator: ${BLINK_RED};

  /* Status Bar */
  --vscode-statusBar-background: #181818;
  --vscode-statusBar-foreground: ${DARK_FG};
  --vscode-statusBar-border: ${DARK_BORDER};
  --vscode-statusBar-noFolderBackground: #181818;
  --vscode-statusBar-noFolderForeground: ${DARK_FG};
  --vscode-statusBar-debuggingBackground: ${BLINK_RED};
  --vscode-statusBar-debuggingForeground: #ffffff;
  --vscode-statusBarItem-activeBackground: ${BLINK_RED}66;
  --vscode-statusBarItem-hoverBackground: #3C3C3C;
  --vscode-statusBarItem-prominentBackground: ${BLINK_RED};
  --vscode-statusBarItem-prominentForeground: #ffffff;
  --vscode-statusBarItem-prominentHoverBackground: ${BLINK_RED_LIGHT};
  --vscode-statusBarItem-remoteBackground: ${BLINK_RED};
  --vscode-statusBarItem-remoteForeground: #ffffff;
  --vscode-statusBarItem-errorBackground: ${BLINK_RED};
  --vscode-statusBarItem-errorForeground: #ffffff;
  --vscode-statusBarItem-warningBackground: ${BLINK_YELLOW};
  --vscode-statusBarItem-warningForeground: #000000;

  /* Selection & Focus (blue -> yellow) */
  --vscode-editor-selectionBackground: ${BLINK_YELLOW}44;
  --vscode-editor-selectionHighlightBackground: ${BLINK_YELLOW}33;
  --vscode-editor-inactiveSelectionBackground: ${BLINK_YELLOW}22;
  --vscode-editor-wordHighlightBackground: ${BLINK_YELLOW}33;
  --vscode-editor-wordHighlightStrongBackground: ${BLINK_YELLOW}44;
  --vscode-editor-wordHighlightTextBackground: ${BLINK_YELLOW}33;

  /* List Selection (blue -> yellow) */
  --vscode-list-activeSelectionBackground: ${BLINK_YELLOW}33;
  --vscode-list-activeSelectionForeground: #ffffff;
  --vscode-list-inactiveSelectionBackground: ${BLINK_YELLOW}22;
  --vscode-list-focusBackground: ${BLINK_YELLOW}33;
  --vscode-list-focusOutline: ${BLINK_YELLOW};
  --vscode-list-focusAndSelectionOutline: ${BLINK_YELLOW};

  /* Quick Input */
  --vscode-quickInput-list-focusBackground: ${BLINK_YELLOW}33;
  --vscode-quickInputList-focusBackground: ${BLINK_YELLOW}33;

  /* Editor Highlight */
  --vscode-editor-hoverHighlightBackground: ${BLINK_YELLOW}22;
  --vscode-editor-lineHighlightBackground: ${BLINK_YELLOW}11;
  --vscode-editor-rangeHighlightBackground: ${BLINK_YELLOW}22;

  /* Peek View */
  --vscode-peekView-border: ${BLINK_YELLOW};
  --vscode-peekViewEditor-matchHighlightBackground: ${BLINK_YELLOW}44;
  --vscode-peekViewResult-matchHighlightBackground: ${BLINK_YELLOW}44;
  --vscode-peekViewResult-selectionBackground: ${BLINK_YELLOW}33;

  /* Editor Widget */
  --vscode-editorWidget-border: ${BLINK_YELLOW}66;

  /* Suggest Widget */
  --vscode-editorSuggestWidget-selectedBackground: ${BLINK_YELLOW}33;
  --vscode-editorSuggestWidget-focusHighlightForeground: ${BLINK_YELLOW};
  --vscode-editorSuggestWidget-highlightForeground: ${BLINK_YELLOW};

  /* Menu */
  --vscode-menu-selectionBackground: ${BLINK_YELLOW}33;

  /* Dropdown */
  --vscode-dropdown-listBackground: #252526;

  /* Tree indent guides */
  --vscode-tree-indentGuidesStroke: ${BLINK_YELLOW}44;

  /* Minimap */
  --vscode-minimap-selectionHighlight: ${BLINK_YELLOW}66;
  --vscode-minimap-findMatchHighlight: ${BLINK_YELLOW};

  /* Editor marker navigation */
  --vscode-editorMarkerNavigation-background: #252526;

  /* Bracket match */
  --vscode-editorBracketMatch-background: ${BLINK_YELLOW}33;
  --vscode-editorBracketMatch-border: ${BLINK_YELLOW};
}

/* Buttons */
.monaco-button,
.monaco-text-button,
.monaco-workbench .monaco-button,
.monaco-workbench .monaco-text-button {
  background-color: ${BLINK_RED} !important;
  color: #ffffff !important;
  border: none !important;
}

.monaco-button:hover,
.monaco-text-button:hover,
.monaco-workbench .monaco-button:hover,
.monaco-workbench .monaco-text-button:hover {
  background-color: ${BLINK_RED_LIGHT} !important;
}

.monaco-button.secondary,
.monaco-workbench .monaco-button.secondary {
  background-color: ${DARK_BORDER} !important;
  color: ${DARK_FG} !important;
}

/* Activity Bar */
.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked .active-item-indicator:before {
  border-left-color: ${BLINK_RED} !important;
}

.monaco-workbench .activitybar .badge {
  background-color: ${BLINK_RED} !important;
  color: #ffffff !important;
}

/* Tabs */
.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active {
  border-top: 2px solid ${BLINK_RED} !important;
}

/* Panel */
.monaco-workbench .part.panel > .title > .panel-switcher-container > .monaco-action-bar .action-item.checked .action-label {
  border-bottom-color: ${BLINK_RED} !important;
}

/* Progress Bar */
.monaco-workbench .monaco-progress-container .progress-bit {
  background-color: ${BLINK_RED} !important;
}

/* Links */
a,
.monaco-link,
.monaco-workbench a,
.monaco-workbench .monaco-link {
  color: ${BLINK_RED} !important;
}

a:hover,
.monaco-link:hover,
.monaco-workbench a:hover,
.monaco-workbench .monaco-link:hover {
  color: ${BLINK_RED_LIGHT} !important;
}

/* Focus Border */
.monaco-workbench *:focus {
  outline-color: ${BLINK_RED} !important;
}

/* Input Focus */
.monaco-workbench .monaco-inputbox.synthetic-focus,
.monaco-workbench .monaco-inputbox:focus-within {
  border-color: ${BLINK_RED} !important;
}

/* Cursor */
.monaco-editor .cursor {
  background-color: ${BLINK_YELLOW} !important;
  border-color: ${BLINK_YELLOW} !important;
}

/* Find Match */
.monaco-editor .findMatch {
  background-color: ${BLINK_YELLOW}66 !important;
}

.monaco-editor .currentFindMatch {
  background-color: ${BLINK_YELLOW}99 !important;
}

/* List Highlight */
.monaco-list .monaco-highlighted-label .highlight,
.monaco-workbench .monaco-list .monaco-highlighted-label .highlight {
  color: ${BLINK_YELLOW} !important;
}

/* Pane header titles */
.monaco-pane-view .pane > .pane-header h3.title,
.monaco-workbench .monaco-pane-view .pane > .pane-header h3.title {
  color: ${BLINK_RED} !important;
}

/* Sash (panel dividers) - only on hover/active */
.monaco-sash.hover,
.monaco-sash.active,
.monaco-workbench .monaco-sash.hover,
.monaco-workbench .monaco-sash.active {
  background-color: ${BLINK_YELLOW} !important;
}

.monaco-sash.hover:before,
.monaco-sash.hover:after,
.monaco-sash.active:before,
.monaco-sash.active:after,
.monaco-workbench .monaco-sash.hover:before,
.monaco-workbench .monaco-sash.hover:after,
.monaco-workbench .monaco-sash.active:before,
.monaco-workbench .monaco-sash.active:after {
  background-color: ${BLINK_YELLOW} !important;
}

/* Scrollbar Active */
.monaco-scrollable-element > .scrollbar > .slider:active {
  background-color: ${BLINK_RED}99 !important;
}

/* Status Bar Remote */
.monaco-workbench .part.statusbar > .items-container > .statusbar-item.remote-kind {
  background-color: ${BLINK_RED} !important;
  color: #ffffff !important;
}

/* Extension Button */
.extension-editor .monaco-button,
.extensions-list .monaco-button {
  background-color: ${BLINK_RED} !important;
  color: #ffffff !important;
}

/* Checkbox checked */
.monaco-custom-checkbox.checked:before,
.monaco-workbench .monaco-custom-checkbox.checked:before {
  background-color: ${BLINK_RED} !important;
  border-color: ${BLINK_RED} !important;
}

/* Settings modified indicator */
.monaco-workbench .settings-editor .setting-item-modified-indicator {
  background-color: ${BLINK_RED} !important;
}

/* Notification buttons */
.monaco-workbench .notifications-list-container .notification-list-item .notification-list-item-buttons-container .monaco-button {
  background-color: ${BLINK_RED} !important;
  color: #ffffff !important;
}

/* Status Bar */
.monaco-workbench .part.statusbar {
  background-color: #181818 !important;
  color: ${DARK_FG} !important;
  border-top: 1px solid ${DARK_BORDER} !important;
}

.monaco-workbench .part.statusbar.no-folder-workspace {
  background-color: #181818 !important;
}

/* List Focus Outline */
.monaco-workbench .monaco-list:focus:before,
.monaco-workbench .monaco-list:not(.element-focused):focus:before,
.monaco-workbench .monaco-list:not(.element-focused):not(:active):focus:before {
  outline-color: ${BLINK_RED} !important;
}

/* Any remaining blue selection backgrounds */
.monaco-workbench .monaco-list .monaco-list-row.selected,
.monaco-workbench .monaco-list .monaco-list-row.focused {
  background-color: ${BLINK_YELLOW}33 !important;
}

.monaco-workbench .monaco-list .monaco-list-row.selected.focused {
  background-color: ${BLINK_YELLOW}44 !important;
}
`;
}

export { BLINK_RED, BLINK_RED_LIGHT, BLINK_RED_DARK, BLINK_YELLOW, BLINK_YELLOW_LIGHT };
