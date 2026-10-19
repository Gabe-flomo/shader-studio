//! What an instance's parts share: the processor (audio thread), the controller and the window
//! (main thread) and the announce thread. Everything the audio thread touches is an atomic.

use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use pfsend_protocol::Segment;

pub struct Shared {
    pub pairing_id: AtomicU32,
    /// The segment the audio thread writes to (null while there is none). Owned by `MainState`'s
    /// list, which outlives every pointer stored here.
    pub seg: AtomicPtr<Segment>,
    /// f64 bits.
    pub sample_rate: AtomicU64,
    pub active: AtomicBool,
    pub processing: AtomicBool,
    /// Live is rendering offline (Export, Freeze): nothing goes to Playfield meanwhile.
    pub offline: AtomicBool,
    /// Peaks since the window last looked (f32 bits; positive floats order like their bits).
    pub peak: [AtomicU32; 2],
    pub frames: AtomicU64,
    /// Stops the announce thread.
    pub stop: AtomicBool,
    /// What the hello carries besides the atomics: (shm name, instance name). Never locked on the audio thread.
    pub announce: Mutex<(String, String)>,
}

impl Shared {
    pub fn new() -> Self {
        Self {
            pairing_id: AtomicU32::new(0),
            seg: AtomicPtr::new(std::ptr::null_mut()),
            sample_rate: AtomicU64::new(48_000f64.to_bits()),
            active: AtomicBool::new(false),
            processing: AtomicBool::new(false),
            offline: AtomicBool::new(false),
            peak: [AtomicU32::new(0), AtomicU32::new(0)],
            frames: AtomicU64::new(0),
            stop: AtomicBool::new(false),
            announce: Mutex::new((String::new(), String::new())),
        }
    }

    pub fn sample_rate(&self) -> f64 {
        f64::from_bits(self.sample_rate.load(Ordering::Relaxed))
    }

    /// The segment, if any (for the main thread and the window; the audio thread loads `seg` itself).
    pub fn segment(&self) -> Option<&Segment> {
        let p = self.seg.load(Ordering::Acquire);
        // Safe: segments are only freed in `terminate`, after `seg` is cleared and nothing reads it.
        unsafe { p.as_ref() }
    }

    /// Take the peaks since the last call (the window's meter).
    pub fn take_peaks(&self) -> [f32; 2] {
        [f32::from_bits(self.peak[0].swap(0, Ordering::Relaxed)), f32::from_bits(self.peak[1].swap(0, Ordering::Relaxed))]
    }

    /// What the window shows about the app: (connected, paired-to label, colour 0xRRGGBB).
    pub fn app_status(&self) -> (bool, String, Option<u32>) {
        let Some(seg) = self.segment() else { return (false, String::new(), None) };
        let h = seg.header();
        let beat = h.app.heartbeat_ms.load(Ordering::Acquire);
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let connected = beat > 0 && now.saturating_sub(beat) < 2_000;
        (connected, h.app.label.read().unwrap_or_default(), h.app_colour())
    }
}

impl Default for Shared {
    fn default() -> Self {
        Self::new()
    }
}

/// Keep the larger of a stored peak and `v` (no lock: compare-and-swap on the bits).
#[inline]
pub fn raise_peak(slot: &AtomicU32, v: f32) {
    if !(v > 0.0) {
        return;
    }
    slot.fetch_max(v.to_bits(), Ordering::Relaxed);
}
