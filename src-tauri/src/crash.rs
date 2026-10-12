//! crash.rs — local crash reports (docs/crash-recovery.md "Crash reports").
//! Nothing here sends anything anywhere: reports are files in the app's data
//! folder, `crash-reports/<timestamp>.json`, the newest 20 kept.
//!
//! - The page writes most reports (src/files/crashReports.ts) through
//!   `crash_report_write`: a page that went down, a fatal JS error, a WebGL
//!   context loss.
//! - A Rust panic writes its own, from the panic hook (`install_panic_hook`).
//! - WebKit's web content process dying (the window would go blank) is caught
//!   by `webkit::install`: the session is marked crashed (recovery.rs) and the
//!   page reloaded, so it comes back with the Recover dialog and writes the
//!   report from the log lines the dead page left.
//! - `crash_simulate` is the hidden dev helper (src/dev/simulateCrash.ts).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::recovery::write_atomic;

pub const KEEP: usize = 20;

static REPORT_DIR: OnceLock<PathBuf> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Days since 1970-01-01 → (year, month, day) (Howard Hinnant's civil_from_days).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// `2026-10-11T20:04:22.570Z`
pub fn iso(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let (y, mo, d) = civil(secs.div_euclid(86_400));
    let s = secs.rem_euclid(86_400);
    format!("{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", s / 3600, (s / 60) % 60, s % 60, ms % 1000)
}

/// A report's file name: `2026-10-11T20-04-22-570Z.json` (what the page's `reportFileName` makes).
pub fn report_name(ms: u64) -> String {
    format!("{}.json", iso(ms).replace([':', '.'], "-"))
}

/// `YYYY-MM-DDTHH-MM-SS-mmmZ.json`, nothing else.
pub fn valid_report_name(name: &str) -> bool {
    let b = name.as_bytes();
    if b.len() != 29 || !name.ends_with("Z.json") {
        return false;
    }
    b[..23].iter().enumerate().all(|(i, c)| match i {
        4 | 7 | 13 | 16 | 19 => *c == b'-',
        10 => *c == b'T',
        _ => c.is_ascii_digit(),
    })
}

/// The report names to remove so the newest `keep` stay (names sort by time).
pub fn plan_rotation(names: &[String], keep: usize) -> Vec<String> {
    let mut r: Vec<String> = names.iter().filter(|n| valid_report_name(n)).cloned().collect();
    r.sort();
    r.reverse();
    r.into_iter().skip(keep).collect()
}

fn list_in(dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.filter_map(|e| e.ok()).filter_map(|e| e.file_name().to_str().map(str::to_string)).filter(|n| valid_report_name(n)).collect()
}

/// Write a report into `dir` (atomically) and keep the newest 20.
pub fn write_report_in(dir: &Path, name: &str, body: &[u8]) -> std::io::Result<()> {
    if !valid_report_name(name) {
        return Err(std::io::Error::other(format!("Not a crash report name: {name:?}")));
    }
    write_atomic(&dir.join(name), body)?;
    for old in plan_rotation(&list_in(dir), KEEP) {
        let _ = std::fs::remove_file(dir.join(old));
    }
    Ok(())
}

fn report_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("crash-reports"))
}

/// macOS's version ("macOS 15.6.1"), read once.
pub fn os_version() -> String {
    static OS: OnceLock<String> = OnceLock::new();
    OS.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            if let Ok(o) = std::process::Command::new("/usr/bin/sw_vers").arg("-productVersion").output() {
                let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if !v.is_empty() {
                    return format!("macOS {v}");
                }
            }
        }
        std::env::consts::OS.to_string()
    })
    .clone()
}

