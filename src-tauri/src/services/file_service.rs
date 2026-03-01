//! File Service
//!
//! Provides file system operations matching VS Code's file service.
//! All operations are async and return proper error types.

use std::any::Any;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tokio::fs;

use super::registry::Service;

/// File type enumeration (matching VS Code's FileType)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64,
}

/// File statistics (matching VS Code's IStat)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub file_type: FileType,
    /// Creation time in milliseconds since Unix epoch
    pub ctime: u64,
    /// Modification time in milliseconds since Unix epoch
    pub mtime: u64,
    /// File size in bytes
    pub size: u64,
    /// Permissions (Unix mode)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<u32>,
}

/// File change type for watch events
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileChangeType {
    Updated = 0,
    Added = 1,
    Deleted = 2,
}

/// File change event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub change_type: FileChangeType,
    pub path: PathBuf,
}

/// File service error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileError {
    pub code: FileErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileErrorCode {
    NotFound,
    PermissionDenied,
    AlreadyExists,
    InvalidPath,
    Unknown,
}

impl std::fmt::Display for FileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for FileError {}

/// File service implementation
pub struct FileService;

impl Service for FileService {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn service_id(&self) -> &'static str {
        "IFileService"
    }
}

impl FileService {
    pub fn new() -> Self {
        Self
    }

    /// Get file/directory statistics
    pub async fn stat(&self, path: &PathBuf) -> Result<FileStat, FileError> {
        let metadata = fs::metadata(path).await.map_err(|e| self.io_error(e))?;

        let file_type = if metadata.is_dir() {
            FileType::Directory
        } else if metadata.is_symlink() {
            FileType::SymbolicLink
        } else if metadata.is_file() {
            FileType::File
        } else {
            FileType::Unknown
        };

        #[cfg(unix)]
        let permissions = {
            use std::os::unix::fs::MetadataExt;
            Some(metadata.mode())
        };

        #[cfg(not(unix))]
        let permissions = None;

        Ok(FileStat {
            file_type,
            ctime: metadata
                .created()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            mtime: metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            size: metadata.len(),
            permissions,
        })
    }

    /// Check if a path exists
    pub async fn exists(&self, path: &PathBuf) -> bool {
        fs::metadata(path).await.is_ok()
    }

    /// Read file contents as bytes
    pub async fn read_file(&self, path: &PathBuf) -> Result<Vec<u8>, FileError> {
        fs::read(path).await.map_err(|e| self.io_error(e))
    }

    /// Read file contents as string
    pub async fn read_file_string(&self, path: &PathBuf) -> Result<String, FileError> {
        fs::read_to_string(path).await.map_err(|e| self.io_error(e))
    }

