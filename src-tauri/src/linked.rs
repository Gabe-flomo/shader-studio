//! Linked folders (src/files/linkedFolders.ts; docs/linked-folders.md): folders
//! on disk — a samples folder, an image folder — that the app browses and
//! reads media from in place, without copying anything into its library.
//!
//! Read-only on purpose: there is no command here that writes, renames or
//! removes. The page names the linked roots it has (`lf_set_roots`, from the
//! folders the user picked in the dialog); every other command refuses a root
//! that isn't one of them, refuses paths with "..", "." or empty parts, and
//! refuses anything that resolves (through a symlink) outside its root.
//!
//! A watcher per root tells the page ("linked-changed", with the root and the
//! changed paths) when a file there changes, so an edited sample reloads.
//!
//! The list of linked folders itself is kept here too, in
//! `<app data>/linked-folders.json` (`lf_store_list` / `lf_store_put` /
//! `lf_store_remove`), one entry per folder, written atomically. Each change
//! touches only its own folder, read fresh from disk, so a window (or a second
//! copy of the app) that loaded the list earlier can't write over folders
//! linked elsewhere. The page's WebKit IndexedDB used to hold it as one array,
//! rewritten whole from memory on every change (the page migrates that list).

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct LinkedState {
    roots: Mutex<HashSet<PathBuf>>,
    watchers: Mutex<HashMap<PathBuf, notify::RecommendedWatcher>>,
    /// One change to the saved list at a time.
    store: Mutex<()>,
}

#[derive(Serialize, Debug)]
pub struct Entry {
    name: String,
    dir: bool,
    size: u64,
    mtime: f64,
}

#[derive(Serialize, Debug)]
pub struct Stat {
    size: u64,
    mtime: f64,
}

#[derive(Serialize, Clone)]
struct Changed {
    root: String,
    paths: Vec<String>,
}

fn skipped(name: &str) -> bool {
    name.starts_with('.') || name == "Thumbs.db" || name == "desktop.ini"
}

fn err(e: std::io::Error) -> String {
    match e.kind() {
        ErrorKind::PermissionDenied => format!("permission: {e}"),
        ErrorKind::NotFound => format!("gone: {e}"),
        _ => e.to_string(),
    }
}

fn millis(t: std::io::Result<SystemTime>) -> f64 {
    t.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// A linked root: absolute, one the page registered, and there (a folder).
fn linked_root(state: &LinkedState, root: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(root);
    if !p.is_absolute() {
        return Err("A linked folder must be a full path.".into());
    }
    if !state.roots.lock().map_err(|e| e.to_string())?.contains(&p) {
        return Err("Not a linked folder.".into());
    }
    match fs::metadata(&p) {
        Ok(m) if m.is_dir() => Ok(p),
        Ok(_) => Err("gone: the linked path isn't a folder".into()),
        Err(e) => Err(err(e)),
    }
}

/// A path inside the root: '/'-separated names, none empty, "." or "..";
/// "" is the root itself. Symlinks that lead outside the root are refused.
fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut p = root.to_path_buf();
    if !rel.is_empty() {
        for part in rel.split('/') {
            if part.is_empty() || part == "." || part == ".." || part.contains('\\') || part.contains('\0') {
                return Err(format!("Not a path inside the linked folder: {rel}"));
            }
            p.push(part);
        }
    }
    // Resolve links: what it really is must still be under the (resolved) root.
    if let (Ok(real), Ok(real_root)) = (fs::canonicalize(&p), fs::canonicalize(root)) {
        if !real.starts_with(&real_root) {
            return Err(format!("Outside the linked folder: {rel}"));
        }
    }
    Ok(p)
}

/// The folders the user linked (replaces the list; watchers of roots no longer there stop).
#[tauri::command]
pub fn lf_set_roots(state: State<'_, LinkedState>, roots: Vec<String>) -> Result<(), String> {
    let set: HashSet<PathBuf> = roots.into_iter().map(PathBuf::from).filter(|p| p.is_absolute()).collect();
    state.watchers.lock().map_err(|e| e.to_string())?.retain(|k, _| set.contains(k));
    *state.roots.lock().map_err(|e| e.to_string())? = set;
    Ok(())
}

/// "ok", "gone" (drive unplugged, folder moved) or "permission".
#[tauri::command]
pub fn lf_probe(state: State<'_, LinkedState>, root: String) -> String {
    probe(&state, &root)
}

fn probe(state: &LinkedState, root: &str) -> String {
    match linked_root(state, root) {
        Ok(p) => match fs::read_dir(&p) {
            Ok(_) => "ok".into(),
            Err(e) if e.kind() == ErrorKind::PermissionDenied => "permission".into(),
            Err(_) => "gone".into(),
        },
        Err(e) if e.starts_with("permission") => "permission".into(),
        Err(_) => "gone".into(),
    }
}

