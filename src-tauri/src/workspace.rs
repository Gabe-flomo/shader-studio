//! The workspace folder (src/workspace/): a folder the user picks, possibly on
//! an external drive, that holds their graphs, presentations, shaders… as files.
//!
//! These commands read and write inside that folder by paths relative to it,
//! so the fs plugin's scope (limited to the home folder) doesn't get in the
//! way of a drive under /Volumes. They never create the folder itself except
//! when asked to (`ws_create_root`, right after the user chose it): when a drive
//! is unplugged its mount point disappears, and writing then must fail with
//! "gone" rather than quietly make a new folder on the startup disk.
//!
//! Writes are atomic: a temp file (`.ss-tmp-…`, which listings skip) is written
//! and synced, then renamed over the target. A watcher (notify) tells the page
//! when anything in the folder changes.

use base64::Engine as _;
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

pub struct WatchState(pub Mutex<Option<notify::RecommendedWatcher>>);

#[derive(Serialize)]
pub struct Listed {
    path: String,
    size: u64,
    mtime: f64,
}

#[derive(Serialize)]
pub struct Stat {
    size: u64,
    mtime: f64,
}

const TEMP_MARK: &str = ".ss-tmp-";

fn skipped(name: &str) -> bool {
    name.starts_with(TEMP_MARK) || name == ".DS_Store" || name == "Thumbs.db" || name.starts_with("._")
}

fn err(e: std::io::Error) -> String {
    match e.kind() {
        ErrorKind::PermissionDenied => format!("permission: {e}"),
        ErrorKind::NotFound => format!("gone: {e}"),
        _ => e.to_string(),
    }
}

/// The folder must be there (a drive that was unplugged isn't).
fn root_dir(root: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(root);
    if !p.is_absolute() {
        return Err("The workspace folder must be a full path.".into());
    }
    match fs::metadata(&p) {
        Ok(m) if m.is_dir() => Ok(p),
        Ok(_) => Err("gone: the workspace path isn't a folder".into()),
        Err(e) => Err(err(e)),
    }
}

/// A path inside the folder: '/'-separated names, none empty, "." or "..".
fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut p = root.to_path_buf();
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') || part.contains('\0') {
            return Err(format!("Not a path inside the workspace: {rel}"));
        }
        p.push(part);
    }
    Ok(p)
}

fn millis(t: std::io::Result<SystemTime>) -> f64 {
    t.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// "ok", "gone" (not there: drive unplugged, folder moved) or "permission".
#[tauri::command]
pub fn ws_probe(root: String) -> String {
    match root_dir(&root) {
        Ok(p) => match fs::read_dir(&p) {
            Ok(_) => "ok".into(),
            Err(e) if e.kind() == ErrorKind::PermissionDenied => "permission".into(),
            Err(_) => "gone".into(),
        },
        Err(e) if e.starts_with("permission") => "permission".into(),
        Err(_) => "gone".into(),
    }
}

/// Make the folder the user just chose (the suggested ~/Documents/Shader Studio may not exist yet).
#[tauri::command]
pub fn ws_create_root(root: String) -> Result<(), String> {
    let p = PathBuf::from(&root);
    if !p.is_absolute() {
        return Err("The workspace folder must be a full path.".into());
    }
    fs::create_dir_all(&p).map_err(err)
}

fn walk(dir: &Path, prefix: &str, out: &mut Vec<Listed>) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(err(e)),
    };
    for entry in entries {
        let entry = entry.map_err(err)?;
        let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else { continue };
        if skipped(&name) {
            continue;
        }
        let path = format!("{prefix}{name}");
        let ft = entry.file_type().map_err(err)?;
        if ft.is_dir() {
            walk(&entry.path(), &format!("{path}/"), out)?;
        } else if ft.is_file() {
            let m = entry.metadata().map_err(err)?;
            out.push(Listed { path, size: m.len(), mtime: millis(m.modified()) });
        }
    }
    Ok(())
}

