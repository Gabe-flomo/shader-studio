//! audio_engine — the desktop app's Audio engine: racks of Audio Units
//! (an instrument or the sample player, then effects) on AVAudioEngine,
//! played from MIDI and the computer keyboard, each rack's output analysed
//! for the page's audio readers. docs/audio-engine.md has the whole picture.
//!
//!   ffi.rs       the Objective-C half (native/audio_engine.m), as Result-returning calls
//!   analysis.rs  FFT → the spectrum frames the page reads (`audio-engine://frame`)
//!   params.rs    parameter descriptions, and the glide for mapped parameters
//!   render.rs    a take's racks rendered offline (sample-exact replay) for a video's sound
//!   tap.rs       the live engine's sound drained into a WAV for a real-time recording
//!   touch.rs     Configure's "touch to configure": which parameter changes are the person's
//!   safety.rs    plug-ins that crash: trial loads in a throwaway process, the loading marker
//!
//! Every command is async so it runs off the main thread: loading an AUv3
//! calls back on other threads, and plug-in windows are made on the main one.
//! A worker thread (started with the first rack) glides parameters every
//! 10 ms, sends a frame per sounding rack about 33 times a second, drains
//! the recording tap while one is on, and, while Configure watches a slot,
//! drains its parameter changes about 33 times a second and sends the
//! touched ones as `audio-engine:param-touched` (touch.rs).

pub mod analysis;
pub mod ffi;
pub mod params;
pub mod render;
pub mod safety;
pub mod tap;
pub mod touch;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

pub const FRAME_EVENT: &str = "audio-engine://frame";
const TICK: Duration = Duration::from_millis(10);
/// Frames every this many ticks (about 33 a second).
const FRAME_TICKS: u32 = 3;
/// A rack that has been silent this many frames stops sending (its spectrum has decayed to the floor by then).
const QUIET_FRAMES: u32 = 20;

struct RackAnalysis {
    analyser: analysis::Analyser,
    last_total: u64,
    quiet: u32,
}

/// The recording tap while it runs: the file it fills.
struct TapRun {
    path: PathBuf,
    collector: tap::TapCollector<std::io::BufWriter<std::fs::File>>,
}

/// A slot Configure is watching: what it decided so far, and its parameters' descriptions.
struct Watch {
    touch: touch::TouchWatch,
    params: HashMap<u64, params::Param>,
}

/// A touched parameter, for the page (`audio-engine:param-touched`).
#[derive(Serialize, Clone)]
struct Touched {
    rack: String,
    slot: String,
    /// Its description, `value` the newest.
    param: params::Param,
    /// The first time it moved in this watch.
    first: bool,
}

#[derive(Default)]
struct Inner {
    racks: HashMap<String, RackAnalysis>,
    smoother: params::Smoother,
    tap: Option<TapRun>,
    watches: HashMap<(String, String), Watch>,
    /// A take is rendering: touches are dropped.
    render_busy: bool,
}

#[derive(Default)]
pub struct EngineState {
    inner: Arc<Mutex<Inner>>,
    worker: Mutex<bool>,
    /// Web sounds uploaded for the next render, by rack id (render.rs).
    render_inputs: Mutex<HashMap<String, Vec<f32>>>,
    /// One render at a time.
    rendering: Mutex<()>,
}

fn lock_err<T>(_: T) -> String {
    "The audio engine's state is unavailable".into()
}

/// Ids are the page's (rk_…, fx_…): letters, digits, _ and -, short.
fn valid_id(id: &str) -> Result<&str, String> {
    if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        Ok(id)
    } else {
        Err(format!("Not a valid id: {id:?}"))
    }
}

/// An Audio Unit, by its component description.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
pub struct UnitRef {
    #[serde(rename = "type")]
    pub kind: u32,
    pub subtype: u32,
    pub manufacturer: u32,
}

impl UnitRef {
    fn triple(self) -> (u32, u32, u32) {
        (self.kind, self.subtype, self.manufacturer)
    }
}

