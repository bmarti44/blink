//! Logger Service
//!
//! Provides structured logging with file output and log levels.
//! Based on VS Code's logging infrastructure.

use std::any::Any;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use chrono::Local;
use parking_lot::Mutex;

use super::registry::Service;

/// Log levels (matching VS Code)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Trace = 0,
    Debug = 1,
    Info = 2,
    Warning = 3,
    Error = 4,
    Off = 5,
}

impl LogLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Trace => "TRACE",
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warning => "WARN",
            LogLevel::Error => "ERROR",
            LogLevel::Off => "OFF",
        }
    }
}

impl Default for LogLevel {
    fn default() -> Self {
        LogLevel::Info
    }
}

/// Logger service for a specific channel
pub struct LoggerService {
    /// Channel name (e.g., "extensionHost", "server", "terminal")
    channel: String,
    /// Minimum log level to output
    level: LogLevel,
    /// Log file handle
    file: Option<Arc<Mutex<File>>>,
    /// Whether to output to stderr as well
    console_output: bool,
}

impl Service for LoggerService {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn service_id(&self) -> &'static str {
        "ILoggerService"
    }
}

impl LoggerService {
    /// Create a new logger for a channel
    pub fn new(
        channel: &str,
        logs_dir: &PathBuf,
        level: LogLevel,
        console_output: bool,
    ) -> Result<Self, String> {
        // Create logs directory if needed
        std::fs::create_dir_all(logs_dir)
            .map_err(|e| format!("Failed to create logs dir: {}", e))?;

        // Create log file with date suffix
        let date = Local::now().format("%Y-%m-%d");
        let log_path = logs_dir.join(format!("{}_{}.log", channel, date));

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("Failed to open log file: {}", e))?;

        Ok(Self {
            channel: channel.to_string(),
            level,
            file: Some(Arc::new(Mutex::new(file))),
            console_output,
        })
    }

    /// Create a console-only logger (no file output)
    pub fn console_only(channel: &str, level: LogLevel) -> Self {
        Self {
            channel: channel.to_string(),
            level,
            file: None,
            console_output: true,
        }
    }

    /// Log a message at trace level
    pub fn trace(&self, message: &str) {
        self.log(LogLevel::Trace, message);
    }

    /// Log a message at debug level
    pub fn debug(&self, message: &str) {
        self.log(LogLevel::Debug, message);
    }

    /// Log a message at info level
    pub fn info(&self, message: &str) {
        self.log(LogLevel::Info, message);
    }

    /// Log a message at warning level
    pub fn warn(&self, message: &str) {
        self.log(LogLevel::Warning, message);
    }

    /// Log a message at error level
    pub fn error(&self, message: &str) {
        self.log(LogLevel::Error, message);
    }

    /// Log a message at the specified level
    pub fn log(&self, level: LogLevel, message: &str) {
        // Skip if below configured level
        if level < self.level {
            return;
        }

        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let log_line = format!(
            "[{}] [{}] [{}] {}\n",
            timestamp,
            level.as_str(),
            self.channel,
            message
        );

        // Write to console
        if self.console_output {
            eprint!("{}", log_line);
        }

        // Write to file
        if let Some(file) = &self.file {
            let _ = file.lock().write_all(log_line.as_bytes());
        }
    }

    /// Log with formatting
    pub fn log_fmt(&self, level: LogLevel, args: std::fmt::Arguments) {
        self.log(level, &args.to_string());
    }

    /// Set the minimum log level
    pub fn set_level(&mut self, level: LogLevel) {
        self.level = level;
    }

    /// Get the current log level
    pub fn get_level(&self) -> LogLevel {
        self.level
    }

    /// Get the channel name
    pub fn channel(&self) -> &str {
        &self.channel
    }

    /// Flush the log file
    pub fn flush(&self) {
        if let Some(file) = &self.file {
            let _ = file.lock().flush();
        }
    }
}

/// Macro for convenient trace logging
#[macro_export]
macro_rules! log_trace {
    ($logger:expr, $($arg:tt)*) => {
        $logger.log($crate::services::logger::LogLevel::Trace, &format!($($arg)*))
    };
}

/// Macro for convenient debug logging
#[macro_export]
macro_rules! log_debug {
    ($logger:expr, $($arg:tt)*) => {
        $logger.log($crate::services::logger::LogLevel::Debug, &format!($($arg)*))
    };
}

/// Macro for convenient info logging
#[macro_export]
macro_rules! log_info {
    ($logger:expr, $($arg:tt)*) => {
        $logger.log($crate::services::logger::LogLevel::Info, &format!($($arg)*))
    };
}

/// Macro for convenient warning logging
#[macro_export]
macro_rules! log_warn {
    ($logger:expr, $($arg:tt)*) => {
        $logger.log($crate::services::logger::LogLevel::Warning, &format!($($arg)*))
    };
}

/// Macro for convenient error logging
#[macro_export]
macro_rules! log_error {
    ($logger:expr, $($arg:tt)*) => {
        $logger.log($crate::services::logger::LogLevel::Error, &format!($($arg)*))
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_console_logger() {
        let logger = LoggerService::console_only("test", LogLevel::Debug);
        assert_eq!(logger.channel(), "test");
        assert_eq!(logger.get_level(), LogLevel::Debug);
    }

    #[test]
    fn test_log_level_filtering() {
        let logger = LoggerService::console_only("test", LogLevel::Warning);

        // These should be filtered out (level < Warning)
        logger.trace("trace");
        logger.debug("debug");
        logger.info("info");

        // These should be logged
        logger.warn("warning");
        logger.error("error");
    }

    #[test]
    fn test_log_level_ordering() {
        assert!(LogLevel::Trace < LogLevel::Debug);
        assert!(LogLevel::Debug < LogLevel::Info);
        assert!(LogLevel::Info < LogLevel::Warning);
        assert!(LogLevel::Warning < LogLevel::Error);
        assert!(LogLevel::Error < LogLevel::Off);
    }

    #[test]
    fn test_file_logger() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let logger = LoggerService::new(
            "test",
            &temp_dir.path().to_path_buf(),
            LogLevel::Debug,
            false,
        )
        .unwrap();

        logger.info("Test message");
        logger.flush();

        // Verify file was created
        let entries: Vec<_> = std::fs::read_dir(temp_dir.path()).unwrap().collect();
        assert_eq!(entries.len(), 1);
    }
}
