//! ffi.rs — the Objective-C half of the Audio engine (native/audio_engine.m),
//! wrapped so the rest of Rust sees `Result<_, String>`. Off macOS every call
//! says the engine is macOS-only.

#[cfg(target_os = "macos")]
mod sys {
    use std::os::raw::{c_char, c_int};
    extern "C" {
        pub fn ae_free(p: *mut c_char);
        #[allow(dead_code)] // tests
        pub fn ae_configure_offline(rate: f64) -> c_int;
        pub fn ae_sample_rate() -> f64;
        pub fn ae_list_units() -> *mut c_char;
        pub fn ae_rack_create(rack: *const c_char, err: *mut *mut c_char) -> c_int;
        pub fn ae_rack_remove(rack: *const c_char, err: *mut *mut c_char) -> c_int;
        pub fn ae_rack_volume(rack: *const c_char, volume: f32, mute: c_int, err: *mut *mut c_char) -> c_int;
        pub fn ae_rack_set_instrument(rack: *const c_char, t: u32, s: u32, m: u32, err: *mut *mut c_char) -> c_int;
        pub fn ae_rack_set_sampler(rack: *const c_char, err: *mut *mut c_char) -> c_int;
        pub fn ae_sampler_zone(rack: *const c_char, index: c_int, path: *const c_char, lo: c_int, hi: c_int, root: c_int, gain: f32, err: *mut *mut c_char) -> c_int;
        pub fn ae_effect_insert(rack: *const c_char, slot: *const c_char, index: c_int, t: u32, s: u32, m: u32, err: *mut *mut c_char) -> c_int;
        pub fn ae_effect_remove(rack: *const c_char, slot: *const c_char, err: *mut *mut c_char) -> c_int;
        pub fn ae_effect_move(rack: *const c_char, slot: *const c_char, index: c_int, err: *mut *mut c_char) -> c_int;
        pub fn ae_slot_bypass(rack: *const c_char, slot: *const c_char, bypass: c_int, err: *mut *mut c_char) -> c_int;
        pub fn ae_params(rack: *const c_char, slot: *const c_char, err: *mut *mut c_char) -> *mut c_char;
        pub fn ae_param_set(rack: *const c_char, slot: *const c_char, address: u64, value: f32, err: *mut *mut c_char) -> c_int;
        pub fn ae_state_get(rack: *const c_char, slot: *const c_char, err: *mut *mut c_char) -> *mut c_char;
        pub fn ae_state_set(rack: *const c_char, slot: *const c_char, b64: *const c_char, err: *mut *mut c_char) -> c_int;
        pub fn ae_midi(rack: *const c_char, status: u8, d1: u8, d2: u8, err: *mut *mut c_char) -> c_int;
        pub fn ae_rack_read(rack: *const c_char, out: *mut f32, n: c_int, total: *mut u64) -> c_int;
        pub fn ae_master(volume: f32, mute: c_int) -> c_int;
        pub fn ae_outputs() -> *mut c_char;
        pub fn ae_set_output(device: u32, err: *mut *mut c_char) -> c_int;
        #[allow(dead_code)] // tests
        pub fn ae_render_offline(out: *mut f32, frames: c_int, err: *mut *mut c_char) -> c_int;
        pub fn ae_open_ui(rack: *const c_char, slot: *const c_char, title: *const c_char, err: *mut *mut c_char) -> c_int;
        pub fn ae_watch_start(rack: *const c_char, slot: *const c_char, err: *mut *mut c_char) -> c_int;
        pub fn ae_watch_stop(rack: *const c_char, slot: *const c_char) -> c_int;
        pub fn ae_watch_drain() -> *mut c_char;
        pub fn ae_rack_set_input(rack: *const c_char, capacity: u32, err: *mut *mut c_char) -> c_int;
        pub fn ae_rack_feed(rack: *const c_char, pcm: *const f32, frames: u32, err: *mut *mut c_char) -> i64;
        pub fn ae_rack_input_stats(rack: *const c_char, queued: *mut u64, underruns: *mut u64) -> c_int;
        pub fn ae_rack_latency(rack: *const c_char) -> f64;
        pub fn ae_render_open(rate: f64, err: *mut *mut c_char) -> c_int;
        pub fn ae_render_close() -> c_int;
        pub fn ae_render_stereo(left: *mut f32, right: *mut f32, frames: c_int, err: *mut *mut c_char) -> c_int;
        pub fn ae_tap_start(err: *mut *mut c_char) -> u64;
        pub fn ae_tap_read(out: *mut f32, max: c_int, from: *mut u64, written: *mut u64) -> c_int;
        pub fn ae_tap_info(rate: *mut f64, install_ns: *mut u64, first_ns: *mut u64) -> c_int;
        pub fn ae_tap_stop() -> c_int;
        // Loading plug-ins safely (safety.rs).
        pub fn ae_nan_flushes() -> u64;
        pub fn ae_last_load_in_process() -> c_int;
        pub fn ae_probe_prepare();
        pub fn ae_pump_main(seconds: f64);
        // Plug-in windows' placement and memory (pure helpers; the tests below).
        #[allow(dead_code)]
        pub fn ae_win_place(want: *const f64, axes: c_int, limits: *const f64, saved: *const f64, screen: *const f64, out: *mut f64) -> c_int;
        #[allow(dead_code)]
        pub fn ae_win_key(t: u32, s: u32, m: u32) -> *mut c_char;
        #[allow(dead_code)]
        pub fn ae_win_store(suite: *const c_char, key: *const c_char, rect: *const f64) -> c_int;
        #[allow(dead_code)]
        pub fn ae_win_recall(suite: *const c_char, key: *const c_char, out: *mut f64) -> c_int;
    }
}

