//! live_connector.rs — Ableton Live through the Live connector (docs/live-connector-plan.md).
//!
//! The connector is a Remote Script (tools/live-connector/Playfield) that runs inside Live and
//! speaks OSC over UDP on 127.0.0.1: it listens on 11100 and sends to 11101. Here:
//!
//! - a second OSC listener (osc_listener::Listener) on 11101, forwarding each datagram to the
//!   webview as a `live-packet` event (src/lib/liveClient.ts decodes it);
//! - `live_send`: Playfield → Live commands (launch a clip, …) as UDP to 127.0.0.1:11100;
//! - the one-click install: find Live's User Library (from Library.cfg, Live 11 and 12) and copy
//!   the script, which is compiled into the app, into `<User Library>/Remote Scripts/Playfield/`.
//!
//! The finding and copying are plain functions, unit-tested with sample Library.cfg files and
//! temporary folders.

use std::fs;
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::osc_listener;

/// Playfield listens here for the script.
pub const LIVE_IN_PORT: u16 = 11101;
/// The script listens here for Playfield.
pub const LIVE_OUT_PORT: u16 = 11100;

/// The script, as shipped: (file name, contents).
pub const SCRIPT_FILES: &[(&str, &str)] = &[
    ("__init__.py", include_str!("../../tools/live-connector/Playfield/__init__.py")),
    ("connector.py", include_str!("../../tools/live-connector/Playfield/connector.py")),
    ("model.py", include_str!("../../tools/live-connector/Playfield/model.py")),
    ("osc.py", include_str!("../../tools/live-connector/Playfield/osc.py")),
    ("surface.py", include_str!("../../tools/live-connector/Playfield/surface.py")),
    ("version.txt", include_str!("../../tools/live-connector/Playfield/version.txt")),
    ("CREDITS.txt", include_str!("../../tools/live-connector/Playfield/CREDITS.txt")),
];

/// The shipped script's version (its `VERSION = "x.y.z"` line).
pub fn bundled_version() -> String {
    script_version(SCRIPT_FILES[0].1).unwrap_or_default()
}

/// `VERSION = "1.0.0"` → "1.0.0".
pub fn script_version(init_py: &str) -> Option<String> {
    init_py.lines().find_map(|l| {
        let l = l.trim();
        let rest = l.strip_prefix("VERSION")?.trim_start().strip_prefix('=')?.trim();
        let v = rest.trim_matches('"').trim_matches('\'');
        (!v.is_empty() && v.chars().all(|c| c.is_ascii_digit() || c == '.')).then(|| v.to_string())
    })
}

// ── Finding the User Library ──────────────────────────────────────────────────

/// The User Library from a Library.cfg: `<UserLibrary>`'s `ProjectPath` joined with its
/// `ProjectName` (Live 12 writes `ProjectPath Value="/Users/me/Music/Ableton"` and
/// `ProjectName Value="User Library"`). A path that already ends in the name is kept.
pub fn user_library_from_cfg(xml: &str) -> Option<PathBuf> {
    let start = xml.find("<UserLibrary>")?;
    let end = xml[start..].find("</UserLibrary>").map(|e| start + e).unwrap_or(xml.len());
    let block = &xml[start..end];
    let value = |tag: &str| -> Option<String> {
        let i = block.find(&format!("<{tag} "))?;
        let rest = &block[i..];
        let v = rest.find("Value=\"")? + 7;
        let close = rest[v..].find('"')?;
        Some(unescape_xml(&rest[v..v + close]))
    };
    let path = value("ProjectPath").filter(|p| !p.is_empty())?;
    let name = value("ProjectName").unwrap_or_else(|| "User Library".into());
    let base = PathBuf::from(path);
    if name.is_empty() || base.file_name().map(|f| f == name.as_str()).unwrap_or(false) {
        Some(base)
    } else {
        Some(base.join(name))
    }
}

fn unescape_xml(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

/// "Live 12.4.6" → [12, 4, 6] (for picking the newest preferences folder).
fn live_version_of(name: &str) -> Option<Vec<u32>> {
    let v = name.strip_prefix("Live ")?;
    let parts: Vec<u32> = v.split(|c: char| c == '.' || c == ' ').map_while(|p| p.parse().ok()).collect();
    (!parts.is_empty()).then_some(parts)
}

/// Live's preference folders (`Live 11.3.13`, `Live 12.4.6`…) under `prefs_root`, newest first.
pub fn live_pref_dirs(prefs_root: &Path) -> Vec<PathBuf> {
    let mut found: Vec<(Vec<u32>, PathBuf)> = fs::read_dir(prefs_root)
        .map(|rd| rd.filter_map(|e| e.ok()).filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let v = live_version_of(&name)?;
            e.path().is_dir().then(|| (v, e.path()))
        }).collect())
        .unwrap_or_default();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, p)| p).collect()
}

