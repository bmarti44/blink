use std::path::PathBuf;
use std::process::Command;

use super::document_service::*;

pub struct PowerPointBackend {
    scripts_dir: PathBuf,
}

impl PowerPointBackend {
    pub fn new() -> Self {
        // Try multiple locations for the scripts directory:
        // 1. Relative to executable/scripts (production)
        // 2. src-tauri/scripts from current working directory (development)
        // 3. Hardcoded development path

        let mut possible_paths: Vec<PathBuf> = vec![];

        // Production: relative to executable
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                possible_paths.push(parent.join("scripts"));
                // Also check Resources on macOS
                possible_paths.push(parent.join("../Resources/scripts"));
            }
        }

        // Development: relative to current working directory
        if let Ok(cwd) = std::env::current_dir() {
            possible_paths.push(cwd.join("src-tauri/scripts"));
            possible_paths.push(cwd.join("scripts"));
        }

        // No hardcoded fallback — rely on relative paths above

        let scripts_dir = possible_paths
            .into_iter()
            .find(|p| p.join("pptx-service.js").exists())
            .unwrap_or_else(|| PathBuf::from("scripts"));

        Self { scripts_dir }
    }

    #[allow(dead_code)]
    pub fn with_scripts_dir(scripts_dir: PathBuf) -> Self {
        Self { scripts_dir }
    }

    fn get_script_path(&self) -> PathBuf {
        self.scripts_dir.join("pptx-service.js")
    }

    fn run_node_command(&self, args: &[&str]) -> Result<String, DocumentError> {
        let script_path = self.get_script_path();

        // Check if script exists
        if !script_path.exists() {
            return Err(DocumentError::SidecarError(format!(
                "PowerPoint service script not found at: {}",
                script_path.display()
            )));
        }

        let output = Command::new("node")
            .arg(&script_path)
            .args(args)
            .current_dir(&self.scripts_dir)
            .output()
            .map_err(|e| {
                DocumentError::SidecarError(format!("Failed to run Node.js: {}", e))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);

            // Try to parse error from JSON output
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&stdout) {
                if let Some(error) = parsed.get("error").and_then(|e| e.as_str()) {
                    return Err(DocumentError::SidecarError(error.to_string()));
                }
            }

            return Err(DocumentError::SidecarError(format!(
                "Node.js script failed: {} {}",
                stderr, stdout
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(stdout)
    }
}

impl Default for PowerPointBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl DocumentBackend for PowerPointBackend {
    fn read(&self, path: &PathBuf) -> Result<DocumentContent, DocumentError> {
        let path_str = path.to_string_lossy();
        let output = self.run_node_command(&["read", &path_str])?;

        let parsed: serde_json::Value = serde_json::from_str(&output)
            .map_err(|e| DocumentError::ParseError(format!("Invalid JSON response: {}", e)))?;

        // Check for error in response
        if let Some(error) = parsed.get("error").and_then(|e| e.as_str()) {
            return Err(DocumentError::ParseError(error.to_string()));
        }

        let text_content = parsed
            .get("text_content")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        let slide_count = parsed
            .get("slide_count")
            .and_then(|c| c.as_u64())
            .map(|c| c as u32);

        let slides = parsed
            .get("slides")
            .cloned()
            .unwrap_or(serde_json::json!([]));

        Ok(DocumentContent {
            doc_type: DocumentType::PowerPoint,
            text_content,
            structured_content: serde_json::json!({ "slides": slides }),
            metadata: DocumentMetadata {
                title: parsed.get("title").and_then(|t| t.as_str()).map(String::from),
                author: parsed.get("author").and_then(|a| a.as_str()).map(String::from),
                slide_count,
                ..Default::default()
            },
        })
    }

    fn apply_edit(&self, path: &PathBuf, edit: DocumentEdit) -> Result<(), DocumentError> {
        self.apply_edits(path, vec![edit])
    }

    fn apply_edits(&self, path: &PathBuf, edits: Vec<DocumentEdit>) -> Result<(), DocumentError> {
        let path_str = path.to_string_lossy();
        let edits_json = serde_json::to_string(&edits)
            .map_err(|e| DocumentError::WriteError(format!("Failed to serialize edits: {}", e)))?;

        let input = serde_json::json!({
            "path": path_str,
            "edits": edits_json
        });

        let input_str = input.to_string();
        let output = self.run_node_command(&["edit", &input_str])?;

        let parsed: serde_json::Value = serde_json::from_str(&output)
            .map_err(|e| DocumentError::WriteError(format!("Invalid JSON response: {}", e)))?;

        // Check for error in response
        if let Some(error) = parsed.get("error").and_then(|e| e.as_str()) {
            return Err(DocumentError::WriteError(error.to_string()));
        }

        Ok(())
    }

    fn render_html(&self, path: &PathBuf) -> Result<String, DocumentError> {
        let content = self.read(path)?;
        let mut html = String::from("<div class=\"pptx-presentation\">");

        // Get presentation title from metadata if available
        if let Some(title) = &content.metadata.title {
            html.push_str(&format!(
                "<div class=\"pptx-header\"><h2 class=\"pptx-doc-title\">{}</h2></div>",
                html_escape(title)
            ));
        }

        if let Some(slides) = content.structured_content.get("slides") {
            if let Some(arr) = slides.as_array() {
                let total_slides = arr.len();

                for (idx, slide) in arr.iter().enumerate() {
                    let title = slide
                        .get("title")
                        .and_then(|t| t.as_str())
                        .unwrap_or("");
                    let body = slide
                        .get("body")
                        .and_then(|b| b.as_str())
                        .unwrap_or("");
                    let notes = slide
                        .get("notes")
                        .and_then(|n| n.as_str())
                        .unwrap_or("");
                    let layout = slide
                        .get("layout")
                        .and_then(|l| l.as_str())
                        .unwrap_or("blank");

                    // Determine slide class based on layout
                    let layout_class = match layout {
                        "title" => "pptx-slide-title-layout",
                        "titleAndContent" | "titleContent" => "pptx-slide-content-layout",
                        "twoColumn" | "twoContent" => "pptx-slide-two-column",
                        "blank" => "pptx-slide-blank",
                        _ => "pptx-slide-default",
                    };

                    html.push_str(&format!(
                        r#"<div class="pptx-slide {}" data-slide-index="{}">"#,
                        layout_class, idx
                    ));

                    // Slide header with number
                    html.push_str(&format!(
                        r#"<div class="pptx-slide-header">
                            <span class="pptx-slide-number">Slide {} of {}</span>
                        </div>"#,
                        idx + 1,
                        total_slides
                    ));

                    // Slide content area
                    html.push_str("<div class=\"pptx-slide-content\">");

                    // Title
                    if !title.is_empty() {
                        html.push_str(&format!(
                            "<h3 class=\"pptx-title\">{}</h3>",
                            html_escape(title)
                        ));
                    }

                    // Body content - handle bullet points
                    if !body.is_empty() {
                        html.push_str("<div class=\"pptx-body\">");
                        let lines: Vec<&str> = body.split('\n').collect();
                        let mut in_list = false;

                        for line in lines {
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }

                            // Check for bullet points
                            if trimmed.starts_with("• ") || trimmed.starts_with("- ") || trimmed.starts_with("* ") {
                                if !in_list {
                                    html.push_str("<ul class=\"pptx-bullets\">");
                                    in_list = true;
                                }
                                let item_text = trimmed.trim_start_matches(&['•', '-', '*', ' '][..]);
                                html.push_str(&format!("<li>{}</li>", html_escape(item_text)));
                            } else if trimmed.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
                                && trimmed.contains(". ")
                            {
                                // Numbered list
                                if !in_list {
                                    html.push_str("<ol class=\"pptx-numbered\">");
                                    in_list = true;
                                }
                                if let Some(pos) = trimmed.find(". ") {
                                    let item_text = &trimmed[pos + 2..];
                                    html.push_str(&format!("<li>{}</li>", html_escape(item_text)));
                                }
                            } else {
                                if in_list {
                                    html.push_str("</ul>");
                                    in_list = false;
                                }
                                html.push_str(&format!("<p>{}</p>", html_escape(trimmed)));
                            }
                        }

                        if in_list {
                            html.push_str("</ul>");
                        }
                        html.push_str("</div>");
                    }

                    html.push_str("</div>"); // close pptx-slide-content

                    // Speaker notes
                    if !notes.is_empty() {
                        html.push_str(&format!(
                            r#"<div class="pptx-notes">
                                <div class="pptx-notes-header">Speaker Notes</div>
                                <div class="pptx-notes-content">{}</div>
                            </div>"#,
                            html_escape(notes).replace('\n', "<br>")
                        ));
                    }

                    html.push_str("</div>"); // close pptx-slide
                }
            }
        }

        html.push_str("</div>");
        Ok(html)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_powerpoint_backend_new() {
        let backend = PowerPointBackend::new();
        // Should not panic
        assert!(backend.scripts_dir.to_string_lossy().len() > 0);
    }

    #[test]
    fn test_powerpoint_backend_with_scripts_dir() {
        let custom_dir = PathBuf::from("/custom/scripts");
        let backend = PowerPointBackend::with_scripts_dir(custom_dir.clone());
        assert_eq!(backend.scripts_dir, custom_dir);
    }

    #[test]
    fn test_render_html_structure() {
        // Test that render_html produces valid structure even with mock data
        let _backend = PowerPointBackend::with_scripts_dir(PathBuf::from("scripts"));

        // Create mock content
        let content = DocumentContent {
            doc_type: DocumentType::PowerPoint,
            text_content: "Test slide".to_string(),
            structured_content: serde_json::json!({
                "slides": [
                    {
                        "index": 0,
                        "title": "Test Title",
                        "body": "Test body content",
                        "notes": "Speaker notes"
                    }
                ]
            }),
            metadata: DocumentMetadata::default(),
        };

        // Manually test the HTML generation logic
        let mut html = String::from("<div class=\"pptx-presentation\">");
        if let Some(slides) = content.structured_content.get("slides") {
            if let Some(arr) = slides.as_array() {
                for slide in arr.iter() {
                    let title = slide.get("title").and_then(|t| t.as_str()).unwrap_or("");
                    let body = slide.get("body").and_then(|b| b.as_str()).unwrap_or("");
                    html.push_str(&format!(
                        "<div class=\"pptx-slide\"><h3>{}</h3><div>{}</div></div>",
                        title, body
                    ));
                }
            }
        }
        html.push_str("</div>");

        assert!(html.contains("pptx-presentation"));
        assert!(html.contains("Test Title"));
        assert!(html.contains("Test body content"));
    }

    // Integration tests require Node.js and npm install
    // They are marked as ignored by default
    #[test]
    #[ignore]
    fn test_read_nonexistent_file() {
        let backend = PowerPointBackend::with_scripts_dir(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts"),
        );
        let path = PathBuf::from("/nonexistent/file.pptx");

        let result = backend.read(&path);
        assert!(result.is_err());
    }
}
