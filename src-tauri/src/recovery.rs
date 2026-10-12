//! recovery.rs — autosave snapshots and the session marker, for crash recovery
//! (docs/crash-recovery.md). The web side decides what and when
//! (src/files/autosave.ts); this keeps the files in the app's private data
//! folder (`~/Library/Application Support/com.shaderstudio.app/`):
//!
//!   session.json              this launch: { id, startedAt, cleanExit, project, lastSaveAt, reason, appVersion }
//!   pending-recovery.json     a session that went down, kept until the page has answered for it
//!   autosave/autosave-<ms>.play   snapshots (2026.10.183's .playfile and older .json still read), written atomically (temp + rename)
//!
//! At launch the previous `session.json` is read; if it didn't end cleanly it
//! becomes `pending-recovery.json` (with `reason: "unknown"` when nothing saw it
//! go: a force quit, a kill, the bundle replaced, a power loss). This launch's
//! marker is written `cleanExit: false`, and a clean quit (`RunEvent::Exit`)
//! marks it `true`. The pending one stays until the page calls
//! `session_recovery_done`, so a launch that quits (or dies) before the Recover
//! dialog was answered asks again next time. Nothing here compares app
//! versions: an update or a new build still gets the check.
//!
//! Inside a running app, the page itself can die while the process lives on
//! (WebKit's web content process killed, a fatal JS error): that is pending
//! too (`page_crashed`), so the reload offers recovery even if the app is then
//! quit cleanly. A page load after one that didn't unload cleanly (no
//! `session_page_hide`) counts as `page-reloaded`.

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
    /// The session to offer recovery for, until the page says it's done (also in `pending-recovery.json`).
    pending: Option<Value>,
    current: Value,
    /// Page loads in this process, and whether the last page went away cleanly.
    page_loads: u32,
    page_clean: bool,
}

/// Was this marker's session ended cleanly? A marker without `cleanExit: true` wasn't.
fn is_clean(m: &Value) -> bool {
    m.get("cleanExit").and_then(Value::as_bool) == Some(true)
}

fn has_id(m: &Value) -> bool {
    m.get("id").and_then(Value::as_str).is_some_and(|s| !s.is_empty())
}

/// At launch: the session to offer. The last launch's when it didn't end cleanly
/// (`reason` "unknown" when nothing recorded why), else one still waiting from before.
pub fn pending_at_launch(previous: Option<Value>, leftover: Option<Value>) -> Option<Value> {
    if let Some(mut p) = previous.filter(|p| has_id(p) && !is_clean(p)) {
        if p.get("reason").and_then(Value::as_str).is_none() {
            p["reason"] = json!("unknown");
        }
        return Some(p);
    }
    leftover.filter(|l| has_id(l) && !is_clean(l))
}

/// A page load in a running process: the page before it went without a clean unload.
pub fn pending_on_page_load(page_loads: u32, page_clean: bool, current: &Value) -> Option<Value> {
    if page_loads == 0 || page_clean {
        return None;
    }
    let mut p = current.clone();
    p["cleanExit"] = json!(false);
    p["reason"] = json!("page-reloaded");
    Some(p)
}

fn write_pending(dir: &Path, pending: &Option<Value>) {
    let path = dir.join("pending-recovery.json");
    match pending {
        Some(p) => {
            let _ = write_atomic(&path, p.to_string().as_bytes());
        }
        None => {
            let _ = std::fs::remove_file(path);
        }
    }
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

/// A container snapshot's extension: `.play`, or `.playfile` (2026.10.183).
fn is_container_snapshot(name: &str) -> bool {
    name.ends_with(".play") || name.ends_with(".playfile")
}

/// A snapshot's file name: `autosave-<digits>.play` (or an older `.playfile` / `.json`), nothing else.
pub fn valid_snapshot_name(name: &str) -> bool {
    name.strip_prefix("autosave-")
        .and_then(|r| r.strip_suffix(".play").or_else(|| r.strip_suffix(".playfile")).or_else(|| r.strip_suffix(".json")))
        .is_some_and(|d| (10..=16).contains(&d.len()) && d.bytes().all(|b| b.is_ascii_digit()))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

fn read_json(path: &Path) -> Option<Value> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok())
}

