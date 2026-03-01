use docx_rs::*;
use std::fs::File;
use std::io::Read;
use std::path::PathBuf;

use super::document_service::*;

/// Represents text formatting for a run of text
#[derive(Debug, Clone, Default)]
struct TextFormatting {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
}

/// Represents a formatted text run
#[derive(Debug, Clone)]
struct FormattedRun {
    text: String,
    formatting: TextFormatting,
}

/// Paragraph alignment
#[derive(Debug, Clone, Default)]
struct ParagraphFormatting {
    alignment: Option<String>, // left, center, right, justify
}

pub struct WordBackend;

impl WordBackend {
    pub fn new() -> Self {
        Self
    }

    fn read_docx_bytes(&self, path: &PathBuf) -> Result<Vec<u8>, DocumentError> {
        let file =
            File::open(path).map_err(|e| DocumentError::FileNotFound(format!("{}: {}", path.display(), e)))?;

        let mut buf = Vec::new();
        std::io::BufReader::new(file)
            .read_to_end(&mut buf)
            .map_err(|e| DocumentError::ParseError(e.to_string()))?;

        Ok(buf)
    }

    /// Extract formatting from a Run element
    fn extract_run_formatting(run: &Run) -> TextFormatting {
        let mut fmt = TextFormatting::default();

        // Check run properties - these are direct fields, not Options
        let props = &run.run_property;

        // Bold
        if props.bold.is_some() {
            fmt.bold = true;
        }

        // Italic
        if props.italic.is_some() {
            fmt.italic = true;
        }

        // Underline
        if props.underline.is_some() {
            fmt.underline = true;
        }

        // Strike
        if props.strike.is_some() {
            fmt.strike = true;
        }

        fmt
    }

    /// Extract formatted runs from a paragraph
    fn extract_formatted_runs(para: &Paragraph) -> Vec<FormattedRun> {
        let mut runs = Vec::new();

        for child in &para.children {
            if let ParagraphChild::Run(run) = child {
                let formatting = Self::extract_run_formatting(run);
                let mut text = String::new();

                for run_child in &run.children {
                    match run_child {
                        RunChild::Text(t) => text.push_str(&t.text),
                        RunChild::Tab(_) => text.push('\t'),
                        RunChild::Break(_) => text.push('\n'),
                        _ => {}
                    }
                }

                if !text.is_empty() {
                    runs.push(FormattedRun { text, formatting });
                }
            }
        }

        runs
    }

    /// Extract paragraph formatting
    fn extract_paragraph_formatting(para: &Paragraph) -> ParagraphFormatting {
        let mut fmt = ParagraphFormatting::default();

        // Check alignment - alignment.val is already a String in docx_rs
        if let Some(ref align) = para.property.alignment {
            // Map the string value to standard CSS alignment
            let align_str = align.val.to_lowercase();
            fmt.alignment = Some(match align_str.as_str() {
                "left" | "start" => "left".to_string(),
                "center" => "center".to_string(),
                "right" | "end" => "right".to_string(),
                "both" | "justified" | "justify" => "justify".to_string(),
                _ => "left".to_string(),
            });
        }

        fmt
    }

    fn extract_paragraph_text(para: &Paragraph) -> String {
        let mut text = String::new();
        for child in &para.children {
            if let ParagraphChild::Run(run) = child {
                for run_child in &run.children {
                    if let RunChild::Text(t) = run_child {
                        text.push_str(&t.text);
                    }
                }
            }
        }
        text
    }

    fn get_paragraph_style(para: &Paragraph) -> Option<String> {
        para.property.style.as_ref().map(|s| s.val.clone())
    }

    /// Convert formatting to inline CSS style
    fn formatting_to_style(fmt: &TextFormatting) -> String {
        let mut styles = Vec::new();

        if fmt.bold {
            styles.push("font-weight:bold".to_string());
        }
        if fmt.italic {
            styles.push("font-style:italic".to_string());
        }
        if fmt.underline {
            styles.push("text-decoration:underline".to_string());
        }
        if fmt.strike {
            styles.push("text-decoration:line-through".to_string());
        }

        styles.join(";")
    }