pub const AVAILABLE: bool = cfg!(target_os = "macos");

#[cfg(target_os = "macos")]
mod imp {
    use super::sys;
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int};
    use std::ptr;

    fn cstr(s: &str) -> CString {
        CString::new(s.replace('\0', "")).unwrap_or_default()
    }

    /// A string the native side malloc'd, taken and freed.
    unsafe fn take(p: *mut c_char) -> Option<String> {
        if p.is_null() {
            return None;
        }
        let s = CStr::from_ptr(p).to_string_lossy().into_owned();
        sys::ae_free(p);
        Some(s)
    }

    fn check(code: c_int, err: *mut c_char, what: &str) -> Result<(), String> {
        let msg = unsafe { take(err) };
        if code >= 0 {
            Ok(())
        } else {
            Err(msg.unwrap_or_else(|| format!("{what} failed ({code})")))
        }
    }

    #[allow(dead_code)] // tests: an engine with no device
    pub fn configure_offline(rate: f64) -> Result<(), String> {
        if unsafe { sys::ae_configure_offline(rate) } == 0 { Ok(()) } else { Err("The engine is already running".into()) }
    }
    pub fn sample_rate() -> f64 { unsafe { sys::ae_sample_rate() } }
    pub fn list_units() -> String { unsafe { take(sys::ae_list_units()) }.unwrap_or_else(|| "[]".into()) }
    pub fn outputs() -> String { unsafe { take(sys::ae_outputs()) }.unwrap_or_else(|| "[]".into()) }

    pub fn rack_create(rack: &str) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let r = cstr(rack);
        check(unsafe { sys::ae_rack_create(r.as_ptr(), &mut e) }, e, "Making the rack")
    }
    pub fn rack_remove(rack: &str) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let r = cstr(rack);
        check(unsafe { sys::ae_rack_remove(r.as_ptr(), &mut e) }, e, "Removing the rack")
    }
    pub fn rack_volume(rack: &str, volume: f32, mute: bool) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let r = cstr(rack);
        check(unsafe { sys::ae_rack_volume(r.as_ptr(), volume, mute as c_int, &mut e) }, e, "Setting the volume")
    }
    pub fn set_instrument(rack: &str, unit: Option<(u32, u32, u32)>) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let r = cstr(rack);
        let (t, s, m) = unit.unwrap_or((0, 0, 0));
        check(unsafe { sys::ae_rack_set_instrument(r.as_ptr(), t, s, m, &mut e) }, e, "Loading the instrument")
    }
    pub fn set_sampler(rack: &str) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let r = cstr(rack);
        check(unsafe { sys::ae_rack_set_sampler(r.as_ptr(), &mut e) }, e, "Making the sample player")
    }
    #[allow(clippy::too_many_arguments)]
    pub fn sampler_zone(rack: &str, index: i32, path: &str, lo: i32, hi: i32, root: i32, gain: f32) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let (r, p) = (cstr(rack), cstr(path));
        check(unsafe { sys::ae_sampler_zone(r.as_ptr(), index, p.as_ptr(), lo, hi, root, gain, &mut e) }, e, "Loading the sound")
    }
    pub fn effect_insert(rack: &str, slot: &str, index: i32, unit: (u32, u32, u32)) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let (r, s) = (cstr(rack), cstr(slot));
        check(unsafe { sys::ae_effect_insert(r.as_ptr(), s.as_ptr(), index, unit.0, unit.1, unit.2, &mut e) }, e, "Loading the effect")
    }
    pub fn effect_remove(rack: &str, slot: &str) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let (r, s) = (cstr(rack), cstr(slot));
        check(unsafe { sys::ae_effect_remove(r.as_ptr(), s.as_ptr(), &mut e) }, e, "Removing the effect")
    }
    pub fn effect_move(rack: &str, slot: &str, index: i32) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let (r, s) = (cstr(rack), cstr(slot));
        check(unsafe { sys::ae_effect_move(r.as_ptr(), s.as_ptr(), index, &mut e) }, e, "Moving the effect")
    }
    pub fn bypass(rack: &str, slot: &str, on: bool) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let (r, s) = (cstr(rack), cstr(slot));
        check(unsafe { sys::ae_slot_bypass(r.as_ptr(), s.as_ptr(), on as c_int, &mut e) }, e, "Bypassing the effect")
    }
    pub fn params(rack: &str, slot: &str) -> Result<String, String> {
        let mut e = ptr::null_mut();
        let (r, s) = (cstr(rack), cstr(slot));
        let out = unsafe { take(sys::ae_params(r.as_ptr(), s.as_ptr(), &mut e)) };
        let err = unsafe { take(e) };
        out.ok_or_else(|| err.unwrap_or_else(|| "No parameters".into()))
    }
    pub fn param_set(rack: &str, slot: &str, address: u64, value: f32) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let (r, s) = (cstr(rack), cstr(slot));
        check(unsafe { sys::ae_param_set(r.as_ptr(), s.as_ptr(), address, value, &mut e) }, e, "Setting the parameter")
    }
    pub fn state_get(rack: &str, slot: &str) -> Result<Option<String>, String> {
        let mut e = ptr::null_mut();
        let (r, s) = (cstr(rack), cstr(slot));
        let out = unsafe { take(sys::ae_state_get(r.as_ptr(), s.as_ptr(), &mut e)) };
        match unsafe { take(e) } {
            Some(err) => Err(err),
            None => Ok(out),
        }
    }
    pub fn state_set(rack: &str, slot: &str, b64: &str) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let (r, s, b) = (cstr(rack), cstr(slot), cstr(b64));
        check(unsafe { sys::ae_state_set(r.as_ptr(), s.as_ptr(), b.as_ptr(), &mut e) }, e, "Restoring the preset")
    }
    pub fn midi(rack: &str, status: u8, d1: u8, d2: u8) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let r = cstr(rack);
        check(unsafe { sys::ae_midi(r.as_ptr(), status, d1, d2, &mut e) }, e, "Sending MIDI")
    }
    /// The newest `out.len()` samples (oldest first), how many were real, and the running total.
    pub fn rack_read(rack: &str, out: &mut [f32]) -> (usize, u64) {
        let r = cstr(rack);
        let mut total = 0u64;
        let n = unsafe { sys::ae_rack_read(r.as_ptr(), out.as_mut_ptr(), out.len() as c_int, &mut total) };
        (n.max(0) as usize, total)
    }
    pub fn master(volume: f32, mute: bool) { unsafe { sys::ae_master(volume, mute as c_int) }; }
    pub fn set_output(device: u32) -> Result<(), String> {
        let mut e = ptr::null_mut();
        check(unsafe { sys::ae_set_output(device, &mut e) }, e, "Switching the output")
    }
    #[allow(dead_code)] // tests
    pub fn render_offline(out: &mut [f32]) -> Result<usize, String> {
        let mut e = ptr::null_mut();
        let n = unsafe { sys::ae_render_offline(out.as_mut_ptr(), out.len() as c_int, &mut e) };
        let err = unsafe { take(e) };
        if n < 0 { Err(err.unwrap_or_else(|| "Render failed".into())) } else { Ok(n as usize) }
    }
    pub fn open_ui(rack: &str, slot: &str, title: &str) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let (r, s, t) = (cstr(rack), cstr(slot), cstr(title));
        check(unsafe { sys::ae_open_ui(r.as_ptr(), s.as_ptr(), t.as_ptr(), &mut e) }, e, "Opening the plug-in window")
    }
    /// Watch a slot's parameters for touches (Configure; touch.rs).
    pub fn watch_start(rack: &str, slot: &str) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let (r, s) = (cstr(rack), cstr(slot));
        check(unsafe { sys::ae_watch_start(r.as_ptr(), s.as_ptr(), &mut e) }, e, "Watching the plug-in")
    }
    pub fn watch_stop(rack: &str, slot: &str) {
        let (r, s) = (cstr(rack), cstr(slot));
        unsafe { sys::ae_watch_stop(r.as_ptr(), s.as_ptr()) };
    }
    /// JSON: every watched slot's changes and window activity since the last drain.
    pub fn watch_drain() -> String {
        unsafe { take(sys::ae_watch_drain()) }.unwrap_or_else(|| "[]".into())
    }

    // ── Inputs fed from the page ────────────────────────────────────────────
    /// The rack's source becomes an input the page feeds, with `capacity` frames of buffer.
    pub fn set_input(rack: &str, capacity: u32) -> Result<(), String> {
        let mut e = ptr::null_mut();
        let r = cstr(rack);
        check(unsafe { sys::ae_rack_set_input(r.as_ptr(), capacity, &mut e) }, e, "Making the input")
    }
    /// Interleaved stereo frames for the rack's input; how many are queued after.
    pub fn feed(rack: &str, pcm: &[f32]) -> Result<u64, String> {
        let mut e = ptr::null_mut();
        let r = cstr(rack);
        let n = unsafe { sys::ae_rack_feed(r.as_ptr(), pcm.as_ptr(), (pcm.len() / 2) as u32, &mut e) };
        let err = unsafe { take(e) };
        if n < 0 { Err(err.unwrap_or_else(|| "Feeding the input failed".into())) } else { Ok(n as u64) }
    }
    /// (frames queued, render cycles that ran dry) of a rack's input.
    pub fn input_stats(rack: &str) -> Option<(u64, u64)> {
        let r = cstr(rack);
        let (mut q, mut u) = (0u64, 0u64);
        (unsafe { sys::ae_rack_input_stats(r.as_ptr(), &mut q, &mut u) } == 0).then_some((q, u))
    }
    /// Seconds of latency the rack's units report.
    pub fn rack_latency(rack: &str) -> f64 {
        let r = cstr(rack);
        unsafe { sys::ae_rack_latency(r.as_ptr()) }
    }

    // ── Offline rendering (racks named "render:…") ─────────────────────────
    pub fn render_open(rate: f64) -> Result<(), String> {
        let mut e = ptr::null_mut();
        check(unsafe { sys::ae_render_open(rate, &mut e) }, e, "Opening the render")
    }
    pub fn render_close() { unsafe { sys::ae_render_close() }; }
    /// Render `left.len()` frames of the offline engine into both channels; how many were rendered.
    pub fn render_stereo(left: &mut [f32], right: &mut [f32]) -> Result<usize, String> {
        let n = left.len().min(right.len());
        let mut e = ptr::null_mut();
        let got = unsafe { sys::ae_render_stereo(left.as_mut_ptr(), right.as_mut_ptr(), n as c_int, &mut e) };
        let err = unsafe { take(e) };
        if got < 0 { Err(err.unwrap_or_else(|| "Render failed".into())) } else { Ok(got as usize) }
    }

    // ── The main-mixer tap ─────────────────────────────────────────────────
    /// Start the tap; the install time (mach ns).
    pub fn tap_start() -> Result<u64, String> {
        let mut e = ptr::null_mut();
        let at = unsafe { sys::ae_tap_start(&mut e) };
        let err = unsafe { take(e) };
        match err {
            Some(m) => Err(m),
            None => Ok(at),
        }
    }
    /// Drain up to `out.len() / 2` frames: (frames, frame count of the first, frames written so far).
    pub fn tap_read(out: &mut [f32]) -> (usize, u64, u64) {
        let (mut from, mut written) = (0u64, 0u64);
        let n = unsafe { sys::ae_tap_read(out.as_mut_ptr(), (out.len() / 2) as c_int, &mut from, &mut written) };
        (n.max(0) as usize, from, written)
    }
    /// (sample rate, install ns, first buffer ns) while the tap is on.
    pub fn tap_info() -> Option<(f64, u64, u64)> {
        let (mut rate, mut a, mut b) = (0f64, 0u64, 0u64);
        (unsafe { sys::ae_tap_info(&mut rate, &mut a, &mut b) } == 0).then_some((rate, a, b))
    }
    pub fn tap_stop() { unsafe { sys::ae_tap_stop() }; }
    /// Buffers a unit made that weren't finite (NaN, ±inf), flushed to silence, since launch.
    pub fn nan_flushes() -> u64 { unsafe { sys::ae_nan_flushes() } }
    /// Whether the last unit loaded ended up in the app's own process (None before any).
    pub fn last_load_in_process() -> Option<bool> {
        match unsafe { sys::ae_last_load_in_process() } { 0 => Some(false), 1 => Some(true), _ => None }
    }
    /// The trial-load process: an AppKit app that never shows in the Dock.
    pub fn probe_prepare() { unsafe { sys::ae_probe_prepare() } }
    /// Run the main thread's run loop for a while (a plug-in loading elsewhere may dispatch to it).
    pub fn pump_main(seconds: f64) { unsafe { sys::ae_pump_main(seconds) } }
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
mod imp {
    const NO: &str = "The Audio engine hosts Audio Units on macOS only";
    pub fn nan_flushes() -> u64 { 0 }
    pub fn last_load_in_process() -> Option<bool> { None }
    pub fn probe_prepare() {}
    pub fn pump_main(seconds: f64) { std::thread::sleep(std::time::Duration::from_secs_f64(seconds)) }
    pub fn configure_offline(_: f64) -> Result<(), String> { Err(NO.into()) }
    pub fn sample_rate() -> f64 { 48000.0 }
    pub fn list_units() -> String { "[]".into() }
    pub fn outputs() -> String { "[]".into() }
    pub fn rack_create(_: &str) -> Result<(), String> { Err(NO.into()) }
    pub fn rack_remove(_: &str) -> Result<(), String> { Ok(()) }
    pub fn rack_volume(_: &str, _: f32, _: bool) -> Result<(), String> { Err(NO.into()) }
    pub fn set_instrument(_: &str, _: Option<(u32, u32, u32)>) -> Result<(), String> { Err(NO.into()) }
    pub fn set_sampler(_: &str) -> Result<(), String> { Err(NO.into()) }
    pub fn sampler_zone(_: &str, _: i32, _: &str, _: i32, _: i32, _: i32, _: f32) -> Result<(), String> { Err(NO.into()) }
    pub fn effect_insert(_: &str, _: &str, _: i32, _: (u32, u32, u32)) -> Result<(), String> { Err(NO.into()) }
    pub fn effect_remove(_: &str, _: &str) -> Result<(), String> { Err(NO.into()) }
    pub fn effect_move(_: &str, _: &str, _: i32) -> Result<(), String> { Err(NO.into()) }
    pub fn bypass(_: &str, _: &str, _: bool) -> Result<(), String> { Err(NO.into()) }
    pub fn params(_: &str, _: &str) -> Result<String, String> { Err(NO.into()) }
    pub fn param_set(_: &str, _: &str, _: u64, _: f32) -> Result<(), String> { Err(NO.into()) }
    pub fn state_get(_: &str, _: &str) -> Result<Option<String>, String> { Err(NO.into()) }
    pub fn state_set(_: &str, _: &str, _: &str) -> Result<(), String> { Err(NO.into()) }
    pub fn midi(_: &str, _: u8, _: u8, _: u8) -> Result<(), String> { Err(NO.into()) }
    pub fn rack_read(_: &str, out: &mut [f32]) -> (usize, u64) { out.fill(0.0); (0, 0) }
    pub fn master(_: f32, _: bool) {}
    pub fn set_output(_: u32) -> Result<(), String> { Err(NO.into()) }
    pub fn render_offline(_: &mut [f32]) -> Result<usize, String> { Err(NO.into()) }
    pub fn open_ui(_: &str, _: &str, _: &str) -> Result<(), String> { Err(NO.into()) }
    pub fn watch_start(_: &str, _: &str) -> Result<(), String> { Err(NO.into()) }
    pub fn watch_stop(_: &str, _: &str) {}
    pub fn watch_drain() -> String { "[]".into() }
    pub fn set_input(_: &str, _: u32) -> Result<(), String> { Err(NO.into()) }
    pub fn feed(_: &str, _: &[f32]) -> Result<u64, String> { Err(NO.into()) }
    pub fn input_stats(_: &str) -> Option<(u64, u64)> { None }
    pub fn rack_latency(_: &str) -> f64 { 0.0 }
    pub fn render_open(_: f64) -> Result<(), String> { Err(NO.into()) }
    pub fn render_close() {}
    pub fn render_stereo(_: &mut [f32], _: &mut [f32]) -> Result<usize, String> { Err(NO.into()) }
    pub fn tap_start() -> Result<u64, String> { Err(NO.into()) }
    pub fn tap_read(_: &mut [f32]) -> (usize, u64, u64) { (0, 0, 0) }
    pub fn tap_info() -> Option<(f64, u64, u64)> { None }
    pub fn tap_stop() {}
}

