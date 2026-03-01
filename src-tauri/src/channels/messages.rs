//! Channel Message Types
//!
//! Defines all message types used for IPC communication.
//! These types match VS Code's language server protocol types.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Position in a document
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

impl Position {
    pub fn new(line: u32, character: u32) -> Self {
        Self { line, character }
    }

    pub fn zero() -> Self {
        Self::new(0, 0)
    }
}

impl Default for Position {
    fn default() -> Self {
        Self::zero()
    }
}

/// Range in a document
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

impl Range {
    pub fn new(start: Position, end: Position) -> Self {
        Self { start, end }
    }

    pub fn from_coords(start_line: u32, start_char: u32, end_line: u32, end_char: u32) -> Self {
        Self {
            start: Position::new(start_line, start_char),
            end: Position::new(end_line, end_char),
        }
    }

    pub fn empty() -> Self {
        Self::new(Position::zero(), Position::zero())
    }

    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }

    pub fn contains(&self, pos: Position) -> bool {
        if pos.line < self.start.line || pos.line > self.end.line {
            return false;
        }
        if pos.line == self.start.line && pos.character < self.start.character {
            return false;
        }
        if pos.line == self.end.line && pos.character > self.end.character {
            return false;
        }
        true
    }
}

impl Default for Range {
    fn default() -> Self {
        Self::empty()
    }
}

/// Location (URI + Range)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    pub uri: String,
    pub range: Range,
}

impl Location {
    pub fn new(uri: String, range: Range) -> Self {
        Self { uri, range }
    }
}

/// Text edit
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEdit {
    pub range: Range,
    pub new_text: String,
}

impl TextEdit {
    pub fn new(range: Range, new_text: String) -> Self {
        Self { range, new_text }
    }

    pub fn insert(position: Position, text: String) -> Self {
        Self::new(Range::new(position, position), text)
    }

    pub fn delete(range: Range) -> Self {
        Self::new(range, String::new())
    }

    pub fn replace(range: Range, text: String) -> Self {
        Self::new(range, text)
    }
}

/// Completion item kind
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum CompletionItemKind {
    Text = 1,
    Method = 2,
    Function = 3,
    Constructor = 4,
    Field = 5,
    Variable = 6,
    Class = 7,
    Interface = 8,
    Module = 9,
    Property = 10,
    Unit = 11,
    Value = 12,
    Enum = 13,
    Keyword = 14,
    Snippet = 15,
    Color = 16,
    File = 17,
    Reference = 18,
    Folder = 19,
    EnumMember = 20,
    Constant = 21,
    Struct = 22,
    Event = 23,
    Operator = 24,
    TypeParameter = 25,
}

/// Completion item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<CompletionItemKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_edit: Option<TextEdit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_text_edits: Option<Vec<TextEdit>>,
}

impl CompletionItem {
    pub fn new(label: String) -> Self {
        Self {
            label,
            kind: None,
            detail: None,
            documentation: None,
            insert_text: None,
            sort_text: None,
            filter_text: None,
            text_edit: None,
            additional_text_edits: None,
        }
    }

    pub fn with_kind(mut self, kind: CompletionItemKind) -> Self {
        self.kind = Some(kind);
        self
    }

    pub fn with_detail(mut self, detail: String) -> Self {
        self.detail = Some(detail);
        self
    }

    pub fn with_insert_text(mut self, text: String) -> Self {
        self.insert_text = Some(text);
        self
    }
}

/// Completion list
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionList {
    pub is_incomplete: bool,
    pub items: Vec<CompletionItem>,
}

impl CompletionList {
    pub fn new(items: Vec<CompletionItem>, is_incomplete: bool) -> Self {
        Self {
            is_incomplete,
            items,
        }
    }

    pub fn complete(items: Vec<CompletionItem>) -> Self {
        Self::new(items, false)
    }

    pub fn incomplete(items: Vec<CompletionItem>) -> Self {
        Self::new(items, true)
    }
}

/// Marked string for hover content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MarkedString {
    String(String),
    Code { language: String, value: String },
}

impl MarkedString {
    pub fn plain(s: impl Into<String>) -> Self {
        Self::String(s.into())
    }

    pub fn code(language: impl Into<String>, value: impl Into<String>) -> Self {
        Self::Code {
            language: language.into(),
            value: value.into(),
        }
    }
}

/// Hover result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hover {
    pub contents: Vec<MarkedString>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
}

impl Hover {
    pub fn new(contents: Vec<MarkedString>) -> Self {
        Self {
            contents,
            range: None,
        }
    }

    pub fn with_range(mut self, range: Range) -> Self {
        self.range = Some(range);
        self
    }
}

/// Diagnostic severity
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

/// Diagnostic tag
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum DiagnosticTag {
    Unnecessary = 1,
    Deprecated = 2,
}

