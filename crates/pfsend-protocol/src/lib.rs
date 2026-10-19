//! pfsend-protocol — what Playfield Send (the VST3 plugin, tools/playfield-send) and the desktop app
//! (src-tauri/src/live_send.rs) share. docs/playfield-send-plan.md, section 3.
//!
//! - **The segment**: one POSIX shared-memory object per plugin instance, `/pfsend.<pid>.<n>`. A page
//!   of header ([`Header`]), then a ring of `capacity_frames` stereo f32 frames, interleaved. The
//!   plugin creates it off the audio thread and is its only writer; the app maps it and is its only
//!   reader (and writes the small app → plugin area: the paired track's name, colour and a heartbeat).
//! - **The ring**: [`Segment::write`] is the audio thread's whole job: copies and one Release store.
//!   No allocation, no locks, no syscalls. [`RingReader`] polls `write_frame`, copies the new frames,
//!   and checks afterwards that the writer hadn't lapped it (a dropout).
//! - **Discovery**: a plain thread in the plugin sends [`Hello`] (OSC over UDP to 127.0.0.1:11102)
//!   once a second, and `/pfsend/bye` when the instance goes. macOS can't list shm segments.
//!
//! The protocol version in the header lets the app read versions N and N-1 (only 1 exists).

use std::sync::atomic::{fence, AtomicU32, AtomicU64, Ordering};

pub mod osc;
#[cfg(unix)]
pub mod fake;
#[cfg(unix)]
mod shm;
#[cfg(unix)]
pub use shm::{pid_alive, unlink, Segment};

pub use osc::{decode_message, encode_bye, encode_hello, Hello, Message};

/// "PFSEND" and two zeros.
pub const MAGIC: [u8; 8] = *b"PFSEND\0\0";
/// Bumped when the header or ring layout changes. The app reads this and the one before.
pub const PROTOCOL_VERSION: u32 = 1;
/// The plugin's hellos go here (the Live connector uses 11100/11101).
pub const HELLO_PORT: u16 = 11102;
/// The header takes one page; the ring starts after it.
pub const HEADER_BYTES: usize = 4096;
/// The ring is always stereo (a mono track is written to both sides).
pub const CHANNELS: usize = 2;
/// The longest name or label kept in the segment, in UTF-8 bytes.
pub const TEXT_BYTES: usize = 64;
/// Pairing IDs are 0..=9999 (four digits in Live's device view).
pub const PAIRING_MAX: u32 = 9999;
/// Every shm name starts with this (the app maps nothing else).
pub const SHM_PREFIX: &str = "/pfsend.";
/// The plugin's version, carried in the hello (the app offers an update when it is older than the bundled one).
pub const PLUGIN_VERSION: &str = "1.0.0";

/// `flags`: the plugin is active (between setActive(true) and setActive(false)).
pub const FLAG_ACTIVE: u32 = 1;
/// `flags`: Live is rendering offline (Export, Freeze): nothing is written to the ring meanwhile.
pub const FLAG_OFFLINE: u32 = 2;

/// The shm name for an instance: `/pfsend.<pid>.<n>` (macOS allows 31 characters).
pub fn shm_name(pid: u32, n: u32) -> String {
    format!("{SHM_PREFIX}{pid}.{n}")
}

/// Is this a name the app may map (ours, short, no path tricks)?
pub fn valid_shm_name(name: &str) -> bool {
    name.len() <= 31
        && name.starts_with(SHM_PREFIX)
        && name[SHM_PREFIX.len()..].chars().all(|c| c.is_ascii_digit() || c == '.')
        && name.len() > SHM_PREFIX.len()
}

/// Ring frames for a sample rate: about a second, a power of two, at least 2^15.
pub fn capacity_for(sample_rate: f64) -> u32 {
    let want = sample_rate.max(1.0).min(768_000.0).ceil() as u32;
    want.next_power_of_two().max(1 << 15)
}

/// Bytes of a whole segment with this many frames.
pub fn segment_bytes(capacity_frames: u32) -> usize {
    HEADER_BYTES + capacity_frames as usize * CHANNELS * 4
}

// ── Text with a sequence lock ────────────────────────────────────────────────────────────────────