pub use imp::*;

/// Plug-in windows: where one goes (sized to the plug-in, clamped to the screen, a
/// remembered frame restored) and the per-plug-in memory, in a throwaway defaults suite.
#[cfg(all(test, target_os = "macos"))]
mod window_tests {
    use super::sys;
    use std::ffi::{CStr, CString};
    use std::ptr;

    const SCREEN: [f64; 4] = [0.0, 25.0, 1440.0, 875.0]; // a visible frame below the menu bar

    fn place(want: [f64; 2], axes: i32, limits: Option<[f64; 4]>, saved: Option<[f64; 4]>) -> ([f64; 4], i32) {
        let mut out = [0.0; 4];
        let l = limits.as_ref().map_or(ptr::null(), |l| l.as_ptr());
        let s = saved.as_ref().map_or(ptr::null(), |s| s.as_ptr());
        let used = unsafe { sys::ae_win_place(want.as_ptr(), axes, l, s, SCREEN.as_ptr(), out.as_mut_ptr()) };
        (out, used)
    }

    #[test]
    fn a_new_window_is_the_plugin_s_size_centred() {
        let (r, used) = place([600.0, 428.0], 0, None, None);
        assert_eq!(used, 0);
        assert_eq!(r, [420.0, 249.0, 600.0, 428.0]);
    }

