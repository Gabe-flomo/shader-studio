//! safety.rs — plug-ins must not take the app down (docs/audio-engine.md
//! "When a plug-in crashes").
//!
//! - **Trial loads.** The first time a third-party unit is used, and again
//!   after it's updated (its version or its bundle's date changes), it's
//!   loaded in a throwaway copy of the app (`<app binary> --au-probe t s m`)
//!   that instantiates it exactly as the engine would, lists its parameters,
//!   round-trips its preset and renders a note through it offline (nothing is
//!   heard). A crash or a hang (45 s) there marks it; the app then refuses to
//!   load it until Try again. Results are kept per version in
//!   `plugin-probes.json` in the app's data folder. Apple's own units are trusted.
//! - **The loading marker.** `loading-plugin.json` is written (and synced)
//!   right before a unit is instantiated, its window opened or its preset
//!   restored, and removed right after. Finding it at launch means that unit
//!   took the app down: it's recorded as crashed for its version and handed
//!   to the page (crash recovery's dialog names it, the Plugins setting
//!   switches it off).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use super::{ffi, UnitRef};

pub const PROBE_FLAG: &str = "--au-probe";
/// A trial load that takes longer than this counts as hung.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(45);
/// The probe's exit code when the unit failed to load cleanly (an error, not a crash).
pub const PROBE_FAILED: i32 = 3;
const PROBE_LINE: &str = "PLAYFIELD-PROBE:";
pub const PROBING_EVENT: &str = "audio-engine:plugin-probing";
pub const BLOCKED_EVENT: &str = "audio-engine:plugin-blocked";
const MARKER_FILE: &str = "loading-plugin.json";
const CACHE_FILE: &str = "plugin-probes.json";
/// A window's marker stays this long after asking for it (the view loads asynchronously on the main thread).
pub const WINDOW_MARKER: Duration = Duration::from_secs(5);

// ── Pure parts ───────────────────────────────────────────────────────────────

/// A four-character code as the native side prints it (`ae_fourcc`: unprintable bytes are `?`).
pub fn fourcc(v: u32) -> String {
    v.to_be_bytes().iter().map(|&b| if (32..=126).contains(&b) { b as char } else { '?' }).collect()
}

/// A unit's key, as the page and `ae_units` name it: "aumu/dls /appl".
pub fn unit_code(u: (u32, u32, u32)) -> String {
    format!("{}/{}/{}", fourcc(u.0), fourcc(u.1), fourcc(u.2))
}

pub const fn cc(s: &[u8; 4]) -> u32 {
    ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | s[3] as u32
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    /// Loaded, rendered, and went away cleanly.
    Ok,
    /// Didn't load, but said so (an error, not a crash): not blocked; the app's own load reports it.
    Failed,
    /// Took the trial process (or the app) down.
    Crashed,
    /// Didn't finish in PROBE_TIMEOUT.
    Timeout,
}

impl Verdict {
    pub fn blocks(self) -> bool {
        matches!(self, Verdict::Crashed | Verdict::Timeout)
    }
}

/// What's known about one unit, for one version of it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProbeRecord {
    pub verdict: Verdict,
    pub version: String,
    /// Its bundle's modification time (s since 1970; 0 unknown).
    pub mtime: u64,
    #[serde(default)]
    pub message: String,
    /// When (ms).
    #[serde(default)]
    pub at: u64,
    /// "probe" (a trial load), "app" (it took the app down), "you" (Load anyway).
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, PartialEq)]
pub enum Gate {
    Allow,
    /// Never tried, or changed since: try it out first.
    Probe,
    Refuse(ProbeRecord),
}

/// Load it, try it out first, or refuse it. A new version (or a changed bundle) always gets a fresh try.
pub fn decide(rec: Option<&ProbeRecord>, version: &str, mtime: u64, trusted: bool) -> Gate {
    if trusted {
        return Gate::Allow;
    }
    match rec {
        None => Gate::Probe,
        Some(r) if r.version != version || (r.mtime != 0 && mtime != 0 && r.mtime != mtime) => Gate::Probe,
        Some(r) if r.verdict.blocks() => Gate::Refuse(r.clone()),
        Some(_) => Gate::Allow,
    }
}

