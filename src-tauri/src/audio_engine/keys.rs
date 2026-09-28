//! keys.rs — computer-keyboard notes from a plug-in window (docs/audio-engine.md,
//! "Computer keyboard"). While a rack plays from the keyboard the page turns
//! forwarding on (`ae_keys_forward`); a key a plug-in window's view doesn't use
//! comes back from native/audio_engine.m as JSON and goes to the page as
//! `plugin-window:key`, which `src/lib/pluginWindowKeys.ts` hands to the same
//! handler as a DOM key event.

use std::ffi::CStr;
use std::os::raw::c_char;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::ffi;

pub const KEY_EVENT: &str = "plugin-window:key";

/// A key from a plug-in window, shaped like the DOM `KeyboardEvent` fields the page reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginKey {
    /// "down", "up", or "blur" (the window lost focus: let go of held notes).
    #[serde(rename = "type")]
    pub kind: String,
    /// `KeyboardEvent.code` ("KeyA", "ShiftLeft", "Escape"…); "" for blur.
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub meta: bool,
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub alt: bool,
    /// The plug-in window's "rack/slot".
    #[serde(default)]
    pub window: String,
}

/// The native side's JSON; None for anything else.
pub fn parse_key(json: &str) -> Option<PluginKey> {
    let k: PluginKey = serde_json::from_str(json).ok()?;
    matches!(k.kind.as_str(), "down" | "up" | "blur").then_some(k)
}

static APP: OnceLock<AppHandle> = OnceLock::new();

extern "C" fn on_key(json: *const c_char) {
    if json.is_null() {
        return;
    }
    let s = unsafe { CStr::from_ptr(json) }.to_string_lossy();
    if let (Some(k), Some(app)) = (parse_key(&s), APP.get()) {
        let _ = app.emit(KEY_EVENT, k);
    }
}

/// A rack has the computer keyboard (on) or not: keys plug-in windows pass on come to the page.
#[tauri::command]
pub async fn ae_keys_forward(app: AppHandle, on: bool) -> Result<(), String> {
    let _ = APP.set(app);
    ffi::keys_forward(on, on_key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_from_the_native_side_parse() {
        let k = parse_key(r#"{"type":"down","code":"KeyA","key":"a","repeat":false,"shift":true,"meta":false,"ctrl":false,"alt":false,"window":"rk_1/inst"}"#).unwrap();
        assert_eq!((k.kind.as_str(), k.code.as_str(), k.shift, k.window.as_str()), ("down", "KeyA", true, "rk_1/inst"));
        let b = parse_key(r#"{"type":"blur","code":"","key":"","repeat":false,"shift":false,"meta":false,"ctrl":false,"alt":false,"window":""}"#).unwrap();
        assert_eq!(b.kind, "blur");
        assert!(parse_key(r#"{"type":"press","code":"KeyA"}"#).is_none());
        assert!(parse_key("nope").is_none());
        // What the page receives keeps the native field names.
        let v = serde_json::to_value(&k).unwrap();
        assert_eq!(v["type"], "down");
        assert_eq!(v["code"], "KeyA");
    }

    /// The native key-code table matches the page's positional codes for the keys that play.
    #[cfg(target_os = "macos")]
    #[test]
    fn mac_key_codes_are_dom_codes() {
        let want: &[(u16, &str)] = &[
            (0, "KeyA"), (13, "KeyW"), (1, "KeyS"), (14, "KeyE"), (2, "KeyD"), (3, "KeyF"), (17, "KeyT"), (5, "KeyG"),
            (16, "KeyY"), (4, "KeyH"), (32, "KeyU"), (38, "KeyJ"), (40, "KeyK"), (31, "KeyO"), (37, "KeyL"), (35, "KeyP"),
            (41, "Semicolon"), (39, "Quote"), (6, "KeyZ"), (7, "KeyX"), (8, "KeyC"), (9, "KeyV"), (49, "Space"), (53, "Escape"),
        ];
        for (code, name) in want {
            assert_eq!(ffi::key_code_name(*code), *name, "key code {code}");
        }
        // Tab (48) and Return (36) are never forwarded.
        assert_eq!(ffi::key_code_name(48), "");
        assert_eq!(ffi::key_code_name(36), "");
    }
}
