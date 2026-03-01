#!/usr/bin/env node
/**
 * AI Chat Sidecar
 *
 * This Node.js script runs as a sidecar process and handles AI chat requests
 * using @gbu/rapid-machine-learning. It communicates with the Tauri app via stdin/stdout.
 *
 * Protocol:
 * - Input: JSON lines on stdin
 * - Output: JSON lines on stdout
 * - Each request has an "id" for correlation
 * - Streaming tokens are sent as separate messages with the same id
 */

const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');

// Import undici for proxy support
let EnvHttpProxyAgent, undici;
try {
  undici = require('undici');
  EnvHttpProxyAgent = undici.EnvHttpProxyAgent;
} catch (err) {
  console.error('[Sidecar] Warning: undici not available, proxy support disabled');
}

// Set up proxy dispatcher globally if available
if (EnvHttpProxyAgent) {
  const dispatcher = new EnvHttpProxyAgent();
  // Set as global dispatcher for all fetch requests
  undici.setGlobalDispatcher(dispatcher);
}

let getPromptResponse, waitForToken, setTokenValues, tokenCallbackHandler;
let useRealAPI = true;

// Check for mock mode environment variable
const mockModeEnv = process.env.RAPID_CODE_MOCK?.toLowerCase();
const forceMockMode = mockModeEnv === 'true' || mockModeEnv === '1';

