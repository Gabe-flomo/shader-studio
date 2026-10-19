//! The plugin window (v1): a small native status view, no canvas.
//!
//!   Playfield Send
//!   ● Connected to Playfield            (or: ○ Playfield isn't listening)
//!   Pairing ID   4821
//!   Paired to    Live · Drums           (the track's colour; or "Not named yet")
//!   48 kHz · stereo · Sending           (Paused / Rendering offline: not sent)
//!   [level meter, L and R]
//!
//! It is an NSView of labels and two level indicators, refreshed 15 times a second by a timer on
//! the main thread. It reads only atomics and the segment's app area (written by the app).
//!
//! **Later (not built):** a canvas preview. The view is a plain container, so a later version can
//! add a layer-backed image view under the status lines and show frames the app writes into a
//! second shared area (a small RGBA thumbnail ring next to the audio ring, its own seqlock). The
//! protocol version would bump; this window's size grows to fit (getSize).

#[cfg(not(target_os = "macos"))]
use std::sync::Arc;

use crate::shared::Shared;

pub const WIDTH: i32 = 340;
pub const HEIGHT: i32 = 168;

/// The status lines the window shows, worked out without AppKit (so they can be tested).
#[derive(Debug, Clone, PartialEq)]
pub struct Status {
    pub connected: String,
    pub connected_ok: bool,
    pub pairing: String,
    pub paired_to: String,
    pub colour: Option<u32>,
    pub stream: String,
}

pub fn status_of(sh: &Shared) -> Status {
    use std::sync::atomic::Ordering;
    let (ok, label, colour) = sh.app_status();
    let rate = sh.sample_rate();
    let khz = if (rate / 1000.0).fract() == 0.0 { format!("{} kHz", (rate / 1000.0) as u32) } else { format!("{:.1} kHz", rate / 1000.0) };
    let state = if sh.offline.load(Ordering::Relaxed) {
        "Rendering offline: not sent"
    } else if !sh.active.load(Ordering::Relaxed) || !sh.processing.load(Ordering::Relaxed) {
        "Paused"
    } else if sh.segment().is_none() {
        "Not sending (no shared memory)"
    } else {
        "Sending"
    };
    Status {
        connected: if ok { "● Connected to Playfield".into() } else { "○ Playfield isn’t listening (open its Live tab)".into() },
        connected_ok: ok,
        pairing: format!("{}", sh.pairing_id.load(Ordering::Relaxed)),
        paired_to: if label.is_empty() { "Not named yet: turn on the Live connector, or name it in Playfield".into() } else { label },
        colour,
        stream: format!("{khz} · stereo · {state}"),
    }
}

/// A peak (0..1+) as the meter's 0..1 on a dB scale (−60 dB to 0 dB).
pub fn meter_level(peak: f32) -> f64 {
    if !(peak > 0.0) {
        return 0.0;
    }
    let db = 20.0 * (peak as f64).log10();
    ((db + 60.0) / 60.0).clamp(0.0, 1.0)
}

#[cfg(target_os = "macos")]
pub use mac::create;

