# Blink Architecture

## Overview

Blink is a desktop IDE built with:

- **Tauri v2**: Rust-based desktop framework (replaces Electron)
- **React**: UI library (v19)
- **monaco-vscode-api**: Full VS Code Workbench in the browser
- **Integrates with providers**: AI assistance via your favorite provider

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              VS Code Workbench (monaco-vscode-api)          ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       ││
│  │  │ Activity │ │  Side    │ │  Editor  │ │  Bottom  │       ││
│  │  │   Bar    │ │  bar     │ │  Area    │ │  Panel   │       ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                Custom React Components                       ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                     ││
│  │  │  Office  │ │ AI Chat │ │ Settings │                     ││
│  │  │  Editors │ │  Panel   │ │  Editor  │                     ││
│  │  └──────────┘ └──────────┘ └──────────┘                     ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Service Layer (TypeScript)                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │   VS Code    │ │   Tauri FS   │ │  Extension   │            │
│  │   Services   │ │   Provider   │ │   Manager    │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  AI Chat     │ │   Settings   │ │   Recent     │            │
│  │   Service    │ │   Service    │ │   Files      │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│     Tauri Core (Rust)    │  │   AI Provider (BYOK)     │
│  ┌────────────────────┐  │  │  ┌────────────────────┐  │
│  │   File System      │  │  │  │   Anthropic API    │  │
│  │   Commands         │  │  │  │   (Claude)         │  │
│  └────────────────────┘  │  │  └────────────────────┘  │
│  ┌────────────────────┐  │  │  ┌────────────────────┐  │
│  │   Extension        │  │  │  │   OpenAI / custom  │  │
│  │   Management       │  │  │  │   OpenAI-compat     │  │
│  └────────────────────┘  │  │  └────────────────────┘  │
│  ┌────────────────────┐  │  └──────────────────────────┘
│  │   Test Server      │  │
│  │   (debug only)     │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

## Key Components

### 1. VS Code Workbench Integration

**File**: `src/services/vscode/workbench.ts`

The workbench is initialized with 40+ service overrides from `@codingame/monaco-vscode-*-service-override` packages. Key services:

| Service                              | Purpose                 | Status           |
| ------------------------------------ | ----------------------- | ---------------- |
| `files-service-override`             | File system abstraction | Working          |
| `extensions-service-override`        | Extension management    | Working          |
| `extension-gallery-service-override` | Open VSX marketplace    | Working          |
| `workbench-service-override`         | Full workbench UI       | Working          |
| `terminal-service-override`          | Integrated terminal     | Working          |
| `scm-service-override`               | Git/SCM panel           | **Need backend** |
| `debug-service-override`             | Debugger UI             | **Need backend** |
| `testing-service-override`           | Test explorer           | **Need backend** |
| `chat-service-override`              | AI chat                | Working          |

### 2. Tauri Filesystem Bridge

**File**: `src/services/vscode/tauriFileSystemProvider.ts`

Implements `IFileSystemProviderWithFileReadWriteCapability` to bridge VS Code's virtual filesystem to Tauri's native filesystem:

```typescript
class TauriFileSystemProvider {
  async readFile(uri: URI): Promise<Uint8Array>;
  async writeFile(uri: URI, content: Uint8Array): Promise<void>;
  async stat(uri: URI): Promise<IStat>;
  async readdir(uri: URI): Promise<[string, FileType][]>;
  async mkdir(uri: URI): Promise<void>;
  async delete(uri: URI): Promise<void>;
  async rename(from: URI, to: URI): Promise<void>;
}
```

### 3. Extension Management

**Files**:

- `src/services/vscode/extensionServiceOverride.ts` - Service patching (3,650 lines)
- `src/services/vscode/tauriExtensionManagementService.ts` - Tauri backend
- `src/services/vscode/tauriLocalExtensionServer.ts` - Local extension server

Extension flow:

1. User searches marketplace (Open VSX)
2. Click Install → `tauriExtensionManagementService.installFromGallery()`
3. VSIX downloaded and extracted via Tauri commands
4. Extension registered with local server
5. UI updated via event system

### 4. Blink Agent Integration

**Files**:

TBD

### 5. Office Document Editors

**Files**:

- `src/services/vscode/editorResolverDocx.ts` - Word editor (TipTap + docx_rs)
- `src/services/vscode/editorResolverXlsx.ts` - Excel editor (calamine + rust_xlsxwriter)
- `src/services/vscode/editorResolverPptx.ts` - PowerPoint editor (Node.js sidecar)

Custom editors are registered for `.docx`, `.xlsx`, `.pptx` files.

### 6. Extension Host Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Blink (Tauri v2)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              WebView + monaco-vscode-api                   │  │
│  │  - Web Worker Extension Host (themes, grammars, snippets) │  │
│  │  - Chat UI, Diff Editor, All panels                       │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │ WebSocket/Tauri IPC                  │
│  ┌────────────────────────▼──────────────────────────────────┐  │
│  │                    Rust Core                               │  │
│  │  - File system ops (git2-rs, tokio-fs)                    │  │
│  │  - DAP router for debugging (TODO)                         │  │
│  │  - AI OAuth server (port 8500)                            │  │
│  │  - Process management                                      │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │ stdin/stdout JSON-RPC                │
│  ┌────────────────────────▼──────────────────────────────────┐  │
│  │              Node.js Sidecar (pkg binary)                  │  │
│  │  - Node.js Extension Host (debuggers, linters, LSP)       │  │
│  │  - Language servers (typescript, pyright, rust-analyzer)  │  │
│  │  - PowerPoint service (pptx2json, PptxGenJS)              │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Extension Compatibility**:

- **Web Worker safe (~60%)**: Color themes, TextMate grammars, snippets, icon themes
- **Node.js required (~40%)**: Debuggers, linters (ESLint), language servers, Git extensions

## Data Flow

### File Operations

```
User clicks file in Explorer
        ↓
VS Code calls IFileService.readFile()
        ↓
Files service delegates to TauriFileSystemProvider
        ↓
TauriFileSystemProvider calls readFile() from @tauri-apps/plugin-fs
        ↓
Tauri invokes Rust command → OS filesystem
        ↓
Content returned as Uint8Array
        ↓
VS Code opens file in editor
```

### Extension Install

```
User clicks Install button
        ↓
IExtensionsWorkbenchService.install()
        ↓
Patched to use TauriExtensionManagementService
        ↓
Download VSIX from Open VSX
        ↓
Tauri command: extract VSIX to extensions directory
        ↓
TauriLocalExtensionServer registers extension
        ↓
Fire onDidInstallExtensions event
        ↓
UI updates via fakeLocalExtensions sync
```

### AI Chat Message

```
User sends message in Chat Panel
        ↓
chatProvider.handleRequest()
        ↓
streamChat(messages, callbacks) from aiProviderService.ts
        ↓
HTTP request to configured AI provider (Anthropic/OpenAI)
        ↓
SSE stream response
        ↓
onToken callbacks update chat UI progressively
        ↓
onComplete fires when stream ends
```

### AI Configuration

```
User opens Command Palette → "Blink: Configure AI Provider"
        ↓
configureProviderCommand.ts shows provider picker
        ↓
User selects Anthropic / OpenAI / Custom
        ↓
User enters API key and model
        ↓
Config stored in localStorage (blink-ai-provider-config)
        ↓
isAIProviderConfigured() returns true
        ↓
streamChat() is ready for requests
```

## Configuration

### User Settings

- Stored in: `~/.blink/settings.json`
- Loaded by: `src/services/settings.ts`
- Synced to VS Code configuration service

### Extension Storage

- Location: `~/.blink/extensions/`
- Metadata: `~/.blink/extensions.json`

### Workspace

- Stored in: `localStorage` (key: `blink-workspace-folder`)
- Can be passed via URL: `/#/vscode?folder=/path/to/folder`

### AI Configuration

- Config: `localStorage` (key: `blink-ai-provider-config`)
- Managed via Command Palette: "Blink: Configure AI Provider"

---

## Architecture Issues & Technical Debt

> **See [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) for full details.**

### Component Boundaries (Grade: D+)

The three-layer architecture exists but has porous boundaries:

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (React/TypeScript)                                     │
│  - 50+ service files (23,601 LOC)                                │
│  - 38 Tauri invoke() imports scattered across files              │
│  - No centralized adapter pattern                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ (porous boundary)
┌──────────────────────────▼──────────────────────────────────────┐
│  RUST BACKEND (Tauri)                                            │
│  - 7 command modules                                             │
│  - 9,371 LOC in services                                         │
│  - 162 unwrap() calls (panic on any error)                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ (stdin/stdout IPC)
┌──────────────────────────▼──────────────────────────────────────┐
│  NODE.JS SIDECAR                                                 │
│  - Extension host                                                │
│  - Language servers                                              │
│  - PowerPoint service                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Key Problems

| Problem                     | Severity | Location                                    |
| --------------------------- | -------- | ------------------------------------------- |
| **No Dependency Injection** | Critical | 4 singleton services                        |
| **God Objects**             | High     | `extensionServiceOverride.ts` (3,650 lines) |
| **Scattered State**         | High     | File + localStorage + in-memory caches      |
| **Tight Coupling**          | High     | Every layer knows impl details of next      |
| **No Centralized IPC**      | Medium   | 38 invoke() calls scattered                 |

### Memory Leaks (6 Critical)

1. `workbench.ts:306` - `setInterval(scan, 1000)` never cleared
2. `workbench.ts:304` - `MutationObserver` never disconnected
3. `extensionHostIntegration.ts` - Event handlers never unregistered
4. Rust threads hold Arc references indefinitely
5. Child processes not reaped (zombie processes)
6. Channel receivers dropped but subscriptions remain in HashMap

### Race Conditions (5 Critical)

1. **ExtensionHostState** - process/stdin can become inconsistent
2. **Workbench init** - Double-checked locking with race window
3. **Pending requests** - Reader thread and timeout race for same response
4. **Workspace folder** - Can change while awaiting send_request
5. **Request timeout** - Response and timeout can both fire

---

## Related Documents

- [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) - Full code review findings
- [FEATURES.md](./FEATURES.md) - Feature checklist with E2E tests
- [AI_IDE_ROADMAP.md](./plan/AI_IDE_ROADMAP.md) - Implementation roadmap
- [TESTING.md](./TESTING.md) - Testing guidelines