/// Every file under these top-level folders, and these top-level files.
#[tauri::command]
pub async fn ws_list(root: String, dirs: Vec<String>, files: Vec<String>) -> Result<Vec<Listed>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = root_dir(&root)?;
        let mut out = Vec::new();
        for d in dirs {
            let p = inside(&r, &d)?;
            walk(&p, &format!("{d}/"), &mut out)?;
        }
        for f in files {
            let p = inside(&r, &f)?;
            if let Ok(m) = fs::metadata(&p) {
                if m.is_file() {
                    out.push(Listed { path: f, size: m.len(), mtime: millis(m.modified()) });
                }
            }
        }
        // A listing of an unplugged drive can come back empty rather than failing: check again.
        root_dir(&root)?;
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A file's bytes (raw, not JSON).
#[tauri::command]
pub async fn ws_read(root: String, path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = root_dir(&root)?;
        let p = inside(&r, &path)?;
        fs::read(&p).map(tauri::ipc::Response::new).map_err(|e| match e.kind() {
            // One file missing (deleted meanwhile) isn't the whole folder gone.
            ErrorKind::NotFound => format!("{path}: not there any more"),
            _ => err(e),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn header(req: &tauri::ipc::Request, name: &str) -> Result<String, String> {
    let v = req.headers().get(name).ok_or(format!("missing {name}"))?;
    let b = base64::engine::general_purpose::STANDARD
        .decode(v.as_bytes())
        .map_err(|e| e.to_string())?;
    String::from_utf8(b).map_err(|e| e.to_string())
}

fn write_atomic(target: &Path, data: &[u8]) -> Result<Stat, String> {
    let dir = target.parent().ok_or("no folder")?;
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tmp = dir.join(format!("{TEMP_MARK}{nanos}-{name}"));
    let res = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, target)
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(err(e));
    }
    let m = fs::metadata(target).map_err(err)?;
    Ok(Stat { size: m.len(), mtime: millis(m.modified()) })
}

/// Write a whole file: the body is the bytes; headers x-ws-root and x-ws-path (base64 of UTF-8).
#[tauri::command]
pub async fn ws_write(request: tauri::ipc::Request<'_>) -> Result<Stat, String> {
    let root = header(&request, "x-ws-root")?;
    let path = header(&request, "x-ws-path")?;
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.clone(),
        tauri::ipc::InvokeBody::Json(v) => serde_json::from_value::<Vec<u8>>(v.clone()).map_err(|e| e.to_string())?,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let r = root_dir(&root)?;
        let p = inside(&r, &path)?;
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        write_atomic(&p, &data)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Remove a file (one that isn't there is fine), then folders it leaves empty below the top level.
#[tauri::command]
pub async fn ws_remove(root: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = root_dir(&root)?;
        let p = inside(&r, &path)?;
        match fs::remove_file(&p) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(err(e)),
        }
        let depth = path.split('/').count();
        let mut dir = p.parent().map(|d| d.to_path_buf());
        for _ in 2..depth {
            let Some(d) = dir else { break };
            // Only an empty folder goes (a .DS_Store left by Finder keeps it: fine).
            if fs::remove_dir(&d).is_err() {
                break;
            }
            dir = d.parent().map(|x| x.to_path_buf());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Watch the folder; the page gets "workspace-changed" (with the changed paths) when anything changes.
#[tauri::command]
pub fn ws_watch(app: AppHandle, state: State<'_, WatchState>, root: String) -> Result<(), String> {
    let r = root_dir(&root)?;
    let base = r.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let paths: Vec<String> = match res {
            Ok(ev) => ev
                .paths
                .iter()
                .filter(|p| !p.file_name().and_then(|n| n.to_str()).map(skipped).unwrap_or(false))
                .map(|p| p.strip_prefix(&base).unwrap_or(p).to_string_lossy().replace('\\', "/"))
                .collect(),
            // The watch itself failed (the drive went): say so, the page checks the folder.
            Err(_) => vec![String::new()],
        };
        if !paths.is_empty() {
            let _ = app.emit("workspace-changed", paths);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&r, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn ws_unwatch(state: State<'_, WatchState>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Show the folder in Finder (Explorer, the file manager).
#[tauri::command]
pub fn ws_reveal(root: String) -> Result<(), String> {
    let r = root_dir(&root)?;
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&r).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ss-ws-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn only_paths_inside() {
        let r = Path::new("/tmp/ws");
        assert!(inside(r, "graphs/A/b.graph.json").is_ok());
        assert!(inside(r, "../etc/passwd").is_err());
        assert!(inside(r, "graphs//x").is_err());
        assert!(inside(r, "/abs").is_err());
        assert!(inside(r, "graphs/./x").is_err());
    }

    #[test]
    fn a_missing_root_is_gone_and_never_made() {
        let r = std::env::temp_dir().join("ss-ws-test-missing-drive/Shader Studio");
        let _ = fs::remove_dir_all(r.parent().unwrap());
        let e = root_dir(r.to_str().unwrap()).unwrap_err();
        assert!(e.starts_with("gone"), "{e}");
        assert_eq!(ws_probe(r.to_string_lossy().into()), "gone");
        assert!(!r.exists());
    }

    #[test]
    fn writes_atomically_lists_and_removes() {
        let r = tmp_root("rw");
        let p = inside(&r, "graphs/Tests/Foo.graph.json").unwrap();
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        let st = write_atomic(&p, b"{\"nodes\":[]}").unwrap();
        assert_eq!(st.size, 12);
        let mut out = Vec::new();
        walk(&r.join("graphs"), "graphs/", &mut out).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].path, "graphs/Tests/Foo.graph.json");
        // No temp files left.
        assert_eq!(fs::read_dir(p.parent().unwrap()).unwrap().count(), 1);
        fs::remove_dir_all(&r).unwrap();
    }
}
