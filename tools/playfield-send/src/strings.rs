//! The SDK's fixed-size C and UTF-16 strings.

use std::ffi::c_char;

use vst3::Steinberg::char16;
use vst3::Steinberg::Vst::TChar;

/// Copy into a C string field (cut to fit, always NUL-terminated).
pub fn copy_cstring(src: &str, dst: &mut [c_char]) {
    let Some(last) = dst.len().checked_sub(1) else { return };
    let mut n = 0;
    for (d, s) in dst[..last].iter_mut().zip(src.bytes()) {
        *d = s as c_char;
        n += 1;
    }
    for d in dst[n..].iter_mut() {
        *d = 0;
    }
}

/// Copy into a UTF-16 field (cut to fit, always NUL-terminated).
pub fn copy_wstring(src: &str, dst: &mut [TChar]) {
    let Some(last) = dst.len().checked_sub(1) else { return };
    let mut n = 0;
    for (d, s) in dst[..last].iter_mut().zip(src.encode_utf16()) {
        *d = s as TChar;
        n += 1;
    }
    for d in dst[n..].iter_mut() {
        *d = 0;
    }
}

/// Same for char16 fields (PClassInfoW).
pub fn copy_u16(src: &str, dst: &mut [char16]) {
    copy_wstring(src, dst)
}

/// Read a NUL-terminated UTF-16 string (at most 128 units, a String128).
///
/// # Safety
/// `p` must point at a NUL-terminated UTF-16 string or at least 128 readable units.
pub unsafe fn read_wstring(p: *const TChar) -> String {
    if p.is_null() {
        return String::new();
    }
    let mut units = Vec::with_capacity(16);
    for i in 0..128 {
        let u = *p.add(i);
        if u == 0 {
            break;
        }
        units.push(u as u16);
    }
    String::from_utf16_lossy(&units)
}