    /// Write bytes to file
    pub async fn write_file(&self, path: &PathBuf, content: &[u8]) -> Result<(), FileError> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| self.io_error(e))?;
        }

        fs::write(path, content).await.map_err(|e| self.io_error(e))
    }

    /// Write string to file
    pub async fn write_file_string(&self, path: &PathBuf, content: &str) -> Result<(), FileError> {
        self.write_file(path, content.as_bytes()).await
    }

    /// Delete file or directory
    pub async fn delete(&self, path: &PathBuf, recursive: bool) -> Result<(), FileError> {
        let metadata = fs::metadata(path).await.map_err(|e| self.io_error(e))?;

        if metadata.is_dir() {
            if recursive {
                fs::remove_dir_all(path)
                    .await
                    .map_err(|e| self.io_error(e))
            } else {
                fs::remove_dir(path).await.map_err(|e| self.io_error(e))
            }
        } else {
            fs::remove_file(path).await.map_err(|e| self.io_error(e))
        }
    }

    /// Rename/move file or directory
    pub async fn rename(&self, from: &PathBuf, to: &PathBuf) -> Result<(), FileError> {
        // Ensure parent directory exists
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| self.io_error(e))?;
        }

        fs::rename(from, to).await.map_err(|e| self.io_error(e))
    }

    /// Copy file
    pub async fn copy(&self, from: &PathBuf, to: &PathBuf) -> Result<(), FileError> {
        // Ensure parent directory exists
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| self.io_error(e))?;
        }

        fs::copy(from, to).await.map_err(|e| self.io_error(e))?;
        Ok(())
    }

    /// Create directory
    pub async fn mkdir(&self, path: &PathBuf) -> Result<(), FileError> {
        fs::create_dir_all(path)
            .await
            .map_err(|e| self.io_error(e))
    }

    /// Read directory contents
    pub async fn read_dir(&self, path: &PathBuf) -> Result<Vec<(String, FileType)>, FileError> {
        let mut entries = Vec::new();
        let mut dir = fs::read_dir(path).await.map_err(|e| self.io_error(e))?;

        while let Some(entry) = dir.next_entry().await.map_err(|e| self.io_error(e))? {
            let metadata = entry.metadata().await.map_err(|e| self.io_error(e))?;

            let file_type = if metadata.is_dir() {
                FileType::Directory
            } else if metadata.is_symlink() {
                FileType::SymbolicLink
            } else {
                FileType::File
            };

            let name = entry.file_name().to_string_lossy().to_string();
            entries.push((name, file_type));
        }

        Ok(entries)
    }

    /// Read directory recursively
    pub async fn read_dir_recursive(
        &self,
        path: &PathBuf,
    ) -> Result<Vec<(PathBuf, FileType)>, FileError> {
        let mut results = Vec::new();
        self.read_dir_recursive_inner(path, &mut results).await?;
        Ok(results)
    }

    async fn read_dir_recursive_inner(
        &self,
        path: &PathBuf,
        results: &mut Vec<(PathBuf, FileType)>,
    ) -> Result<(), FileError> {
        let entries = self.read_dir(path).await?;

        for (name, file_type) in entries {
            let full_path = path.join(&name);
            results.push((full_path.clone(), file_type));

            if file_type == FileType::Directory {
                Box::pin(self.read_dir_recursive_inner(&full_path, results)).await?;
            }
        }

        Ok(())
    }

    /// Convert IO error to FileError
    fn io_error(&self, error: std::io::Error) -> FileError {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => FileErrorCode::NotFound,
            std::io::ErrorKind::PermissionDenied => FileErrorCode::PermissionDenied,
            std::io::ErrorKind::AlreadyExists => FileErrorCode::AlreadyExists,
            std::io::ErrorKind::InvalidInput => FileErrorCode::InvalidPath,
            _ => FileErrorCode::Unknown,
        };

        FileError {
            code,
            message: error.to_string(),
        }
    }
}

impl Default for FileService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_file_operations() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let service = FileService::new();

        // Write file
        let file_path = temp_dir.path().join("test.txt");
        service
            .write_file_string(&file_path, "Hello, World!")
            .await
            .unwrap();

        // Check exists
        assert!(service.exists(&file_path).await);

        // Read file
        let content = service.read_file_string(&file_path).await.unwrap();
        assert_eq!(content, "Hello, World!");

        // Stat file
        let stat = service.stat(&file_path).await.unwrap();
        assert_eq!(stat.file_type, FileType::File);
        assert_eq!(stat.size, 13);

        // Delete file
        service.delete(&file_path, false).await.unwrap();
        assert!(!service.exists(&file_path).await);
    }

    #[tokio::test]
    async fn test_directory_operations() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let service = FileService::new();

        // Create directory
        let dir_path = temp_dir.path().join("subdir");
        service.mkdir(&dir_path).await.unwrap();

        // Stat directory
        let stat = service.stat(&dir_path).await.unwrap();
        assert_eq!(stat.file_type, FileType::Directory);

        // Create files in directory
        service
            .write_file_string(&dir_path.join("a.txt"), "a")
            .await
            .unwrap();
        service
            .write_file_string(&dir_path.join("b.txt"), "b")
            .await
            .unwrap();

        // Read directory
        let entries = service.read_dir(&dir_path).await.unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[tokio::test]
    async fn test_copy_and_rename() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let service = FileService::new();

        let src = temp_dir.path().join("src.txt");
        let dst = temp_dir.path().join("dst.txt");
        let renamed = temp_dir.path().join("renamed.txt");

        // Write source
        service
            .write_file_string(&src, "test content")
            .await
            .unwrap();

        // Copy
        service.copy(&src, &dst).await.unwrap();
        assert!(service.exists(&dst).await);

        // Rename
        service.rename(&dst, &renamed).await.unwrap();
        assert!(!service.exists(&dst).await);
        assert!(service.exists(&renamed).await);
    }
}
