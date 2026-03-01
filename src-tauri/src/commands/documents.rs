use crate::services::{DocumentContent, DocumentEdit, DocumentService};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

pub struct DocumentState {
    pub service: Arc<Mutex<DocumentService>>,
}

impl DocumentState {
    pub fn new() -> Self {
        Self {
            service: Arc::new(Mutex::new(DocumentService::new())),
        }
    }
}

impl Default for DocumentState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn read_document(
    state: State<'_, DocumentState>,
    path: String,
) -> Result<DocumentContent, String> {
    let service = state.service.lock().await;
    let path = PathBuf::from(path);

    service.read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_document(
    state: State<'_, DocumentState>,
    path: String,
) -> Result<(), String> {
    let service = state.service.lock().await;
    let path = PathBuf::from(path);

    service.create(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn apply_document_edits(
    state: State<'_, DocumentState>,
    path: String,
    edits: Vec<DocumentEdit>,
) -> Result<(), String> {
    let service = state.service.lock().await;
    let path = PathBuf::from(path);

    service.apply_edits(&path, edits).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn render_document_html(
    state: State<'_, DocumentState>,
    path: String,
) -> Result<String, String> {
    let service = state.service.lock().await;
    let path = PathBuf::from(path);

    service.render_html(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_document_context_for_ai(
    state: State<'_, DocumentState>,
    path: String,
) -> Result<String, String> {
    let service = state.service.lock().await;
    let path = PathBuf::from(path);

    service
        .get_document_context_for_ai(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_supported_extensions() -> Vec<String> {
    vec![
        "doc".to_string(),
        "docx".to_string(),
        "xls".to_string(),
        "xlsx".to_string(),
        "xlsm".to_string(),
        "ppt".to_string(),
        "pptx".to_string(),
    ]
}

#[tauri::command]
pub fn is_document_supported(path: String) -> bool {
    use crate::services::DocumentType;
    let path = PathBuf::from(path);
    DocumentType::from_path(&path).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_supported_extensions() {
        let extensions = get_supported_extensions();
        assert!(extensions.contains(&"docx".to_string()));
        assert!(extensions.contains(&"xlsx".to_string()));
        assert!(extensions.contains(&"pptx".to_string()));
    }

    #[test]
    fn test_is_document_supported() {
        assert!(is_document_supported("/path/to/file.docx".to_string()));
        assert!(is_document_supported("/path/to/file.DOCX".to_string()));
        assert!(is_document_supported("/path/to/file.xlsx".to_string()));
        assert!(is_document_supported("/path/to/file.pptx".to_string()));
        assert!(!is_document_supported("/path/to/file.txt".to_string()));
        assert!(!is_document_supported("/path/to/file.pdf".to_string()));
    }
}