/// The panic hook: a report file (and the session's reason, in case the app goes down
/// with it), then the default hook. Never blocks on a lock.
pub fn install_panic_hook(app: &AppHandle) {
    if let Ok(dir) = report_dir(app) {
        let _ = REPORT_DIR.set(dir);
    }
    let _ = APP.set(app.clone());
    let version = app.package_info().version.to_string();
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let at = now_ms();
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "panic".to_string()
        };
        let location = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_default();
        let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let report = json!({
            "format": "playfield-crash-report", "version": 1, "at": at, "time": iso(at),
            "kind": "rust-panic", "summary": "The app’s native side hit an error (a Rust panic)",
            "appVersion": version, "os": format!("{} ({})", os_version(), std::env::consts::ARCH),
            "gpu": { "renderer": "n/a (native)", "vendor": "n/a", "webgl": "n/a" },
            "page": "unknown", "graph": { "name": null, "nodes": 0, "groups": 0, "dirty": false },
            "error": { "message": format!("panicked at {location}: {message}"), "stack": backtrace, "source": format!("thread '{thread}'") },
            "log": [],
        });
        if let Some(dir) = REPORT_DIR.get() {
            let _ = write_report_in(dir, &report_name(at), serde_json::to_string_pretty(&report).unwrap_or_default().as_bytes());
        }
        if let Some(app) = APP.get() {
            crate::recovery::note_panic(app);
        }
        default(info);
    }));
}