/// At launch: the session to offer (if any) kept for the page, this launch's marker written.
pub fn start(app: &AppHandle) {
    let Some(dir) = data_dir(app) else { return };
    let path = dir.join("session.json");
    let pending = pending_at_launch(read_json(&path), read_json(&dir.join("pending-recovery.json")));
    write_pending(&dir, &pending);
    let current = json!({
        "id": format!("{}-{}", now_ms(), std::process::id()),
        "startedAt": now_ms(),
        "cleanExit": false,
        "project": { "name": null, "version": null, "dirty": false },
        "lastSaveAt": 0,
        "appVersion": app.package_info().version.to_string(),
    });
    let _ = write_atomic(&path, current.to_string().as_bytes());
    if let Ok(mut g) = app.state::<SessionState>().inner.lock() {
        *g = SessionInner { dir: Some(dir), pending, current, page_loads: 0, page_clean: false };
    }
}

/// The page died inside the running app (WebKit's content process, a fatal JS error):
/// this session is offered for recovery on the next page load, or the next launch.
pub fn page_crashed(app: &AppHandle, reason: &str) {
    let state = app.state::<SessionState>();
    let Ok(mut g) = state.inner.lock() else { return };
    mark_page_crashed(&mut g, reason);
}

fn mark_page_crashed(g: &mut SessionInner, reason: &str) {
    let Some(dir) = g.dir.clone() else { return };
    g.current["reason"] = json!(reason);
    let _ = write_atomic(&dir.join("session.json"), g.current.to_string().as_bytes());
    // An older one still waiting (the page never answered for it) keeps its place.
    if g.pending.is_none() {
        let mut p = g.current.clone();
        p["cleanExit"] = json!(false);
        g.pending = Some(p);
        write_pending(&dir, &g.pending);
    }
}

