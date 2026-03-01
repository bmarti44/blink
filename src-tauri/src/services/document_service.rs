use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT TYPES
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DocumentType {
    Word,
    Excel,
    PowerPoint,
}

impl DocumentType {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "doc" | "docx" => Some(Self::Word),
            "xls" | "xlsx" | "xlsm" => Some(Self::Excel),
            "ppt" | "pptx" => Some(Self::PowerPoint),
            _ => None,
        }
    }

    pub fn from_path(path: &PathBuf) -> Option<Self> {
        path.extension()
            .and_then(|e| e.to_str())
            .and_then(Self::from_extension)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentContent {
    pub doc_type: DocumentType,
    pub text_content: String,
    pub structured_content: serde_json::Value,
    pub metadata: DocumentMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DocumentMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub page_count: Option<u32>,
    pub sheet_count: Option<u32>,
    pub slide_count: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════
// EDIT COMMANDS (AI generates these)
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum DocumentEdit {
    // Word edits
    InsertParagraph {
        text: String,
        position: InsertPosition,
        style: Option<String>,
    },
    ReplaceParagraph {
        index: usize,
        text: String,
    },
    DeleteParagraph {
        index: usize,
    },
    InsertHeading {
        text: String,
        level: u8,
        position: InsertPosition,
    },
    InsertTable {
        rows: Vec<Vec<String>>,
        position: InsertPosition,
    },
    InsertList {
        items: Vec<String>,
        ordered: bool,
        position: InsertPosition,
    },
    ApplyStyle {
        paragraph_index: usize,
        style: TextStyle,
    },

    // Excel edits
    SetCell {
        sheet: String,
        cell: String,
        value: String,
    },
    SetFormula {
        sheet: String,
        cell: String,
        formula: String,
    },
    SetCellRange {
        sheet: String,
        start: String,
        values: Vec<Vec<String>>,
    },
    InsertRow {
        sheet: String,
        index: u32,
    },
    InsertColumn {
        sheet: String,
        index: u32,
    },
    DeleteRow {
        sheet: String,
        index: u32,
    },
    DeleteColumn {
        sheet: String,
        index: u32,
    },
    CreateSheet {
        name: String,
    },
    DeleteSheet {
        name: String,
    },
    FormatCell {
        sheet: String,
        cell: String,
        format: CellFormat,
    },

    // PowerPoint edits
    AddSlide {
        layout: SlideLayout,
    },
    DeleteSlide {
        index: usize,
    },
    SetSlideTitle {
        index: usize,
        title: String,
    },
    SetSlideBody {
        index: usize,
        body: String,
    },
    AddTextBox {
        slide: usize,
        text: String,
        position: ShapePosition,
    },
    AddShape {
        slide: usize,
        shape_type: String,
        position: ShapePosition,
    },
    SetSpeakerNotes {
        index: usize,
        notes: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum InsertPosition {
    Start,
    #[default]
    End,
    AtIndex(usize),
    AfterParagraph(usize),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TextStyle {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub font_size: Option<u32>,
    pub font_color: Option<String>,
    pub font_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CellFormat {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub font_size: Option<f64>,
    pub font_color: Option<String>,
    pub bg_color: Option<String>,
    pub number_format: Option<String>,
    pub alignment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum SlideLayout {
    TitleSlide,
    #[default]
    TitleAndContent,
    SectionHeader,
    TwoContent,
    Comparison,
    TitleOnly,
    Blank,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapePosition {
    pub left_inches: f64,
    pub top_inches: f64,
    pub width_inches: f64,
    pub height_inches: f64,
}

impl Default for ShapePosition {
    fn default() -> Self {
        Self {
            left_inches: 1.0,
            top_inches: 1.0,
            width_inches: 4.0,
            height_inches: 1.0,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Debug, thiserror::Error)]
pub enum DocumentError {
    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Write error: {0}")]
    WriteError(String),

    #[error("Sidecar error: {0}")]
    #[allow(dead_code)]
    SidecarError(String),

    #[error("Invalid operation: {0}")]
    #[allow(dead_code)]
    InvalidOperation(String),
}

impl Serialize for DocumentError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE TRAIT
// ═══════════════════════════════════════════════════════════════════════════

#[allow(dead_code)]
pub trait DocumentBackend: Send + Sync {
    fn read(&self, path: &PathBuf) -> Result<DocumentContent, DocumentError>;
    fn apply_edit(&self, path: &PathBuf, edit: DocumentEdit) -> Result<(), DocumentError>;
    fn apply_edits(&self, path: &PathBuf, edits: Vec<DocumentEdit>) -> Result<(), DocumentError>;
    fn render_html(&self, path: &PathBuf) -> Result<String, DocumentError>;
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED SERVICE
// ═══════════════════════════════════════════════════════════════════════════

pub struct DocumentService {
    word_backend: Box<dyn DocumentBackend>,
    excel_backend: Box<dyn DocumentBackend>,
    powerpoint_backend: Box<dyn DocumentBackend>,
}

impl DocumentService {
    pub fn new() -> Self {
        Self {
            word_backend: Box::new(super::word::WordBackend::new()),
            excel_backend: Box::new(super::excel::ExcelBackend::new()),
            powerpoint_backend: Box::new(super::powerpoint::PowerPointBackend::new()),
        }
    }

    pub fn read(&self, path: &PathBuf) -> Result<DocumentContent, DocumentError> {
        let doc_type = DocumentType::from_path(path)
            .ok_or_else(|| DocumentError::UnsupportedFormat("Unknown extension".into()))?;

        match doc_type {
            DocumentType::Word => self.word_backend.read(path),
            DocumentType::Excel => self.excel_backend.read(path),
            DocumentType::PowerPoint => self.powerpoint_backend.read(path),
        }
    }

    pub fn apply_edits(
        &self,
        path: &PathBuf,
        edits: Vec<DocumentEdit>,
    ) -> Result<(), DocumentError> {
        let doc_type = DocumentType::from_path(path)
            .ok_or_else(|| DocumentError::UnsupportedFormat("Unknown extension".into()))?;

        match doc_type {
            DocumentType::Word => self.word_backend.apply_edits(path, edits),
            DocumentType::Excel => self.excel_backend.apply_edits(path, edits),
            DocumentType::PowerPoint => self.powerpoint_backend.apply_edits(path, edits),
        }
    }

    pub fn render_html(&self, path: &PathBuf) -> Result<String, DocumentError> {
        let doc_type = DocumentType::from_path(path)
            .ok_or_else(|| DocumentError::UnsupportedFormat("Unknown extension".into()))?;

        match doc_type {
            DocumentType::Word => self.word_backend.render_html(path),
            DocumentType::Excel => self.excel_backend.render_html(path),
            DocumentType::PowerPoint => self.powerpoint_backend.render_html(path),
        }
    }

    pub fn get_document_context_for_ai(&self, path: &PathBuf) -> Result<String, DocumentError> {
        let content = self.read(path)?;

        Ok(format!(
            "Document: {}\nType: {:?}\n\nContent:\n{}",
            path.display(),
            content.doc_type,
            content.text_content
        ))
    }

    /// Create a new empty document at the given path
    pub fn create(&self, path: &PathBuf) -> Result<(), DocumentError> {
        let doc_type = DocumentType::from_path(path)
            .ok_or_else(|| DocumentError::UnsupportedFormat("Unknown extension".into()))?;

        match doc_type {
            DocumentType::Word => self.create_word(path),
            DocumentType::Excel => self.create_excel(path),
            DocumentType::PowerPoint => self.create_powerpoint(path),
        }
    }

    fn create_word(&self, path: &PathBuf) -> Result<(), DocumentError> {
        use docx_rs::*;

        let docx = Docx::new()
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("New Document")));

        let file =
            std::fs::File::create(path).map_err(|e| DocumentError::WriteError(e.to_string()))?;
        docx.build()
            .pack(file)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;

        Ok(())
    }

    fn create_excel(&self, path: &PathBuf) -> Result<(), DocumentError> {
        use rust_xlsxwriter::Workbook;

        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();

        // Write an empty cell to ensure the sheet exists
        sheet
            .write_string(0, 0, "")
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;

        workbook
            .save(path)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;

        Ok(())
    }

    fn create_powerpoint(&self, path: &PathBuf) -> Result<(), DocumentError> {
        // Create a minimal PowerPoint file structure
        // pptx files are ZIP archives with XML content
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        use zip::ZipWriter;

        let file =
            std::fs::File::create(path).map_err(|e| DocumentError::WriteError(e.to_string()))?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        // [Content_Types].xml
        zip.start_file("[Content_Types].xml", options)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
</Types>"#).map_err(|e| DocumentError::WriteError(e.to_string()))?;

        // _rels/.rels
        zip.start_file("_rels/.rels", options)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>"#).map_err(|e| DocumentError::WriteError(e.to_string()))?;

        // ppt/presentation.xml
        zip.start_file("ppt/presentation.xml", options)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>"#).map_err(|e| DocumentError::WriteError(e.to_string()))?;

        // ppt/_rels/presentation.xml.rels
        zip.start_file("ppt/_rels/presentation.xml.rels", options)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>"#).map_err(|e| DocumentError::WriteError(e.to_string()))?;

        // ppt/slides/slide1.xml
        zip.start_file("ppt/slides/slide1.xml", options)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sld>"#).map_err(|e| DocumentError::WriteError(e.to_string()))?;

        // ppt/slides/_rels/slide1.xml.rels
        zip.start_file("ppt/slides/_rels/slide1.xml.rels", options)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>"#).map_err(|e| DocumentError::WriteError(e.to_string()))?;

        // ppt/slideMasters/slideMaster1.xml
        zip.start_file("ppt/slideMasters/slideMaster1.xml", options)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>"#).map_err(|e| DocumentError::WriteError(e.to_string()))?;

        // ppt/slideMasters/_rels/slideMaster1.xml.rels
        zip.start_file("ppt/slideMasters/_rels/slideMaster1.xml.rels", options)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>"#).map_err(|e| DocumentError::WriteError(e.to_string()))?;

        // ppt/slideLayouts/slideLayout1.xml
        zip.start_file("ppt/slideLayouts/slideLayout1.xml", options)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" type="blank">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sldLayout>"#).map_err(|e| DocumentError::WriteError(e.to_string()))?;

        // ppt/slideLayouts/_rels/slideLayout1.xml.rels
        zip.start_file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", options)
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>"#).map_err(|e| DocumentError::WriteError(e.to_string()))?;

        zip.finish()
            .map_err(|e| DocumentError::WriteError(e.to_string()))?;

        Ok(())
    }
}

impl Default for DocumentService {
    fn default() -> Self {
        Self::new()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_document_type_from_extension() {
        assert_eq!(
            DocumentType::from_extension("docx"),
            Some(DocumentType::Word)
        );
        assert_eq!(
            DocumentType::from_extension("DOCX"),
            Some(DocumentType::Word)
        );
        assert_eq!(
            DocumentType::from_extension("doc"),
            Some(DocumentType::Word)
        );
        assert_eq!(
            DocumentType::from_extension("xlsx"),
            Some(DocumentType::Excel)
        );
        assert_eq!(
            DocumentType::from_extension("xls"),
            Some(DocumentType::Excel)
        );
        assert_eq!(
            DocumentType::from_extension("pptx"),
            Some(DocumentType::PowerPoint)
        );
        assert_eq!(DocumentType::from_extension("txt"), None);
        assert_eq!(DocumentType::from_extension("pdf"), None);
    }

    #[test]
    fn test_document_type_from_path() {
        let word_path = PathBuf::from("/some/path/document.docx");
        let excel_path = PathBuf::from("/some/path/spreadsheet.xlsx");
        let ppt_path = PathBuf::from("/some/path/presentation.pptx");
        let unknown_path = PathBuf::from("/some/path/file.txt");

        assert_eq!(
            DocumentType::from_path(&word_path),
            Some(DocumentType::Word)
        );
        assert_eq!(
            DocumentType::from_path(&excel_path),
            Some(DocumentType::Excel)
        );
        assert_eq!(
            DocumentType::from_path(&ppt_path),
            Some(DocumentType::PowerPoint)
        );
        assert_eq!(DocumentType::from_path(&unknown_path), None);
    }

    #[test]
    fn test_html_escape() {
        assert_eq!(html_escape("Hello & World"), "Hello &amp; World");
        assert_eq!(html_escape("<script>"), "&lt;script&gt;");
        assert_eq!(html_escape("\"quoted\""), "&quot;quoted&quot;");
        assert_eq!(html_escape("A < B & C > D"), "A &lt; B &amp; C &gt; D");
    }

    #[test]
    fn test_insert_position_default() {
        let pos: InsertPosition = Default::default();
        assert!(matches!(pos, InsertPosition::End));
    }

    #[test]
    fn test_document_error_serialization() {
        let error = DocumentError::FileNotFound("test.docx".to_string());
        let serialized = serde_json::to_string(&error).unwrap();
        assert!(serialized.contains("File not found: test.docx"));
    }

    #[test]
    fn test_document_edit_serialization() {
        let edit = DocumentEdit::InsertParagraph {
            text: "Hello World".to_string(),
            position: InsertPosition::End,
            style: Some("Normal".to_string()),
        };

        let json = serde_json::to_string(&edit).unwrap();
        assert!(json.contains("InsertParagraph"));
        assert!(json.contains("Hello World"));

        // Test deserialization
        let parsed: DocumentEdit = serde_json::from_str(&json).unwrap();
        if let DocumentEdit::InsertParagraph { text, .. } = parsed {
            assert_eq!(text, "Hello World");
        } else {
            panic!("Expected InsertParagraph");
        }
    }
}