/// Up to 64 bytes of UTF-8 behind a sequence lock: one writer, any number of readers, nobody waits.
/// Stored as 32-bit atomic words, so neither side ever reads memory the other is writing non-atomically.
#[repr(C)]
pub struct SeqText {
    seq: AtomicU32,
    len: AtomicU32,
    words: [AtomicU32; TEXT_BYTES / 4],
}

impl SeqText {
    /// Write (one writer at a time). Cut at a character boundary to fit.
    pub fn write(&self, text: &str) {
        let mut end = text.len().min(TEXT_BYTES);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        let bytes = &text.as_bytes()[..end];
        let s = self.seq.load(Ordering::Relaxed);
        self.seq.store(s.wrapping_add(1) | 1, Ordering::Relaxed);
        fence(Ordering::Release);
        let mut buf = [0u8; TEXT_BYTES];
        buf[..end].copy_from_slice(bytes);
        for (i, w) in self.words.iter().enumerate() {
            w.store(u32::from_le_bytes([buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2], buf[i * 4 + 3]]), Ordering::Relaxed);
        }
        self.len.store(end as u32, Ordering::Relaxed);
        self.seq.store((s.wrapping_add(1) | 1).wrapping_add(1), Ordering::Release);
    }

    /// Read a consistent copy (None after a few tries while the writer keeps writing).
    pub fn read(&self) -> Option<String> {
        for _ in 0..16 {
            let s1 = self.seq.load(Ordering::Acquire);
            if s1 & 1 == 1 {
                std::hint::spin_loop();
                continue;
            }
            let mut buf = [0u8; TEXT_BYTES];
            for (i, w) in self.words.iter().enumerate() {
                buf[i * 4..i * 4 + 4].copy_from_slice(&w.load(Ordering::Relaxed).to_le_bytes());
            }
            let len = (self.len.load(Ordering::Relaxed) as usize).min(TEXT_BYTES);
            fence(Ordering::Acquire);
            if self.seq.load(Ordering::Relaxed) == s1 {
                return Some(String::from_utf8_lossy(&buf[..len]).into_owned());
            }
        }
        None
    }
}

// ── The header ───────────────────────────────────────────────────────────────────────────────────

/// What the app writes back for the plugin's window: who it is paired to and that the app is reading.
#[repr(C)]
pub struct AppArea {
    /// "Drums": the Live track the Remote Script reported for this pairing ID (or the name set in Playfield).
    pub label: SeqText,
    /// 0x00RRGGBB with bit 24 set when there is a colour.
    pub colour: AtomicU32,
    _pad: u32,
    /// Unix ms of the app's last read: the plugin says "Connected to Playfield" while it is recent.
    pub heartbeat_ms: AtomicU64,
}

/// The first page of a segment. `#[repr(C)]` and only fixed-size fields, so the plugin and the app
/// (built from this same crate) agree on every offset.
#[repr(C)]
pub struct Header {
    pub magic: [u8; 8],
    pub version: u32,
    pub header_bytes: u32,
    pub capacity_frames: u32,
    pub channels: u32,
    pub pid: u32,
    /// Bumped (Release) after the sample rate changed in place: the reader starts again from `write_frame`.
    pub generation: AtomicU32,
    /// f64 bits.
    pub sample_rate: AtomicU64,
    pub flags: AtomicU32,
    pub pairing_id: AtomicU32,
    _pad0: [u32; 4],
    /// Total frames ever written (Release after the samples). Position in the ring: `% capacity_frames`.
    /// On its own cache line: the audio thread writes it every block.
    pub write_frame: AtomicU64,
    _pad1: [u64; 7],
    /// The plugin's own name for this instance ("" until a name is set in the plugin).
    pub name: SeqText,
    pub app: AppArea,
}

const _: () = assert!(std::mem::size_of::<Header>() <= HEADER_BYTES);
const _: () = assert!(std::mem::offset_of!(Header, write_frame) % 64 == 0);

impl Header {
    pub fn sample_rate(&self) -> f64 {
        f64::from_bits(self.sample_rate.load(Ordering::Acquire))
    }
    pub fn flags(&self) -> u32 {
        self.flags.load(Ordering::Acquire)
    }
    pub fn set_flag(&self, flag: u32, on: bool) {
        if on {
            self.flags.fetch_or(flag, Ordering::Release);
        } else {
            self.flags.fetch_and(!flag, Ordering::Release);
        }
    }
    /// The app's colour as 0xRRGGBB, if one is set.
    pub fn app_colour(&self) -> Option<u32> {
        let c = self.app.colour.load(Ordering::Acquire);
        (c & (1 << 24) != 0).then_some(c & 0xFF_FFFF)
    }
}