/// Diagnostic related information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticRelatedInformation {
    pub location: Location,
    pub message: String,
}

/// Diagnostic
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub range: Range,
    pub message: String,
    pub severity: DiagnosticSeverity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<DiagnosticTag>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_information: Option<Vec<DiagnosticRelatedInformation>>,
}

impl Diagnostic {
    pub fn error(range: Range, message: String) -> Self {
        Self {
            range,
            message,
            severity: DiagnosticSeverity::Error,
            code: None,
            source: None,
            tags: None,
            related_information: None,
        }
    }

    pub fn warning(range: Range, message: String) -> Self {
        Self {
            range,
            message,
            severity: DiagnosticSeverity::Warning,
            code: None,
            source: None,
            tags: None,
            related_information: None,
        }
    }

    pub fn with_source(mut self, source: String) -> Self {
        self.source = Some(source);
        self
    }

    pub fn with_code(mut self, code: String) -> Self {
        self.code = Some(code);
        self
    }
}

/// Document symbol kind
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum SymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
}

/// Document symbol
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSymbol {
    pub name: String,
    pub kind: SymbolKind,
    pub range: Range,
    pub selection_range: Range,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<DocumentSymbol>,
}

impl DocumentSymbol {
    pub fn new(name: String, kind: SymbolKind, range: Range) -> Self {
        Self {
            name,
            kind,
            selection_range: range,
            range,
            detail: None,
            children: Vec::new(),
        }
    }

    pub fn with_children(mut self, children: Vec<DocumentSymbol>) -> Self {
        self.children = children;
        self
    }
}

/// Command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Command {
    pub title: String,
    pub command: String,
    #[serde(default)]
    pub arguments: Vec<serde_json::Value>,
}

impl Command {
    pub fn new(title: String, command: String) -> Self {
        Self {
            title,
            command,
            arguments: Vec::new(),
        }
    }

    pub fn with_args(mut self, args: Vec<serde_json::Value>) -> Self {
        self.arguments = args;
        self
    }
}

/// Workspace edit
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceEdit {
    pub changes: HashMap<String, Vec<TextEdit>>,
}

impl WorkspaceEdit {
    pub fn new() -> Self {
        Self {
            changes: HashMap::new(),
        }
    }

    pub fn add_edit(&mut self, uri: String, edit: TextEdit) {
        self.changes.entry(uri).or_default().push(edit);
    }
}

impl Default for WorkspaceEdit {
    fn default() -> Self {
        Self::new()
    }
}

/// Code action
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeAction {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Vec<Diagnostic>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_preferred: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit: Option<WorkspaceEdit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<Command>,
}

impl CodeAction {
    pub fn new(title: String) -> Self {
        Self {
            title,
            kind: None,
            diagnostics: None,
            is_preferred: None,
            edit: None,
            command: None,
        }
    }

    pub fn quickfix(title: String, edit: WorkspaceEdit) -> Self {
        Self {
            title,
            kind: Some("quickfix".to_string()),
            diagnostics: None,
            is_preferred: None,
            edit: Some(edit),
            command: None,
        }
    }
}

/// Signature help
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureHelp {
    pub signatures: Vec<SignatureInformation>,
    pub active_signature: u32,
    pub active_parameter: u32,
}

/// Signature information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureInformation {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
    #[serde(default)]
    pub parameters: Vec<ParameterInformation>,
}

/// Parameter information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParameterInformation {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_position() {
        let pos = Position::new(10, 5);
        assert_eq!(pos.line, 10);
        assert_eq!(pos.character, 5);
    }

    #[test]
    fn test_range_contains() {
        let range = Range::from_coords(1, 0, 3, 10);

        assert!(range.contains(Position::new(1, 0)));
        assert!(range.contains(Position::new(2, 5)));
        assert!(range.contains(Position::new(3, 10)));

        assert!(!range.contains(Position::new(0, 0)));
        assert!(!range.contains(Position::new(4, 0)));
        assert!(!range.contains(Position::new(3, 11)));
    }

    #[test]
    fn test_completion_item() {
        let item = CompletionItem::new("test".to_string())
            .with_kind(CompletionItemKind::Function)
            .with_detail("A test function".to_string());

        assert_eq!(item.label, "test");
        assert_eq!(item.kind, Some(CompletionItemKind::Function));
        assert_eq!(item.detail, Some("A test function".to_string()));
    }

    #[test]
    fn test_text_edit() {
        let insert = TextEdit::insert(Position::new(1, 0), "hello".to_string());
        assert!(insert.range.is_empty());
        assert_eq!(insert.new_text, "hello");

        let delete = TextEdit::delete(Range::from_coords(1, 0, 1, 5));
        assert!(delete.new_text.is_empty());
    }
}