fn list_dir(dir: &Path) -> Result<Vec<Entry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(err)? {
        let Ok(entry) = entry else { continue };
        let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else { continue };
        if skipped(&name) {
            continue;
        }
        // Follow links for what they point at (a linked sample pack inside is fine: `inside` checks reads).
        let Ok(m) = fs::metadata(entry.path()) else { continue };
        if m.is_dir() {
            out.push(Entry { name, dir: true, size: 0, mtime: millis(m.modified()) });
        } else if m.is_file() {
            out.push(Entry { name, dir: false, size: m.len(), mtime: millis(m.modified()) });
        }
    }
    Ok(out)
}

/// One folder's entries (not recursive): `dir` is relative to the root, "" for the root.
#[tauri::command]
pub async fn lf_list(state: State<'_, LinkedState>, root: String, dir: String) -> Result<Vec<Entry>, String> {
    let r = linked_root(&state, &root)?;
    let p = inside(&r, &dir)?;
    tauri::async_runtime::spawn_blocking(move || list_dir(&p)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn lf_stat(state: State<'_, LinkedState>, root: String, path: String) -> Result<Stat, String> {
    let r = linked_root(&state, &root)?;
    let p = inside(&r, &path)?;
    let m = fs::metadata(&p).map_err(|e| match e.kind() {
        ErrorKind::NotFound => format!("missing: {path}"),
        _ => err(e),
    })?;
    if !m.is_file() {
        return Err(format!("missing: {path} isn't a file"));
    }
    Ok(Stat { size: m.len(), mtime: millis(m.modified()) })
}

/// A file's bytes (raw, not JSON).
#[tauri::command]
pub async fn lf_read(state: State<'_, LinkedState>, root: String, path: String) -> Result<tauri::ipc::Response, String> {
    let r = linked_root(&state, &root)?;
    let p = inside(&r, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::read(&p).map(tauri::ipc::Response::new).map_err(|e| match e.kind() {
            ErrorKind::NotFound => format!("missing: {path}"),
            _ => err(e),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Watch a linked root: "linked-changed" { root, paths } when anything under it changes.
#[tauri::command]
pub fn lf_watch(app: AppHandle, state: State<'_, LinkedState>, root: String) -> Result<(), String> {
    let r = linked_root(&state, &root)?;
    let base = r.clone();
    let label = root.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let paths: Vec<String> = match res {
            Ok(ev) => ev
                .paths
                .iter()
                .map(|p| p.strip_prefix(&base).unwrap_or(p).to_string_lossy().replace('\\', "/"))
                .collect(),
            Err(_) => vec![String::new()],
        };
        if !paths.is_empty() {
            let _ = app.emit("linked-changed", Changed { root: label.clone(), paths });
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&r, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    state.watchers.lock().map_err(|e| e.to_string())?.insert(r, watcher);
    Ok(())
}

#[tauri::command]
pub fn lf_unwatch(state: State<'_, LinkedState>, root: String) -> Result<(), String> {
    state.watchers.lock().map_err(|e| e.to_string())?.remove(&PathBuf::from(root));
    Ok(())
}

// ── The saved list ──────────────────────────────────────────────────────────

const STORE_FILE: &str = "linked-folders.json";

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join(STORE_FILE)).map_err(|e| e.to_string())
}

fn id_of(f: &Value) -> Option<&str> {
    f.get("id").and_then(|i| i.as_str()).filter(|i| !i.is_empty())
}

/// The saved folders (an entry needs a string `id`; anything else is skipped).
/// No file yet is an empty list; one that can't be read is an error, so a
/// change never writes over a list it couldn't read.
pub fn store_read(path: &Path) -> Result<Vec<Value>, String> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Couldn't read the linked folders list: {e}")),
    };
    let v: Value = serde_json::from_slice(&bytes).map_err(|e| format!("The linked folders list is damaged: {e}"))?;
    let list = v.get("folders").and_then(|f| f.as_array()).cloned().unwrap_or_default();
    Ok(list.into_iter().filter(|f| id_of(f).is_some()).collect())
}

fn store_write(path: &Path, folders: &[Value]) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(&json!({ "version": 1, "folders": folders })).map_err(|e| e.to_string())?;
    crate::recovery::write_atomic(path, &body).map_err(|e| format!("Couldn't save the linked folders list: {e}"))
}

/// Add a folder, or replace the one with its id (in place, so the order stays).
pub fn store_put(path: &Path, folder: Value) -> Result<(), String> {
    let id = id_of(&folder).ok_or("A linked folder needs an id.")?.to_string();
    let mut list = store_read(path)?;
    match list.iter_mut().find(|f| id_of(f) == Some(id.as_str())) {
        Some(had) => *had = folder,
        None => list.push(folder),
    }
    store_write(path, &list)
}

/// Forget a folder (only the list changes; nothing on disk is touched).
pub fn store_remove(path: &Path, id: &str) -> Result<(), String> {
    let list = store_read(path)?;
    let kept: Vec<Value> = list.iter().filter(|f| id_of(f) != Some(id)).cloned().collect();
    if kept.len() == list.len() {
        return Ok(());
    }
    store_write(path, &kept)
}

#[tauri::command]
pub fn lf_store_list(app: AppHandle, state: State<'_, LinkedState>) -> Result<Vec<Value>, String> {
    let _g = state.store.lock().map_err(|e| e.to_string())?;
    store_read(&store_path(&app)?)
}

#[tauri::command]
pub fn lf_store_put(app: AppHandle, state: State<'_, LinkedState>, folder: Value) -> Result<(), String> {
    let _g = state.store.lock().map_err(|e| e.to_string())?;
    store_put(&store_path(&app)?, folder)
}

#[tauri::command]
pub fn lf_store_remove(app: AppHandle, state: State<'_, LinkedState>, id: String) -> Result<(), String> {
    let _g = state.store.lock().map_err(|e| e.to_string())?;
    store_remove(&store_path(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(id: &str, path: &str) -> Value {
        json!({ "id": id, "name": id, "kind": "samples", "backend": "desktop", "path": path, "addedAt": 1 })
    }

    fn ids(l: &[Value]) -> Vec<String> {
        l.iter().map(|f| f["id"].as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn store_keeps_every_folder() {
        let d = tmp_root("store");
        let p = d.join("linked-folders.json");
        assert!(store_read(&p).unwrap().is_empty());
        store_put(&p, folder("a", "/Volumes/x/A")).unwrap();
        store_put(&p, folder("b", "/Users/me/B")).unwrap();
        store_put(&p, folder("c", "/Users/me/C")).unwrap();
        assert_eq!(ids(&store_read(&p).unwrap()), ["a", "b", "c"]);
        // Replacing keeps the order; removing takes only that one.
        let mut b = folder("b", "/Users/me/B2");
        b["name"] = json!("Renamed");
        store_put(&p, b).unwrap();
        store_remove(&p, "a").unwrap();
        store_remove(&p, "nope").unwrap();
        let l = store_read(&p).unwrap();
        assert_eq!(ids(&l), ["b", "c"]);
        assert_eq!(l[0]["name"], "Renamed");
        assert_eq!(l[0]["path"], "/Users/me/B2");
        assert!(store_put(&p, json!({ "name": "no id" })).is_err());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_damaged_list_is_never_written_over() {
        let d = tmp_root("damaged");
        let p = d.join("linked-folders.json");
        fs::write(&p, b"{ not json").unwrap();
        assert!(store_read(&p).is_err());
        assert!(store_put(&p, folder("a", "/x")).is_err());
        assert_eq!(fs::read(&p).unwrap(), b"{ not json");
        fs::remove_dir_all(&d).unwrap();
    }

    fn tmp_root(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ss-lf-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn state_with(root: &Path) -> LinkedState {
        let s = LinkedState::default();
        s.roots.lock().unwrap().insert(root.to_path_buf());
        s
    }

    #[test]
    fn only_registered_roots() {
        let r = tmp_root("reg");
        let s = LinkedState::default();
        assert!(linked_root(&s, r.to_str().unwrap()).is_err());
        assert_eq!(probe(&s, r.to_str().unwrap()), "gone");
        let s = state_with(&r);
        assert!(linked_root(&s, r.to_str().unwrap()).is_ok());
        assert_eq!(probe(&s, r.to_str().unwrap()), "ok");
        assert!(linked_root(&s, "relative/path").is_err());
        fs::remove_dir_all(&r).unwrap();
    }

    #[test]
    fn only_paths_inside() {
        let r = tmp_root("inside");
        assert!(inside(&r, "Kicks/kick.wav").is_ok());
        assert!(inside(&r, "").is_ok());
        assert!(inside(&r, "../etc/passwd").is_err());
        assert!(inside(&r, "a//b").is_err());
        assert!(inside(&r, "a/./b").is_err());
        assert!(inside(&r, "/abs").is_err());
        fs::remove_dir_all(&r).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_out_are_refused() {
        let r = tmp_root("link");
        let outside = tmp_root("outside");
        fs::write(outside.join("secret.txt"), b"x").unwrap();
        std::os::unix::fs::symlink(&outside, r.join("out")).unwrap();
        assert!(inside(&r, "out/secret.txt").is_err());
        fs::remove_dir_all(&r).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn lists_one_level_and_skips_hidden() {
        let r = tmp_root("list");
        fs::create_dir_all(r.join("Kicks")).unwrap();
        fs::write(r.join("Kicks/kick.wav"), b"RIFF").unwrap();
        fs::write(r.join("snare.wav"), b"RIFF1").unwrap();
        fs::write(r.join(".DS_Store"), b"").unwrap();
        let mut out = list_dir(&r).unwrap();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].name, "Kicks");
        assert!(out[0].dir);
        assert_eq!(out[1].name, "snare.wav");
        assert_eq!(out[1].size, 5);
        fs::remove_dir_all(&r).unwrap();
    }
}