/// Apple's own units ship with macOS: never tried out.
pub fn trusted_maker(u: (u32, u32, u32)) -> bool {
    u.2 == cc(b"appl")
}

/// What a finished trial process says: its exit, and the line it printed.
pub fn classify(code: Option<i32>, signal: Option<i32>, output: &str) -> (Verdict, String) {
    let said = output.lines().rev().find_map(|l| l.strip_prefix(PROBE_LINE)).map(|s| s.trim().to_string()).unwrap_or_default();
    if let Some(sig) = signal {
        return (Verdict::Crashed, format!("It crashed while it was being tried out ({})", signal_name(sig)));
    }
    match code {
        Some(0) => (Verdict::Ok, String::new()),
        Some(PROBE_FAILED) => (Verdict::Failed, if said.is_empty() { "It didn't load".into() } else { said }),
        Some(c) => (Verdict::Crashed, format!("It stopped the trial process (exit code {c})")),
        None => (Verdict::Crashed, "It stopped the trial process".into()),
    }
}

fn signal_name(sig: i32) -> String {
    let n = match sig {
        4 => "SIGILL",
        5 => "SIGTRAP",
        6 => "SIGABRT",
        8 => "SIGFPE",
        9 => "SIGKILL",
        10 => "SIGBUS",
        11 => "SIGSEGV",
        _ => "",
    };
    if n.is_empty() { format!("signal {sig}") } else { format!("signal {sig}, {n}") }
}

/// The loading marker: which unit, doing what, since when.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LoadingMarker {
    pub name: String,
    pub code: String,
    /// ms since 1970.
    pub at: u64,
    /// "load", "window", "preset".
    pub stage: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub mtime: u64,
    /// Which write this is: only that write's owner removes it.
    #[serde(default)]
    pub token: u64,
}

pub fn parse_marker(bytes: &[u8]) -> Option<LoadingMarker> {
    let m: LoadingMarker = serde_json::from_slice(bytes).ok()?;
    (!m.code.is_empty()).then_some(m)
}

/// An installed unit, from `ae_units`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UnitInfo {
    pub name: String,
    pub version: String,
    pub path: String,
}

pub fn parse_units(json: &str) -> HashMap<String, UnitInfo> {
    let list: Vec<serde_json::Value> = serde_json::from_str(json).unwrap_or_default();
    list.iter()
        .filter_map(|u| {
            let s = |k: &str| u.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let code = s("code");
            (!code.is_empty()).then(|| (code, UnitInfo { name: s("name"), version: s("version"), path: s("path") }))
        })
        .collect()
}

/// When a unit's bundle last changed (its Info.plist, else the bundle itself); 0 unknown.
pub fn bundle_mtime(path: &str) -> u64 {
    if path.is_empty() {
        return 0;
    }
    let p = Path::new(path);
    let plist = p.join("Contents").join("Info.plist");
    let meta = std::fs::metadata(&plist).or_else(|_| std::fs::metadata(p));
    meta.and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// ── State ────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct SafetyState {
    inner: Mutex<SafetyInner>,
    /// One trial at a time.
    probing: Mutex<()>,
    token: AtomicU64,
}

#[derive(Default)]
struct SafetyInner {
    dir: Option<PathBuf>,
    cache: HashMap<String, ProbeRecord>,
    units: HashMap<String, UnitInfo>,
    /// The plug-in the app went down with last time, until the page takes it.
    crash: Option<LoadingMarker>,
    /// Which unit is in which slot (rack, slot) → code, for the window and preset markers.
    slots: HashMap<(String, String), (u32, u32, u32)>,
}

fn lock_err<T>(_: T) -> String {
    "The plug-in safety state is unavailable".into()
}

impl SafetyState {
    fn save_cache(inner: &SafetyInner) {
        let Some(dir) = &inner.dir else { return };
        if let Ok(json) = serde_json::to_vec_pretty(&inner.cache) {
            let _ = crate::recovery::write_atomic(&dir.join(CACHE_FILE), &json);
        }
    }