    #[test]
    fn a_window_is_never_bigger_than_the_screen_nor_off_it() {
        let (r, _) = place([3000.0, 2000.0], 0, None, None);
        assert_eq!(r, SCREEN);
        // A saved frame off the right and bottom edges comes back on screen.
        let (r, used) = place([400.0, 300.0], 0, None, Some([1300.0, -200.0, 400.0, 300.0]));
        assert_eq!(used, 1);
        assert_eq!(r, [1040.0, 25.0, 400.0, 300.0]);
    }

    #[test]
    fn a_fixed_plugin_keeps_its_size_but_its_remembered_place() {
        let (r, used) = place([400.0, 300.0], 0, None, Some([100.0, 200.0, 900.0, 700.0]));
        assert_eq!(used, 1);
        // The saved top-left (y + h = 900) is kept; the size is the plug-in's.
        assert_eq!(r, [100.0, 600.0, 400.0, 300.0]);
    }

    #[test]
    fn a_resizable_plugin_gets_its_remembered_size_within_its_limits() {
        let (r, _) = place([400.0, 300.0], 3, Some([200.0, 150.0, 0.0, 0.0]), Some([100.0, 200.0, 900.0, 700.0]));
        assert_eq!(r, [100.0, 200.0, 900.0, 700.0]);
        // Under its minimum: the minimum; over a maximum: the maximum.
        let (r, _) = place([400.0, 300.0], 3, Some([200.0, 150.0, 0.0, 0.0]), Some([100.0, 200.0, 50.0, 40.0]));
        assert_eq!((r[2], r[3]), (200.0, 150.0));
        let (r, _) = place([400.0, 300.0], 3, Some([200.0, 150.0, 640.0, 480.0]), Some([100.0, 200.0, 900.0, 700.0]));
        assert_eq!((r[2], r[3]), (640.0, 480.0));
        // No saved frame: the plug-in's size.
        let (r, used) = place([400.0, 300.0], 3, Some([200.0, 150.0, 0.0, 0.0]), None);
        assert_eq!((used, r[2], r[3]), (0, 400.0, 300.0));
    }

