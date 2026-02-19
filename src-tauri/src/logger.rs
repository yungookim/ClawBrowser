use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use log::{Level, LevelFilter, Log, Metadata, Record};
use serde_json::Value;
use time::format_description::FormatItem;
use time::macros::format_description;
use time::{Duration, OffsetDateTime};

const RETENTION_DAYS: i64 = 7;
const DATE_FORMAT: &[FormatItem<'static>] = format_description!("[year]-[month]-[day]");
const TS_FORMAT: &[FormatItem<'static>] = format_description!("[year]-[month]-[day]T[hour]:[minute]:[second]Z");

static LOGGER: OnceLock<SystemLogger> = OnceLock::new();

pub fn init_system_logger() {
    if LOGGER.get().is_some() {
        return;
    }

    let logs_dir = match default_logs_dir() {
        Some(dir) => dir,
        None => return,
    };

    let logger = SystemLogger::new(logs_dir);
    if LOGGER.set(logger).is_err() {
        return;
    }

    if let Some(logger_ref) = LOGGER.get() {
        logger_ref.prune_old_logs();
        let _ = log::set_logger(logger_ref);
        log::set_max_level(LevelFilter::Error);
    }
}

struct SystemLogger {
    logs_dir: PathBuf,
    last_prune_date: Mutex<Option<String>>,
}

impl SystemLogger {
    fn new(logs_dir: PathBuf) -> Self {
        Self {
            logs_dir,
            last_prune_date: Mutex::new(None),
        }
    }

    fn date_string(&self, now: OffsetDateTime) -> String {
        now.format(DATE_FORMAT).unwrap_or_else(|_| "unknown".to_string())
    }

    fn timestamp_string(&self, now: OffsetDateTime) -> String {
        now.format(TS_FORMAT)
            .unwrap_or_else(|_| now.unix_timestamp().to_string())
    }

    fn file_path(&self, date_str: &str) -> PathBuf {
        self.logs_dir.join(format!("{date_str}.log"))
    }

    fn write_line(&self, date_str: &str, line: &str) {
        if fs::create_dir_all(&self.logs_dir).is_err() {
            return;
        }
        let path = self.file_path(date_str);
        let mut file = match OpenOptions::new().create(true).append(true).open(path) {
            Ok(file) => file,
            Err(_) => return,
        };
        let _ = file.write_all(line.as_bytes());
    }

    fn prune_if_needed(&self, today: &str) {
        let mut should_prune = true;
        if let Ok(mut guard) = self.last_prune_date.lock() {
            if guard.as_deref() == Some(today) {
                should_prune = false;
            } else {
                *guard = Some(today.to_string());
            }
        }
        if !should_prune {
            return;
        }
        self.prune_old_logs();
    }

    fn prune_old_logs(&self) {
        let cutoff = self.cutoff_date();
        let entries = match fs::read_dir(&self.logs_dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("log") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if !is_date_str(stem) {
                continue;
            }
            if stem < cutoff.as_str() {
                let _ = fs::remove_file(path);
            }
        }
    }

    fn cutoff_date(&self) -> String {
        let today = OffsetDateTime::now_utc().date();
        let cutoff = today - Duration::days(RETENTION_DAYS - 1);
        cutoff.format(DATE_FORMAT).unwrap_or_else(|_| "unknown".to_string())
    }
}

impl Log for SystemLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        matches!(metadata.level(), Level::Error)
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let now = OffsetDateTime::now_utc();
        let date_str = self.date_string(now);
        self.prune_if_needed(&date_str);
        let line = format!(
            "[{}] {} {}\n",
            self.timestamp_string(now),
            record.level(),
            record.args()
        );
        self.write_line(&date_str, &line);
    }

    fn flush(&self) {}
}

fn is_date_str(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 {
        return false;
    }
    bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes.iter().enumerate().all(|(idx, b)| {
            if idx == 4 || idx == 7 {
                return true;
            }
            (*b).is_ascii_digit()
        })
}

fn default_logs_dir() -> Option<PathBuf> {
    if let Some(dir) = env_logs_base_dir() {
        return Some(dir.join("system"));
    }
    let home = home_dir()?;
    let config_path = home.join(".clawbrowser").join("config.json");
    if let Ok(raw) = fs::read_to_string(config_path) {
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            if let Some(workspace_path) = value.get("workspacePath").and_then(|path| path.as_str()) {
                if !workspace_path.is_empty() {
                    return Some(PathBuf::from(workspace_path).join("logs").join("system"));
                }
            }
        }
    }
    Some(home.join(".clawbrowser").join("workspace").join("logs").join("system"))
}

fn env_logs_base_dir() -> Option<PathBuf> {
    let raw = std::env::var("CLAW_LOG_DIR").ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Some(path);
    }
    match std::env::current_dir() {
        Ok(cwd) => Some(cwd.join(path)),
        Err(_) => Some(path),
    }
}

fn home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        if !home.is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    let drive = std::env::var("HOMEDRIVE").ok();
    let path = std::env::var("HOMEPATH").ok();
    match (drive, path) {
        (Some(drive), Some(path)) if !drive.is_empty() && !path.is_empty() => {
            Some(PathBuf::from(format!("{drive}{path}")))
        }
        _ => None,
    }
}