    fn info(&self, u: (u32, u32, u32)) -> UnitInfo {
        let code = unit_code(u);
        if let Some(i) = self.inner.lock().ok().and_then(|g| g.units.get(&code).cloned()) {
            return i;
        }
        let units = parse_units(&ffi::list_units());
        let found = units.get(&code).cloned();
        if let Ok(mut g) = self.inner.lock() {
            g.units = units;
        }
        found.unwrap_or(UnitInfo { name: code, ..Default::default() })
    }

    /// The unit list changed (a rescan): names, versions and paths read again next time.
    pub fn forget_units(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.units.clear();
        }
    }

    pub fn note_slot(&self, rack: &str, slot: &str, unit: Option<(u32, u32, u32)>) {
        if let Ok(mut g) = self.inner.lock() {
            let k = (rack.to_string(), slot.to_string());
            match unit {
                Some(u) => g.slots.insert(k, u),
                None => g.slots.remove(&k),
            };
        }
    }

    pub fn forget_rack(&self, rack: &str) {
        if let Ok(mut g) = self.inner.lock() {
            g.slots.retain(|(r, _), _| r != rack);
        }
    }

    fn record(&self, code: &str, rec: ProbeRecord) {
        if let Ok(mut g) = self.inner.lock() {
            g.cache.insert(code.to_string(), rec);
            Self::save_cache(&g);
        }
    }
}

