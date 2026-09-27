//! audio_engine — the desktop app's Audio engine: racks of Audio Units
//! (an instrument or the sample player, then effects) on AVAudioEngine,
//! played from MIDI and the computer keyboard, each rack's output analysed
//! for the page's audio readers. docs/audio-engine.md has the whole picture.
//!
//!   ffi.rs       the Objective-C half (native/audio_engine.m), as Result-returning calls
//!   analysis.rs  FFT → the spectrum frames the page reads (`audio-engine://frame`)
//!   params.rs    parameter descriptions, and the glide for mapped parameters
//!
//! Every command is async so it runs off the main thread: loading an AUv3
//! calls back on other threads, and plug-in windows are made on the main one.
//! A worker thread (started with the first rack) glides parameters every
//! 10 ms and sends a frame per sounding rack about 33 times a second.

pub mod analysis;
pub mod ffi;
pub mod params;

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

#[derive(Default)]
struct Inner {
    racks: HashMap<String, RackAnalysis>,
    smoother: params::Smoother,
}

#[derive(Default)]
pub struct EngineState {
    inner: Arc<Mutex<Inner>>,
    worker: Mutex<bool>,
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
    loop {
        std::thread::sleep(TICK);
        let now = Instant::now();
        let dt = now.duration_since(last).as_secs_f32();
        last = now;
        tick = tick.wrapping_add(1);
        let (moves, racks) = match inner.lock() {
            Ok(mut g) => (g.smoother.step(dt), if tick % FRAME_TICKS == 0 { g.racks.keys().cloned().collect::<Vec<_>>() } else { vec![] }),
            Err(_) => return,
        };
        for ((rack, slot, address), v) in moves {
            let _ = ffi::param_set(&rack, &slot, address, v);
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

// ── Commands ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct Status {
    /// Audio Units can be hosted here (macOS).
    available: bool,
    #[serde(rename = "sampleRate")]
    sample_rate: f64,
}

#[tauri::command]
pub async fn ae_status() -> Result<Status, String> {
    Ok(Status { available: ffi::AVAILABLE, sample_rate: if ffi::AVAILABLE { ffi::sample_rate() } else { 48000.0 } })
}

/// Every installed instrument and effect (read fresh each time, so it doubles as a rescan).
#[tauri::command]
pub async fn ae_units() -> Result<serde_json::Value, String> {
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
pub async fn ae_rack_remove(state: State<'_, EngineState>, rack: String) -> Result<(), String> {
    let rack = valid_id(&rack)?;
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
pub async fn ae_set_instrument(state: State<'_, EngineState>, rack: String, unit: Option<UnitRef>) -> Result<(), String> {
    let rack = valid_id(&rack)?;
    state.inner.lock().map_err(lock_err)?.smoother.forget(rack, Some("inst"));
    ffi::set_instrument(rack, unit.map(UnitRef::triple))
}

#[tauri::command]
pub async fn ae_set_sampler(state: State<'_, EngineState>, rack: String) -> Result<(), String> {
    let rack = valid_id(&rack)?;
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
pub async fn ae_effect_insert(rack: String, slot: String, index: i32, unit: UnitRef) -> Result<(), String> {
    ffi::effect_insert(valid_id(&rack)?, valid_id(&slot)?, index, unit.triple())
}

#[tauri::command]
pub async fn ae_effect_remove(state: State<'_, EngineState>, rack: String, slot: String) -> Result<(), String> {
    let (rack, slot) = (valid_id(&rack)?, valid_id(&slot)?);
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
pub async fn ae_state_set(rack: String, slot: String, state: String) -> Result<(), String> {
    ffi::state_set(valid_id(&rack)?, valid_id(&slot)?, &state)
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
pub async fn ae_open_ui(rack: String, slot: String, title: String) -> Result<(), String> {
    ffi::open_ui(valid_id(&rack)?, valid_id(&slot)?, &title)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        ffi::configure_offline(48000.0).expect("offline");
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
