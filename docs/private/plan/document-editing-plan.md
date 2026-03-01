# Microsoft Document Editing Implementation Plan

## Executive Summary

This plan extends Blink's existing document preview capabilities into full WYSIWYG editing. The current implementation already has:

- Rust backends for Word (docx_rs), Excel (calamine + rust_xlsxwriter), PowerPoint (Node.js sidecar)
- Basic editor components (WordEditor, ExcelEditor, PowerPointEditor)
- VSCode editor resolvers for all three formats
- TipTap integration for Word (optional)

This plan focuses on:

1. Adding AST type definitions for LLM-compatible document operations
2. Implementing LLM function schemas for AI document editing
3. Enhancing editor UI components with better toolbars
4. Improving the editing experience with proper undo/redo

---

## Test File Numbering

> **IMPORTANT**: Document editing tests use range **70-79** to avoid conflicts with existing tests.
>
> Existing test ranges:
>
> - 01-09: Core health, workbench, extensions
> - 20-29: AI integration (already used)
> - 26-28: Extensions panel UI (already used)
> - 30-39: Terminal, panels
> - 40-49: AI features
> - 50-59: VS Code features (Git, Debugger, Testing)
> - 60-69: Agent/Composer features
> - **70-79: Document editing** (this plan)

---

## Current State Analysis

### Existing Components

| Component            | Location                                     | Status                               |
| -------------------- | -------------------------------------------- | ------------------------------------ |
| Word Rust Backend    | `src-tauri/src/services/word.rs`             | Working (docx_rs)                    |
| Excel Rust Backend   | `src-tauri/src/services/excel.rs`            | Working (calamine + rust_xlsxwriter) |
| PowerPoint Backend   | `src-tauri/scripts/pptx-service.js`          | Working (Node.js)                    |
| Document Service     | `src-tauri/src/services/document_service.rs` | Working (unified interface)          |
| Word Editor UI       | `src/components/office/WordEditor.tsx`       | Basic editing                        |
| Excel Editor UI      | `src/components/office/ExcelEditor.tsx`      | Cell editing                         |
| PowerPoint Editor UI | `src/components/office/PowerPointEditor.tsx` | Title/body editing                   |
| DOCX Resolver        | `src/services/vscode/editorResolverDocx.ts`  | Working with TipTap                  |
| XLSX Resolver        | `src/services/vscode/editorResolverXlsx.ts`  | Basic                                |
| PPTX Resolver        | `src/services/vscode/editorResolverPptx.ts`  | Basic                                |

### Existing Edit Commands (from document_service.rs)

**Word**: InsertParagraph, ReplaceParagraph, DeleteParagraph, InsertHeading, InsertTable, InsertList, ApplyStyle
**Excel**: SetCell, SetFormula, SetCellRange, InsertRow, InsertColumn, DeleteRow, DeleteColumn, CreateSheet, DeleteSheet, FormatCell
**PowerPoint**: AddSlide, DeleteSlide, SetSlideTitle, SetSlideBody, AddTextBox, AddShape, SetSpeakerNotes

---

## Phase 1: AST Type Definitions (Day 1)

Create TypeScript type definitions that mirror the research report's AST structures for LLM integration.

### Files to Create

1. **`src/services/vscode/office/ast/types.ts`** - Core shared types
2. **`src/services/vscode/office/ast/word-ast.ts`** - Word document AST
3. **`src/services/vscode/office/ast/excel-ast.ts`** - Excel workbook AST
4. **`src/services/vscode/office/ast/pptx-ast.ts`** - PowerPoint presentation AST
5. **`src/services/vscode/office/ast/operations.ts`** - Edit operation types

### Key Types

```typescript
// Base node for all document elements
interface BaseNode {
  type: string;
  id: string;
}

// Position for insert operations
interface InsertPosition {
  type: 'before' | 'after' | 'start' | 'end' | 'at';
  anchorId?: string;
  index?: number;
}

// Generic edit operation
interface DocumentOperation {
  type: string;
  targetId?: string;
  position?: InsertPosition;
  data?: unknown;
}
```

---

## Phase 2: LLM Function Schemas (Day 2)

Create OpenAI-compatible function calling schemas for document operations.

### Files to Create