if (forceMockMode) {
  console.error('[Sidecar] Mock mode enabled via RAPID_CODE_MOCK environment variable');
  useRealAPI = false;
} else {
  try {
    const rapidML = require('@gbu/rapid-machine-learning');
    getPromptResponse = rapidML.getPromptResponse;
    waitForToken = rapidML.waitForToken;
    setTokenValues = rapidML.setTokenValues;
    tokenCallbackHandler = rapidML.tokenCallbackHandler;
  } catch (err) {
    console.error('[Sidecar] Warning: @gbu/rapid-machine-learning not available, using mock mode');
    useRealAPI = false;
  }
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

const TOOLS = {
  read_file: {
    name: 'read_file',
    description: 'Read the contents of a file at the specified path. Use this to examine existing code or files.',
    parameters: {
      path: { type: 'string', description: 'The file path relative to the project root', required: true },
    },
  },
  write_file: {
    name: 'write_file',
    description:
      'Write content to a file. Creates the file if it does not exist, or overwrites if it does. Use this to create new files or modify existing ones.',
    parameters: {
      path: { type: 'string', description: 'The file path relative to the project root', required: true },
      content: { type: 'string', description: 'The complete content to write to the file', required: true },
    },
  },
  list_directory: {
    name: 'list_directory',
    description: 'List all files and directories in the specified directory. Use this to explore the project structure.',
    parameters: {
      path: { type: 'string', description: 'The directory path relative to the project root (use "." for root)', required: true },
      recursive: { type: 'boolean', description: 'Whether to list recursively (default: false)', required: false },
    },
  },
  search_files: {
    name: 'search_files',
    description: 'Search for files matching a pattern or containing specific text.',
    parameters: {
      pattern: { type: 'string', description: 'Glob pattern to match file names (e.g., "*.tsx", "**/*.js")', required: false },
      content: { type: 'string', description: 'Text to search for within files', required: false },
      path: { type: 'string', description: 'Directory to search in (default: project root)', required: false },
    },
  },
  delete_file: {
    name: 'delete_file',
    description: 'Delete a file at the specified path. Use with caution.',
    parameters: {
      path: { type: 'string', description: 'The file path relative to the project root', required: true },
    },
  },
  create_directory: {
    name: 'create_directory',
    description: 'Create a new directory at the specified path.',
    parameters: {
      path: { type: 'string', description: 'The directory path relative to the project root', required: true },
    },
  },
};

// Generate tool documentation for the system prompt
function generateToolDocs() {
  let docs = 'You have access to the following tools to help you accomplish tasks:\n\n';

  for (const [name, tool] of Object.entries(TOOLS)) {
    docs += `### ${name}\n`;
    docs += `${tool.description}\n`;
    docs += 'Parameters:\n';
    for (const [paramName, param] of Object.entries(tool.parameters)) {
      docs += `  - ${paramName} (${param.type}${param.required ? ', required' : ', optional'}): ${param.description}\n`;
    }
    docs += '\n';
  }

  docs += `
## How to use tools

When you need to use a tool, output a tool call in the following XML format:

<tool_call>
<name>tool_name</name>
<parameters>
{"param1": "value1", "param2": "value2"}
</parameters>
</tool_call>

After you make a tool call, wait for the result before continuing. The result will be provided to you.

You can make multiple tool calls in sequence to accomplish complex tasks. For example:
1. Use list_directory to explore the project structure
2. Use read_file to examine relevant files
3. Use write_file to make changes

Always explain what you're doing to the user before and after using tools.
`;

  return docs;
}

// Generate document editing documentation
function generateDocumentEditDocs() {
  return `
## Editing Office Documents (Word, Excel, PowerPoint)

When a document file is provided in context, you can edit it using structured edit commands.
Document content will be provided in a structured format showing the current content.

To edit a document, output a document_edit block in the following format:

<document_edit>
<file>path/to/document.docx</file>
<edits>
[
  { "type": "EditType", ... edit parameters ... }
]
</edits>
</document_edit>

### Word Document Edits (.docx)

Available edit types:
- InsertParagraph: Add a new paragraph
  { "type": "InsertParagraph", "text": "content", "position": "End" }
  Position options: "Start", "End", {"AtIndex": n}, {"AfterParagraph": n}

- ReplaceParagraph: Replace an existing paragraph
  { "type": "ReplaceParagraph", "index": 0, "text": "new content" }

- DeleteParagraph: Remove a paragraph
  { "type": "DeleteParagraph", "index": 0 }

- InsertHeading: Add a heading
  { "type": "InsertHeading", "text": "Heading Text", "level": 1, "position": "Start" }

- InsertTable: Add a table
  { "type": "InsertTable", "rows": [["Cell1", "Cell2"], ["Cell3", "Cell4"]], "position": "End" }

- InsertList: Add a list
  { "type": "InsertList", "items": ["Item 1", "Item 2"], "ordered": false, "position": "End" }

### Excel Document Edits (.xlsx)

Available edit types:
- SetCell: Set a cell value
  { "type": "SetCell", "sheet": "Sheet1", "cell": "A1", "value": "Hello" }

- SetFormula: Set a cell formula
  { "type": "SetFormula", "sheet": "Sheet1", "cell": "B1", "formula": "=SUM(A1:A10)" }

- SetCellRange: Set multiple cells at once
  { "type": "SetCellRange", "sheet": "Sheet1", "start": "A1", "values": [["A","B"],["C","D"]] }

- InsertRow: Insert a new row
  { "type": "InsertRow", "sheet": "Sheet1", "index": 5 }

- InsertColumn: Insert a new column
  { "type": "InsertColumn", "sheet": "Sheet1", "index": 2 }

- DeleteRow: Delete a row
  { "type": "DeleteRow", "sheet": "Sheet1", "index": 3 }

- DeleteColumn: Delete a column
  { "type": "DeleteColumn", "sheet": "Sheet1", "index": 1 }

- CreateSheet: Create a new worksheet
  { "type": "CreateSheet", "name": "New Sheet" }

- DeleteSheet: Delete a worksheet
  { "type": "DeleteSheet", "name": "Sheet1" }

### PowerPoint Document Edits (.pptx)

Available edit types:
- AddSlide: Add a new slide
  { "type": "AddSlide", "layout": "TitleAndContent" }
  Layout options: "TitleSlide", "TitleAndContent", "SectionHeader", "TwoContent", "Comparison", "TitleOnly", "Blank"

- DeleteSlide: Remove a slide
  { "type": "DeleteSlide", "index": 2 }

- SetSlideTitle: Set slide title
  { "type": "SetSlideTitle", "index": 0, "title": "New Title" }

- SetSlideBody: Set slide body content
  { "type": "SetSlideBody", "index": 0, "body": "Slide content here" }

- SetSpeakerNotes: Set speaker notes for a slide
  { "type": "SetSpeakerNotes", "index": 0, "notes": "Notes for the presenter" }

- AddTextBox: Add a text box
  { "type": "AddTextBox", "slide": 0, "text": "Text content", "position": {"left_inches": 1, "top_inches": 1, "width_inches": 4, "height_inches": 2} }

Example document edit:

<document_edit>
<file>report.docx</file>
<edits>
[
  { "type": "InsertHeading", "text": "Executive Summary", "level": 1, "position": "Start" },
  { "type": "InsertParagraph", "text": "This report covers Q4 results.", "position": { "AfterParagraph": 0 } }
]
</edits>
</document_edit>
`;
}

// System prompt for the AI assistant
const SYSTEM_PROMPT = `You are an AI coding assistant integrated into Blink, a desktop application for editing and working with files. You have FULL ACCESS to read and modify files in the user's project directory.

## Your Capabilities

You can help users with:
- Understanding and explaining code
- Finding and fixing bugs
- Refactoring and improving code quality
- Writing documentation
- Creating new files and features
- Modifying existing code
- Navigating and exploring the codebase
- Editing Microsoft Office documents (Word, Excel, PowerPoint)

## Important Guidelines

1. **Be proactive**: When asked to make changes, actually make them using the tools provided
2. **Verify before modifying**: Read files before editing them to understand their current state
3. **Explain your actions**: Tell the user what you're doing and why
4. **Be careful with destructive operations**: Confirm before deleting files
5. **Format code properly**: When writing code, use appropriate formatting and syntax
6. **Office Documents**: Use document_edit blocks for Word/Excel/PowerPoint files, not write_file

${generateToolDocs()}

${generateDocumentEditDocs()}
`;

// Track active requests for cancellation
const activeRequests = new Map();

// Current working directory (set per request)
let currentWorkingDirectory = null;

// Code Assist API configuration
const CODE_ASSIST_CHAT_ENDPOINT = undefined;
const DEFAULT_MODEL = undefined;

// Token refresh management
const TOKEN_TTL_MS = 3600000;
const TOKEN_REFRESH_SKEW_MS = 60000;
let tokenRefreshPromise = null;

// =============================================================================
// TOOL EXECUTION
// =============================================================================

/**
 * Resolve a path relative to the current working directory
 */
function resolvePath(relativePath) {
  if (!currentWorkingDirectory) {
    throw new Error('No working directory set');
  }

  // Prevent path traversal attacks
  const resolved = path.resolve(currentWorkingDirectory, relativePath);
  if (!resolved.startsWith(currentWorkingDirectory)) {
    throw new Error('Path traversal not allowed');
  }

  return resolved;
}

/**
 * Execute a tool and return the result
 */
async function executeTool(toolName, parameters) {
  console.error(`[Sidecar] Executing tool: ${toolName}`, parameters);

  try {
    switch (toolName) {
      case 'read_file': {
        const filePath = resolvePath(parameters.path);
        const content = await fs.readFile(filePath, 'utf-8');
        return {
          success: true,
          result: {
            path: parameters.path,
            content,
            size: content.length,
            lines: content.split('\n').length,
          },
        };
      }

      case 'write_file': {
        const filePath = resolvePath(parameters.path);
        // Ensure parent directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, parameters.content, 'utf-8');
        return {
          success: true,
          result: {
            path: parameters.path,
            bytesWritten: parameters.content.length,
            message: `Successfully wrote ${parameters.content.length} bytes to ${parameters.path}`,
          },
        };
      }

      case 'list_directory': {
        const dirPath = resolvePath(parameters.path || '.');
        const recursive = parameters.recursive || false;

        async function listDir(dir, prefix = '') {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const results = [];

          for (const entry of entries) {
            // Skip hidden files and node_modules
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const isDirectory = entry.isDirectory();

            results.push({
              name: entry.name,
              path: relativePath,
              type: isDirectory ? 'directory' : 'file',
            });

            if (recursive && isDirectory) {
              const subEntries = await listDir(path.join(dir, entry.name), relativePath);
              results.push(...subEntries);
            }
          }

          return results;
        }

        const entries = await listDir(dirPath);
        return {
          success: true,
          result: {
            path: parameters.path || '.',
            entries,
            count: entries.length,
          },
        };
      }

      case 'search_files': {
        const searchPath = resolvePath(parameters.path || '.');
        const results = [];

        async function searchDir(dir) {
          const entries = await fs.readdir(dir, { withFileTypes: true });

          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(currentWorkingDirectory, fullPath);

            if (entry.isDirectory()) {
              await searchDir(fullPath);
            } else {
              // Check pattern match
              let matchesPattern = true;
              if (parameters.pattern) {
                const pattern = parameters.pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
                matchesPattern = new RegExp(pattern).test(entry.name);
              }

              // Check content match
              let matchesContent = true;
              let matchingLines = [];
              if (parameters.content && matchesPattern) {
                try {
                  const content = await fs.readFile(fullPath, 'utf-8');
                  const lines = content.split('\n');
                  matchesContent = content.includes(parameters.content);
                  if (matchesContent) {
                    lines.forEach((line, index) => {
                      if (line.includes(parameters.content)) {
                        matchingLines.push({ line: index + 1, content: line.trim().substring(0, 100) });
                      }
                    });
                  }
                } catch (e) {
                  matchesContent = false;
                }
              }

              if (matchesPattern && matchesContent) {
                results.push({
                  path: relativePath,
                  matches: matchingLines.length > 0 ? matchingLines.slice(0, 5) : undefined,
                });
              }
            }
          }
        }

        await searchDir(searchPath);
        return {
          success: true,
          result: {
            query: { pattern: parameters.pattern, content: parameters.content },
            files: results.slice(0, 50),
            totalMatches: results.length,
          },
        };
      }

      case 'delete_file': {
        const filePath = resolvePath(parameters.path);
        await fs.unlink(filePath);
        return {
          success: true,
          result: {
            path: parameters.path,
            message: `Successfully deleted ${parameters.path}`,
          },
        };
      }

      case 'create_directory': {
        const dirPath = resolvePath(parameters.path);
        await fs.mkdir(dirPath, { recursive: true });
        return {
          success: true,
          result: {
            path: parameters.path,
            message: `Successfully created directory ${parameters.path}`,
          },
        };
      }

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }
  } catch (error) {
    console.error(`[Sidecar] Tool execution error:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Parse tool calls from AI response
 */
function parseToolCalls(text) {
  const toolCalls = [];
  const regex = /<tool_call>\s*<name>(.*?)<\/name>\s*<parameters>([\s\S]*?)<\/parameters>\s*<\/tool_call>/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const name = match[1].trim();
      const paramsStr = match[2].trim();
      const parameters = JSON.parse(paramsStr);
      toolCalls.push({ name, parameters, raw: match[0] });
    } catch (e) {
      console.error('[Sidecar] Failed to parse tool call:', e);
    }
  }

  return toolCalls;
}

/**
 * Parse document edits from AI response
 */
function parseDocumentEdits(text) {
  const documentEdits = [];
  const regex = /<document_edit>\s*<file>(.*?)<\/file>\s*<edits>([\s\S]*?)<\/edits>\s*<\/document_edit>/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const file = match[1].trim();
      const editsStr = match[2].trim();
      const edits = JSON.parse(editsStr);
      documentEdits.push({ file, edits, raw: match[0] });
    } catch (e) {
      console.error('[Sidecar] Failed to parse document edit:', e);
    }
  }

  return documentEdits;
}

/**
 * Check if text contains a tool call
 */
function hasToolCall(text) {
  return text.includes('<tool_call>');
}

/**
 * Check if text contains a document edit
 */
function hasDocumentEdit(text) {
  return text.includes('<document_edit>');
}

// =============================================================================
// TOKEN MANAGEMENT
// =============================================================================

async function ensureFreshToken() {
  if (!useRealAPI || !waitForToken) return;

  const expiresTime = parseInt(process.env.RAPID_ML_EXPIRES_TIME || '0', 10);
  const now = Date.now();

  if (process.env.RAPID_ML_ACCESS_TOKEN && expiresTime > now + TOKEN_REFRESH_SKEW_MS) {
    return;
  }

  if (!tokenRefreshPromise) {
    console.error('[Sidecar] Token expired or missing, opening browser for authentication...');
    tokenRefreshPromise = waitForToken()
      .then(() => {
        console.error('[Sidecar] Token received successfully');
      })
      .catch((err) => {
        console.error('[Sidecar] Token refresh failed:', err.message);
        throw err;
      })
      .finally(() => {
        tokenRefreshPromise = null;
      });
  }

  await tokenRefreshPromise;
}

// =============================================================================
// MESSAGE HANDLING
// =============================================================================

function parseSSEData(data) {
  if (typeof data !== 'string') return null;

  if (data.includes('data: [DONE]')) {
    return { done: true };
  }

  const lines = data.split('\n');
  let content = '';

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6).trim();
      if (jsonStr && jsonStr !== '[DONE]') {
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.choices && parsed.choices[0]?.delta?.content) {
            content += parsed.choices[0].delta.content;
          }
        } catch (e) {
          // Not JSON, might be raw content
        }
      }
    }
  }

  return content ? { content } : null;
}

function sendMessage(msg) {
  console.log(JSON.stringify(msg));
}

// =============================================================================
// CHAT REQUEST HANDLING
// =============================================================================

function buildMessages(request, toolHistory = []) {
  const messages = [];

  // Build system message with context
  let systemContent = SYSTEM_PROMPT;

  // Add working directory info
  if (currentWorkingDirectory) {
    systemContent += `\n\n## Current Project\nWorking directory: ${currentWorkingDirectory}\n`;
  }

  // Add file context if provided
  if (request.context && request.context.files) {
    systemContent += '\n\n<open_files>';
    for (const file of request.context.files) {
      if (file.content) {
        systemContent += `\n--- File: ${file.name} ---\n\`\`\`\n${file.content}\n\`\`\``;
      }
    }
    systemContent += '\n</open_files>';
  }

  // Add selected code if provided
  if (request.context && request.context.selectedCode) {
    const { file, code, startLine, endLine } = request.context.selectedCode;
    systemContent += `\n\n<selected_code file="${file}" lines="${startLine}-${endLine}">\n\`\`\`\n${code}\n\`\`\`\n</selected_code>`;
  }

  messages.push({ role: 'system', content: systemContent });

  // Add conversation history
  if (request.history && request.history.length > 0) {
    for (const msg of request.history.slice(-10)) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  // Add tool history for this request
  for (const toolExchange of toolHistory) {
    messages.push({ role: 'assistant', content: toolExchange.call });
    messages.push({ role: 'user', content: `<tool_result>\n${JSON.stringify(toolExchange.result, null, 2)}\n</tool_result>` });
  }

  // Add current user message
  messages.push({ role: 'user', content: request.message });

  return messages;
}

async function handleChatRequestReal(request, toolHistory = []) {
  const { id } = request;

  try {
    await ensureFreshToken();

    const messages = buildMessages(request, toolHistory);

    let fullResponse = '';
    const abortController = new AbortController();
    const requestState = activeRequests.get(id);

    if (requestState) {
      requestState.abortController = abortController;
    }

    console.error(`[Sidecar] Sending request to API (tool iteration: ${toolHistory.length})...`);
    console.error(`[Sidecar] Messages count: ${messages.length}`);

    const result = await getPromptResponse(
      messages,
      CODE_ASSIST_CHAT_ENDPOINT,
      DEFAULT_MODEL,
      undefined,
      undefined,
      (text) => {
        const currentState = activeRequests.get(id);
        if (!currentState || currentState.cancelled) {
          abortController.abort();
          return;
        }

        const parsed = parseSSEData(text);

        if (parsed && parsed.content) {
          fullResponse += parsed.content;

          // Stream tokens to UI, but filter out tool call and document edit XML for cleaner display
          // We'll send tool usage and document edit notifications separately
          if (
            !parsed.content.includes('<tool_call>') &&
            !parsed.content.includes('</tool_call>') &&
            !parsed.content.includes('<document_edit>') &&
            !parsed.content.includes('</document_edit>')
          ) {
            sendMessage({ id, type: 'token', content: parsed.content });
          }
        }
      },
      abortController.signal
    );

    console.error(`[Sidecar] API response complete, length: ${fullResponse.length}`);

    // Check for document edits (these are sent to frontend for execution)
    if (hasDocumentEdit(fullResponse)) {
      const documentEdits = parseDocumentEdits(fullResponse);
      console.error(`[Sidecar] Found ${documentEdits.length} document edits`);

      for (const docEdit of documentEdits) {
        // Notify UI about document edit - frontend will handle execution
        sendMessage({
          id,
          type: 'document_edit',
          file: docEdit.file,
          edits: docEdit.edits,
        });
      }
    }

    // Check if response contains tool calls
    if (hasToolCall(fullResponse)) {
      const toolCalls = parseToolCalls(fullResponse);
      console.error(`[Sidecar] Found ${toolCalls.length} tool calls`);

      for (const toolCall of toolCalls) {
        // Notify UI about tool usage
        sendMessage({
          id,
          type: 'tool_use',
          tool: toolCall.name,
          parameters: toolCall.parameters,
        });

        // Execute the tool
        const toolResult = await executeTool(toolCall.name, toolCall.parameters);

        // Notify UI about tool result
        sendMessage({
          id,
          type: 'tool_result',
          tool: toolCall.name,
          success: toolResult.success,
          result: toolResult.success ? toolResult.result : undefined,
          error: toolResult.success ? undefined : toolResult.error,
        });

        // Add to tool history
        toolHistory.push({
          call: fullResponse,
          result: toolResult,
        });
      }

      // Continue the conversation with tool results (max 10 iterations)
      if (toolHistory.length < 10) {
        const finalState = activeRequests.get(id);
        if (finalState && !finalState.cancelled) {
          await handleChatRequestReal(request, toolHistory);
        }
      } else {
        sendMessage({
          id,
          type: 'token',
          content: '\n\n*Maximum tool iterations reached.*',
        });
        sendMessage({ id, type: 'complete', content: fullResponse });
        activeRequests.delete(id);
      }
    } else {
      // No tool calls, we're done
      const finalState = activeRequests.get(id);
      if (finalState && !finalState.cancelled) {
        sendMessage({ id, type: 'complete', content: fullResponse || result });
      }
      activeRequests.delete(id);
    }
  } catch (error) {
    const errorMessage = error.message || String(error);
    console.error(`[Sidecar] API error: ${errorMessage}`);
    console.error(`[Sidecar] Error stack: ${error.stack}`);

    if (
      errorMessage.includes('404') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('network') ||
      errorMessage.includes('proxy') ||
      errorMessage.includes('ETIMEDOUT')
    ) {
      sendMessage({
        id,
        type: 'token',
        content: `*[AI service unavailable - tool features require live API connection]*\n\n`,
      });
      await streamMockResponse(id, request.message);
    } else if (error.name !== 'AbortError') {
      sendMessage({
        id,
        type: 'error',
        error: errorMessage,
      });
    }
    activeRequests.delete(id);
  }
}

// =============================================================================
// MOCK MODE
// =============================================================================

const MOCK_RESPONSES = {
  explain: `I'd be happy to explain this code for you.

This code implements a component that handles user interactions. Here's a breakdown:

1. **State Management**: Uses hooks to manage local state
2. **Event Handlers**: Processes user input and updates accordingly
3. **Rendering**: Returns JSX that displays the UI

Would you like me to go deeper into any specific part?`,

  bug: `After analyzing the code, here are potential issues I noticed:

1. **Missing Error Handling**: Some async operations should have try-catch blocks
2. **Memory Leak Risk**: Event listeners may not be cleaned up in useEffect
3. **Type Safety**: Consider adding proper TypeScript types

Would you like me to show you how to fix any of these?`,

  refactor: `Here are some refactoring suggestions:

\`\`\`typescript
// Consider extracting repeated logic
const handleAction = useCallback((type: string) => {
  // Consolidated logic here
}, [dependencies]);
\`\`\`

Additional suggestions:
- Extract reusable hooks for complex state logic
- Use constants for magic strings
- Add JSDoc comments for public APIs`,

  // Mock response for file operations - demonstrates tool usage
  file: `I'll help you with that file. Let me read it first.

<tool_call>
<name>read_file</name>
<parameters>
{"path": "README.md"}
</parameters>
</tool_call>`,

  // Mock response for listing files
  list: `Let me explore the project structure for you.

<tool_call>
<name>list_directory</name>
<parameters>
{"path": ".", "recursive": false}
</parameters>
</tool_call>`,

  // Mock response for Word document editing - uses special mock_document_demo format
  word: {
    type: 'document_demo',
    docType: 'word',
    fileName: 'test-document.docx',
    intro: `I'll create a test Word document and demonstrate editing it.`,
    edits: [
      { type: 'InsertHeading', text: 'Meeting Notes', level: 1, position: 'Start' },
      { type: 'InsertParagraph', text: 'Date: December 30, 2024', position: 'End' },
      { type: 'InsertParagraph', text: 'Attendees: John, Sarah, Mike', position: 'End' },
      { type: 'InsertHeading', text: 'Action Items', level: 2, position: 'End' },
      { type: 'InsertList', items: ['Review Q4 report', 'Schedule follow-up meeting', 'Send summary email'], ordered: true, position: 'End' },
    ],
    summary: `**Edits Applied:**
- Added heading: "Meeting Notes" (Level 1)
- Added paragraph: "Date: December 30, 2024"
- Added paragraph: "Attendees: John, Sarah, Mike"
- Added heading: "Action Items" (Level 2)
- Added numbered list with 3 items`,
  },

  // Mock response for Excel editing
  excel: {
    type: 'document_demo',
    docType: 'excel',
    fileName: 'test-spreadsheet.xlsx',
    intro: `I'll create a test Excel spreadsheet and demonstrate editing it.`,
    edits: [
      { type: 'SetCell', sheet: 'Sheet1', cell: 'A1', value: 'Product' },
      { type: 'SetCell', sheet: 'Sheet1', cell: 'B1', value: 'Q1 Sales' },
      { type: 'SetCell', sheet: 'Sheet1', cell: 'C1', value: 'Q2 Sales' },
      { type: 'SetCell', sheet: 'Sheet1', cell: 'A2', value: 'Widget A' },
      { type: 'SetCell', sheet: 'Sheet1', cell: 'B2', value: '1500' },
      { type: 'SetCell', sheet: 'Sheet1', cell: 'C2', value: '1800' },
      { type: 'SetCell', sheet: 'Sheet1', cell: 'A3', value: 'Widget B' },
      { type: 'SetCell', sheet: 'Sheet1', cell: 'B3', value: '2200' },
      { type: 'SetCell', sheet: 'Sheet1', cell: 'C3', value: '2500' },
      { type: 'SetFormula', sheet: 'Sheet1', cell: 'B4', formula: '=SUM(B2:B3)' },
      { type: 'SetFormula', sheet: 'Sheet1', cell: 'C4', formula: '=SUM(C2:C3)' },
    ],
    summary: `**Edits Applied:**
- Set header row: Product, Q1 Sales, Q2 Sales
- Added data for Widget A: 1500, 1800
- Added data for Widget B: 2200, 2500
- Added SUM formula in B4: =SUM(B2:B3)
- Added SUM formula in C4: =SUM(C2:C3)`,
  },

  // Mock response for PowerPoint editing
  powerpoint: {
    type: 'document_demo',
    docType: 'powerpoint',
    fileName: 'test-presentation.pptx',
    intro: `I'll create a test PowerPoint presentation and demonstrate editing it.`,
    edits: [
      { type: 'AddSlide', layout: 'TitleSlide' },
      { type: 'SetSlideTitle', index: 0, title: 'Q4 2024 Business Review' },
      { type: 'SetSlideBody', index: 0, body: 'Prepared by AI Assistant' },
      { type: 'AddSlide', layout: 'TitleAndContent' },
      { type: 'SetSlideTitle', index: 1, title: 'Key Highlights' },
      { type: 'SetSlideBody', index: 1, body: '• Revenue up 15% YoY\n• Customer satisfaction at 92%\n• New product launches on track' },
      { type: 'SetSpeakerNotes', index: 1, notes: 'Emphasize the customer satisfaction improvement' },
    ],
    summary: `**Edits Applied:**
- Added title slide with layout "TitleSlide"
- Set slide 1 title: "Q4 2024 Business Review"
- Set slide 1 body: "Prepared by AI Assistant"
- Added content slide with layout "TitleAndContent"
- Set slide 2 title: "Key Highlights"
- Set slide 2 body with 3 bullet points
- Added speaker notes to slide 2`,
  },

  default: `I understand your question. Let me help you with that.

Based on the context provided, here's my analysis:

1. The code structure looks reasonable
2. Consider the architectural implications
3. Test coverage would be beneficial

Is there a specific aspect you'd like me to focus on?`,
};

function getMockResponse(message) {
  const lower = message.toLowerCase();
  if (lower.includes('explain')) return MOCK_RESPONSES.explain;
  if (lower.includes('bug') || lower.includes('error') || lower.includes('issue')) return MOCK_RESPONSES.bug;
  if (lower.includes('refactor') || lower.includes('improve')) return MOCK_RESPONSES.refactor;
  // File operation triggers
  if (lower.includes('read file') || lower.includes('show file') || lower.includes('open file')) return MOCK_RESPONSES.file;
  if (lower.includes('list') || lower.includes('files') || lower.includes('directory') || lower.includes('folder')) return MOCK_RESPONSES.list;
  // Document edit triggers
  if (lower.includes('word') || lower.includes('docx') || lower.includes('document')) return MOCK_RESPONSES.word;
  if (lower.includes('excel') || lower.includes('xlsx') || lower.includes('spreadsheet') || lower.includes('cell')) return MOCK_RESPONSES.excel;
  if (lower.includes('powerpoint') || lower.includes('pptx') || lower.includes('slide') || lower.includes('presentation'))
    return MOCK_RESPONSES.powerpoint;
  return MOCK_RESPONSES.default;
}

/**
 * Stream text word by word with typing effect
 */
async function streamText(id, text) {
  const words = text.split(' ').filter((w) => w.length > 0);
  for (const word of words) {
    const requestState = activeRequests.get(id);
    if (!requestState || requestState.cancelled) {
      return false;
    }
    sendMessage({ id, type: 'token', content: `${word} ` });
    await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 40));
  }
  return true;
}