    #[test]
    fn a_plugin_that_stretches_one_way_keeps_its_size_the_other() {
        // Width only (1): the saved width, the plug-in's height (top-left kept).
        let (r, _) = place([400.0, 300.0], 1, Some([200.0, 150.0, 0.0, 0.0]), Some([100.0, 200.0, 900.0, 700.0]));
        assert_eq!(r, [100.0, 600.0, 900.0, 300.0]);
        // Height only (2).
        let (r, _) = place([400.0, 300.0], 2, Some([200.0, 150.0, 0.0, 0.0]), Some([100.0, 200.0, 900.0, 700.0]));
        assert_eq!(r, [100.0, 200.0, 400.0, 700.0]);
    }

    #[test]
    fn a_nonsense_saved_frame_is_ignored() {
        let (r, used) = place([400.0, 300.0], 3, None, Some([f64::NAN, 0.0, 400.0, 300.0]));
        assert_eq!(used, 0);
        assert_eq!(r, [520.0, 313.0, 400.0, 300.0]);
        let (_, used) = place([400.0, 300.0], 3, None, Some([10.0, 10.0, 0.0, 300.0]));
        assert_eq!(used, 0);
    }

    fn key(t: &[u8; 4], s: &[u8; 4], m: &[u8; 4]) -> String {
        let cc = |b: &[u8; 4]| u32::from_be_bytes(*b);
        unsafe {
            let p = sys::ae_win_key(cc(t), cc(s), cc(m));
            let k = CStr::from_ptr(p).to_string_lossy().into_owned();
            sys::ae_free(p);
            k
        }
    }

