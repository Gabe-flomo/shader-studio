//! Playfield Send: a pass-through VST3 that streams a Live track's audio to the Playfield desktop
//! app on the same Mac (docs/playfield-send-plan.md). Hand-written on the `vst3` crate (MIT/Apache,
//! bindings to the MIT-licensed VST 3.8 SDK).
//!
//! - plugin.rs: the component (pass-through, the ring writer, the Pairing ID, the state).
//! - shared.rs: what the audio thread, the main thread, the window and the announce thread share.
//! - announce.rs: the hello a second to 127.0.0.1:11102.
//! - pairing.rs: unique IDs within Live's process.
//! - view.rs: the status window (macOS).
//! - This file: the factory and the module's entry points.

#![allow(non_snake_case)]

use std::ffi::c_void;

use vst3::Steinberg::Vst::SDKVersionString;
use vst3::Steinberg::*;
use vst3::{Class, ComWrapper};

pub mod announce;
pub mod pairing;
pub mod plugin;
pub mod shared;
pub mod strings;
pub mod view;

use plugin::PlayfieldSend;
use strings::{copy_cstring, copy_u16};

pub const PLUGIN_NAME: &str = "Playfield Send";
pub const VENDOR: &str = "Playfield";
pub const VENDOR_URL: &str = "https://playfield.example";
/// Live sorts it under Audio Effects (Fx) and shows it as a utility (Tools).
pub const SUB_CATEGORIES: &str = "Fx|Tools";

struct Factory;

impl Class for Factory {
    type Interfaces = (IPluginFactory3,);
}

fn sdk_version() -> String {
    // The crate's own constant ("VST 3.8.x"), as a Rust string.
    let out = unsafe { std::ffi::CStr::from_ptr(SDKVersionString) }.to_string_lossy().into_owned();
    if out.is_empty() { "VST 3.8.0".into() } else { out }
}

impl IPluginFactoryTrait for Factory {
    unsafe fn getFactoryInfo(&self, info: *mut PFactoryInfo) -> tresult {
        let Some(info) = info.as_mut() else { return kInvalidArgument };
        copy_cstring(VENDOR, &mut info.vendor);
        copy_cstring(VENDOR_URL, &mut info.url);
        copy_cstring("", &mut info.email);
        info.flags = PFactoryInfo_::FactoryFlags_::kUnicode as int32;
        kResultOk
    }

    unsafe fn countClasses(&self) -> i32 {
        1
    }

    unsafe fn getClassInfo(&self, index: i32, info: *mut PClassInfo) -> tresult {
        let Some(info) = info.as_mut() else { return kInvalidArgument };
        if index != 0 {
            return kInvalidArgument;
        }
        info.cid = PlayfieldSend::CID;
        info.cardinality = PClassInfo_::ClassCardinality_::kManyInstances as int32;
        copy_cstring("Audio Module Class", &mut info.category);
        copy_cstring(PLUGIN_NAME, &mut info.name);
        kResultOk
    }

    unsafe fn createInstance(&self, cid: FIDString, iid: FIDString, obj: *mut *mut c_void) -> tresult {
        if obj.is_null() {
            return kInvalidArgument;
        }
        *obj = std::ptr::null_mut();
        if cid.is_null() || iid.is_null() || *(cid as *const TUID) != PlayfieldSend::CID {
            return kInvalidArgument;
        }
        let Some(instance) = ComWrapper::new(PlayfieldSend::new()).to_com_ptr::<FUnknown>() else { return kResultFalse };
        let ptr = instance.as_ptr();
        ((*(*ptr).vtbl).queryInterface)(ptr, iid as *mut TUID, obj)
    }
}

impl IPluginFactory2Trait for Factory {
    unsafe fn getClassInfo2(&self, index: i32, info: *mut PClassInfo2) -> tresult {
        let Some(info) = info.as_mut() else { return kInvalidArgument };
        if index != 0 {
            return kInvalidArgument;
        }
        info.cid = PlayfieldSend::CID;
        info.cardinality = PClassInfo_::ClassCardinality_::kManyInstances as int32;
        copy_cstring("Audio Module Class", &mut info.category);
        copy_cstring(PLUGIN_NAME, &mut info.name);
        // Not kDistributable: the component and the controller are one object.
        info.classFlags = 0;
        copy_cstring(SUB_CATEGORIES, &mut info.subCategories);
        copy_cstring(VENDOR, &mut info.vendor);
        copy_cstring(pfsend_protocol::PLUGIN_VERSION, &mut info.version);
        copy_cstring(&sdk_version(), &mut info.sdkVersion);
        kResultOk
    }
}

impl IPluginFactory3Trait for Factory {
    unsafe fn getClassInfoUnicode(&self, index: i32, info: *mut PClassInfoW) -> tresult {
        let Some(info) = info.as_mut() else { return kInvalidArgument };
        if index != 0 {
            return kInvalidArgument;
        }
        info.cid = PlayfieldSend::CID;
        info.cardinality = PClassInfo_::ClassCardinality_::kManyInstances as int32;
        copy_cstring("Audio Module Class", &mut info.category);
        copy_u16(PLUGIN_NAME, &mut info.name);
        info.classFlags = 0;
        copy_cstring(SUB_CATEGORIES, &mut info.subCategories);
        copy_u16(VENDOR, &mut info.vendor);
        copy_u16(pfsend_protocol::PLUGIN_VERSION, &mut info.version);
        copy_u16(&sdk_version(), &mut info.sdkVersion);
        kResultOk
    }

    unsafe fn setHostContext(&self, _context: *mut FUnknown) -> tresult {
        kResultOk
    }
}

// ── Entry points ────────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn bundleEntry(_bundle: *mut c_void) -> bool {
    true
}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn bundleExit() -> bool {
    true
}

// Older hosts look the entry points up with a capital B.
#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn BundleEntry(_bundle: *mut c_void) -> bool {
    true
}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn BundleExit() -> bool {
    true
}

#[cfg(target_os = "windows")]
#[no_mangle]
pub extern "system" fn InitDll() -> bool {
    true
}

#[cfg(target_os = "windows")]
#[no_mangle]
pub extern "system" fn ExitDll() -> bool {
    true
}

#[cfg(target_os = "linux")]
#[no_mangle]
pub extern "C" fn ModuleEntry(_lib: *mut c_void) -> bool {
    true
}

#[cfg(target_os = "linux")]
#[no_mangle]
pub extern "C" fn ModuleExit() -> bool {
    true
}

#[no_mangle]
pub extern "system" fn GetPluginFactory() -> *mut IPluginFactory {
    ComWrapper::new(Factory).to_com_ptr::<IPluginFactory>().map(|p| p.into_raw()).unwrap_or(std::ptr::null_mut())
}