/**
 * Handle document demo mock response - creates file, edits it, shows summary
 */
async function streamDocumentDemo(id, demo) {
  const { docType, fileName, intro, edits, summary } = demo;

  // Stream the intro
  if (!(await streamText(id, `${intro}\n\n`))) {
    sendMessage({ id, type: 'cancelled' });
    return;
  }

  // Step 1: Create the test document file
  sendMessage({ id, type: 'token', content: `**Step 1:** Creating test file \`${fileName}\`...\n\n` });
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Show tool use for creating the document
  sendMessage({
    id,
    type: 'tool_use',
    tool: 'create_document',
    parameters: { path: fileName, type: docType },
  });

  await new Promise((resolve) => setTimeout(resolve, 800));

  // Simulate successful file creation
  sendMessage({
    id,
    type: 'tool_result',
    tool: 'create_document',
    success: true,
    result: { path: fileName, message: `Created empty ${docType} document` },
  });

  await new Promise((resolve) => setTimeout(resolve, 300));

  // Step 2: Apply edits
  sendMessage({ id, type: 'token', content: `**Step 2:** Applying ${edits.length} edits to the document...\n\n` });
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Emit the document edit event
  sendMessage({
    id,
    type: 'document_edit',
    file: fileName,
    edits,
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Step 3: Show summary
  sendMessage({ id, type: 'token', content: `**Step 3:** Edits complete!\n\n` });
  await new Promise((resolve) => setTimeout(resolve, 200));

  if (!(await streamText(id, `${summary}\n\n`))) {
    sendMessage({ id, type: 'cancelled' });
    return;
  }

  sendMessage({ id, type: 'token', content: `\nThe file \`${fileName}\` is now ready. You can open it from the file explorer to see the changes.` });

  sendMessage({ id, type: 'complete', content: `${intro}\n\n${summary}` });
  activeRequests.delete(id);
}

async function streamMockResponse(id, message) {
  const response = getMockResponse(message);

  // Handle document demo objects
  if (response && typeof response === 'object' && response.type === 'document_demo') {
    await streamDocumentDemo(id, response);
    return;
  }

  // Handle string responses (regular mock responses)
  // Stream the response, but filter out XML blocks for cleaner display
  const cleanResponse = response
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<document_edit>[\s\S]*?<\/document_edit>/g, '')
    .trim();

  if (!(await streamText(id, cleanResponse))) {
    sendMessage({ id, type: 'cancelled' });
    return;
  }

  // Process tool calls in mock response
  if (hasToolCall(response)) {
    const toolCalls = parseToolCalls(response);
    for (const toolCall of toolCalls) {
      // Notify UI about tool usage
      sendMessage({
        id,
        type: 'tool_use',
        tool: toolCall.name,
        parameters: toolCall.parameters,
      });

      // Simulate tool execution delay
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Execute the tool (works even in mock mode since it uses local fs)
      const toolResult = await executeTool(toolCall.name, toolCall.parameters);

      // Notify UI about tool result
      sendMessage({
        id,
        type: 'tool_result',
        tool: toolCall.name,
        success: toolResult.success,
        result: toolResult.success ? toolResult.result : undefined,
        error: toolResult.success ? undefined : toolResult.error,
      });
    }
  }

  // Process document edits in mock response
  if (hasDocumentEdit(response)) {
    const documentEdits = parseDocumentEdits(response);
    for (const docEdit of documentEdits) {
      // Notify UI about document edit - frontend will handle execution
      sendMessage({
        id,
        type: 'document_edit',
        file: docEdit.file,
        edits: docEdit.edits,
      });
    }
  }

  sendMessage({ id, type: 'complete', content: response });
  activeRequests.delete(id);
}

// =============================================================================
// REQUEST HANDLERS
// =============================================================================

async function handleChatRequest(request) {
  const { id, message, workingDirectory } = request;

  // Set working directory for this request
  if (workingDirectory) {
    currentWorkingDirectory = workingDirectory;
    console.error(`[Sidecar] Working directory set to: ${currentWorkingDirectory}`);
  }

  activeRequests.set(id, { cancelled: false });

  if (useRealAPI) {
    await handleChatRequestReal(request);
  } else {
    await streamMockResponse(id, message);
  }
}

function handleCancel(request) {
  const { id } = request;
  const requestState = activeRequests.get(id);
  if (requestState) {
    requestState.cancelled = true;
    if (requestState.abortController) {
      requestState.abortController.abort();
    }
  }
  sendMessage({ id, type: 'cancelled' });
}

function handlePing(request) {
  sendMessage({ id: request.id, type: 'pong' });
}

function processMessage(line) {
  try {
    const request = JSON.parse(line);

    switch (request.type) {
      case 'chat':
        handleChatRequest(request);
        break;
      case 'cancel':
        handleCancel(request);
        break;
      case 'ping':
        handlePing(request);
        break;
      default:
        sendMessage({
          id: request.id,
          type: 'error',
          error: `Unknown request type: ${request.type}`,
        });
    }
  } catch (error) {
    sendMessage({
      type: 'error',
      error: `Failed to parse request: ${error.message}`,
    });
  }
}

// =============================================================================
// STARTUP
// =============================================================================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', processMessage);

rl.on('close', () => {
  process.exit(0);
});

console.error(`[Sidecar] Starting with tool support...`);
console.error(`[Sidecar] Available tools: ${Object.keys(TOOLS).join(', ')}`);
console.error(`[Sidecar] Proxy agent: ${EnvHttpProxyAgent ? 'enabled' : 'disabled'}`);
console.error(`[Sidecar] Mode: ${useRealAPI ? 'LIVE API' : 'MOCK MODE'}${forceMockMode ? ' (forced via RAPID_CODE_MOCK)' : ''}`);
console.error(`[Sidecar] HTTP_PROXY: ${process.env.HTTP_PROXY || process.env.http_proxy || 'not set'}`);
console.error(`[Sidecar] HTTPS_PROXY: ${process.env.HTTPS_PROXY || process.env.https_proxy || 'not set'}`);

sendMessage({ type: 'ready', mock: !useRealAPI, proxy: !!EnvHttpProxyAgent, tools: Object.keys(TOOLS) });
