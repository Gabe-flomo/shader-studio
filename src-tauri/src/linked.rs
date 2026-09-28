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

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct LinkedState {
    roots: Mutex<HashSet<PathBuf>>,
    watchers: Mutex<HashMap<PathBuf, notify::RecommendedWatcher>>,
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

#[cfg(test)]
mod tests {
    use super::*;

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
