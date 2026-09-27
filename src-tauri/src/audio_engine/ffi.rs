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
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
mod imp {
    const NO: &str = "The Audio engine hosts Audio Units on macOS only";
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
}

pub use imp::*;
