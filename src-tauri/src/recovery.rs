//! recovery.rs — autosave snapshots and the session marker, for crash recovery
//! (docs/crash-recovery.md). The web side decides what and when
//! (src/files/autosave.ts); this keeps the files in the app's private data
//! folder (`~/Library/Application Support/com.shaderstudio.app/`):
//!
//!   session.json          this launch: { id, startedAt, cleanExit, project, lastSaveAt }
//!   autosave/autosave-<ms>.json   snapshots, written atomically (temp + rename)
//!
//! At launch the previous `session.json` is read (and handed to the page once),
//! then replaced by this launch's, `cleanExit: false`. A clean quit
//! (`RunEvent::Exit`) marks it `true`. A reload of the page doesn't restart the
//! process, so it neither looks like a crash nor offers recovery twice.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct SessionState {
    inner: Mutex<SessionInner>,
}

#[derive(Default)]
struct SessionInner {
    dir: Option<PathBuf>,
    /// The previous launch's marker, until the page takes it.
    previous: Option<Value>,
    current: Value,
}

/// Write `bytes` to `path` so a reader sees the old file or the whole new one, never half.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| std::io::Error::other("no parent folder"))?;
    std::fs::create_dir_all(dir)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// A snapshot's file name: `autosave-<digits>.json`, nothing else.
pub fn valid_snapshot_name(name: &str) -> bool {
    name.strip_prefix("autosave-")
        .and_then(|r| r.strip_suffix(".json"))
        .is_some_and(|d| (10..=16).contains(&d.len()) && d.bytes().all(|b| b.is_ascii_digit()))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

/// At launch: keep the previous marker for the page, write this launch's.
pub fn start(app: &AppHandle) {
    let Some(dir) = data_dir(app) else { return };
    let path = dir.join("session.json");
    let previous = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    let current = json!({
        "id": format!("{}-{}", now_ms(), std::process::id()),
        "startedAt": now_ms(),
        "cleanExit": false,
        "project": { "name": null, "version": null, "dirty": false },
        "lastSaveAt": 0,
    });
    let _ = write_atomic(&path, current.to_string().as_bytes());
    if let Ok(mut g) = app.state::<SessionState>().inner.lock() {
        *g = SessionInner { dir: Some(dir), previous, current };
    }
}

/// A clean quit.
pub fn clean_exit(app: &AppHandle) {
    let state = app.state::<SessionState>();
    let Ok(mut g) = state.inner.lock() else { return };
    let Some(dir) = g.dir.clone() else { return };
    g.current["cleanExit"] = json!(true);
    let _ = write_atomic(&dir.join("session.json"), g.current.to_string().as_bytes());
}

/// Merge the page's news into a marker: which project is open, the last real save. Other keys are ignored.
pub fn merge_note(current: &mut Value, note: &Value) {
    if let Some(p) = note.get("project").filter(|p| p.is_object()) {
        current["project"] = json!({
            "name": p.get("name").and_then(Value::as_str),
            "version": p.get("version").and_then(Value::as_f64),
            "dirty": p.get("dirty").and_then(Value::as_bool).unwrap_or(true),
        });
    }
    if let Some(t) = note.get("lastSaveAt").and_then(Value::as_f64) {
        current["lastSaveAt"] = json!(t);
    }
}

/// This launch's marker, and the previous launch's (once: a reload of the page gets none).
#[tauri::command]
pub fn session_start(state: State<SessionState>) -> Result<Value, String> {
    let mut g = state.inner.lock().map_err(|_| "The session marker is unavailable".to_string())?;
    let previous = g.previous.take();
    Ok(json!({ "current": g.current, "previous": previous }))
}

/// The page's news for the marker (see `merge_note`).
#[tauri::command]
pub fn session_note(state: State<SessionState>, note: Value) -> Result<(), String> {
    let mut g = state.inner.lock().map_err(|_| "The session marker is unavailable".to_string())?;
    let Some(dir) = g.dir.clone() else { return Ok(()) };
    merge_note(&mut g.current, &note);
    write_atomic(&dir.join("session.json"), g.current.to_string().as_bytes()).map_err(|e| e.to_string())
}

fn autosave_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app).ok_or("No app data folder")?.join("autosave"))
}

fn snapshot_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !valid_snapshot_name(name) {
        return Err(format!("Not an autosave file: {name:?}"));
    }
    Ok(autosave_dir(app)?.join(name))
}

#[tauri::command]
pub async fn autosave_write(app: AppHandle, name: String, body: String) -> Result<(), String> {
    write_atomic(&snapshot_path(&app, &name)?, body.as_bytes()).map_err(|e| format!("Couldn't autosave: {e}"))
}

/// The snapshots' names (newest-first ordering is the page's).
#[tauri::command]
pub async fn autosave_list(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = autosave_dir(&app)?;
    let Ok(rd) = std::fs::read_dir(&dir) else { return Ok(vec![]) };
    Ok(rd.filter_map(|e| e.ok()).filter_map(|e| e.file_name().to_str().map(str::to_string)).filter(|n| valid_snapshot_name(n)).collect())
}

#[tauri::command]
pub async fn autosave_read(app: AppHandle, name: String) -> Result<String, String> {
    std::fs::read_to_string(snapshot_path(&app, &name)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn autosave_remove(app: AppHandle, name: String) -> Result<(), String> {
    match std::fs::remove_file(snapshot_path(&app, &name)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// The autosave folder in Finder.
#[tauri::command]
pub async fn autosave_reveal(app: AppHandle) -> Result<(), String> {
    let dir = autosave_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&dir).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(format!("The autosaves are in {}", dir.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_snapshot_names_are_accepted() {
        assert!(valid_snapshot_name("autosave-1727520000000.json"));
        assert!(!valid_snapshot_name("autosave-17.json"));
        assert!(!valid_snapshot_name("autosave-../../x.json"));
        assert!(!valid_snapshot_name("session.json"));
        assert!(!valid_snapshot_name("autosave-1727520000000.json.tmp"));
    }

    #[test]
    fn atomic_writes_replace_the_whole_file_and_leave_no_temp() {
        let dir = std::env::temp_dir().join(format!("pf-recovery-test-{}", std::process::id()));
        let p = dir.join("autosave-1727520000000.json");
        write_atomic(&p, b"first, longer contents").unwrap();
        write_atomic(&p, b"second").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"second");
        let names: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name()).collect();
        assert_eq!(names.len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn notes_merge_the_project_and_the_last_save() {
        let mut m = json!({ "id": "a", "cleanExit": false, "project": { "name": null, "version": null, "dirty": false }, "lastSaveAt": 0 });
        merge_note(&mut m, &json!({ "project": { "name": "Rings", "version": 3, "dirty": true }, "id": "evil" }));
        assert_eq!(m["project"]["name"], "Rings");
        assert_eq!(m["project"]["dirty"], true);
        assert_eq!(m["id"], "a");
        merge_note(&mut m, &json!({ "lastSaveAt": 12345 }));
        assert_eq!(m["lastSaveAt"], 12345.0);
        assert_eq!(m["project"]["name"], "Rings");
    }
}
