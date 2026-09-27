//! Fetching data from a link for the Data editor, and the Kaggle key.
//!
//! The webview can't read most sites' files (CORS), so the desktop app
//! fetches them here: https only (http only to this computer), no cookies,
//! at most `MAX_BYTES`, `TIMEOUT` overall, up to five redirects. The body
//! goes back as base64 (it may be a zip) with its content type and the final
//! address.
//!
//! The Kaggle API key lives in the system keychain (macOS Keychain, Windows
//! Credential Manager). The page never reads it back: `fetch_url` with
//! `kaggle: true` adds it as Basic auth itself, and only for www.kaggle.com.

use base64::Engine as _;
use serde::Serialize;
use std::time::Duration;

const MAX_BYTES: u64 = 25 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
const KEYCHAIN_SERVICE: &str = "Playfield Kaggle";
const KEYCHAIN_USER: &str = "kaggle-api";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fetched {
    status: u16,
    content_type: Option<String>,
    final_url: String,
    body: String,
}

/// Is this an address the app may fetch? https anywhere; http only on this computer.
fn allowed(url: &str) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("That address has spaces or control characters in it.".into());
    }
    if lower.starts_with("https://") {
        return Ok(());
    }
    for local in ["http://localhost", "http://127.0.0.1", "http://[::1]"] {
        if let Some(rest) = lower.strip_prefix(local) {
            if rest.is_empty() || rest.starts_with('/') || rest.starts_with(':') {
                return Ok(());
            }
        }
    }
    Err("Only https:// links can be fetched (and http:// on this computer).".into())
}

fn kaggle_host(url: &str) -> bool {
    url.to_ascii_lowercase().starts_with("https://www.kaggle.com/api/")
}

#[derive(serde::Deserialize, Serialize)]
struct KaggleCreds {
    username: String,
    key: String,
}

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| format!("The keychain isn't available: {e}"))
}

fn read_creds() -> Option<KaggleCreds> {
    let secret = keychain().ok()?.get_password().ok()?;
    serde_json::from_str(&secret).ok()
}

fn fetch_blocking(url: String, kaggle: bool) -> Result<Fetched, String> {
    allowed(&url)?;
    let local = !url.to_ascii_lowercase().starts_with("https://");
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .https_only(!local)
        .timeout_global(Some(TIMEOUT))
        .max_redirects(5)
        .http_status_as_error(false)
        .user_agent("Playfield data import")
        .build()
        .into();
    let mut req = agent.get(&url);
    if kaggle {
        if !kaggle_host(&url) {
            return Err("The Kaggle key is only sent to kaggle.com.".into());
        }
        let creds = read_creds().ok_or("Add your Kaggle username and API key first.")?;
        let token = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", creds.username, creds.key));
        req = req.header("Authorization", format!("Basic {token}"));
    }
    let mut res = req.call().map_err(|e| match e {
        ureq::Error::Timeout(_) => format!("No answer after {} s.", TIMEOUT.as_secs()),
        ureq::Error::RequireHttpsOnly(_) => "Only https:// links can be fetched.".to_string(),
        ureq::Error::TooManyRedirects => "The link redirects too many times.".to_string(),
        other => format!("Couldn't fetch it: {other}"),
    })?;
    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let final_url = {
        use ureq::ResponseExt;
        res.get_uri().to_string()
    };
    let bytes = res
        .body_mut()
        .with_config()
        .limit(MAX_BYTES)
        .read_to_vec()
        .map_err(|e| match e {
            ureq::Error::BodyExceedsLimit(_) => format!("The file is over {} MB, the most a link can bring in.", MAX_BYTES / 1024 / 1024),
            other => format!("The download stopped: {other}"),
        })?;
    Ok(Fetched {
        status,
        content_type,
        final_url,
        body: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

/// Fetch a link's bytes (see the module comment). `kaggle` adds the stored Kaggle key.
#[tauri::command]
pub async fn fetch_url(url: String, kaggle: bool) -> Result<Fetched, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_blocking(url, kaggle))
        .await
        .map_err(|e| e.to_string())?
}

/// The Kaggle username stored on this machine (never the key), or None.
#[tauri::command]
pub fn kaggle_account() -> Option<String> {
    read_creds().map(|c| c.username)
}

/// Store the Kaggle username and API key in the keychain.
#[tauri::command]
pub fn kaggle_save(username: String, key: String) -> Result<(), String> {
    let (u, k) = (username.trim().to_string(), key.trim().to_string());
    if u.is_empty() || k.is_empty() || u.len() > 200 || k.len() > 400 {
        return Err("Enter both your Kaggle username and API key.".into());
    }
    let json = serde_json::to_string(&KaggleCreds { username: u, key: k }).map_err(|e| e.to_string())?;
    keychain()?.set_password(&json).map_err(|e| format!("The keychain refused it: {e}"))
}

/// Remove the Kaggle key from the keychain.
#[tauri::command]
pub fn kaggle_forget() -> Result<(), String> {
    match keychain()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("The keychain refused it: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_or_this_computer() {
        assert!(allowed("https://example.com/a.csv").is_ok());
        assert!(allowed("http://localhost:8080/a.json").is_ok());
        assert!(allowed("http://127.0.0.1/a.json").is_ok());
        assert!(allowed("http://example.com/a.csv").is_err());
        assert!(allowed("http://localhost.evil.com/a.csv").is_err());
        assert!(allowed("file:///etc/passwd").is_err());
        assert!(allowed("https://example.com/a b.csv").is_err());
    }

    #[test]
    fn kaggle_key_only_to_kaggle() {
        assert!(kaggle_host("https://www.kaggle.com/api/v1/datasets/list/a/b"));
        assert!(!kaggle_host("https://www.kaggle.com.evil.com/api/"));
        assert!(!kaggle_host("https://example.com/"));
    }
}