// ── Reading the ring ─────────────────────────────────────────────────────────────────────────────

/// What one poll found.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ReadOutcome {
    /// Frames appended to `out`.
    pub frames: usize,
    /// The writer lapped the reader (the app stalled for about a second): skipped to the newest.
    pub overrun: bool,
    /// The sample rate changed in place: started again from the newest frame.
    pub restarted: bool,
}

/// The app's side of one ring: its own position, and what it skipped.
#[derive(Debug, Clone)]
pub struct RingReader {
    pos: u64,
    generation: u32,
    started: bool,
    pub dropouts: u64,
}

impl Default for RingReader {
    fn default() -> Self {
        Self::new()
    }
}

impl RingReader {
    pub fn new() -> Self {
        Self { pos: 0, generation: 0, started: false, dropouts: 0 }
    }

    /// Frames written and not read yet.
    pub fn pending(&self, h: &Header) -> u64 {
        h.write_frame.load(Ordering::Acquire).saturating_sub(self.pos)
    }

    /// Copy the frames written since the last call into `out` (interleaved stereo), at most `max_frames`
    /// (the oldest first; the rest stay for the next call). The first call starts at the newest frame.
    ///
    /// # Safety
    /// `ring` must point at the segment's ring of `h.capacity_frames * CHANNELS` floats.
    pub unsafe fn read(&mut self, h: &Header, ring: *const f32, out: &mut Vec<f32>, max_frames: usize) -> ReadOutcome {
        let cap = h.capacity_frames as u64;
        let mut outcome = ReadOutcome::default();
        let g = h.generation.load(Ordering::Acquire);
        let w = h.write_frame.load(Ordering::Acquire);
        if !self.started || g != self.generation {
            outcome.restarted = self.started;
            self.started = true;
            self.generation = g;
            self.pos = w;
            return outcome;
        }
        if w < self.pos {
            // A fresh writer on the same segment (shouldn't happen): follow it.
            self.pos = w;
            outcome.restarted = true;
            return outcome;
        }
        let avail = w - self.pos;
        // Leave a quarter of the ring as a margin: the writer may be writing just ahead of `w`.
        if avail > cap - cap / 4 {
            self.dropouts += 1;
            self.pos = w;
            outcome.overrun = true;
            return outcome;
        }
        let n = (avail as usize).min(max_frames);
        if n == 0 {
            return outcome;
        }
        let start = out.len();
        out.reserve(n * CHANNELS);
        let mask = cap - 1;
        let mut done = 0usize;
        while done < n {
            let at = ((self.pos + done as u64) & mask) as usize;
            let run = (n - done).min(cap as usize - at);
            let src = std::slice::from_raw_parts(ring.add(at * CHANNELS), run * CHANNELS);
            out.extend_from_slice(src);
            done += run;
        }
        // Did the writer lap what we just copied? Then those frames may be torn: drop them.
        let w2 = h.write_frame.load(Ordering::Acquire);
        if w2.saturating_sub(self.pos) > cap {
            out.truncate(start);
            self.dropouts += 1;
            self.pos = w2;
            outcome.overrun = true;
            return outcome;
        }
        self.pos += n as u64;
        outcome.frames = n;
        outcome
    }
}