    /// Convert paragraph formatting to inline CSS style
    fn para_formatting_to_style(fmt: &ParagraphFormatting) -> String {
        let mut styles = Vec::new();

        if let Some(ref align) = fmt.alignment {
            styles.push(format!("text-align:{}", align));
        }

        styles.join(";")
    }
}

impl Default for WordBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl DocumentBackend for WordBackend {
    fn read(&self, path: &PathBuf) -> Result<DocumentContent, DocumentError> {
        let buf = self.read_docx_bytes(path)?;

        let docx =
            read_docx(&buf).map_err(|e| DocumentError::ParseError(format!("Failed to parse docx: {}", e)))?;

        let mut text_content = String::new();
        let mut paragraphs = Vec::new();

        for child in &docx.document.children {
            if let DocumentChild::Paragraph(para) = child {
                let para_text = Self::extract_paragraph_text(para);
                let style = Self::get_paragraph_style(para);

                if !para_text.is_empty() {
                    text_content.push_str(&para_text);
                    text_content.push('\n');
                }

                paragraphs.push(serde_json::json!({
                    "text": para_text,
                    "style": style,
                }));
            } else if let DocumentChild::Table(table) = child {
                // Extract table content
                let mut table_rows = Vec::new();
                for row in &table.rows {
                    let TableChild::TableRow(tr) = row;
                    let mut row_cells = Vec::new();
                    for cell in &tr.cells {
                        let TableRowChild::TableCell(tc) = cell;
                        let mut cell_text = String::new();
                        for cell_child in &tc.children {
                            if let TableCellContent::Paragraph(para) = cell_child {
                                cell_text.push_str(&Self::extract_paragraph_text(para));
                            }
                        }
                        row_cells.push(cell_text.clone());
                        text_content.push_str(&cell_text);
                        text_content.push('\t');
                    }
                    table_rows.push(row_cells);
                    text_content.push('\n');
                }

                paragraphs.push(serde_json::json!({
                    "type": "table",
                    "rows": table_rows,
                }));
            }
        }

        Ok(DocumentContent {
            doc_type: DocumentType::Word,
            text_content,
            structured_content: serde_json::json!({
                "paragraphs": paragraphs,
            }),
            metadata: DocumentMetadata {
                title: None,
                author: None,
                created: None,
                modified: None,
                page_count: None,
                sheet_count: None,
                slide_count: None,
            },
        })
    }

    fn apply_edit(&self, path: &PathBuf, edit: DocumentEdit) -> Result<(), DocumentError> {
        self.apply_edits(path, vec![edit])
    }