/// At launch: read the trial results, and the marker a crash left.
pub fn start(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    let state = app.state::<SafetyState>();
    let cache: HashMap<String, ProbeRecord> = std::fs::read(dir.join(CACHE_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let marker_path = dir.join(MARKER_FILE);
    let crash = std::fs::read(&marker_path).ok().and_then(|b| parse_marker(&b));
    let _ = std::fs::remove_file(&marker_path);
    let Ok(mut g) = state.inner.lock() else { return };
    g.dir = Some(dir);
    g.cache = cache;
    if let Some(m) = &crash {
        let what = match m.stage.as_str() {
            "window" => "opening its window",
            "preset" => "restoring its settings",
            _ => "loading it",
        };
        g.cache.insert(m.code.clone(), ProbeRecord {
            verdict: Verdict::Crashed,
            version: m.version.clone(),
            mtime: m.mtime,
            message: format!("Playfield closed unexpectedly while {what}"),
            at: m.at,
            source: "app".into(),
            name: m.name.clone(),
        });
        SafetyState::save_cache(&g);
        log::warn!("[audio engine] {} ({}) was {} when the app last went down: switched off", m.name, m.code, m.stage);
    }
    g.crash = crash;
}

// ── The loading marker ───────────────────────────────────────────────────────

/// While it lives, the marker names this unit; dropping it removes the marker (if it's still ours).
pub struct Loading {
    path: Option<PathBuf>,
    token: u64,
}

impl Loading {
    fn none() -> Self {
        Loading { path: None, token: 0 }
    }

    /// Keep the marker a little longer (a window's view loads after the call returns).
    pub fn linger(self, d: Duration) {
        std::thread::spawn(move || {
            std::thread::sleep(d);
            drop(self);
        });
    }
}

impl Drop for Loading {
    fn drop(&mut self) {
        let Some(p) = &self.path else { return };
        let ours = std::fs::read(p).ok().and_then(|b| parse_marker(&b)).is_some_and(|m| m.token == self.token);
        if ours {
            let _ = std::fs::remove_file(p);
        }
    }
}

fn mark(state: &SafetyState, u: (u32, u32, u32), info: &UnitInfo, stage: &str) -> Loading {
    let Some(dir) = state.inner.lock().ok().and_then(|g| g.dir.clone()) else { return Loading::none() };
    let token = state.token.fetch_add(1, Ordering::Relaxed) + 1;
    let m = LoadingMarker {
        name: info.name.clone(),
        code: unit_code(u),
        at: now_ms(),
        stage: stage.into(),
        version: info.version.clone(),
        mtime: bundle_mtime(&info.path),
        token,
    };
    let path = dir.join(MARKER_FILE);
    match serde_json::to_vec(&m).map_err(|e| e.to_string()).and_then(|b| crate::recovery::write_atomic(&path, &b).map_err(|e| e.to_string())) {
        Ok(()) => Loading { path: Some(path), token },
        Err(e) => {
            log::warn!("[audio engine] couldn't write the loading marker: {e}");
            Loading::none()
        }
    }
}

#[derive(Serialize, Clone)]
struct Blocked {
    code: String,
    name: String,
    why: String,
    stage: String,
}

#[derive(Serialize, Clone)]
struct Probing {
    code: String,
    name: String,
}

fn refusal(name: &str, r: &ProbeRecord) -> String {
    let what = if r.verdict == Verdict::Timeout {
        format!("{name} didn't finish loading when it was tried out (it may be waiting for a licence or another dialog)")
    } else if r.source == "app" {
        format!("{name} crashed Playfield last time ({})", r.message.to_lowercase())
    } else {
        format!("{name} crashed when it was tried out")
    };
    format!("{what}, so it isn't loaded. It's switched off in Settings → Plugins; Try again there (or after updating it).")
}

/// Before loading a unit: try it out if it's new or changed, refuse it if it crashes, then mark it as loading.
pub fn before_load(app: &AppHandle, state: &SafetyState, unit: UnitRef) -> Result<Loading, String> {
    let u = unit.triple();
    let info = state.info(u);
    let code = unit_code(u);
    let mtime = bundle_mtime(&info.path);
    let gate = {
        let g = state.inner.lock().map_err(lock_err)?;
        decide(g.cache.get(&code), &info.version, mtime, trusted_maker(u))
    };
    let gate = match gate {
        Gate::Probe => {
            // One trial at a time; another load of the same unit may have tried it meanwhile.
            let _one = state.probing.lock().map_err(lock_err)?;
            let again = {
                let g = state.inner.lock().map_err(lock_err)?;
                decide(g.cache.get(&code), &info.version, mtime, false)
            };
            if again == Gate::Probe {
                let _ = app.emit(PROBING_EVENT, Probing { code: code.clone(), name: info.name.clone() });
                let rec = probe_now(u, &info, mtime);
                state.record(&code, rec.clone());
                if rec.verdict.blocks() { Gate::Refuse(rec) } else { Gate::Allow }
            } else {
                again
            }
        }
        g => g,
    };
    if let Gate::Refuse(r) = gate {
        let why = refusal(&info.name, &r);
        let stage = if r.verdict == Verdict::Timeout { "timeout" } else if r.source == "app" { "load" } else { "probe" };
        let _ = app.emit(BLOCKED_EVENT, Blocked { code, name: info.name.clone(), why: why.clone(), stage: stage.into() });
        return Err(why);
    }
    Ok(mark(state, u, &info, "load"))
}

/// The marker around a window opening or a preset restore on a loaded slot.
pub fn around_slot(state: &SafetyState, rack: &str, slot: &str, stage: &str) -> Loading {
    let u = state.inner.lock().ok().and_then(|g| g.slots.get(&(rack.to_string(), slot.to_string())).copied());
    match u {
        Some(u) => {
            let info = state.info(u);
            mark(state, u, &info, stage)
        }
        None => Loading::none(),
    }
}

/// For an offline render: refuse (without a trial run's toast) a unit that's known to crash; try out one never tried.
pub fn allowed_for_render(app: &AppHandle, state: &SafetyState, unit: UnitRef) -> Result<(), String> {
    before_load(app, state, unit).map(drop)
}

// ── The trial ────────────────────────────────────────────────────────────────

fn probe_now(u: (u32, u32, u32), info: &UnitInfo, mtime: u64) -> ProbeRecord {
    let (verdict, message) = run_probe(u, PROBE_TIMEOUT);
    log::info!("[audio engine] tried out {} ({}): {:?} {}", info.name, unit_code(u), verdict, message);
    ProbeRecord { verdict, version: info.version.clone(), mtime, message, at: now_ms(), source: "probe".into(), name: info.name.clone() }
}

/// Load the unit in a throwaway copy of the app, with a time limit.
pub fn run_probe(u: (u32, u32, u32), timeout: Duration) -> (Verdict, String) {
    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(e) => return (Verdict::Failed, format!("The trial process couldn't start: {e}")),
    };
    let mut child = match Command::new(exe)
        .args([PROBE_FLAG, &u.0.to_string(), &u.1.to_string(), &u.2.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return (Verdict::Failed, format!("The trial process couldn't start: {e}")),
    };
    // Read its output as it comes (a chatty plug-in mustn't fill the pipe and stall it); the tail is kept.
    let out = Arc::new(Mutex::new(String::new()));
    if let Some(mut so) = child.stdout.take() {
        let out = out.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = so.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if let Ok(mut o) = out.lock() {
                    o.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if o.len() > 16384 {
                        let cut = o.len() - 8192;
                        let cut = (cut..o.len()).find(|&i| o.is_char_boundary(i)).unwrap_or(o.len());
                        o.drain(..cut);
                    }
                }
            }
        });
    }
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return (Verdict::Timeout, format!("It didn't finish loading in {} s", timeout.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return (Verdict::Failed, format!("The trial process couldn't be watched: {e}")),
        }
    };
    std::thread::sleep(Duration::from_millis(20)); // the reader's last bytes
    #[cfg(unix)]
    let signal = std::os::unix::process::ExitStatusExt::signal(&status);
    #[cfg(not(unix))]
    let signal: Option<i32> = None;
    let text = out.lock().map(|o| o.clone()).unwrap_or_default();
    classify(status.code(), signal, &text)
}