#[tauri::command]
pub async fn crash_report_write(app: AppHandle, name: String, body: String) -> Result<(), String> {
    write_report_in(&report_dir(&app)?, &name, body.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crash_report_list(app: AppHandle) -> Result<Vec<String>, String> {
    Ok(list_in(&report_dir(&app)?))
}

#[tauri::command]
pub async fn crash_report_read(app: AppHandle, name: String) -> Result<String, String> {
    if !valid_report_name(&name) {
        return Err(format!("Not a crash report: {name:?}"));
    }
    std::fs::read_to_string(report_dir(&app)?.join(name)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crash_report_remove(app: AppHandle, name: String) -> Result<(), String> {
    if !valid_report_name(&name) {
        return Err(format!("Not a crash report: {name:?}"));
    }
    match std::fs::remove_file(report_dir(&app)?.join(name)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// A report selected in Finder (or the folder, with no name).
#[tauri::command]
pub async fn crash_report_reveal(app: AppHandle, name: Option<String>) -> Result<(), String> {
    let dir = report_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        match name.filter(|n| valid_report_name(n)) {
            Some(n) => cmd.arg("-R").arg(dir.join(n)),
            None => cmd.arg(&dir),
        };
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = name;
        Err(format!("The crash reports are in {}", dir.display()))
    }
}

/// What a report records about the machine.
#[tauri::command]
pub fn crash_env() -> Value {
    json!({ "os": os_version(), "arch": std::env::consts::ARCH })
}

/// The hidden dev helper: "rust-panic" (on the main thread, so the app goes down), "sigkill",
/// "web-process" (WebKit's content process killed).
#[tauri::command]
pub fn crash_simulate(app: AppHandle, kind: String) -> Result<(), String> {
    match kind.as_str() {
        "rust-panic" => app.run_on_main_thread(|| panic!("Simulated panic (dev helper: crash_simulate)")).map_err(|e| e.to_string()),
        "sigkill" => std::process::Command::new("/bin/kill").args(["-9", &std::process::id().to_string()]).spawn().map(|_| ()).map_err(|e| e.to_string()),
        "web-process" => {
            #[cfg(target_os = "macos")]
            {
                webkit::kill_content_process(&app);
                Ok(())
            }
            #[cfg(not(target_os = "macos"))]
            {
                Err("Only on macOS".into())
            }
        }
        other => Err(format!("Unknown crash kind {other:?}")),
    }
}

/// WebKit's `webViewWebContentProcessDidTerminate:`. wry has a handler for it that Tauri
/// doesn't expose (and leaves unset, so the window just goes blank): this replaces the
/// method on wry's navigation delegate class with one that marks the session crashed
/// and reloads the page.
#[cfg(target_os = "macos")]
pub mod webkit {
    use std::ffi::{c_char, c_void, CStr};
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tauri::{AppHandle, Manager};

    type Id = *mut c_void;
    type Sel = *mut c_void;

    #[link(name = "objc", kind = "dylib")]
    extern "C" {
        fn object_getClass(obj: Id) -> Id;
        fn sel_registerName(name: *const c_char) -> Sel;
        fn class_replaceMethod(cls: Id, sel: Sel, imp: *const c_void, types: *const c_char) -> *const c_void;
        fn objc_msgSend();
    }

    /// The main window's WKWebView (its address), to tell it from the output window's.
    static MAIN: AtomicUsize = AtomicUsize::new(0);

    unsafe fn sel(name: &CStr) -> Sel {
        sel_registerName(name.as_ptr())
    }
    unsafe fn send0(obj: Id, s: Sel) -> Id {
        let f: unsafe extern "C" fn(Id, Sel) -> Id = std::mem::transmute(objc_msgSend as *const ());
        f(obj, s)
    }
    unsafe fn responds(obj: Id, s: Sel) -> bool {
        let f: unsafe extern "C" fn(Id, Sel, Sel) -> bool = std::mem::transmute(objc_msgSend as *const ());
        f(obj, sel(c"respondsToSelector:"), s)
    }

    extern "C" fn did_terminate(_this: Id, _cmd: Sel, webview: Id) {
        let main = MAIN.load(Ordering::Relaxed) == webview as usize;
        log::warn!("WebKit's web content process stopped ({} window); reloading", if main { "main" } else { "another" });
        eprintln!("[playfield] web content process terminated; reloading the page");
        if main {
            if let Some(app) = super::APP.get() {
                crate::recovery::page_crashed(app, "web-content-terminated");
            }
        }
        // Reloading starts a new content process; the page comes back to the Recover dialog.
        unsafe {
            send0(webview, sel(c"reload"));
        }
    }

    /// Hook the main window's webview (and so every webview wry makes: it's the class).
    pub fn install(app: &AppHandle) {
        let _ = super::APP.set(app.clone());
        let Some(w) = app.get_webview_window("main") else { return };
        let _ = w.with_webview(|pw| unsafe {
            let wk = pw.inner();
            if wk.is_null() {
                return;
            }
            MAIN.store(wk as usize, Ordering::Relaxed);
            let delegate = send0(wk, sel(c"navigationDelegate"));
            if delegate.is_null() {
                return;
            }
            let cls = object_getClass(delegate);
            class_replaceMethod(cls, sel(c"webViewWebContentProcessDidTerminate:"), did_terminate as *const c_void, c"v@:@".as_ptr());
        });
    }

    /// The dev helper: kill the main webview's content process (WebKit's private
    /// `_killWebContentProcess`, development only).
    pub fn kill_content_process(app: &AppHandle) {
        let Some(w) = app.get_webview_window("main") else { return };
        let _ = w.with_webview(|pw| unsafe {
            let wk = pw.inner();
            let s = sel(c"_killWebContentProcess");
            if !wk.is_null() && responds(wk, s) {
                send0(wk, s);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_iso_times_and_match_the_pages() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_791_774_262_570), "2026-10-12T03:04:22.570Z");
        let n = report_name(1_791_774_262_570);
        assert_eq!(n, "2026-10-12T03-04-22-570Z.json");
        assert!(valid_report_name(&n));
        assert!(!valid_report_name("../2026-10-11T22-04-22-570Z.json"));
        assert!(!valid_report_name("2026-10-11T22-04-22-570Z.json.tmp"));
        assert!(!valid_report_name("session.json"));
    }

    #[test]
    fn writing_keeps_the_newest_twenty() {
        let dir = std::env::temp_dir().join(format!("pf-crash-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for i in 0..25u64 {
            write_report_in(&dir, &report_name(1_700_000_000_000 + i * 1000), b"{}").unwrap();
        }
        let mut names = list_in(&dir);
        names.sort();
        assert_eq!(names.len(), KEEP);
        assert_eq!(names[0], report_name(1_700_000_005_000));
        assert!(write_report_in(&dir, "evil.json", b"{}").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