#[cfg(not(target_os = "macos"))]
pub fn create(_shared: Arc<Shared>) -> *mut vst3::Steinberg::IPlugView {
    std::ptr::null_mut()
}

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::RefCell;
    use std::ffi::{c_void, CStr};
    use std::ptr::NonNull;
    use std::sync::Arc;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSColor, NSFont, NSLevelIndicator, NSLevelIndicatorStyle, NSTextField, NSView};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSTimer};
    use vst3::Steinberg::*;
    use vst3::{Class, ComWrapper};

    use super::{meter_level, status_of, HEIGHT, WIDTH};
    use crate::shared::Shared;

    struct Ui {
        root: Retained<NSView>,
        timer: Retained<NSTimer>,
    }

    pub struct StatusView {
        shared: Arc<Shared>,
        ui: RefCell<Option<Ui>>,
    }

    impl Class for StatusView {
        type Interfaces = (IPlugView,);
    }

    pub fn create(shared: Arc<Shared>) -> *mut IPlugView {
        ComWrapper::new(StatusView { shared, ui: RefCell::new(None) })
            .to_com_ptr::<IPlugView>()
            .map(|p| p.into_raw())
            .unwrap_or(std::ptr::null_mut())
    }

    fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
        NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
    }

    fn label(text: &str, frame: NSRect, size: f64, bold: bool, mtm: MainThreadMarker) -> Retained<NSTextField> {
        let l = NSTextField::labelWithString(&NSString::from_str(text), mtm);
        l.setFrame(frame);
        let font = if bold { NSFont::boldSystemFontOfSize(size) } else { NSFont::systemFontOfSize(size) };
        l.setFont(Some(&font));
        l
    }

    fn meter(frame: NSRect, mtm: MainThreadMarker) -> Retained<NSLevelIndicator> {
        let m = NSLevelIndicator::initWithFrame(mtm.alloc(), frame);
        m.setLevelIndicatorStyle(NSLevelIndicatorStyle::ContinuousCapacity);
        m.setMinValue(0.0);
        m.setMaxValue(1.0);
        m.setWarningValue(0.8);
        m.setCriticalValue(0.95);
        m
    }

    fn rgb(c: u32) -> Retained<NSColor> {
        let f = |s: u32| ((c >> s) & 0xFF) as f64 / 255.0;
        NSColor::colorWithSRGBRed_green_blue_alpha(f(16), f(8), f(0), 1.0)
    }

    impl StatusView {
        fn build(&self, mtm: MainThreadMarker) -> Ui {
            let (w, h) = (WIDTH as f64, HEIGHT as f64);
            let root = NSView::initWithFrame(mtm.alloc(), rect(0.0, 0.0, w, h));
            // AppKit's y runs up from the bottom.
            let row = |i: f64| h - 30.0 - i * 22.0;
            let title = label("Playfield Send", rect(14.0, row(0.0), w - 28.0, 20.0), 14.0, true, mtm);
            let connected = label("", rect(14.0, row(1.0), w - 28.0, 18.0), 12.0, false, mtm);
            let id_caption = label("Pairing ID", rect(14.0, row(2.0), 86.0, 18.0), 12.0, false, mtm);
            let id_value = label("", rect(100.0, row(2.0), w - 114.0, 18.0), 12.0, true, mtm);
            let to_caption = label("Paired to", rect(14.0, row(3.0), 86.0, 18.0), 12.0, false, mtm);
            let to_value = label("", rect(100.0, row(3.0), w - 114.0, 18.0), 12.0, true, mtm);
            let stream = label("", rect(14.0, row(4.0), w - 28.0, 18.0), 11.0, false, mtm);
            let muted = NSColor::secondaryLabelColor();
            id_caption.setTextColor(Some(&muted));
            to_caption.setTextColor(Some(&muted));
            stream.setTextColor(Some(&muted));
            let meter_l = meter(rect(14.0, 16.0, w - 28.0, 7.0), mtm);
            let meter_r = meter(rect(14.0, 6.0, w - 28.0, 7.0), mtm);
            for v in [&*title, &*connected, &*id_caption, &*id_value, &*to_caption, &*to_value, &*stream] {
                root.addSubview(v);
            }
            root.addSubview(&meter_l);
            root.addSubview(&meter_r);

            let shared = self.shared.clone();
            // Meters fall back slowly, as level meters do; the peaks are taken from the audio thread's atomics.
            let held = RefCell::new([0.0f64; 2]);
            let refresh = move || {
                let s = status_of(&shared);
                connected.setStringValue(&NSString::from_str(&s.connected));
                let tint = if s.connected_ok { NSColor::systemGreenColor() } else { NSColor::secondaryLabelColor() };
                connected.setTextColor(Some(&tint));
                id_value.setStringValue(&NSString::from_str(&s.pairing));
                to_value.setStringValue(&NSString::from_str(&s.paired_to));
                let tint = match s.colour { Some(c) => rgb(c), None => NSColor::labelColor() };
                to_value.setTextColor(Some(&tint));
                stream.setStringValue(&NSString::from_str(&s.stream));
                let peaks = shared.take_peaks();
                let mut held = held.borrow_mut();
                for (i, m) in [&meter_l, &meter_r].into_iter().enumerate() {
                    held[i] = meter_level(peaks[i]).max(held[i] - 0.06);
                    m.setDoubleValue(held[i]);
                }
            };
            refresh();
            let block = RcBlock::new(move |_t: NonNull<NSTimer>| refresh());
            let timer = unsafe { NSTimer::scheduledTimerWithTimeInterval_repeats_block(1.0 / 15.0, true, &block) };
            Ui { root, timer }
        }
    }

    impl IPlugViewTrait for StatusView {
        unsafe fn isPlatformTypeSupported(&self, t: FIDString) -> tresult {
            if !t.is_null() && CStr::from_ptr(t) == CStr::from_ptr(kPlatformTypeNSView) { kResultTrue } else { kResultFalse }
        }

        unsafe fn attached(&self, parent: *mut c_void, t: FIDString) -> tresult {
            if parent.is_null() || self.isPlatformTypeSupported(t) != kResultTrue {
                return kResultFalse;
            }
            let Some(mtm) = MainThreadMarker::new() else { return kResultFalse };
            let ui = self.build(mtm);
            let parent: &NSView = &*(parent as *const NSView);
            parent.addSubview(&ui.root);
            *self.ui.borrow_mut() = Some(ui);
            kResultOk
        }

        unsafe fn removed(&self) -> tresult {
            if let Some(ui) = self.ui.borrow_mut().take() {
                ui.timer.invalidate();
                ui.root.removeFromSuperview();
            }
            kResultOk
        }

        unsafe fn onWheel(&self, _d: f32) -> tresult { kResultFalse }
        unsafe fn onKeyDown(&self, _k: char16, _c: int16, _m: int16) -> tresult { kResultFalse }
        unsafe fn onKeyUp(&self, _k: char16, _c: int16, _m: int16) -> tresult { kResultFalse }

        unsafe fn getSize(&self, size: *mut ViewRect) -> tresult {
            let Some(r) = size.as_mut() else { return kInvalidArgument };
            *r = ViewRect { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };
            kResultOk
        }

        unsafe fn onSize(&self, _new: *mut ViewRect) -> tresult { kResultOk }
        unsafe fn onFocus(&self, _state: TBool) -> tresult { kResultOk }
        unsafe fn setFrame(&self, _frame: *mut IPlugFrame) -> tresult { kResultOk }
        unsafe fn canResize(&self) -> tresult { kResultFalse }

        unsafe fn checkSizeConstraint(&self, r: *mut ViewRect) -> tresult {
            let Some(r) = r.as_mut() else { return kInvalidArgument };
            *r = ViewRect { left: r.left, top: r.top, right: r.left + WIDTH, bottom: r.top + HEIGHT };
            kResultTrue
        }
    }

    impl Drop for StatusView {
        fn drop(&mut self) {
            if let Some(ui) = self.ui.get_mut().take() {
                ui.timer.invalidate();
                ui.root.removeFromSuperview();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn status_lines() {
        let sh = Shared::new();
        sh.pairing_id.store(4821, Ordering::Relaxed);
        let s = status_of(&sh);
        assert!(!s.connected_ok);
        assert_eq!(s.pairing, "4821");
        assert!(s.paired_to.starts_with("Not named yet"));
        assert_eq!(s.stream, "48 kHz · stereo · Paused");
        sh.sample_rate.store(44_100f64.to_bits(), Ordering::Relaxed);
        sh.offline.store(true, Ordering::Relaxed);
        assert_eq!(status_of(&sh).stream, "44.1 kHz · stereo · Rendering offline: not sent");
    }

    #[test]
    fn the_meter_is_in_db() {
        assert_eq!(meter_level(0.0), 0.0);
        assert_eq!(meter_level(1.0), 1.0);
        assert!(meter_level(0.001) < 1e-6); // −60 dB
        assert!((meter_level(0.1) - (2.0 / 3.0)).abs() < 1e-6); // −20 dB
        assert_eq!(meter_level(f32::NAN), 0.0);
    }
}