1. **`src/services/vscode/office/llm/FunctionSchemas.ts`** - Complete operation schemas
2. **`src/services/vscode/office/llm/OperationValidator.ts`** - Pre-execution validation
3. **`src/services/vscode/office/llm/OperationExecutor.ts`** - Execute validated operations

### Integration with AI

Update `ai/chatProvider.ts` to:

- Detect document context in user messages
- Include document schemas in function calling
- Execute document operations through the Tauri backend

---

## Phase 3: Enhanced Editor UI (Day 3-4)

Improve the WebView editors with better toolbars and formatting controls.

### Word Editor Enhancements

- Full TipTap toolbar (Bold, Italic, Underline, Strikethrough)
- Heading styles dropdown (H1-H4)
- List buttons (bullet, numbered)
- Alignment controls
- Undo/Redo buttons

### Excel Editor Enhancements

- Cell formatting toolbar (Bold, Italic)
- Number format dropdown
- Cell alignment buttons
- Formula bar display
- Sheet tab management

### PowerPoint Editor Enhancements

- Slide layout selector
- Text formatting toolbar
- Slide thumbnail improvements
- Add slide button

---

## Phase 4: E2E Test Suite (Day 5)

Create comprehensive tests for document editing functionality.

### Test Files (70-79 range)

| File                 | Purpose                               |
| -------------------- | ------------------------------------- |
| `70-docx-edit.sh`    | Word document editing tests           |
| `71-xlsx-edit.sh`    | Excel workbook editing tests          |
| `72-pptx-edit.sh`    | PowerPoint presentation editing tests |
| `73-document-llm.sh` | LLM document operation tests          |

---

## Implementation Checklist

### Phase 1: AST Types

- [ ] Create `src/services/vscode/office/ast/types.ts`
- [ ] Create `src/services/vscode/office/ast/word-ast.ts`
- [ ] Create `src/services/vscode/office/ast/excel-ast.ts`
- [ ] Create `src/services/vscode/office/ast/pptx-ast.ts`
- [ ] Create `src/services/vscode/office/ast/operations.ts`
- [ ] Create index.ts for exports

### Phase 2: LLM Integration

- [ ] Create `src/services/vscode/office/llm/FunctionSchemas.ts`
- [ ] Create `src/services/vscode/office/llm/OperationValidator.ts`
- [ ] Create `src/services/vscode/office/llm/OperationExecutor.ts`
- [ ] Update `ai/chatProvider.ts` with document operation support
- [ ] Add document context detection

### Phase 3: Editor UI

- [ ] Enhance Word editor toolbar in `editorResolverDocx.ts`
- [ ] Enhance Excel editor toolbar in `editorResolverXlsx.ts`
- [ ] Enhance PowerPoint editor in `editorResolverPptx.ts`
- [ ] Add undo/redo support

### Phase 4: Testing

- [ ] Create `70-docx-edit.sh` test suite
- [ ] Create `71-xlsx-edit.sh` test suite
- [ ] Create `72-pptx-edit.sh` test suite
- [ ] Create `73-document-llm.sh` test suite
- [ ] Update `run-tests.sh` with new suites
- [ ] Add `npm run test:tauri:docs` script
- [ ] Run full verification

---

## E2E Test Scenarios

### 70-docx-edit.sh

```bash
test_01_open_docx_file() {
    # Act: Open a .docx file
    open_file "/tmp/test-workspace/sample.docx"

    # Assert: Word editor opens
    wait_for_element "[data-testid='word-editor']" 10
    assert_element_visible "[data-testid='word-editor']"
}

test_02_type_in_document() {
    # Act: Type text in editor
    click_element "[data-testid='word-editor-content']"
    type_text "[data-testid='word-editor-content']" "Hello World"

    # Assert: Text appears
    local content=$(get_element_text "[data-testid='word-editor-content']")
    assert_contains "$content" "Hello World"
}

test_03_apply_bold_formatting() {
    # Arrange: Select text
    select_text "[data-testid='word-editor-content']" "Hello"

    # Act: Click bold button
    click_testid "word-toolbar-bold"

    # Assert: Text is bold
    assert_element_exists "[data-testid='word-editor-content'] strong"
}

test_04_save_document() {
    # Act: Save document
    send_key "Control+s"

    # Assert: Save indicator appears
    wait_for_element "[data-testid='save-success']" 5
}
```