    #[test]
    fn plugins_are_keyed_by_component_description() {
        assert_eq!(key(b"aufx", b"dely", b"appl"), "aufx/dely/appl");
        assert_eq!(key(b"aumu", b"dls ", b"appl"), "aumu/dls /appl");
        assert_eq!(key(b"aufx", &[0, 1, 2, 3], b"appl"), "aufx/00010203/appl");
    }

    #[test]
    fn frames_are_remembered_per_plugin_and_forgotten() {
        let suite = CString::new(format!("com.playfield.tests.plugin-windows.{}", std::process::id())).unwrap();
        let a = CString::new("aufx/dely/appl").unwrap();
        let b = CString::new("aufx/rvb2/appl").unwrap();
        let mut out = [0.0; 4];
        unsafe {
            assert_eq!(sys::ae_win_recall(suite.as_ptr(), a.as_ptr(), out.as_mut_ptr()), 0);
            let fa = [10.0, 20.0, 640.0, 480.0];
            let fb = [300.0, 400.0, 500.0, 350.0];
            assert_eq!(sys::ae_win_store(suite.as_ptr(), a.as_ptr(), fa.as_ptr()), 0);
            assert_eq!(sys::ae_win_store(suite.as_ptr(), b.as_ptr(), fb.as_ptr()), 0);
            assert_eq!(sys::ae_win_recall(suite.as_ptr(), a.as_ptr(), out.as_mut_ptr()), 1);
            assert_eq!(out, fa);
            assert_eq!(sys::ae_win_recall(suite.as_ptr(), b.as_ptr(), out.as_mut_ptr()), 1);
            assert_eq!(out, fb);
            assert_eq!(sys::ae_win_store(suite.as_ptr(), a.as_ptr(), ptr::null()), 0);
            assert_eq!(sys::ae_win_recall(suite.as_ptr(), a.as_ptr(), out.as_mut_ptr()), 0);
            assert_eq!(sys::ae_win_store(suite.as_ptr(), b.as_ptr(), ptr::null()), 0);
        }
    }
}