/// Where Live keeps its preferences: Mac `~/Library/Preferences/Ableton`, Windows `%APPDATA%\Ableton`
/// (each version's folder has a `Preferences` folder inside on Windows).
fn prefs_root() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    { std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("Ableton")) }
    #[cfg(not(target_os = "windows"))]
    { std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Preferences/Ableton")) }
}

/// A version folder's Library.cfg (Windows: inside its `Preferences` folder).
fn library_cfg(version_dir: &Path) -> PathBuf {
    let win = version_dir.join("Preferences").join("Library.cfg");
    if win.exists() { win } else { version_dir.join("Library.cfg") }
}

fn log_txt(version_dir: &Path) -> PathBuf {
    let win = version_dir.join("Preferences").join("Log.txt");
    if win.exists() { win } else { version_dir.join("Log.txt") }
}

/// The default User Library when no Library.cfg says otherwise: `~/Music/Ableton/User Library`
/// (Mac), `Documents\Ableton\User Library` (Windows).
fn default_user_library() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    { std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join("Documents").join("Ableton").join("User Library")) }
    #[cfg(not(target_os = "windows"))]
    { std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Music/Ableton/User Library")) }
}

/// The User Library the newest Live uses (its Library.cfg), else the default.
pub fn find_user_library(prefs: Option<&Path>, fallback: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(root) = prefs {
        for dir in live_pref_dirs(root) {
            if let Ok(xml) = fs::read_to_string(library_cfg(&dir)) {
                if let Some(lib) = user_library_from_cfg(&xml) {
                    return Some(lib);
                }
            }
        }
    }
    fallback
}

// ── Installing ────────────────────────────────────────────────────────────────

/// Copy the script into `<remote_scripts>/Playfield/`. An older copy is kept as `Playfield.bak`
/// (one version back); the folder is written fresh, so no stale files (or `__pycache__`) stay.
pub fn install_into(remote_scripts: &Path, files: &[(&str, &str)]) -> Result<PathBuf, String> {
    fs::create_dir_all(remote_scripts).map_err(|e| format!("Couldn’t make {}: {e}", remote_scripts.display()))?;
    let target = remote_scripts.join("Playfield");
    let backup = remote_scripts.join("Playfield.bak");
    // Write the new copy beside it first, so a failure leaves the old one working.
    let staging = remote_scripts.join(".Playfield.installing");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| format!("Couldn’t write into {}: {e}", remote_scripts.display()))?;
    for (name, body) in files {
        fs::write(staging.join(name), body).map_err(|e| { let _ = fs::remove_dir_all(&staging); format!("Couldn’t write {name}: {e}") })?;
    }
    if target.exists() {
        let _ = fs::remove_dir_all(&backup);
        fs::rename(&target, &backup).map_err(|e| { let _ = fs::remove_dir_all(&staging); format!("Couldn’t move the old connector aside: {e}") })?;
    }
    fs::rename(&staging, &target).map_err(|e| format!("Couldn’t put the connector in place: {e}"))?;
    Ok(target)
}