/// `main`: when the app is started as a trial process, run the trial and return its exit code.
pub fn probe_from_args(args: &[String]) -> Option<i32> {
    let i = args.iter().position(|a| a == PROBE_FLAG)?;
    let nums: Vec<u32> = args.iter().skip(i + 1).take(3).filter_map(|a| a.parse().ok()).collect();
    if nums.len() != 3 {
        println!("{PROBE_LINE} usage: {PROBE_FLAG} <type> <subtype> <manufacturer>");
        return Some(2);
    }
    Some(probe_main((nums[0], nums[1], nums[2])))
}

fn probe_main(u: (u32, u32, u32)) -> i32 {
    ffi::probe_prepare();
    let done = Arc::new(AtomicBool::new(false));
    let result: Arc<Mutex<Option<Result<(), String>>>> = Arc::default();
    {
        let (done, result) = (done.clone(), result.clone());
        std::thread::spawn(move || {
            let r = probe_work(u);
            if let Ok(mut g) = result.lock() {
                *g = Some(r);
            }
            done.store(true, Ordering::SeqCst);
        });
    }
    // The main thread keeps its run loop going: a plug-in may dispatch work to it while it loads.
    while !done.load(Ordering::SeqCst) {
        ffi::pump_main(0.05);
    }
    let r = result.lock().ok().and_then(|mut g| g.take()).unwrap_or(Err("The trial didn't report".into()));
    match r {
        Ok(()) => {
            println!("{PROBE_LINE} ok");
            0
        }
        Err(e) => {
            println!("{PROBE_LINE} {}", e.replace('\n', " "));
            PROBE_FAILED
        }
    }
}