/// A Rust panic: the reason, in case the app goes down with it (the panic hook; never blocks).
pub fn note_panic(app: &AppHandle) {
    let state = app.state::<SessionState>();
    let Ok(mut g) = state.inner.try_lock() else { return };
    let Some(dir) = g.dir.clone() else { return };
    g.current["reason"] = json!("rust-panic");
    let _ = write_atomic(&dir.join("session.json"), g.current.to_string().as_bytes());
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

/// A page load: this launch's marker, and the session to offer recovery for (kept until
/// `session_recovery_done`). A page after one that didn't unload cleanly offers this session.
#[tauri::command]
pub fn session_start(state: State<SessionState>) -> Result<Value, String> {
    let mut g = state.inner.lock().map_err(|_| "The session marker is unavailable".to_string())?;
    if g.pending.is_none() {
        if let Some(p) = pending_on_page_load(g.page_loads, g.page_clean, &g.current) {
            g.pending = Some(p);
            if let Some(dir) = g.dir.clone() {
                write_pending(&dir, &g.pending);
            }
        }
    }
    g.page_loads += 1;
    g.page_clean = false;
    Ok(json!({ "current": g.current, "previous": g.pending }))
}

/// The page has offered recovery (or found nothing to offer): forget the pending session.
#[tauri::command]
pub fn session_recovery_done(state: State<SessionState>) -> Result<(), String> {
    let mut g = state.inner.lock().map_err(|_| "The session marker is unavailable".to_string())?;
    g.pending = None;
    if let Some(dir) = g.dir.clone() {
        write_pending(&dir, &None);
    }
    Ok(())
}

/// The page is going away cleanly (`pagehide`: a reload, the window closing).
#[tauri::command]
pub fn session_page_hide(state: State<SessionState>) -> Result<(), String> {
    let mut g = state.inner.lock().map_err(|_| "The session marker is unavailable".to_string())?;
    g.page_clean = true;
    Ok(())
}

/// The page hit a fatal error: offer this session on the next page load.
#[tauri::command]
pub fn session_page_crashed(state: State<SessionState>, reason: String) -> Result<(), String> {
    let mut g = state.inner.lock().map_err(|_| "The session marker is unavailable".to_string())?;
    let reason: String = reason.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
    mark_page_crashed(&mut g, if reason.is_empty() { "js-fatal" } else { &reason });
    Ok(())
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

/// A snapshot: a .play file's bytes as base64 (`base64: true`), or an old-style JSON text.
#[tauri::command]
pub async fn autosave_write(app: AppHandle, name: String, body: String, base64: Option<bool>) -> Result<(), String> {
    let bytes = if base64.unwrap_or(false) {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.decode(body.as_bytes()).map_err(|e| format!("Couldn't autosave: {e}"))?
    } else {
        body.into_bytes()
    };
    write_atomic(&snapshot_path(&app, &name)?, &bytes).map_err(|e| format!("Couldn't autosave: {e}"))
}

/// The snapshots' names (newest-first ordering is the page's).
#[tauri::command]
pub async fn autosave_list(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = autosave_dir(&app)?;
    let Ok(rd) = std::fs::read_dir(&dir) else { return Ok(vec![]) };
    Ok(rd.filter_map(|e| e.ok()).filter_map(|e| e.file_name().to_str().map(str::to_string)).filter(|n| valid_snapshot_name(n)).collect())
}

/// A snapshot: a .play file as base64, a .json as its text.
#[tauri::command]
pub async fn autosave_read(app: AppHandle, name: String) -> Result<String, String> {
    let path = snapshot_path(&app, &name)?;
    if is_container_snapshot(&name) {
        use base64::Engine;
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        return Ok(base64::engine::general_purpose::STANDARD.encode(bytes));
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
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
        assert!(valid_snapshot_name("autosave-1727520000000.play"));
        assert!(valid_snapshot_name("autosave-1727520000000.playfile"));
        assert!(!valid_snapshot_name("autosave-1727520000000.play.tmp"));
        assert!(!valid_snapshot_name("autosave-1727520000000.playfile.tmp"));
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
    fn an_unclean_launch_is_pending_whatever_its_version() {
        let prev = json!({ "id": "a", "cleanExit": false, "appVersion": "2026.10.100" });
        let p = pending_at_launch(Some(prev), None).unwrap();
        assert_eq!(p["id"], "a");
        assert_eq!(p["reason"], "unknown");
        // A marker from before reasons/versions existed still counts.
        assert_eq!(pending_at_launch(Some(json!({ "id": "old" })), None).unwrap()["id"], "old");
        // A recorded reason is kept.
        assert_eq!(pending_at_launch(Some(json!({ "id": "b", "cleanExit": false, "reason": "web-content-terminated" })), None).unwrap()["reason"], "web-content-terminated");
    }

    #[test]
    fn a_clean_launch_keeps_one_still_waiting() {
        let clean = json!({ "id": "c", "cleanExit": true });
        assert!(pending_at_launch(Some(clean.clone()), None).is_none());
        let left = json!({ "id": "x", "cleanExit": false, "reason": "web-content-terminated" });
        assert_eq!(pending_at_launch(Some(clean), Some(left.clone())).unwrap()["id"], "x");
        // An unclean previous launch is newer than a leftover: it wins.
        assert_eq!(pending_at_launch(Some(json!({ "id": "d", "cleanExit": false })), Some(left)).unwrap()["id"], "d");
        assert!(pending_at_launch(None, Some(json!({ "id": "", "cleanExit": false }))).is_none());
    }

    #[test]
    fn a_page_load_after_an_unclean_page_is_pending() {
        let cur = json!({ "id": "s", "cleanExit": false });
        assert!(pending_on_page_load(0, false, &cur).is_none());
        assert!(pending_on_page_load(1, true, &cur).is_none());
        let p = pending_on_page_load(1, false, &cur).unwrap();
        assert_eq!(p["reason"], "page-reloaded");
        assert_eq!(p["id"], "s");
    }

    #[test]
    fn a_page_crash_is_pending_and_survives_a_clean_quit() {
        let dir = std::env::temp_dir().join(format!("pf-recovery-crash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut g = SessionInner { dir: Some(dir.clone()), pending: None, current: json!({ "id": "s1", "cleanExit": false }), page_loads: 1, page_clean: false };
        mark_page_crashed(&mut g, "web-content-terminated");
        assert_eq!(g.pending.as_ref().unwrap()["reason"], "web-content-terminated");
        // The app then quits cleanly: session.json says clean, but the pending file still offers it.
        g.current["cleanExit"] = json!(true);
        write_atomic(&dir.join("session.json"), g.current.to_string().as_bytes()).unwrap();
        let p = pending_at_launch(read_json(&dir.join("session.json")), read_json(&dir.join("pending-recovery.json"))).unwrap();
        assert_eq!(p["id"], "s1");
        assert_eq!(p["cleanExit"], false);
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