    fn apply_edits(&self, path: &PathBuf, edits: Vec<DocumentEdit>) -> Result<(), DocumentError> {
        // For new documents or when file doesn't exist, create a new one
        let mut docx = if path.exists() {
            let buf = self.read_docx_bytes(path)?;
            read_docx(&buf).map_err(|e| DocumentError::ParseError(format!("Failed to parse docx: {}", e)))?
        } else {
            Docx::new()
        };

        for edit in edits {
            match edit {
                DocumentEdit::InsertParagraph {
                    text,
                    position,
                    style,
                } => {
                    let mut para = Paragraph::new().add_run(Run::new().add_text(&text));
                    if let Some(style_name) = style {
                        para = para.style(&style_name);
                    }

                    match position {
                        InsertPosition::Start => {
                            let mut new_children =
                                vec![DocumentChild::Paragraph(Box::new(para))];
                            new_children.extend(docx.document.children.drain(..));
                            docx.document.children = new_children;
                        }
                        InsertPosition::End => {
                            docx.document
                                .children
                                .push(DocumentChild::Paragraph(Box::new(para)));
                        }
                        InsertPosition::AtIndex(idx) => {
                            let idx = idx.min(docx.document.children.len());
                            docx.document
                                .children
                                .insert(idx, DocumentChild::Paragraph(Box::new(para)));
                        }
                        InsertPosition::AfterParagraph(idx) => {
                            let insert_idx = (idx + 1).min(docx.document.children.len());
                            docx.document
                                .children
                                .insert(insert_idx, DocumentChild::Paragraph(Box::new(para)));
                        }
                    }
                }

                DocumentEdit::InsertHeading {
                    text,
                    level,
                    position,
                } => {
                    let style = match level {
                        1 => "Heading1",
                        2 => "Heading2",
                        3 => "Heading3",
                        _ => "Heading4",
                    };

                    let para = Paragraph::new()
                        .add_run(Run::new().add_text(&text))
                        .style(style);

                    match position {
                        InsertPosition::Start => {
                            let mut new_children =
                                vec![DocumentChild::Paragraph(Box::new(para))];
                            new_children.extend(docx.document.children.drain(..));
                            docx.document.children = new_children;
                        }
                        InsertPosition::End => {
                            docx.document
                                .children
                                .push(DocumentChild::Paragraph(Box::new(para)));
                        }
                        InsertPosition::AtIndex(idx) => {
                            let idx = idx.min(docx.document.children.len());
                            docx.document
                                .children
                                .insert(idx, DocumentChild::Paragraph(Box::new(para)));
                        }
                        InsertPosition::AfterParagraph(idx) => {
                            let insert_idx = (idx + 1).min(docx.document.children.len());
                            docx.document
                                .children
                                .insert(insert_idx, DocumentChild::Paragraph(Box::new(para)));
                        }
                    }
                }

                DocumentEdit::InsertTable { rows, position } => {
                    let mut table = Table::new(vec![]);

                    for row_data in rows {
                        let cells: Vec<TableCell> = row_data
                            .iter()
                            .map(|cell_text| {
                                TableCell::new().add_paragraph(
                                    Paragraph::new().add_run(Run::new().add_text(cell_text)),
                                )
                            })
                            .collect();
                        let row = TableRow::new(cells);
                        table = table.add_row(row);
                    }

                    match position {
                        InsertPosition::Start => {
                            let mut new_children = vec![DocumentChild::Table(Box::new(table))];
                            new_children.extend(docx.document.children.drain(..));
                            docx.document.children = new_children;
                        }
                        InsertPosition::End => {
                            docx.document
                                .children
                                .push(DocumentChild::Table(Box::new(table)));
                        }
                        InsertPosition::AtIndex(idx) => {
                            let idx = idx.min(docx.document.children.len());
                            docx.document
                                .children
                                .insert(idx, DocumentChild::Table(Box::new(table)));
                        }
                        InsertPosition::AfterParagraph(idx) => {
                            let insert_idx = (idx + 1).min(docx.document.children.len());
                            docx.document
                                .children
                                .insert(insert_idx, DocumentChild::Table(Box::new(table)));
                        }
                    }
                }

                DocumentEdit::InsertList {
                    items,
                    ordered,
                    position,
                } => {
                    // docx-rs list support requires numbering definitions
                    // For simplicity, create paragraphs with bullet/number prefixes
                    let mut list_paragraphs: Vec<DocumentChild> = items
                        .iter()
                        .enumerate()
                        .map(|(i, item)| {
                            let prefix = if ordered {
                                format!("{}. ", i + 1)
                            } else {
                                "\u{2022} ".to_string() // bullet character
                            };

                            DocumentChild::Paragraph(Box::new(
                                Paragraph::new()
                                    .add_run(Run::new().add_text(&format!("{}{}", prefix, item))),
                            ))
                        })
                        .collect();

                    match position {
                        InsertPosition::Start => {
                            list_paragraphs.extend(docx.document.children.drain(..));
                            docx.document.children = list_paragraphs;
                        }
                        InsertPosition::End => {
                            docx.document.children.extend(list_paragraphs);
                        }
                        InsertPosition::AtIndex(idx) => {
                            let idx = idx.min(docx.document.children.len());
                            for (offset, para) in list_paragraphs.into_iter().enumerate() {
                                docx.document.children.insert(idx + offset, para);
                            }
                        }
                        InsertPosition::AfterParagraph(idx) => {
                            let insert_idx = (idx + 1).min(docx.document.children.len());
                            for (offset, para) in list_paragraphs.into_iter().enumerate() {
                                docx.document.children.insert(insert_idx + offset, para);
                            }
                        }
                    }
                }

                DocumentEdit::DeleteParagraph { index } => {
                    if index < docx.document.children.len() {
                        docx.document.children.remove(index);
                    }
                }

                DocumentEdit::ReplaceParagraph { index, text } => {
                    if index < docx.document.children.len() {
                        let para = Paragraph::new().add_run(Run::new().add_text(&text));
                        docx.document.children[index] =
                            DocumentChild::Paragraph(Box::new(para));
                    }
                }

                // Skip non-Word edits
                _ => {}
            }
        }

        // Write back
        let file = File::create(path)
            .map_err(|e| DocumentError::WriteError(format!("Failed to create file: {}", e)))?;

        docx.build()
            .pack(file)
            .map_err(|e| DocumentError::WriteError(format!("Failed to write docx: {}", e)))?;

        Ok(())
    }