/// What the engine does with a unit, offline: load, parameters, preset round trip, a note rendered through it.
fn probe_work(u: (u32, u32, u32)) -> Result<(), String> {
    ffi::configure_offline(48000.0)?;
    let rack = "probe";
    ffi::rack_create(rack)?;
    let instrument = u.0 == cc(b"aumu");
    let slot = if instrument {
        ffi::set_instrument(rack, Some(u))?;
        "inst"
    } else {
        ffi::set_sampler(rack)?;
        ffi::effect_insert(rack, "fx", -1, u)?;
        "fx"
    };
    ffi::params(rack, slot)?;
    if let Some(st) = ffi::state_get(rack, slot)? {
        ffi::state_set(rack, slot, &st)?;
    }
    let mut buf = vec![0f32; 4096];
    if instrument {
        ffi::midi(rack, 0x90, 60, 100)?;
    }
    for _ in 0..4 {
        ffi::render_offline(&mut buf)?;
    }
    if instrument {
        ffi::midi(rack, 0x80, 60, 0)?;
    }
    ffi::render_offline(&mut buf)?;
    ffi::rack_remove(rack)?;
    Ok(())
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// The plug-in the app went down with last time (once).
#[tauri::command]
pub async fn ae_crash_take(state: State<'_, SafetyState>) -> Result<Option<LoadingMarker>, String> {
    Ok(state.inner.lock().map_err(lock_err)?.crash.take())
}

#[derive(Serialize)]
pub struct ProbeReport {
    code: String,
    name: String,
    status: Verdict,
    message: String,
}

/// Try again: the trial now (or, with `force`, trust it without one: "Load anyway").
#[tauri::command]
pub async fn ae_plugin_retry(state: State<'_, SafetyState>, code: String, force: Option<bool>) -> Result<ProbeReport, String> {
    let u = code_to_triple(&code).ok_or_else(|| format!("Not a plug-in: {code:?}"))?;
    state.forget_units();
    let info = state.info(u);
    let mtime = bundle_mtime(&info.path);
    let rec = if force == Some(true) {
        ProbeRecord { verdict: Verdict::Ok, version: info.version.clone(), mtime, message: String::new(), at: now_ms(), source: "you".into(), name: info.name.clone() }
    } else {
        let _one = state.probing.lock().map_err(lock_err)?;
        probe_now(u, &info, mtime)
    };
    state.record(&code, rec.clone());
    Ok(ProbeReport { code, name: info.name, status: rec.verdict, message: rec.message })
}

/// Every unit's trial result (for the Plugins setting).
#[tauri::command]
pub async fn ae_plugin_safety(state: State<'_, SafetyState>) -> Result<HashMap<String, ProbeRecord>, String> {
    Ok(state.inner.lock().map_err(lock_err)?.cache.clone())
}

/// "aumu/dls /appl" → its numbers (four printable bytes each).
pub fn code_to_triple(code: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<&str> = code.split('/').collect();
    if parts.len() != 3 {
        return None;
    }
    let n = |p: &str| -> Option<u32> {
        let b = p.as_bytes();
        (b.len() == 4 && b.iter().all(|c| (32..=126).contains(c))).then(|| cc(&[b[0], b[1], b[2], b[3]]))
    };
    Some((n(parts[0])?, n(parts[1])?, n(parts[2])?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(verdict: Verdict, version: &str, mtime: u64) -> ProbeRecord {
        ProbeRecord { verdict, version: version.into(), mtime, message: String::new(), at: 1, source: "probe".into(), name: "X".into() }
    }

    #[test]
    fn codes_match_the_native_side() {
        let dls = (cc(b"aumu"), cc(b"dls "), cc(b"appl"));
        assert_eq!(unit_code(dls), "aumu/dls /appl");
        assert_eq!(code_to_triple("aumu/dls /appl"), Some(dls));
        assert_eq!(fourcc(0x0102_4142), "??AB");
        assert_eq!(code_to_triple("aumu/dls/appl"), None);
        assert!(trusted_maker(dls));
        assert!(!trusted_maker((cc(b"aumu"), cc(b"XfsX"), cc(b"Tfer"))));
    }

    #[test]
    fn a_new_or_changed_unit_is_tried_out_first() {
        assert_eq!(decide(None, "1.0", 100, false), Gate::Probe);
        assert_eq!(decide(Some(&rec(Verdict::Ok, "1.0", 100)), "1.0", 100, false), Gate::Allow);
        // Updated: a new version, or the same version with a new bundle date.
        assert_eq!(decide(Some(&rec(Verdict::Ok, "1.0", 100)), "1.1", 100, false), Gate::Probe);
        assert_eq!(decide(Some(&rec(Verdict::Ok, "1.0", 100)), "1.0", 200, false), Gate::Probe);
        // A date that can't be read doesn't count as a change.
        assert_eq!(decide(Some(&rec(Verdict::Ok, "1.0", 100)), "1.0", 0, false), Gate::Allow);
        // Apple's are never tried.
        assert_eq!(decide(None, "1.0", 100, true), Gate::Allow);
    }

    #[test]
    fn a_crash_or_hang_is_refused_until_the_unit_changes() {
        let crashed = rec(Verdict::Crashed, "7.1", 100);
        assert_eq!(decide(Some(&crashed), "7.1", 100, false), Gate::Refuse(crashed.clone()));
        assert!(matches!(decide(Some(&rec(Verdict::Timeout, "7.1", 100)), "7.1", 100, false), Gate::Refuse(_)));
        // An error isn't a crash: loaded (the app's own load reports it).
        assert_eq!(decide(Some(&rec(Verdict::Failed, "7.1", 100)), "7.1", 100, false), Gate::Allow);
        // Updated since it crashed: a fresh try.
        assert_eq!(decide(Some(&crashed), "7.2", 100, false), Gate::Probe);
    }

    #[test]
    fn trial_exits_are_classified() {
        assert_eq!(classify(Some(0), None, "noise\nPLAYFIELD-PROBE: ok\n").0, Verdict::Ok);
        assert_eq!(classify(Some(PROBE_FAILED), None, "PLAYFIELD-PROBE: That Audio Unit isn't installed\n"), (Verdict::Failed, "That Audio Unit isn't installed".into()));
        let (v, m) = classify(None, Some(11), "");
        assert_eq!(v, Verdict::Crashed);
        assert!(m.contains("SIGSEGV"), "{m}");
        assert_eq!(classify(Some(134), None, "").0, Verdict::Crashed);
        assert!(Verdict::Crashed.blocks() && Verdict::Timeout.blocks() && !Verdict::Failed.blocks() && !Verdict::Ok.blocks());
    }

    #[test]
    fn markers_are_parsed_and_old_ones_still_read() {
        let m = LoadingMarker { name: "Kontakt 7".into(), code: "aumu/Ni$D/-NI-".into(), at: 5, stage: "load".into(), version: "7.10.1".into(), mtime: 9, token: 3 };
        let b = serde_json::to_vec(&m).unwrap();
        assert_eq!(parse_marker(&b), Some(m));
        // Without the optional fields (version, mtime, token).
        let old = parse_marker(br#"{"name":"Serum","code":"aumu/XfsX/Tfer","at":1,"stage":"window"}"#).unwrap();
        assert_eq!((old.name.as_str(), old.version.as_str(), old.token), ("Serum", "", 0));
        assert_eq!(parse_marker(b"not json"), None);
        assert_eq!(parse_marker(br#"{"name":"x","code":"","at":1,"stage":"load"}"#), None);
    }

    #[test]
    fn a_marker_is_removed_only_by_its_own_writer() {
        let dir = std::env::temp_dir().join(format!("pf-safety-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(MARKER_FILE);
        let write = |token: u64| {
            let m = LoadingMarker { name: "A".into(), code: "aufx/abcd/efgh".into(), at: 1, stage: "load".into(), version: String::new(), mtime: 0, token };
            std::fs::write(&path, serde_json::to_vec(&m).unwrap()).unwrap();
        };
        write(1);
        let first = Loading { path: Some(path.clone()), token: 1 };
        write(2); // another load wrote over it
        drop(first);
        assert!(path.exists(), "someone else's marker stays");
        drop(Loading { path: Some(path.clone()), token: 2 });
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn units_are_read_from_the_engine_s_list() {
        let u = parse_units(r#"[{"code":"aumu/XfsX/Tfer","name":"Serum","version":"1.3.6","path":"/Library/Audio/Plug-Ins/Components/Serum.component"},{"name":"no code"}]"#);
        assert_eq!(u.len(), 1);
        assert_eq!(u["aumu/XfsX/Tfer"].version, "1.3.6");
        assert_eq!(bundle_mtime(""), 0);
        assert_eq!(bundle_mtime("/no/such/bundle.component"), 0);
    }
}