/// The installed script's version (its version.txt), if any.
pub fn installed_version(remote_scripts: &Path) -> Option<String> {
    let t = fs::read_to_string(remote_scripts.join("Playfield").join("version.txt")).ok()?;
    let v = t.trim().to_string();
    (!v.is_empty()).then_some(v)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorStatus {
    bundled_version: String,
    installed_version: Option<String>,
    user_library: Option<String>,
    remote_scripts: Option<String>,
    /// Live versions with preferences here ("Live 12.4.6"), newest first.
    lives: Vec<String>,
    /// The newest Live's Log.txt (script errors land there).
    log_path: Option<String>,
}

fn status() -> ConnectorStatus {
    let root = prefs_root();
    let dirs = root.as_deref().map(live_pref_dirs).unwrap_or_default();
    let lib = find_user_library(root.as_deref(), default_user_library());
    let scripts = lib.as_ref().map(|l| l.join("Remote Scripts"));
    ConnectorStatus {
        bundled_version: bundled_version(),
        installed_version: scripts.as_deref().and_then(installed_version),
        user_library: lib.map(|p| p.display().to_string()),
        remote_scripts: scripts.map(|p| p.display().to_string()),
        lives: dirs.iter().filter_map(|d| d.file_name().map(|f| f.to_string_lossy().to_string())).collect(),
        log_path: dirs.first().map(|d| log_txt(d)).filter(|p| p.exists()).map(|p| p.display().to_string()),
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

pub struct LiveState {
    listener: Mutex<Option<osc_listener::Listener>>,
    sender: Mutex<Option<UdpSocket>>,
}

impl Default for LiveState {
    fn default() -> Self { Self { listener: Mutex::new(None), sender: Mutex::new(None) } }
}

/// Start (or keep) listening for the Live connector on 127.0.0.1:11101.
#[tauri::command]
pub fn live_start(app: AppHandle, state: State<LiveState>) -> Result<u16, String> {
    let mut guard = state.listener.lock().map_err(|e| e.to_string())?;
    if let Some(l) = guard.as_ref() {
        return Ok(l.port());
    }
    let listener = osc_listener::Listener::start(LIVE_IN_PORT, false, move |packet: Vec<u8>| {
        let _ = app.emit("live-packet", packet);
    })
    .map_err(|e| e.replace("is the Node bridge or another OSC app running?", "is another Playfield window, or the bridge with --live, running?"))?;
    let port = listener.port();
    *guard = Some(listener);
    Ok(port)
}

#[tauri::command]
pub fn live_stop(state: State<LiveState>) -> Result<(), String> {
    let mut guard = state.listener.lock().map_err(|e| e.to_string())?;
    if let Some(l) = guard.take() {
        l.stop();
    }
    Ok(())
}

/// Is this a datagram we send the script (an OSC message under /pf/, or a bundle), small enough?
pub fn sendable(packet: &[u8]) -> bool {
    packet.len() >= 8 && packet.len() <= 8192 && (packet.starts_with(b"/pf/") || packet.starts_with(b"#bundle\0"))
}

/// Playfield → Live: one OSC datagram to the script on 127.0.0.1:11100.
#[tauri::command]
pub fn live_send(state: State<LiveState>, packet: Vec<u8>) -> Result<(), String> {
    if !sendable(&packet) {
        return Err("Not a Live connector message".into());
    }
    let mut guard = state.sender.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(UdpSocket::bind("127.0.0.1:0").map_err(|e| e.to_string())?);
    }
    let sock = guard.as_ref().expect("socket");
    sock.send_to(&packet, ("127.0.0.1", LIVE_OUT_PORT)).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn live_connector_status() -> ConnectorStatus {
    status()
}

/// Install (or update) the connector into the User Library's Remote Scripts folder.
#[tauri::command]
pub fn live_connector_install() -> Result<ConnectorStatus, String> {
    let lib = find_user_library(prefs_root().as_deref(), default_user_library()).ok_or("Couldn’t find Ableton’s User Library")?;
    install_into(&lib.join("Remote Scripts"), SCRIPT_FILES)?;
    Ok(status())
}

/// Show Live's Log.txt in the Finder (or Explorer), where a script error would be.
#[tauri::command]
pub fn live_reveal_log() -> Result<(), String> {
    let path = status().log_path.ok_or("Live’s log wasn’t found")?;
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg("-R").arg(&path).spawn();
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("explorer").arg(format!("/select,{path}")).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(Path::new(&path).parent().unwrap_or(Path::new("/"))).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pf-live-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    const CFG_12: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.6">
	<ContentLibrary>
		<UserLibrary>
			<LibraryProject Id="0">
				<ProjectLocation />
				<ProjectName Value="User Library" />
				<ProjectPath Value="/Users/me/Music/Ableton" />
			</LibraryProject>
		</UserLibrary>
		<SliceInfoList>
			<LibrarySliceInfo Id="1" Path="/Users/me/Music/Ableton/Factory Packs/X" DisplayName="X" />
		</SliceInfoList>
	</ContentLibrary>
</Ableton>"#;

    #[test]
    fn finds_the_user_library_in_a_live_12_library_cfg() {
        assert_eq!(user_library_from_cfg(CFG_12), Some(PathBuf::from("/Users/me/Music/Ableton/User Library")));
    }

    #[test]
    fn a_moved_library_and_a_path_that_already_names_it() {
        let moved = CFG_12.replace("/Users/me/Music/Ableton", "/Volumes/Sound &amp; Samples/Ableton");
        assert_eq!(user_library_from_cfg(&moved), Some(PathBuf::from("/Volumes/Sound & Samples/Ableton/User Library")));
        let full = CFG_12.replace("/Users/me/Music/Ableton\"", "/Users/me/Music/Ableton/User Library\"");
        assert_eq!(user_library_from_cfg(&full), Some(PathBuf::from("/Users/me/Music/Ableton/User Library")));
        assert_eq!(user_library_from_cfg("<Ableton></Ableton>"), None);
    }

    #[test]
    fn the_newest_live_wins_and_falls_back_to_the_default() {
        let root = temp("prefs");
        for v in ["Live 11.3.13", "Live 12.4.6", "Live 12.4.10", "Live 9.7.7", "Not Live"] {
            fs::create_dir_all(root.join(v)).unwrap();
        }
        let names: Vec<String> = live_pref_dirs(&root).iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(names, ["Live 12.4.10", "Live 12.4.6", "Live 11.3.13", "Live 9.7.7"]);
        // No Library.cfg anywhere: the default.
        assert_eq!(find_user_library(Some(&root), Some(PathBuf::from("/d"))), Some(PathBuf::from("/d")));
        // Live 11's file (Windows keeps it under Preferences\).
        fs::create_dir_all(root.join("Live 11.3.13/Preferences")).unwrap();
        fs::write(root.join("Live 11.3.13/Preferences/Library.cfg"), CFG_12.replace("/Users/me/Music/Ableton", "C:\\Users\\me\\Documents\\Ableton")).unwrap();
        assert_eq!(find_user_library(Some(&root), None), Some(PathBuf::from("C:\\Users\\me\\Documents\\Ableton").join("User Library")));
        // The newest Live's own file wins.
        fs::write(root.join("Live 12.4.10/Library.cfg"), CFG_12).unwrap();
        assert_eq!(find_user_library(Some(&root), None), Some(PathBuf::from("/Users/me/Music/Ableton/User Library")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn installs_fresh_and_keeps_one_backup() {
        let scripts = temp("scripts").join("Remote Scripts");
        let v1: &[(&str, &str)] = &[("__init__.py", "VERSION = \"1.0.0\"\n"), ("version.txt", "1.0.0\n")];
        let v2: &[(&str, &str)] = &[("__init__.py", "VERSION = \"1.1.0\"\n"), ("version.txt", "1.1.0\n")];
        assert_eq!(installed_version(&scripts), None);
        let at = install_into(&scripts, v1).unwrap();
        assert_eq!(at, scripts.join("Playfield"));
        assert_eq!(installed_version(&scripts).as_deref(), Some("1.0.0"));
        // A stale compiled file from the old version doesn't survive an update.
        fs::create_dir_all(scripts.join("Playfield/__pycache__")).unwrap();
        install_into(&scripts, v2).unwrap();
        assert_eq!(installed_version(&scripts).as_deref(), Some("1.1.0"));
        assert!(!scripts.join("Playfield/__pycache__").exists());
        assert_eq!(fs::read_to_string(scripts.join("Playfield.bak/version.txt")).unwrap(), "1.0.0\n");
        assert!(!scripts.join(".Playfield.installing").exists());
        let _ = fs::remove_dir_all(scripts.parent().unwrap());
    }

    #[test]
    fn the_shipped_script_has_its_version_and_every_file() {
        assert_eq!(script_version("# x\nVERSION = \"2.3.4\"\n"), Some("2.3.4".into()));
        let v = bundled_version();
        assert!(!v.is_empty());
        let txt = SCRIPT_FILES.iter().find(|(n, _)| *n == "version.txt").unwrap().1;
        assert_eq!(txt.trim(), v);
        for (n, body) in SCRIPT_FILES {
            assert!(!body.is_empty(), "{n} is empty");
        }
    }

    #[test]
    fn only_connector_messages_are_sent() {
        assert!(sendable(b"/pf/ping\0\0\0\0,\0\0\0"));
        assert!(sendable(b"#bundle\0\0\0\0\0\0\0\0\x01"));
        assert!(!sendable(b"/live/song/stop\0,\0\0\0"));
        assert!(!sendable(&[b'/'; 9000]));
    }

    #[test]
    fn sends_to_the_script_port_and_listens_on_ours() {
        // The listener half is osc_listener's (tested there); here: the two ports differ and are the protocol's.
        assert_eq!((LIVE_OUT_PORT, LIVE_IN_PORT), (11100, 11101));
    }
}