fn start_worker(app: &AppHandle, state: &EngineState) -> Result<(), String> {
    let mut started = state.worker.lock().map_err(lock_err)?;
    if *started {
        return Ok(());
    }
    *started = true;
    let inner = state.inner.clone();
    let app = app.clone();
    std::thread::Builder::new()
        .name("audio-engine-analysis".into())
        .spawn(move || worker(app, inner))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn worker(app: AppHandle, inner: Arc<Mutex<Inner>>) {
    let mut last = Instant::now();
    let mut tick = 0u32;
    let mut buf = vec![0.0f32; analysis::FFT_SIZE];
    let mut tap_buf = vec![0.0f32; tap::DRAIN_FRAMES * 2];
    loop {
        std::thread::sleep(TICK);
        let now = Instant::now();
        let dt = now.duration_since(last).as_secs_f32();
        last = now;
        tick = tick.wrapping_add(1);
        let (moves, racks, tapping, watching) = match inner.lock() {
            Ok(mut g) => (g.smoother.step(dt), if tick % FRAME_TICKS == 0 { g.racks.keys().cloned().collect::<Vec<_>>() } else { vec![] }, g.tap.is_some(), !g.watches.is_empty()),
            Err(_) => return,
        };
        for ((rack, slot, address), v) in moves {
            let _ = ffi::param_set(&rack, &slot, address, v);
        }
        if tapping {
            drain_tap(&inner, &mut tap_buf);
        }
        if watching && tick % FRAME_TICKS == 0 {
            drain_watches(&app, &inner);
        }
        if racks.is_empty() {
            continue;
        }
        let sr = ffi::sample_rate();
        for rack in racks {
            let (_, total) = ffi::rack_read(&rack, &mut buf);
            let frame = {
                let Ok(mut g) = inner.lock() else { return };
                let Some(a) = g.racks.get_mut(&rack) else { continue };
                if total == a.last_total && a.quiet >= QUIET_FRAMES {
                    continue;
                }
                a.last_total = total;
                let f = a.analyser.frame(&rack, &buf, sr);
                a.quiet = if f.peak < 1e-5 { a.quiet.saturating_add(1) } else { 0 };
                if a.quiet > QUIET_FRAMES {
                    continue;
                }
                f
            };
            let _ = app.emit(FRAME_EVENT, frame);
        }
    }
}

/// What the watched slots' parameters did since the last drain: the touched ones to the page.
fn drain_watches(app: &AppHandle, inner: &Arc<Mutex<Inner>>) {
    let batches: Vec<touch::Batch> = serde_json::from_str(&ffi::watch_drain()).unwrap_or_default();
    for b in batches {
        let key = (b.rack.clone(), b.slot.clone());
        let (touches, unknown) = {
            let Ok(mut g) = inner.lock() else { return };
            if b.gone {
                g.watches.remove(&key);
                continue;
            }
            let busy = g.render_busy;
            let Some(w) = g.watches.get_mut(&key) else { continue };
            let t = w.touch.take(&b);
            if busy {
                continue;
            }
            let unknown = t.iter().any(|t| !w.params.contains_key(&t.address));
            (t, unknown)
        };
        if touches.is_empty() {
            continue;
        }
        // A parameter the unit added since the watch began: read the descriptions again.
        let fresh = if unknown { ffi::params(&b.rack, &b.slot).ok().map(|j| param_map(params::parse_params(&j))) } else { None };
        let out: Vec<Touched> = {
            let Ok(mut g) = inner.lock() else { return };
            let Some(w) = g.watches.get_mut(&key) else { continue };
            if let Some(f) = fresh {
                w.params = f;
            }
            touches
                .iter()
                .filter_map(|t| {
                    let mut param = w.params.get(&t.address)?.clone();
                    param.value = t.value.clamp(param.min, param.max);
                    Some(Touched { rack: b.rack.clone(), slot: b.slot.clone(), param, first: t.first })
                })
                .collect()
        };
        for t in out {
            let _ = app.emit(touch::TOUCH_EVENT, t);
        }
    }
}

fn param_map(list: Vec<params::Param>) -> HashMap<u64, params::Param> {
    list.into_iter().filter_map(|p| p.address.parse::<u64>().ok().map(|a| (a, p))).collect()
}

/// Everything the tap ring holds now, into the tap's file.
fn drain_tap(inner: &Arc<Mutex<Inner>>, buf: &mut [f32]) {
    loop {
        let (n, from, _) = ffi::tap_read(buf);
        if n == 0 {
            return;
        }
        let Ok(mut g) = inner.lock() else { return };
        let Some(t) = g.tap.as_mut() else { return };
        if let Err(e) = t.collector.push(from, &buf[..n * 2]) {
            log::warn!("[audio engine] tap write failed: {e}");
            return;
        }
        if n < buf.len() / 2 {
            return;
        }
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct Status {
    /// Audio Units can be hosted here (macOS).
    available: bool,
    #[serde(rename = "sampleRate")]
    sample_rate: f64,
    /// Buffers a unit made that weren't finite (NaN, ±inf), flushed to silence since launch.
    #[serde(rename = "nanFlushes")]
    nan_flushes: u64,
    /// Whether the last unit loaded runs in the app's own process (null before any).
    #[serde(rename = "lastInProcess")]
    last_in_process: Option<bool>,
}

#[tauri::command]
pub async fn ae_status() -> Result<Status, String> {
    Ok(Status {
        available: ffi::AVAILABLE,
        sample_rate: if ffi::AVAILABLE { ffi::sample_rate() } else { 48000.0 },
        nan_flushes: ffi::nan_flushes(),
        last_in_process: ffi::last_load_in_process(),
    })
}

/// Every installed instrument and effect (read fresh each time, so it doubles as a rescan).
#[tauri::command]
pub async fn ae_units(safety: State<'_, safety::SafetyState>) -> Result<serde_json::Value, String> {
    safety.forget_units();
    serde_json::from_str(&ffi::list_units()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ae_rack_create(app: AppHandle, state: State<'_, EngineState>, rack: String) -> Result<(), String> {
    let rack = valid_id(&rack)?.to_string();
    ffi::rack_create(&rack)?;
    state.inner.lock().map_err(lock_err)?.racks.entry(rack).or_insert_with(|| RackAnalysis { analyser: Default::default(), last_total: 0, quiet: 0 });
    start_worker(&app, &state)
}

#[tauri::command]
pub async fn ae_rack_remove(state: State<'_, EngineState>, safety: State<'_, safety::SafetyState>, rack: String) -> Result<(), String> {
    let rack = valid_id(&rack)?;
    safety.forget_rack(rack);
    {
        let mut g = state.inner.lock().map_err(lock_err)?;
        g.racks.remove(rack);
        g.smoother.forget(rack, None);
    }
    ffi::rack_remove(rack)
}

#[tauri::command]
pub async fn ae_rack_volume(rack: String, volume: f32, mute: bool) -> Result<(), String> {
    ffi::rack_volume(valid_id(&rack)?, volume, mute)
}

/// The rack's instrument: an Audio Unit, or none.
#[tauri::command]
pub async fn ae_set_instrument(app: AppHandle, state: State<'_, EngineState>, safety: State<'_, safety::SafetyState>, rack: String, unit: Option<UnitRef>) -> Result<(), String> {
    let rack = valid_id(&rack)?;
    state.inner.lock().map_err(lock_err)?.smoother.forget(rack, Some("inst"));
    // A plug-in that crashed (here or when it was tried out) is refused; a new one is tried out first (safety.rs).
    let loading = match unit {
        Some(u) => Some(safety::before_load(&app, &safety, u)?),
        None => None,
    };
    let r = ffi::set_instrument(rack, unit.map(UnitRef::triple));
    drop(loading);
    safety.note_slot(rack, "inst", if r.is_ok() { unit.map(UnitRef::triple) } else { None });
    r
}

#[tauri::command]
pub async fn ae_set_sampler(state: State<'_, EngineState>, safety: State<'_, safety::SafetyState>, rack: String) -> Result<(), String> {
    let rack = valid_id(&rack)?;
    safety.note_slot(rack, "inst", None);
    state.inner.lock().map_err(lock_err)?.smoother.forget(rack, Some("inst"));
    ffi::set_sampler(rack)
}

fn sounds_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("engine-sounds");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn cached_sound(dir: &std::path::Path, id: &str) -> Option<PathBuf> {
    let prefix = format!("{id}.");
    std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(&prefix)))
}

/// Is a library sound (by id) cached for the engine already?
#[tauri::command]
pub async fn ae_sound_has(app: AppHandle, id: String) -> Result<bool, String> {
    Ok(cached_sound(&sounds_dir(&app)?, valid_id(&id)?).is_some())
}

/// Cache a library sound for the engine: the body is the file's bytes, headers `x-sound-id` and `x-sound-ext`.
#[tauri::command]
pub async fn ae_sound_put(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let id = header("x-sound-id");
    let id = valid_id(&id)?;
    let ext = header("x-sound-ext").to_ascii_lowercase();
    if ext.is_empty() || ext.len() > 5 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Not a sound file type".into());
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Send the sound's bytes as the body".into()) };
    if bytes.len() > 200 * 1024 * 1024 {
        return Err("That sound is too big for the engine (200 MB at most)".into());
    }
    let dir = sounds_dir(&app)?;
    std::fs::write(dir.join(format!("{id}.{ext}")), bytes).map_err(|e| format!("Couldn't keep the sound: {e}"))
}

/// A zone of the rack's sample player: a cached sound (by id) for notes lo..hi, its own pitch at `root`. No sound: remove the zone.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ae_sampler_zone(app: AppHandle, rack: String, index: i32, sound: Option<String>, lo: i32, hi: i32, root: i32, gain: f32) -> Result<(), String> {
    let rack = valid_id(&rack)?;
    let path = match sound {
        Some(id) => cached_sound(&sounds_dir(&app)?, valid_id(&id)?).ok_or("That sound isn't cached for the engine yet")?.to_string_lossy().into_owned(),
        None => String::new(),
    };
    ffi::sampler_zone(rack, index, &path, lo, hi, root, gain)
}

#[tauri::command]
pub async fn ae_effect_insert(app: AppHandle, safety: State<'_, safety::SafetyState>, rack: String, slot: String, index: i32, unit: UnitRef) -> Result<(), String> {
    let (rack, slot) = (valid_id(&rack)?, valid_id(&slot)?);
    let loading = safety::before_load(&app, &safety, unit)?;
    let r = ffi::effect_insert(rack, slot, index, unit.triple());
    drop(loading);
    if r.is_ok() {
        safety.note_slot(rack, slot, Some(unit.triple()));
    }
    r
}

#[tauri::command]
pub async fn ae_effect_remove(state: State<'_, EngineState>, safety: State<'_, safety::SafetyState>, rack: String, slot: String) -> Result<(), String> {
    let (rack, slot) = (valid_id(&rack)?, valid_id(&slot)?);
    safety.note_slot(rack, slot, None);
    state.inner.lock().map_err(lock_err)?.smoother.forget(rack, Some(slot));
    ffi::effect_remove(rack, slot)
}

#[tauri::command]
pub async fn ae_effect_move(rack: String, slot: String, index: i32) -> Result<(), String> {
    ffi::effect_move(valid_id(&rack)?, valid_id(&slot)?, index)
}

#[tauri::command]
pub async fn ae_bypass(rack: String, slot: String, bypass: bool) -> Result<(), String> {
    ffi::bypass(valid_id(&rack)?, valid_id(&slot)?, bypass)
}

#[tauri::command]
pub async fn ae_params(rack: String, slot: String) -> Result<Vec<params::Param>, String> {
    Ok(params::parse_params(&ffi::params(valid_id(&rack)?, valid_id(&slot)?)?))
}

/// Set a parameter: gliding there (`smooth`, for numbers a mapping drives), or at once.
#[tauri::command]
pub async fn ae_param_set(state: State<'_, EngineState>, rack: String, slot: String, address: String, value: f32, smooth: bool) -> Result<(), String> {
    let (rack, slot) = (valid_id(&rack)?, valid_id(&slot)?);
    let address: u64 = address.parse().map_err(|_| "Not a parameter address".to_string())?;
    let now = state.inner.lock().map_err(lock_err)?.smoother.set((rack.into(), slot.into(), address), value, smooth);
    match now {
        Some(v) => ffi::param_set(rack, slot, address, v),
        None => Ok(()),
    }
}

/// The slot's whole state (its preset, as base64), to keep in the setup.
#[tauri::command]
pub async fn ae_state_get(rack: String, slot: String) -> Result<Option<String>, String> {
    ffi::state_get(valid_id(&rack)?, valid_id(&slot)?)
}

#[tauri::command]
pub async fn ae_state_set(safety: State<'_, safety::SafetyState>, rack: String, slot: String, state: String) -> Result<(), String> {
    let (rack, slot) = (valid_id(&rack)?, valid_id(&slot)?);
    let _loading = safety::around_slot(&safety, rack, slot, "preset");
    ffi::state_set(rack, slot, &state)
}

/// MIDI channel messages for the rack's instrument: `bytes` is one or more 1–3 byte messages back to back.
#[tauri::command]
pub async fn ae_midi(rack: String, bytes: Vec<u8>) -> Result<(), String> {
    let rack = valid_id(&rack)?;
    for m in split_midi(&bytes) {
        ffi::midi(rack, m[0], m.get(1).copied().unwrap_or(0), m.get(2).copied().unwrap_or(0))?;
    }
    Ok(())
}

/// Channel messages (0x80–0xEF) back to back, each with its data bytes; anything else is skipped.
pub fn split_midi(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut out = vec![];
    let mut i = 0;
    while i < bytes.len() {
        let s = bytes[i];
        if !(0x80..0xf0).contains(&s) {
            i += 1;
            continue;
        }
        let len = if matches!(s & 0xf0, 0xc0 | 0xd0) { 2 } else { 3 };
        if i + len > bytes.len() || bytes[i + 1..i + len].iter().any(|&b| b >= 0x80) {
            i += 1;
            continue;
        }
        out.push(bytes[i..i + len].to_vec());
        i += len;
    }
    out
}

#[tauri::command]
pub async fn ae_outputs() -> Result<serde_json::Value, String> {
    serde_json::from_str(&ffi::outputs()).map_err(|e| e.to_string())
}

/// The output device (0: the system default).
#[tauri::command]
pub async fn ae_set_output(device: u32) -> Result<(), String> {
    ffi::set_output(device)
}

#[tauri::command]
pub async fn ae_master(volume: f32, mute: bool) -> Result<(), String> {
    ffi::master(volume, mute);
    Ok(())
}

/// The slot's own plug-in window (its view, else a generic one).
#[tauri::command]
pub async fn ae_open_ui(safety: State<'_, safety::SafetyState>, rack: String, slot: String, title: String) -> Result<(), String> {
    let (rack, slot) = (valid_id(&rack)?, valid_id(&slot)?);
    let loading = safety::around_slot(&safety, rack, slot, "window");
    let r = ffi::open_ui(rack, slot, &title);
    // The view loads on the main thread after this returns: the marker stays a few seconds.
    loading.linger(safety::WINDOW_MARKER);
    r
}

/// Configure is on for a slot: watch its parameters, and send the ones the person touches (touch.rs).
#[tauri::command]
pub async fn ae_watch_start(app: AppHandle, state: State<'_, EngineState>, rack: String, slot: String) -> Result<(), String> {
    let (rack, slot) = (valid_id(&rack)?, valid_id(&slot)?);
    let list = params::parse_params(&ffi::params(rack, slot)?);
    ffi::watch_start(rack, slot)?;
    state.inner.lock().map_err(lock_err)?.watches.insert((rack.into(), slot.into()), Watch { touch: Default::default(), params: param_map(list) });
    start_worker(&app, &state)
}

/// Configure is off: stop watching.
#[tauri::command]
pub async fn ae_watch_stop(state: State<'_, EngineState>, rack: String, slot: String) -> Result<(), String> {
    let (rack, slot) = (valid_id(&rack)?, valid_id(&slot)?);
    ffi::watch_stop(rack, slot);
    state.inner.lock().map_err(lock_err)?.watches.remove(&(rack.to_string(), slot.to_string()));
    Ok(())
}

// ── Inputs fed from the page (a web sound through a rack's effects) ─────────

/// The rack's source becomes an input the page feeds with `ae_rack_feed`; `capacity` frames of buffer.
#[tauri::command]
pub async fn ae_rack_input(state: State<'_, EngineState>, safety: State<'_, safety::SafetyState>, rack: String, capacity: u32) -> Result<(), String> {
    let rack = valid_id(&rack)?;
    safety.note_slot(rack, "inst", None);
    state.inner.lock().map_err(lock_err)?.smoother.forget(rack, Some("inst"));
    ffi::set_input(rack, capacity.clamp(1024, 1 << 22))
}

/// Interleaved stereo f32 LE frames (the body) for the rack in header `x-rack`; replies with the frames queued after.
#[tauri::command]
pub async fn ae_rack_feed(request: tauri::ipc::Request<'_>) -> Result<u64, String> {
    let rack = request.headers().get("x-rack").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let rack = valid_id(&rack)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Send the sound's frames as the body".into()) };
    ffi::feed(rack, &f32_le(bytes))
}

#[derive(Serialize)]
pub struct InputStats {
    queued: u64,
    underruns: u64,
}

#[tauri::command]
pub async fn ae_rack_input_stats(rack: String) -> Result<InputStats, String> {
    let (queued, underruns) = ffi::input_stats(valid_id(&rack)?).ok_or("That rack has no input")?;
    Ok(InputStats { queued, underruns })
}

/// Little-endian f32 bytes → samples (a trailing partial sample is dropped).
pub fn f32_le(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

// ── Offline rendering of a take ──────────────────────────────────────────────

/// A web sound (interleaved stereo f32 LE, the body) as the source of rack `x-rack` in the next `ae_render_take`.
#[tauri::command]
pub async fn ae_render_input(state: State<'_, EngineState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let rack = request.headers().get("x-rack").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let rack = valid_id(&rack)?.to_string();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Send the sound's frames as the body".into()) };
    if bytes.len() > 200 * 1024 * 1024 {
        return Err("That sound is too long to render through the engine".into());
    }
    state.render_inputs.lock().map_err(lock_err)?.insert(rack, f32_le(bytes));
    Ok(())
}

/// While a take renders, Configure's touches are dropped (cleared however the render ends).
struct RenderBusy(Arc<Mutex<Inner>>);

impl RenderBusy {
    fn new(inner: &Arc<Mutex<Inner>>) -> Self {
        if let Ok(mut g) = inner.lock() {
            g.render_busy = true;
        }
        RenderBusy(inner.clone())
    }
}

impl Drop for RenderBusy {
    fn drop(&mut self) {
        if let Ok(mut g) = self.0.lock() {
            g.render_busy = false;
        }
    }
}

/// Render the job's racks offline (render.rs); the reply is bytes: u32 LE JSON length, the JSON (`RenderInfo`), left f32 LE, right f32 LE.
#[tauri::command]
pub async fn ae_render_take(app: AppHandle, state: State<'_, EngineState>, safety: State<'_, safety::SafetyState>, mut job: render::RenderJob) -> Result<tauri::ipc::Response, String> {
    let _one = state.rendering.lock().map_err(lock_err)?;
    let _busy = RenderBusy::new(&state.inner);
    for r in &job.racks {
        valid_id(&r.id)?;
        for s in r.effects.iter().chain(r.instrument.iter()) {
            valid_id(&s.id)?;
        }
    }
    // A plug-in known to crash is left out of the render (noted), as one that won't load offline is.
    let mut refused = vec![];
    for r in job.racks.iter_mut() {
        for s in r.instrument.iter_mut().chain(r.effects.iter_mut()) {
            if let Some(u) = s.unit {
                if let Err(e) = safety::allowed_for_render(&app, &safety, u) {
                    refused.push(format!("{}: {e}", r.name));
                    s.unit = None;
                }
            }
        }
    }
    let inputs = std::mem::take(&mut *state.render_inputs.lock().map_err(lock_err)?);
    let dir = sounds_dir(&app)?;
    let sound_path = |id: &str| valid_id(id).ok().and_then(|id| cached_sound(&dir, id)).map(|p| p.to_string_lossy().into_owned());
    let (mut info, left, right) = render::run(&job, &sound_path, inputs)?;
    info.notes.extend(refused);
    Ok(tauri::ipc::Response::new(render::pack_reply(&info, &left, &right)))
}

// ── The recording tap ────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct TapStarted {
    path: String,
    #[serde(rename = "sampleRate")]
    sample_rate: f64,
}

/// Start collecting the live engine's sound into a WAV (for a real-time recording).
#[tauri::command]
pub async fn ae_tap_start(app: AppHandle, state: State<'_, EngineState>) -> Result<TapStarted, String> {
    {
        let g = state.inner.lock().map_err(lock_err)?;
        if g.tap.is_some() {
            return Err("A recording tap is already on".into());
        }
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("engine-tap");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("engine-{}-{stamp}.wav", std::process::id()));
    let file = std::fs::File::create(&path).map_err(|e| format!("Couldn't make the tap's file: {e}"))?;
    ffi::tap_start()?;
    let rate = ffi::tap_info().map(|t| t.0).filter(|r| *r > 0.0).unwrap_or_else(ffi::sample_rate);
    state.inner.lock().map_err(lock_err)?.tap = Some(TapRun { path: path.clone(), collector: tap::TapCollector::new(std::io::BufWriter::new(file), rate.round() as u32) });
    start_worker(&app, &state)?;
    Ok(TapStarted { path: path.to_string_lossy().into_owned(), sample_rate: rate })
}

#[derive(Serialize)]
pub struct TapDone {
    path: String,
    frames: u64,
    #[serde(rename = "sampleRate")]
    sample_rate: f64,
    /// Seconds after the start call that the file's first frame was rendered.
    offset: f64,
    /// Frames the ring lost (silence in the file).
    lost: u64,
}

/// Stop the tap and finish its file.
#[tauri::command]
pub async fn ae_tap_stop(state: State<'_, EngineState>) -> Result<TapDone, String> {
    ffi::tap_stop();
    let (rate, install, first) = ffi::tap_info().unwrap_or((ffi::sample_rate(), 0, 0));
    let mut buf = vec![0.0f32; tap::DRAIN_FRAMES * 2];
    drain_tap(&state.inner, &mut buf);
    let run = state.inner.lock().map_err(lock_err)?.tap.take().ok_or("No recording tap is on")?;
    let (frames, lost, _) = run.collector.finish().map_err(|e| format!("Couldn't finish the tap's file: {e}"))?;
    Ok(TapDone { path: run.path.to_string_lossy().into_owned(), frames, sample_rate: rate, offset: tap::start_offset(install, first), lost })
}

/// Remove a tap file once it's muxed (or given up on).
#[tauri::command]
pub async fn ae_tap_discard(app: AppHandle, path: String) -> Result<(), String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("engine-tap");
    let p = PathBuf::from(&path);
    if p.parent() != Some(dir.as_path()) {
        return Err("Not a tap file".into());
    }
    let _ = std::fs::remove_file(p);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f32_bytes_are_read_little_endian_and_a_short_tail_dropped() {
        let mut b = vec![];
        b.extend_from_slice(&0.5f32.to_le_bytes());
        b.extend_from_slice(&(-1.0f32).to_le_bytes());
        b.extend_from_slice(&[1, 2]);
        assert_eq!(f32_le(&b), vec![0.5, -1.0]);
    }

    #[test]
    fn ids_are_checked() {
        assert!(valid_id("rk_1a-B").is_ok());
        assert!(valid_id("").is_err());
        assert!(valid_id("a/b").is_err());
        assert!(valid_id("../x").is_err());
        assert!(valid_id(&"x".repeat(65)).is_err());
    }

    #[test]
    fn midi_is_split_into_messages() {
        assert_eq!(split_midi(&[0x90, 60, 100, 0x80, 60, 0]), vec![vec![0x90, 60, 100], vec![0x80, 60, 0]]);
        // Program change and channel pressure are two bytes.
        assert_eq!(split_midi(&[0xc0, 5, 0xd1, 64, 0xe0, 0, 64]), vec![vec![0xc0, 5], vec![0xd1, 64], vec![0xe0, 0, 64]]);
        // Stray data, system messages and a cut-off message are skipped.
        assert_eq!(split_midi(&[1, 0xf8, 0x90, 60]), Vec::<Vec<u8>>::new());
        assert_eq!(split_midi(&[0x90, 0x90, 60, 1]), vec![vec![0x90, 60, 1]]);
    }

    #[test]
    fn unit_refs_read_the_page_s_shape() {
        let u: UnitRef = serde_json::from_str(r#"{"type":1635085685,"subtype":1684828960,"manufacturer":1634758764}"#).unwrap();
        assert_eq!(u.triple(), (0x61756d75, 0x646c7320, 0x6170706c));
    }
}

/// The real engine, offline (manual rendering: no device, nothing heard), with Apple's built-in Audio Units.
/// Run with `cargo test --lib audio_engine::native -- --ignored --test-threads=1`.
#[cfg(all(test, target_os = "macos"))]
mod native {
    use super::*;

    const fn cc(s: &[u8; 4]) -> u32 {
        ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | s[3] as u32
    }
    const DLS: (u32, u32, u32) = (cc(b"aumu"), cc(b"dls "), cc(b"appl"));
    const DELAY: (u32, u32, u32) = (cc(b"aufx"), cc(b"dely"), cc(b"appl"));
    const LOWPASS: (u32, u32, u32) = (cc(b"aufx"), cc(b"lpas"), cc(b"appl"));
    const REVERB: (u32, u32, u32) = (cc(b"aufx"), cc(b"rvb2"), cc(b"appl"));

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    #[test]
    #[ignore]
    fn renders_apple_units_offline() {
        let _ = ffi::configure_offline(48000.0); // another test may have configured it
        // The unit list has Apple's built-ins.
        let units: serde_json::Value = serde_json::from_str(&ffi::list_units()).unwrap();
        let names: Vec<String> = units.as_array().unwrap().iter().map(|u| u["name"].as_str().unwrap_or("").to_string()).collect();
        assert!(names.iter().any(|n| n.contains("DLSMusicDevice")), "{names:?}");
        assert!(names.iter().any(|n| n.contains("AUDelay")), "{names:?}");

        ffi::rack_create("rk_test").unwrap();
        ffi::set_instrument("rk_test", Some(DLS)).unwrap();
        let mut out = vec![0.0f32; 4800];
        // Silence before any note.
        ffi::render_offline(&mut out).unwrap();
        assert!(rms(&out) < 1e-4, "silent before a note: {}", rms(&out));

        // A note: sound.
        ffi::midi("rk_test", 0x90, 69, 110).unwrap();
        let mut note = vec![0.0f32; 24000];
        assert_eq!(ffi::render_offline(&mut note).unwrap(), 24000);
        let loud = rms(&note);
        assert!(loud > 1e-3, "DLS makes sound: {loud}");

        // The tap saw it too, and the analyser finds A4 (440 Hz) near the top of its spectrum.
        let mut buf = vec![0.0f32; analysis::FFT_SIZE];
        let (have, total) = ffi::rack_read("rk_test", &mut buf);
        assert!(have > 0 && total > 0, "tap filled: {have} {total}");
        let mut a = analysis::Analyser::default();
        let db = a.spectrum_db(&buf);
        let bin_hz = 48000.0 / analysis::FFT_SIZE as f32;
        let peak = db.iter().enumerate().skip(2).max_by(|x, y| x.1.partial_cmp(y.1).unwrap()).unwrap().0;
        let peak_hz = peak as f32 * bin_hz;
        // The fundamental or a harmonic of 440.
        let harmonic = (peak_hz / 440.0).round();
        assert!(harmonic >= 1.0 && (peak_hz - harmonic * 440.0).abs() < 2.0 * bin_hz, "peak at {peak_hz} Hz");

        // Effects: a delay, a low-pass (with a parameter), a reverb; reorder, bypass, remove.
        ffi::effect_insert("rk_test", "fx_d", -1, DELAY).unwrap();
        ffi::effect_insert("rk_test", "fx_l", -1, LOWPASS).unwrap();
        ffi::effect_insert("rk_test", "fx_r", 0, REVERB).unwrap();
        let ps = params::parse_params(&ffi::params("rk_test", "fx_l").unwrap());
        assert!(!ps.is_empty());
        let cutoff = ps.iter().find(|p| p.unit == "Hz").expect("a Hz parameter");
        assert!(cutoff.log);
        let addr: u64 = cutoff.address.parse().unwrap();
        ffi::param_set("rk_test", "fx_l", addr, 200.0).unwrap();
        let after = params::parse_params(&ffi::params("rk_test", "fx_l").unwrap());
        assert!((after.iter().find(|p| p.address == cutoff.address).unwrap().value - 200.0).abs() < 1.0);
        // Configure's watch: the host's own sets aren't touches; stopping ends it.
        ffi::watch_start("rk_test", "fx_l").unwrap();
        ffi::param_set("rk_test", "fx_l", addr, 300.0).unwrap();
        let drained: Vec<touch::Batch> = serde_json::from_str(&ffi::watch_drain()).unwrap();
        assert_eq!(drained.len(), 1);
        assert!(!drained[0].gone && drained[0].changes.is_empty(), "{:?}", drained[0].changes);
        ffi::watch_stop("rk_test", "fx_l");
        assert_eq!(ffi::watch_drain(), "[]");
        assert!(ffi::watch_start("render:rk_test", "fx_l").is_err(), "renders are never watched");
        ffi::effect_move("rk_test", "fx_r", 2).unwrap();
        ffi::bypass("rk_test", "fx_d", true).unwrap();
        ffi::midi("rk_test", 0x90, 57, 120).unwrap();
        let mut chain = vec![0.0f32; 24000];
        ffi::render_offline(&mut chain).unwrap();
        assert!(rms(&chain) > 1e-4, "the chain passes sound: {}", rms(&chain));
        // The preset round-trips.
        let st = ffi::state_get("rk_test", "fx_l").unwrap().expect("a state");
        ffi::state_set("rk_test", "fx_l", &st).unwrap();
        ffi::effect_remove("rk_test", "fx_r").unwrap();

        // Notes off and the rack muted: silence.
        ffi::midi("rk_test", 0xb0, 123, 0).unwrap();
        ffi::rack_volume("rk_test", 1.0, true).unwrap();
        let mut tail = vec![0.0f32; 48000];
        ffi::render_offline(&mut tail).unwrap();
        assert!(rms(&tail[24000..]) < 1e-5, "muted: {}", rms(&tail[24000..]));

        // A missing unit is an error, not a crash.
        assert!(ffi::effect_insert("rk_test", "fx_x", -1, (cc(b"aufx"), cc(b"zzzz"), cc(b"zzzz"))).is_err());
        assert!(ffi::params("rk_test", "nope").is_err());

        // The sample player with a generated WAV: a zone pitched across the keys.
        let dir = std::env::temp_dir().join(format!("ae-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("tone.wav");
        write_wav(&wav, 44100, &(0..22050).map(|i| 0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 44100.0).sin()).collect::<Vec<_>>());
        ffi::rack_create("rk_s").unwrap();
        ffi::set_sampler("rk_s").unwrap();
        ffi::sampler_zone("rk_s", 0, wav.to_str().unwrap(), 0, 127, 69, 1.0).unwrap();
        ffi::midi("rk_s", 0x90, 81, 127).unwrap(); // an octave up: 880 Hz
        let mut s = vec![0.0f32; 9600];
        ffi::render_offline(&mut s).unwrap();
        assert!(rms(&s) > 1e-3, "sampler plays: {}", rms(&s));
        let (_, _) = ffi::rack_read("rk_s", &mut buf);
        let mut a2 = analysis::Analyser::default();
        let db = a2.spectrum_db(&buf);
        let peak = db.iter().enumerate().skip(2).max_by(|x, y| x.1.partial_cmp(y.1).unwrap()).unwrap().0 as f32 * bin_hz;
        assert!((peak - 880.0).abs() < 2.0 * bin_hz, "pitched up an octave: {peak} Hz");
        ffi::rack_remove("rk_s").unwrap();
        ffi::rack_remove("rk_test").unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A rack control moving a parameter reaches the plug-in's own window: AUDelay (an AUv2) hears it
    /// through AUEventListener (its Cocoa view's path) and the parameter tree's observers (an AUv3 view's).
    /// (A listener hears the v2 bridge's own notification too; that AUDelay's and Serum 2's views only
    /// *move* with ae_param_set's extra AUEventListenerNotify was checked on their real views, which need
    /// the main thread: see docs/audio-engine.md, Plug-in windows.)
    #[test]
    #[ignore]
    fn host_parameter_sets_reach_the_plugin_s_view() {
        let _ = ffi::configure_offline(48000.0);
        ffi::rack_create("rk_view").unwrap();
        ffi::set_instrument("rk_view", Some(DLS)).unwrap();
        ffi::effect_insert("rk_view", "fx_d", -1, DELAY).unwrap();
        let ps = params::parse_params(&ffi::params("rk_view", "fx_d").unwrap());
        let p = ps.iter().find(|p| p.max > p.min).expect("a parameter");
        let addr: u64 = p.address.parse().unwrap();
        let mid = (p.min + p.max) / 2.0;
        let (v2, tree) = ffi::test_param_heard("rk_view", "fx_d", addr, mid, 0.3).unwrap();
        println!("AUDelay {}: v2 listener heard {v2}, tree observers {tree}", p.name);
        assert!(v2 >= 1, "an AUv2 view's listener hears the host's set");
        assert!(tree >= 1, "the tree's observers hear it");
        // Configure's watch still doesn't count it as a touch.
        ffi::watch_start("rk_view", "fx_d").unwrap();
        let (v2w, treew) = ffi::test_param_heard("rk_view", "fx_d", addr, p.min, 0.3).unwrap();
        println!("while watched: v2 listener heard {v2w}, tree observers {treew}");
        assert!(v2w >= 1 && treew >= 1, "the window follows while Configure watches too");
        let drained: Vec<touch::Batch> = serde_json::from_str(&ffi::watch_drain()).unwrap();
        assert!(drained[0].changes.is_empty(), "{:?}", drained[0].changes);
        ffi::watch_stop("rk_view", "fx_d");
        ffi::rack_remove("rk_view").unwrap();
    }

    /// A take with two notes, rendered in the render context (DLSMusicDevice + AUDelay): energy lands at the notes' samples and not before.
    #[test]
    #[ignore]
    fn renders_a_take_s_notes_at_their_samples() {
        let _ = ffi::configure_offline(48000.0);
        let unit = |t: (u32, u32, u32)| UnitRef { kind: t.0, subtype: t.1, manufacturer: t.2 };
        let slot = |id: &str, u: (u32, u32, u32), name: &str| render::SlotSpec { id: id.into(), unit: Some(unit(u)), zones: None, bypass: false, state: None, params: Default::default(), name: name.into() };
        let job = render::RenderJob {
            sample_rate: 48000.0,
            seconds: 2.0,
            racks: vec![render::RackSpec {
                id: "rk_take".into(),
                name: "Rack".into(),
                instrument: Some(slot("inst", DLS, "DLS")),
                effects: vec![slot("fx_d", DELAY, "AUDelay")],
                volume: 1.0,
                mute: false,
                input: false,
            }],
            events: vec![
                render::NoteEvent { t: 0.5, rack: "rk_take".into(), bytes: vec![0x90, 60, 110] },
                render::NoteEvent { t: 0.9, rack: "rk_take".into(), bytes: vec![0x80, 60, 0] },
                render::NoteEvent { t: 1.25, rack: "rk_take".into(), bytes: vec![0x90, 72, 110] },
            ],
            params: vec![],
        };
        let (info, l, r) = render::run(&job, &|_| None, Default::default()).expect("render");
        assert_eq!(info.frames, 96000);
        assert_eq!(l.len(), 96000);
        assert!(info.notes.is_empty(), "{:?}", info.notes);
        let win = |from: usize, to: usize| rms(&l[from..to]).max(rms(&r[from..to]));
        // Silence before the first note; sound within a few ms after it.
        assert!(win(0, 23800) < 1e-5, "silent before the note: {}", win(0, 23800));
        assert!(win(24000, 24000 + 2400) > 1e-3, "sound right after the first note: {}", win(24000, 26400));
        // The second note, at 1.25 s: louder there than in the gap just before it (the first let go at 0.9 s, the delay's tail decaying).
        let before = win(60000 - 4800, 60000 - 200);
        let after = win(60000, 60000 + 4800);
        assert!(after > before * 1.5, "second note: before {before} after {after}");
        println!("two-note render: before-note rms {:.2e}, first note {:.3}, gap {before:.3}, second note {after:.3}; reported latency {:?}", win(0, 23800), win(24000, 26400), info.latency);
        // The render context closed: a second render opens fine.
        let again = render::run(&job, &|_| None, Default::default()).expect("render again");
        assert_eq!(again.1.len(), 96000);

        // An input rack: a sine fed as the source goes through AUDelay and comes out with energy from the first frames (no added latency).
        let sine: Vec<f32> = (0..48000).flat_map(|i| { let v = 0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48000.0).sin(); [v, v] }).collect();
        let mut inputs = std::collections::HashMap::new();
        inputs.insert("rk_in".to_string(), sine);
        let job2 = render::RenderJob {
            sample_rate: 48000.0,
            seconds: 1.0,
            racks: vec![render::RackSpec { id: "rk_in".into(), name: "Send".into(), instrument: None, effects: vec![slot("fx_d", DELAY, "AUDelay")], volume: 1.0, mute: false, input: true }],
            events: vec![],
            params: vec![],
        };
        let (info2, l2, _) = render::run(&job2, &|_| None, inputs).expect("input render");
        assert!(info2.notes.is_empty(), "{:?}", info2.notes);
        assert!(rms(&l2[0..512]) > 0.1, "the fed sound comes through from the start: {}", rms(&l2[0..512]));
        // A rack whose upload is missing is silent, with a note; a unit that isn't there is left out with a note.
        let job3 = render::RenderJob { racks: vec![render::RackSpec { id: "rk_in".into(), name: "Send".into(), instrument: None, effects: vec![], volume: 1.0, mute: false, input: true }], ..job2.clone() };
        assert!(render::run(&job3, &|_| None, Default::default()).is_err());
        let job4 = render::RenderJob { racks: vec![render::RackSpec { effects: vec![slot("fx_x", (cc(b"aufx"), cc(b"zzzz"), cc(b"zzzz")), "Nope")], ..job.racks[0].clone() }], ..job.clone() };
        let (info4, _, _) = render::run(&job4, &|_| None, Default::default()).expect("render without the missing unit");
        assert_eq!(info4.notes.len(), 1, "{:?}", info4.notes);
        assert!(info4.notes[0].contains("Nope"));
    }

    fn write_wav(path: &std::path::Path, rate: u32, samples: &[f32]) {
        let mut b = vec![];
        let data_len = (samples.len() * 2) as u32;
        b.extend_from_slice(b"RIFF");
        b.extend_from_slice(&(36 + data_len).to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&rate.to_le_bytes());
        b.extend_from_slice(&(rate * 2).to_le_bytes());
        b.extend_from_slice(&2u16.to_le_bytes());
        b.extend_from_slice(&16u16.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            b.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        }
        std::fs::write(path, b).unwrap();
    }
}