### 71-xlsx-edit.sh

```bash
test_01_open_xlsx_file() {
    open_file "/tmp/test-workspace/sample.xlsx"
    wait_for_element "[data-testid='excel-editor']" 10
}

test_02_edit_cell() {
    # Act: Click cell A1 and type
    click_element "[data-testid='cell-A1']"
    type_text "[data-testid='cell-input']" "100"
    send_key "Enter"

    # Assert: Cell shows value
    local value=$(get_element_text "[data-testid='cell-A1']")
    assert_equals "$value" "100"
}

test_03_enter_formula() {
    # Act: Enter SUM formula
    click_element "[data-testid='cell-A3']"
    type_text "[data-testid='formula-bar']" "=SUM(A1:A2)"
    send_key "Enter"

    # Assert: Formula evaluates
    wait_for_element "[data-testid='cell-A3']" 5
}

test_04_add_sheet() {
    # Act: Click add sheet button
    click_testid "add-sheet"

    # Assert: New sheet tab appears
    wait_for_element "[data-testid='sheet-tab-Sheet2']" 5
}
```

### 72-pptx-edit.sh

```bash
test_01_open_pptx_file() {
    open_file "/tmp/test-workspace/sample.pptx"
    wait_for_element "[data-testid='pptx-editor']" 10
}

test_02_edit_slide_title() {
    # Act: Click title and edit
    click_element "[data-testid='slide-title']"
    clear_input "[data-testid='slide-title']"
    type_text "[data-testid='slide-title']" "New Title"

    # Assert: Title updated
    local title=$(get_element_text "[data-testid='slide-title']")
    assert_equals "$title" "New Title"
}

test_03_add_slide() {
    click_testid "add-slide"
    wait_for_element "[data-testid='slide-thumbnail-2']" 5
}

test_04_navigate_slides() {
    click_element "[data-testid='slide-thumbnail-2']"
    wait_for_element "[data-testid='active-slide-2']" 2
}
```

### 73-document-llm.sh

```bash
test_01_llm_creates_document() {
    # Act: Ask AI to create a document
    click_testid "chat-panel-toggle"
    type_text "[data-testid='chat-input']" "Create a Word document with a title and three bullet points about AI"
    click_testid "chat-send"

    # Assert: Document created
    wait_for_element "[data-testid='tool-use-create_document']" 60
}

test_02_llm_edits_document() {
    # Arrange: Have document open
    open_file "/tmp/test-workspace/existing.docx"
    wait_for_element "[data-testid='word-editor']" 10

    # Act: Ask AI to edit
    type_text "[data-testid='chat-input']" "Make the first paragraph bold"
    click_testid "chat-send"

    # Assert: Edit applied
    wait_for_element "[data-testid='tool-use-document_edit']" 60
    assert_element_exists "[data-testid='word-editor-content'] strong"
}
```

---

## Verification Commands

```bash
# TypeScript
npx tsc --noEmit

# Rust
cd src-tauri && cargo check && cargo test

# Tauri E2E (requires app: npm run tauri:dev)
npm run test:tauri                # all tests
npm run test:tauri:docs           # document tests only (new)
```

---

## Library Stack (from Research Report)

| Document Type      | Read/Parse       | Write/Generate         | Editor UI     | Status   |
| ------------------ | ---------------- | ---------------------- | ------------- | -------- |
| Word (.docx)       | docx_rs (Rust)   | docx_rs (Rust)         | TipTap 3.x    | Existing |
| Excel (.xlsx)      | calamine (Rust)  | rust_xlsxwriter (Rust) | Custom grid   | Existing |
| PowerPoint (.pptx) | pptx2json (Node) | PptxGenJS (Node)       | Custom canvas | Existing |

---

## Critical Constraints (from Research Report)

1. **Lossless roundtrip is impossible** - No library preserves all features
2. **PowerPoint ecosystem immaturity** - Limited editing capabilities
3. **Formula calculation mismatch** - JS formulas != Excel exactly
4. **CSP restrictions** - WebViews have strict security policies

---

## Success Criteria

1. All document types can be opened and edited in VSCode workbench
2. AI can understand and execute document operations via chat
3. E2E tests verify basic CRUD operations for each format
4. TypeScript compiles without errors
5. Rust backend compiles and passes tests
