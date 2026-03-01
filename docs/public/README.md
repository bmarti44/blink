# Blink IDE - User Guide

Blink is a powerful desktop IDE built with Tauri that combines VS Code's editing experience with AI-powered assistance and native Office document support.

## Getting Started

### Opening a Project

1. Launch Blink
2. Use **File > Open Folder** or press `Cmd+O` to select a project folder
3. The file explorer will show your project structure

### Navigation

| Area              | Description                                                                            |
| ----------------- | -------------------------------------------------------------------------------------- |
| **Activity Bar**  | Left-most sidebar with icons for Explorer, Search, Git, Debug, Extensions, and AI Chat |
| **Sidebar**       | Shows content for the selected activity (file tree, search results, etc.)              |
| **Editor Area**   | Main area with tabs for open files                                                     |
| **Bottom Panel**  | Terminal, Problems, Output (toggle with `Cmd+J`)                                       |
| **AI Chat Panel** | Right sidebar for AI assistance (toggle with `Cmd+Shift+C`)                            |

## Keyboard Shortcuts

### File Operations

| Shortcut      | Action                         |
| ------------- | ------------------------------ |
| `Cmd+O`       | Open folder                    |
| `Cmd+S`       | Save current file              |
| `Cmd+P`       | Quick file open                |
| `Shift+Shift` | Command palette / fuzzy search |
| `Cmd+W`       | Close current tab              |

### Editor

| Shortcut      | Action                 |
| ------------- | ---------------------- |
| `Cmd+F`       | Find in file           |
| `Cmd+H`       | Find and replace       |
| `Cmd+G`       | Go to line             |
| `Cmd+D`       | Select next occurrence |
| `Cmd+/`       | Toggle comment         |
| `Cmd+Z`       | Undo                   |
| `Cmd+Shift+Z` | Redo                   |

### Panels

| Shortcut      | Action                         |
| ------------- | ------------------------------ |
| `Cmd+B`       | Toggle sidebar                 |
| `Cmd+J`       | Toggle bottom panel (terminal) |
| `Cmd+Shift+C` | Toggle AI Chat panel           |
| `Cmd+,`       | Open settings                  |

## Features

### Code Editing

Blink provides a full VS Code editing experience:

- **Syntax highlighting** for TypeScript, JavaScript, JSON, HTML, CSS, Markdown, and more
- **IntelliSense** with auto-completion, parameter hints, and documentation
- **Go to Definition** (`Cmd+Click` or `F12`)
- **Find All References** (`Shift+F12`)
- **Rename Symbol** (`F2`)
- **Code folding** and **minimap**
- **Multiple cursors** (`Cmd+Click` to add cursors)

### Extensions

Install VS Code extensions from Open VSX marketplace:

1. Click the Extensions icon in the Activity Bar (or press `Cmd+Shift+X`)
2. Search for extensions in the search box
3. Click **Install** on any extension
4. Extensions are persisted locally and load on restart

Popular extensions:

- Language support (Python, Rust, Go, etc.)
- Themes and icons
- Linters and formatters
- Git integration tools

### AI Chat Assistant

The AI Chat panel provides intelligent coding assistance powered by Blink Code Assist:

1. Toggle the panel with `Cmd+Shift+C`
2. Type your question or request
3. Reference open files using the context selector
4. Blink Code Assist can:
   - Answer coding questions
   - Explain code
   - Suggest improvements
   - Help with debugging
   - Generate code snippets
   - Create and edit Office documents

### Office Document Support

Blink can open and edit Microsoft Office documents:

- **Word** (.docx) - View and edit documents
- **Excel** (.xlsx) - View and edit spreadsheets
- **PowerPoint** (.pptx) - View and edit presentations

Simply open an Office file from the file explorer or drag it into the editor.

### Terminal

Access an integrated terminal:

1. Press `Cmd+J` to open the bottom panel
2. Click the **Terminal** tab
3. Run shell commands directly in your project

### Settings

Customize your IDE experience:

1. Press `Cmd+,` to open Settings
2. Modify settings like:
   - Font size and family
   - Tab size and spaces vs tabs
   - Theme (dark/light)
   - Word wrap
   - Minimap visibility
3. Click **Open settings.json** for direct JSON editing

## File Types

| Extension                    | Editor                                         |
| ---------------------------- | ---------------------------------------------- |
| `.ts`, `.tsx`, `.js`, `.jsx` | Code editor with TypeScript/JavaScript support |
| `.json`                      | Code editor with JSON validation               |
| `.html`, `.css`, `.scss`     | Code editor with web support                   |
| `.md`                        | Code editor with Markdown preview              |
| `.docx`                      | Word document editor                           |
| `.xlsx`                      | Excel spreadsheet editor                       |
| `.pptx`                      | PowerPoint presentation editor                 |
| Other text files             | Plain text editor                              |

## Troubleshooting

### Files Not Saving

- Check that you have write permissions to the file location
- Look for error messages in the status bar

### Extensions Not Loading

- Restart the application
- Check the Output panel for extension errors
- Verify internet connection for marketplace access

### Performance Issues

- Close unused tabs
- Disable unused extensions
- Check the Problems panel for issues

## System Requirements

- **macOS**: 11.0 or later
- **Windows**: 10 or later
- **Linux**: Ubuntu 20.04+ or equivalent

## Getting Help

- Press `F1` or `Cmd+Shift+P` for the command palette
- Check the Output panel for logs
- AI Chat can answer questions about using the IDE