    fn render_html(&self, path: &PathBuf) -> Result<String, DocumentError> {
        // Re-read the document to get full formatting info
        let buf = self.read_docx_bytes(path)?;
        let docx =
            read_docx(&buf).map_err(|e| DocumentError::ParseError(format!("Failed to parse docx: {}", e)))?;

        let mut html = String::from("<div class=\"word-document\">");

        for child in &docx.document.children {
            match child {
                DocumentChild::Paragraph(para) => {
                    let style = Self::get_paragraph_style(para);
                    let para_fmt = Self::extract_paragraph_formatting(para);
                    let runs = Self::extract_formatted_runs(para);

                    // Skip empty paragraphs
                    if runs.is_empty() || runs.iter().all(|r| r.text.trim().is_empty()) {
                        continue;
                    }

                    // Determine HTML tag based on style
                    let tag = match style.as_deref() {
                        Some("Heading1") | Some("Title") => "h1",
                        Some("Heading2") => "h2",
                        Some("Heading3") => "h3",
                        Some("Heading4") => "h4",
                        Some("Heading5") => "h5",
                        Some("Heading6") => "h6",
                        _ => "p",
                    };

                    // Build paragraph with inline styles
                    let para_style = Self::para_formatting_to_style(&para_fmt);
                    if para_style.is_empty() {
                        html.push_str(&format!("<{}>", tag));
                    } else {
                        html.push_str(&format!("<{} style=\"{}\">", tag, para_style));
                    }

                    // Render each run with its formatting
                    for run in runs {
                        let run_style = Self::formatting_to_style(&run.formatting);
                        let escaped_text = html_escape(&run.text);

                        if run_style.is_empty() {
                            html.push_str(&escaped_text);
                        } else {
                            html.push_str(&format!("<span style=\"{}\">{}</span>", run_style, escaped_text));
                        }
                    }

                    html.push_str(&format!("</{}>", tag));
                }

                DocumentChild::Table(table) => {
                    html.push_str("<table class=\"word-table\">");

                    for (row_idx, row) in table.rows.iter().enumerate() {
                        let TableChild::TableRow(tr) = row;
                        html.push_str("<tr>");

                        for cell in &tr.cells {
                            let TableRowChild::TableCell(tc) = cell;

                            // Use th for first row (header)
                            let cell_tag = if row_idx == 0 { "th" } else { "td" };

                            html.push_str(&format!("<{}>", cell_tag));

                            // Extract formatted content from cell paragraphs
                            for cell_child in &tc.children {
                                if let TableCellContent::Paragraph(para) = cell_child {
                                    let runs = Self::extract_formatted_runs(para);
                                    for run in runs {
                                        let run_style = Self::formatting_to_style(&run.formatting);
                                        let escaped_text = html_escape(&run.text);

                                        if run_style.is_empty() {
                                            html.push_str(&escaped_text);
                                        } else {
                                            html.push_str(&format!(
                                                "<span style=\"{}\">{}</span>",
                                                run_style, escaped_text
                                            ));
                                        }
                                    }
                                }
                            }

                            html.push_str(&format!("</{}>", cell_tag));
                        }

                        html.push_str("</tr>");
                    }

                    html.push_str("</table>");
                }

                _ => {}
            }
        }

        html.push_str("</div>");
        Ok(html)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_docx(dir: &TempDir, filename: &str) -> PathBuf {
        let path = dir.path().join(filename);

        let docx = Docx::new()
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("First paragraph")))
            .add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text("Test Heading"))
                    .style("Heading1"),
            )
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("Second paragraph")));

        let file = std::fs::File::create(&path).expect("Failed to create test docx file");
        docx.build().pack(file).expect("Failed to write test docx");

        path
    }

    #[test]
    fn test_read_docx() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();
        let content = backend.read(&path).expect("Failed to read docx");

        assert_eq!(content.doc_type, DocumentType::Word);
        assert!(content.text_content.contains("First paragraph"));
        assert!(content.text_content.contains("Test Heading"));
        assert!(content.text_content.contains("Second paragraph"));

        // Check structured content
        let paragraphs = content
            .structured_content
            .get("paragraphs")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(paragraphs.len(), 3);
    }

    #[test]
    fn test_read_nonexistent_file() {
        let backend = WordBackend::new();
        let path = PathBuf::from("/nonexistent/path/file.docx");

        let result = backend.read(&path);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), DocumentError::FileNotFound(_)));
    }

    #[test]
    fn test_insert_paragraph_at_end() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();

        // Insert paragraph at end
        backend
            .apply_edit(
                &path,
                DocumentEdit::InsertParagraph {
                    text: "New paragraph at end".to_string(),
                    position: InsertPosition::End,
                    style: None,
                },
            )
            .expect("Failed to insert paragraph");

        // Verify
        let content = backend.read(&path).expect("Failed to read");
        assert!(content.text_content.contains("New paragraph at end"));
    }

    #[test]
    fn test_insert_paragraph_at_start() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();

        // Insert paragraph at start
        backend
            .apply_edit(
                &path,
                DocumentEdit::InsertParagraph {
                    text: "New first paragraph".to_string(),
                    position: InsertPosition::Start,
                    style: None,
                },
            )
            .expect("Failed to insert paragraph");

        // Verify it's at the start
        let content = backend.read(&path).expect("Failed to read");
        let paragraphs = content
            .structured_content
            .get("paragraphs")
            .unwrap()
            .as_array()
            .unwrap();

        assert_eq!(
            paragraphs[0].get("text").unwrap().as_str().unwrap(),
            "New first paragraph"
        );
    }

    #[test]
    fn test_insert_heading() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();

        backend
            .apply_edit(
                &path,
                DocumentEdit::InsertHeading {
                    text: "New Heading".to_string(),
                    level: 2,
                    position: InsertPosition::End,
                },
            )
            .expect("Failed to insert heading");

        let content = backend.read(&path).expect("Failed to read");
        assert!(content.text_content.contains("New Heading"));

        let paragraphs = content
            .structured_content
            .get("paragraphs")
            .unwrap()
            .as_array()
            .unwrap();

        let last = paragraphs.last().unwrap();
        assert_eq!(last.get("style").unwrap().as_str().unwrap(), "Heading2");
    }

    #[test]
    fn test_insert_table() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();

        backend
            .apply_edit(
                &path,
                DocumentEdit::InsertTable {
                    rows: vec![
                        vec!["Header 1".to_string(), "Header 2".to_string()],
                        vec!["Cell 1".to_string(), "Cell 2".to_string()],
                    ],
                    position: InsertPosition::End,
                },
            )
            .expect("Failed to insert table");

        let content = backend.read(&path).expect("Failed to read");
        assert!(content.text_content.contains("Header 1"));
        assert!(content.text_content.contains("Cell 2"));
    }

    #[test]
    fn test_insert_list() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();

        // Insert bulleted list
        backend
            .apply_edit(
                &path,
                DocumentEdit::InsertList {
                    items: vec!["Item 1".to_string(), "Item 2".to_string(), "Item 3".to_string()],
                    ordered: false,
                    position: InsertPosition::End,
                },
            )
            .expect("Failed to insert list");

        let content = backend.read(&path).expect("Failed to read");
        assert!(content.text_content.contains("Item 1"));
        assert!(content.text_content.contains("Item 2"));
        assert!(content.text_content.contains("Item 3"));
    }

    #[test]
    fn test_insert_ordered_list() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();

        backend
            .apply_edit(
                &path,
                DocumentEdit::InsertList {
                    items: vec!["First".to_string(), "Second".to_string()],
                    ordered: true,
                    position: InsertPosition::End,
                },
            )
            .expect("Failed to insert list");

        let content = backend.read(&path).expect("Failed to read");
        assert!(content.text_content.contains("1. First"));
        assert!(content.text_content.contains("2. Second"));
    }

    #[test]
    fn test_delete_paragraph() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();

        // Get initial count
        let content = backend.read(&path).expect("Failed to read");
        let initial_count = content
            .structured_content
            .get("paragraphs")
            .unwrap()
            .as_array()
            .unwrap()
            .len();

        // Delete first paragraph
        backend
            .apply_edit(&path, DocumentEdit::DeleteParagraph { index: 0 })
            .expect("Failed to delete paragraph");

        // Verify
        let content = backend.read(&path).expect("Failed to read");
        let new_count = content
            .structured_content
            .get("paragraphs")
            .unwrap()
            .as_array()
            .unwrap()
            .len();

        assert_eq!(new_count, initial_count - 1);
        // First paragraph should no longer be there
        assert!(!content.text_content.starts_with("First paragraph"));
    }

    #[test]
    fn test_replace_paragraph() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();

        backend
            .apply_edit(
                &path,
                DocumentEdit::ReplaceParagraph {
                    index: 0,
                    text: "Replaced content".to_string(),
                },
            )
            .expect("Failed to replace paragraph");

        let content = backend.read(&path).expect("Failed to read");
        let paragraphs = content
            .structured_content
            .get("paragraphs")
            .unwrap()
            .as_array()
            .unwrap();

        assert_eq!(
            paragraphs[0].get("text").unwrap().as_str().unwrap(),
            "Replaced content"
        );
    }

    #[test]
    fn test_apply_multiple_edits() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();

        backend
            .apply_edits(
                &path,
                vec![
                    DocumentEdit::InsertHeading {
                        text: "Document Title".to_string(),
                        level: 1,
                        position: InsertPosition::Start,
                    },
                    DocumentEdit::InsertParagraph {
                        text: "Final paragraph".to_string(),
                        position: InsertPosition::End,
                        style: None,
                    },
                ],
            )
            .expect("Failed to apply edits");

        let content = backend.read(&path).expect("Failed to read");
        let paragraphs = content
            .structured_content
            .get("paragraphs")
            .unwrap()
            .as_array()
            .unwrap();

        // Title should be first
        assert_eq!(
            paragraphs[0].get("text").unwrap().as_str().unwrap(),
            "Document Title"
        );
        // Final paragraph should be last
        assert_eq!(
            paragraphs.last().unwrap().get("text").unwrap().as_str().unwrap(),
            "Final paragraph"
        );
    }

    #[test]
    fn test_create_new_document() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("new_document.docx");

        let backend = WordBackend::new();

        // Create a new document by applying edits to a non-existent file
        backend
            .apply_edits(
                &path,
                vec![
                    DocumentEdit::InsertHeading {
                        text: "New Document".to_string(),
                        level: 1,
                        position: InsertPosition::Start,
                    },
                    DocumentEdit::InsertParagraph {
                        text: "This is a new document.".to_string(),
                        position: InsertPosition::End,
                        style: None,
                    },
                ],
            )
            .expect("Failed to create document");

        assert!(path.exists());

        let content = backend.read(&path).expect("Failed to read");
        assert!(content.text_content.contains("New Document"));
        assert!(content.text_content.contains("This is a new document."));
    }

    #[test]
    fn test_render_html() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();
        let html = backend.render_html(&path).expect("Failed to render HTML");

        assert!(html.starts_with("<div class=\"word-document\">"));
        assert!(html.ends_with("</div>"));
        assert!(html.contains("<p>First paragraph</p>"));
        assert!(html.contains("<h1>Test Heading</h1>"));
        assert!(html.contains("<p>Second paragraph</p>"));
    }

    #[test]
    fn test_render_html_with_table() {
        let temp_dir = TempDir::new().unwrap();
        let path = create_test_docx(&temp_dir, "test.docx");

        let backend = WordBackend::new();

        // Add a table
        backend
            .apply_edit(
                &path,
                DocumentEdit::InsertTable {
                    rows: vec![
                        vec!["A".to_string(), "B".to_string()],
                        vec!["C".to_string(), "D".to_string()],
                    ],
                    position: InsertPosition::End,
                },
            )
            .expect("Failed to insert table");

        let html = backend.render_html(&path).expect("Failed to render HTML");

        assert!(html.contains("<table class=\"word-table\">"));
        assert!(html.contains("<td>A</td>"));
        assert!(html.contains("<td>D</td>"));
    }
}