/// Write `frames` stereo frames from planar channels into a ring (the audio thread's copy).
/// A block longer than the ring keeps only its newest `capacity` frames.
///
/// # Safety
/// `ring` must point at `h.capacity_frames * CHANNELS` writable floats, and this must be the only writer.
#[inline]
pub unsafe fn write_planar(h: &Header, ring: *mut f32, left: &[f32], right: &[f32], frames: usize) {
    let cap = h.capacity_frames as usize;
    let frames = frames.min(left.len()).min(right.len());
    let w = h.write_frame.load(Ordering::Relaxed);
    let skip = frames.saturating_sub(cap);
    let mask = cap - 1;
    let base = w as usize + skip;
    for i in skip..frames {
        let at = (base + (i - skip)) & mask;
        *ring.add(at * 2) = *left.get_unchecked(i);
        *ring.add(at * 2 + 1) = *right.get_unchecked(i);
    }
    h.write_frame.store(w + frames as u64, Ordering::Release);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A header and ring in ordinary memory (the shm module tests the real mapping).
    struct Mem {
        buf: Vec<u64>,
    }
    impl Mem {
        fn new(cap: u32) -> Self {
            let bytes = segment_bytes(cap);
            let mut m = Mem { buf: vec![0u64; bytes / 8] };
            let h = m.header_mut();
            h.magic = MAGIC;
            h.version = PROTOCOL_VERSION;
            h.capacity_frames = cap;
            h.channels = 2;
            m
        }
        fn header_mut(&mut self) -> &mut Header {
            unsafe { &mut *(self.buf.as_mut_ptr() as *mut Header) }
        }
        fn header(&self) -> &Header {
            unsafe { &*(self.buf.as_ptr() as *const Header) }
        }
        fn ring(&self) -> *mut f32 {
            unsafe { (self.buf.as_ptr() as *mut u8).add(HEADER_BYTES) as *mut f32 }
        }
    }

    fn ramp(from: usize, n: usize) -> (Vec<f32>, Vec<f32>) {
        ((from..from + n).map(|i| i as f32).collect(), (from..from + n).map(|i| -(i as f32)).collect())
    }

    #[test]
    fn capacity_is_a_power_of_two_near_a_second() {
        assert_eq!(capacity_for(44_100.0), 65_536);
        assert_eq!(capacity_for(48_000.0), 65_536);
        assert_eq!(capacity_for(96_000.0), 131_072);
        assert_eq!(capacity_for(8_000.0), 32_768);
        assert_eq!(segment_bytes(65_536), 4096 + 65_536 * 8);
    }

    #[test]
    fn names() {
        assert_eq!(shm_name(51234, 3), "/pfsend.51234.3");
        assert!(valid_shm_name("/pfsend.51234.3"));
        assert!(!valid_shm_name("/pfsend."));
        assert!(!valid_shm_name("/other.1.2"));
        assert!(!valid_shm_name("/pfsend.1/../x"));
        assert!(!valid_shm_name("/pfsend.1234567890123456789012345"));
    }

    #[test]
    fn reads_what_was_written_across_the_wrap() {
        let m = Mem::new(1 << 15);
        let h = m.header();
        let mut r = RingReader::new();
        let mut out = Vec::new();
        // The first read only finds its place.
        assert_eq!(unsafe { r.read(h, m.ring(), &mut out, usize::MAX) }, ReadOutcome::default());
        let mut at = 0;
        // Odd block sizes, many times round the ring.
        for k in 0..400 {
            let n = 97 + (k * 31) % 900;
            let (l, rr) = ramp(at, n);
            unsafe { write_planar(h, m.ring(), &l, &rr, n) };
            at += n;
            if k % 3 == 2 {
                let before = out.len();
                let got = unsafe { r.read(h, m.ring(), &mut out, usize::MAX) };
                assert!(!got.overrun);
                assert_eq!(got.frames * 2, out.len() - before);
            }
        }
        unsafe { r.read(h, m.ring(), &mut out, usize::MAX) };
        assert_eq!(out.len() / 2, at);
        for (i, f) in out.chunks(2).enumerate() {
            assert_eq!(f[0], i as f32);
            assert_eq!(f[1], -(i as f32));
        }
        assert_eq!(r.dropouts, 0);
    }

    #[test]
    fn max_frames_leaves_the_rest_for_later() {
        let m = Mem::new(1 << 15);
        let h = m.header();
        let mut r = RingReader::new();
        let mut out = Vec::new();
        unsafe { r.read(h, m.ring(), &mut out, 0) };
        let (l, rr) = ramp(0, 1000);
        unsafe { write_planar(h, m.ring(), &l, &rr, 1000) };
        assert_eq!(unsafe { r.read(h, m.ring(), &mut out, 300) }.frames, 300);
        assert_eq!(r.pending(h), 700);
        assert_eq!(unsafe { r.read(h, m.ring(), &mut out, 10_000) }.frames, 700);
        assert_eq!(out[2 * 999], 999.0);
    }

    #[test]
    fn an_overrun_skips_to_the_newest_and_counts() {
        let cap = 1 << 15;
        let m = Mem::new(cap);
        let h = m.header();
        let mut r = RingReader::new();
        let mut out = Vec::new();
        unsafe { r.read(h, m.ring(), &mut out, usize::MAX) };
        // The app stalls while more than a ring is written.
        let mut at = 0;
        while at < cap as usize + 5000 {
            let (l, rr) = ramp(at, 512);
            unsafe { write_planar(h, m.ring(), &l, &rr, 512) };
            at += 512;
        }
        let got = unsafe { r.read(h, m.ring(), &mut out, usize::MAX) };
        assert!(got.overrun);
        assert_eq!(got.frames, 0);
        assert_eq!(r.dropouts, 1);
        // Then it carries on from the newest.
        let (l, rr) = ramp(at, 256);
        unsafe { write_planar(h, m.ring(), &l, &rr, 256) };
        let got = unsafe { r.read(h, m.ring(), &mut out, usize::MAX) };
        assert_eq!(got.frames, 256);
        assert_eq!(out[0], at as f32);
    }

    #[test]
    fn a_block_longer_than_the_ring_keeps_its_end() {
        let cap = 1 << 15;
        let m = Mem::new(cap);
        let h = m.header();
        let n = cap as usize + 100;
        let (l, rr) = ramp(0, n);
        unsafe { write_planar(h, m.ring(), &l, &rr, n) };
        assert_eq!(h.write_frame.load(Ordering::Relaxed), n as u64);
        // The newest frame sits where frame n-1 belongs.
        let at = (n - 1) & (cap as usize - 1);
        assert_eq!(unsafe { *m.ring().add(at * 2) }, (n - 1) as f32);
    }

    #[test]
    fn a_generation_change_mid_read_starts_again_at_the_newest() {
        let m = Mem::new(1 << 15);
        let h = m.header();
        let mut r = RingReader::new();
        let mut out = Vec::new();
        unsafe { r.read(h, m.ring(), &mut out, usize::MAX) };
        let (l, rr) = ramp(0, 500);
        unsafe { write_planar(h, m.ring(), &l, &rr, 500) };
        // Live changes its rate: the plugin stores it and bumps the generation.
        h.sample_rate.store(96_000f64.to_bits(), Ordering::Release);
        h.generation.fetch_add(1, Ordering::Release);
        let got = unsafe { r.read(h, m.ring(), &mut out, usize::MAX) };
        assert!(got.restarted);
        assert_eq!(got.frames, 0, "frames from before the change are dropped");
        let (l, rr) = ramp(500, 64);
        unsafe { write_planar(h, m.ring(), &l, &rr, 64) };
        assert_eq!(unsafe { r.read(h, m.ring(), &mut out, usize::MAX) }.frames, 64);
        assert_eq!(out[0], 500.0);
        assert_eq!(h.sample_rate(), 96_000.0);
    }

    #[test]
    fn the_seqlock_name_round_trips_and_cuts_at_a_character() {
        let m = Mem::new(1 << 15);
        let h = m.header();
        assert_eq!(h.name.read().as_deref(), Some(""));
        h.name.write("Drums");
        assert_eq!(h.name.read().as_deref(), Some("Drums"));
        let long = "é".repeat(40); // 80 bytes
        h.name.write(&long);
        let got = h.name.read().unwrap();
        assert_eq!(got.len(), 64);
        assert_eq!(got, "é".repeat(32));
        h.app.label.write("Live · Bass");
        assert_eq!(h.app.label.read().as_deref(), Some("Live · Bass"));
    }

    #[test]
    fn the_seqlock_never_tears_under_a_racing_writer() {
        let m = std::sync::Arc::new(Mem::new(1 << 15));
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (m2, stop2) = (m.clone(), stop.clone());
        let writer = std::thread::spawn(move || {
            let words = ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "c"];
            let mut i = 0;
            while !stop2.load(Ordering::Relaxed) {
                m2.header().name.write(words[i % 3]);
                i += 1;
            }
        });
        let mut seen = 0;
        for _ in 0..20_000 {
            if let Some(s) = m.header().name.read() {
                assert!(s.is_empty() || s.chars().all(|c| c == s.chars().next().unwrap()), "torn: {s}");
                seen += 1;
            }
        }
        stop.store(true, Ordering::Relaxed);
        writer.join().unwrap();
        assert!(seen > 0);
    }

    // Mem is only shared read-only across threads in the test above.
    unsafe impl Sync for Mem {}
    unsafe impl Send for Mem {}
}
