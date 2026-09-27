//! .playfile support on the desktop (docs/playfile-format.md, "Desktop"):
//!
//! - Files opened with the app (double-click in Finder, dropped on the Dock
//!   icon: the `.playfile` file association in tauri.conf.json) arrive as a
//!   `RunEvent::Opened`. They're kept until the web side asks
//!   (`opened_files_take`, for a launch by a file) and announced as an
//!   `open-files` event (for a file opened while the app runs).
//! - `open_file_read` reads such a file (or one dropped on the window) for
//!   the web side: only container files, and only up to the reader's limit.
//! - The author's signing key (an Ed25519 seed, base64) lives in the system
//!   keychain, like the Kaggle key.

use std::sync::Mutex;
use tauri::ipc::Response;

/// The same cap as the reader's (src/playfile/format.ts DEFAULT_LIMITS.fileBytes).
const MAX_BYTES: u64 = 256 * 1024 * 1024;
const KEYCHAIN_SERVICE: &str = "Playfield signing key";
const KEYCHAIN_USER: &str = "node-pack-author";

/// Files the app was asked to open, not yet taken by the web side.
pub struct OpenedFiles(pub Mutex<Vec<String>>);

fn is_container(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".playfile") || lower.ends_with(".playfield") || lower.ends_with(".play")
}

/// Paths of container files among opened URLs (file:// only).
pub fn container_paths(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter()
        .filter(|u| u.scheme() == "file")
        .filter_map(|u| u.to_file_path().ok())
        .filter_map(|p| p.to_str().map(str::to_string))
        .filter(|p| is_container(p))
        .collect()
}

/// The files the app was opened with before the web side listened (and forget them).
#[tauri::command]
pub fn opened_files_take(state: tauri::State<OpenedFiles>) -> Vec<String> {
    state.0.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default()
}

/// A container file's bytes (opened with the app, or dropped on the window).
#[tauri::command]
pub fn open_file_read(path: String) -> Result<Response, String> {
    if !is_container(&path) {
        return Err("Only .playfile files open this way.".into());
    }
    let meta = std::fs::metadata(&path).map_err(|e| format!("Couldn't read it: {e}"))?;
    if !meta.is_file() {
        return Err("That isn't a file.".into());
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("It's too big to open ({} MB; the limit is {} MB).", meta.len() / 1_048_576, MAX_BYTES / 1_048_576));
    }
    std::fs::read(&path).map(Response::new).map_err(|e| format!("Couldn't read it: {e}"))
}

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| format!("The keychain isn't available: {e}"))
}

/// The author's signing key (base64 seed), or None before the first node pack.
#[tauri::command]
pub fn signing_key_get() -> Result<Option<String>, String> {
    match keychain()?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("The keychain refused it: {e}")),
    }
}

/// Keep the author's signing key in the keychain.
#[tauri::command]
pub fn signing_key_save(key: String) -> Result<(), String> {
    let k = key.trim();
    if k.is_empty() || k.len() > 100 || !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=') {
        return Err("That isn't a signing key.".into());
    }
    keychain()?.set_password(k).map_err(|e| format!("The keychain refused it: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_container_files() {
        assert!(is_container("/Users/a/Downloads/My pack.playfile"));
        assert!(is_container("/x/OLD.PLAYFIELD"));
        assert!(!is_container("/etc/passwd"));
        assert!(!is_container("/x/graph.json"));
    }

    #[test]
    fn refuses_other_files() {
        assert!(open_file_read("/etc/hosts".into()).is_err());
    }
}
