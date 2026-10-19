//! live_send.rs — Playfield Send: Live tracks' audio into the page (docs/playfield-send-plan.md).
//!
//! Each Playfield Send instance in Live writes its audio into a shared-memory ring and says hello
//! on UDP 127.0.0.1:11102 once a second (crates/pfsend-protocol). Here:
//!
//! - **Discovery**: an `osc_listener` on 11102 turns hellos and byes into the instance list.
//! - **The reader thread** polls every mapped ring every 3 ms. Every instance gets a meter (RMS);
//!   the page's *subscribed* ones are resampled to its AudioContext rate and, every 10 ms, all of
//!   them go to the page as **one binary Channel message** ([`encode_chunk`]). The page's worklet
//!   (src/lib/liveSend.ts) keeps a ~30 ms cushion that absorbs the clocks' drift.
//! - **Status**: Streaming / Paused (no new frames for 250 ms) / Offline (Live's Export or Freeze),
//!   and dropouts (the reader fell a ring behind). The list goes to the page as `live-send-list`
//!   four times a second. A plugin that went away without a bye is dropped after a few seconds; a
//!   dead process's segment is unlinked.
//! - **Back to the plugin**: the app area of each segment gets a heartbeat (so the plugin's window
//!   says "Connected to Playfield") and the paired track's name and colour.
//! - **Install**: the bundled `Playfield Send.vst3` (a Tauri resource) is copied to
//!   ~/Library/Audio/Plug-Ins/VST3/ without the quarantine attribute and swapped in atomically.
//!
//! The logic is in [`Hub`] (no Tauri types), tested with the fake plugin (pfsend_protocol::fake).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use pfsend_protocol::{decode_message, Hello, Message, RingReader, Segment, FLAG_OFFLINE, HELLO_PORT};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::osc_listener;

/// No new frames for this long: "Paused in Live".
const STALE: Duration = Duration::from_millis(250);
/// No hello for this long: gone (its process is checked first).
const SILENT: Duration = Duration::from_secs(4);
/// The page gets audio this often.
const BATCH: Duration = Duration::from_millis(10);
/// The reader polls this often.
const POLL: Duration = Duration::from_millis(3);
/// The list goes to the page this often.
const LIST_EVERY: Duration = Duration::from_millis(250);

// ── Resampling ──────────────────────────────────────────────────────────────────────────────────

/// Linear-interpolating stereo resampler with state across calls (Live's rate → the page's).
/// Plenty for analysis (the stream is never heard); a sine keeps its pitch exactly.
#[derive(Debug, Clone)]
pub struct Resampler {
    /// Input frames per output frame.
    step: f64,
    /// Where the next output frame falls, in input frames, counted from `prev` (index -1).
    pos: f64,
    prev: [f32; 2],
}

impl Resampler {
    pub fn new(from_rate: f64, to_rate: f64) -> Self {
        Self { step: from_rate / to_rate, pos: 1.0, prev: [0.0; 2] }
    }

    pub fn is_identity(&self) -> bool {
        self.step == 1.0
    }

    /// Append the resampled frames of `input` (interleaved stereo) to `out`.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        let n = input.len() / 2;
        if n == 0 {
            return;
        }
        if self.is_identity() {
            out.extend_from_slice(&input[..n * 2]);
            return;
        }
        // Frame k of this block is at k + 1 on our scale (prev sits at 0).
        let frame = |k: isize, c: usize| if k < 0 { self.prev[c] } else { input[k as usize * 2 + c] };
        while self.pos <= n as f64 {
            let i = self.pos.floor();
            let f = (self.pos - i) as f32;
            let a = i as isize - 1;
            let b = (a + 1).min(n as isize - 1);
            for c in 0..2 {
                let va = frame(a, c);
                let vb = frame(b, c);
                out.push(va + (vb - va) * f);
            }
            self.pos += self.step;
        }
        self.pos -= n as f64;
        self.prev = [input[(n - 1) * 2], input[(n - 1) * 2 + 1]];
    }
}

// ── The page's chunk ────────────────────────────────────────────────────────────────────────────

/// One instance's part of a chunk.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChunkPart {
    pub id: u32,
    /// Frames (stereo) of this part's PCM.
    pub n: usize,
    /// Dropouts so far (the reader's).
    pub drop: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChunkHeader {
    pub seq: u64,
    pub rate: f64,
    pub s: Vec<ChunkPart>,
}

/// `[u32 LE header length][JSON header, padded with spaces to 4 bytes][f32 LE PCM: each part's
/// frames, interleaved stereo, in header order]`. src/lib/liveSendChunk.ts reads it.
pub fn encode_chunk(header: &ChunkHeader, pcm: &[&[f32]]) -> Vec<u8> {
    let mut json = serde_json::to_vec(header).unwrap_or_else(|_| b"{}".to_vec());
    while json.len() % 4 != 0 {
        json.push(b' ');
    }
    let floats: usize = pcm.iter().map(|p| p.len()).sum();
    let mut out = Vec::with_capacity(4 + json.len() + floats * 4);
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    for p in pcm {
        for v in p.iter() {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}

/// The inverse (the tests; the page has its own, src/lib/liveSendChunk.ts).
#[cfg(test)]
pub fn decode_chunk(b: &[u8]) -> Option<(ChunkHeader, Vec<Vec<f32>>)> {
    let len = u32::from_le_bytes(b.get(..4)?.try_into().ok()?) as usize;
    let header: ChunkHeader = serde_json::from_slice(b.get(4..4 + len)?).ok()?;
    let mut at = 4 + len;
    let mut parts = Vec::with_capacity(header.s.len());
    for p in &header.s {
        let bytes = b.get(at..at + p.n * 8)?;
        parts.push(bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect());
        at += p.n * 8;
    }
    Some((header, parts))
}

// ── The instances ───────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SendStatus {
    /// Mapped and moving.
    Streaming,
    /// No new frames (the device is off, the track deactivated, Live stopped processing).
    Paused,
    /// Live is exporting or freezing: those frames aren't sent.
    Offline,
    /// Heard of, but its shared memory couldn't be opened.
    Unreadable,
}

/// What the page lists (`live-send-list`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInfo {
    pub key: String,
    pub id: u32,
    /// The plugin's own name ("" unless set in the plugin).
    pub name: String,
    pub sample_rate: f64,
    pub status: SendStatus,
    /// 0..1, RMS of the last ~50 ms.
    pub level: f32,
    pub dropouts: u64,
    pub version: String,
    pub pid: u32,
    pub subscribed: bool,
}

struct Instance {
    hello: Hello,
    last_hello: Instant,
    seg: Option<Segment>,
    reader: RingReader,
    last_frames: Instant,
    level: f32,
    resampler: Option<(f64, u32, Resampler)>,
    staging: Vec<f32>,
}

/// A name for an ID from the page: the Live connector's track (or the user's name in Playfield).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SendName {
    pub id: u32,
    pub label: String,
    /// 0xRRGGBB.
    pub colour: Option<u32>,
}

/// Everything except the threads and Tauri.
pub struct Hub {
    instances: HashMap<String, Instance>,
    subs: HashSet<u32>,
    rate: f64,
    names: HashMap<u32, SendName>,
    seq: u64,
    scratch: Vec<f32>,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

fn unix_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Hub {
    pub fn new() -> Self {
        Self { instances: HashMap::new(), subs: HashSet::new(), rate: 48_000.0, names: HashMap::new(), seq: 0, scratch: Vec::new() }
    }

    /// A datagram from the hello port.
    pub fn on_packet(&mut self, packet: &[u8], now: Instant) {
        match decode_message(packet) {
            Some(Message::Hello(h)) => self.on_hello(h, now),
            Some(Message::Bye { shm }) => {
                self.instances.remove(&shm);
            }
            None => {}
        }
    }

    fn on_hello(&mut self, h: Hello, now: Instant) {
        if !pfsend_protocol::valid_shm_name(&h.shm) {
            return;
        }
        // The same instance moved to a new segment (a higher sample rate needs a longer ring).
        let moved: Vec<String> = self
            .instances
            .iter()
            .filter(|(k, i)| **k != h.shm && i.hello.pid == h.pid && i.hello.id == h.id)
            .map(|(k, _)| k.clone())
            .collect();
        for k in moved {
            self.instances.remove(&k);
        }
        let inst = self.instances.entry(h.shm.clone()).or_insert_with(|| Instance {
            hello: h.clone(),
            last_hello: now,
            seg: None,
            reader: RingReader::new(),
            last_frames: now,
            level: 0.0,
            resampler: None,
            staging: Vec::new(),
        });
        inst.hello = h;
        inst.last_hello = now;
        if inst.seg.is_none() {
            inst.seg = Segment::open(&inst.hello.shm).ok();
            inst.reader = RingReader::new();
        }
    }

    pub fn subscribe(&mut self, ids: &[u32], rate: f64) {
        self.subs = ids.iter().copied().collect();
        if rate > 1000.0 && rate < 1_000_000.0 {
            self.rate = rate;
        }
        for i in self.instances.values_mut() {
            if !self.subs.contains(&i.hello.id) {
                i.staging.clear();
                i.resampler = None;
            }
        }
    }

    pub fn set_names(&mut self, names: Vec<SendName>) {
        self.names = names.into_iter().map(|n| (n.id, n)).collect();
    }

    /// Read every ring; meters for all, resampled audio staged for the subscribed.
    pub fn poll(&mut self, now: Instant) {
        let rate = self.rate;
        for inst in self.instances.values_mut() {
            let Some(seg) = inst.seg.as_ref() else { continue };
            let h = seg.header();
            self.scratch.clear();
            let got = unsafe { inst.reader.read(h, seg.ring(), &mut self.scratch, 1 << 16) };
            if got.frames > 0 {
                inst.last_frames = now;
                // Meter: RMS of the newest ~50 ms, eased.
                let take = (h.sample_rate() * 0.05) as usize * 2;
                let tail = &self.scratch[self.scratch.len().saturating_sub(take.max(2))..];
                let rms = (tail.iter().map(|v| v * v).sum::<f32>() / tail.len().max(1) as f32).sqrt();
                inst.level = rms.max(inst.level * 0.8);
            } else if now.duration_since(inst.last_frames) > STALE {
                inst.level = 0.0;
            }
            if got.restarted {
                inst.resampler = None;
            }
            if self.subs.contains(&inst.hello.id) && got.frames > 0 {
                let src = h.sample_rate();
                let gen = h.generation.load(Ordering::Acquire);
                let fresh = !matches!(&inst.resampler, Some((r, g, _)) if *r == rate && *g == gen);
                if fresh {
                    inst.resampler = Some((rate, gen, Resampler::new(src, rate)));
                }
                if let Some((_, _, rs)) = inst.resampler.as_mut() {
                    rs.process(&self.scratch, &mut inst.staging);
                }
                // Never let a stalled page pile up more than a second.
                let cap = (rate as usize) * 2;
                if inst.staging.len() > cap {
                    let cut = inst.staging.len() - cap;
                    inst.staging.drain(..cut - cut % 2);
                }
            }
        }
    }

    /// The staged audio as one chunk for the page (None when there is nothing to send).
    pub fn take_chunk(&mut self) -> Option<Vec<u8>> {
        let mut parts = Vec::new();
        let mut pcm: Vec<Vec<f32>> = Vec::new();
        let mut ids: Vec<&String> = self.instances.keys().collect();
        ids.sort();
        let keys: Vec<String> = ids.into_iter().cloned().collect();
        for k in keys {
            let inst = self.instances.get_mut(&k).expect("key");
            if inst.staging.is_empty() || !self.subs.contains(&inst.hello.id) {
                continue;
            }
            let data = std::mem::take(&mut inst.staging);
            parts.push(ChunkPart { id: inst.hello.id, n: data.len() / 2, drop: inst.reader.dropouts });
            pcm.push(data);
        }
        if parts.is_empty() {
            return None;
        }
        self.seq += 1;
        let header = ChunkHeader { seq: self.seq, rate: self.rate, s: parts };
        let refs: Vec<&[f32]> = pcm.iter().map(|v| v.as_slice()).collect();
        Some(encode_chunk(&header, &refs))
    }

    /// Drop instances that went quiet (unlinking a dead process's segment); write heartbeats and names.
    pub fn housekeep(&mut self, now: Instant, alive: impl Fn(u32) -> bool) {
        let gone: Vec<String> = self
            .instances
            .iter()
            .filter(|(_, i)| now.duration_since(i.last_hello) > SILENT)
            .map(|(k, _)| k.clone())
            .collect();
        for k in gone {
            if let Some(i) = self.instances.remove(&k) {
                if !alive(i.hello.pid) {
                    drop(i.seg);
                    pfsend_protocol::unlink(&k);
                }
            }
        }
        let beat = unix_ms();
        for inst in self.instances.values() {
            let Some(seg) = inst.seg.as_ref() else { continue };
            let app = &seg.header().app;
            app.heartbeat_ms.store(beat, Ordering::Release);
            let (label, colour) = match self.names.get(&inst.hello.id) {
                Some(n) => (n.label.as_str(), n.colour.map(|c| (c & 0xFF_FFFF) | (1 << 24)).unwrap_or(0)),
                None => ("", 0),
            };
            if app.label.read().as_deref() != Some(label) {
                app.label.write(label);
            }
            app.colour.store(colour, Ordering::Release);
        }
    }

    pub fn list(&self, now: Instant) -> Vec<InstanceInfo> {
        let mut out: Vec<InstanceInfo> = self
            .instances
            .iter()
            .map(|(k, i)| {
                let (status, rate, dropouts) = match i.seg.as_ref() {
                    None => (SendStatus::Unreadable, i.hello.sample_rate as f64, 0),
                    Some(seg) => {
                        let h = seg.header();
                        let st = if h.flags() & FLAG_OFFLINE != 0 {
                            SendStatus::Offline
                        } else if now.duration_since(i.last_frames) > STALE {
                            SendStatus::Paused
                        } else {
                            SendStatus::Streaming
                        };
                        (st, h.sample_rate(), i.reader.dropouts)
                    }
                };
                InstanceInfo {
                    key: k.clone(),
                    id: i.hello.id,
                    name: i.hello.name.clone(),
                    sample_rate: rate,
                    status,
                    level: i.level.min(1.0),
                    dropouts,
                    version: i.hello.version.clone(),
                    pid: i.hello.pid,
                    subscribed: self.subs.contains(&i.hello.id),
                }
            })
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id).then(a.key.cmp(&b.key)));
        out
    }
}

// ── The threads and commands ────────────────────────────────────────────────────────────────────

struct Running {
    listener: osc_listener::Listener,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

pub struct LiveSendState {
    hub: Arc<Mutex<Hub>>,
    channel: Arc<Mutex<Option<Channel<InvokeResponseBody>>>>,
    running: Mutex<Option<Running>>,
}

impl Default for LiveSendState {
    fn default() -> Self {
        Self { hub: Arc::new(Mutex::new(Hub::new())), channel: Arc::new(Mutex::new(None)), running: Mutex::new(None) }
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Start listening for Playfield Send instances; their subscribed audio comes through `on_audio`.
#[tauri::command]
pub fn live_send_start(app: AppHandle, state: State<LiveSendState>, on_audio: Channel<InvokeResponseBody>) -> Result<u16, String> {
    *lock(&state.channel) = Some(on_audio);
    let mut running = lock(&state.running);
    if let Some(r) = running.as_ref() {
        return Ok(r.listener.port());
    }
    let hub = state.hub.clone();
    let listener = osc_listener::Listener::start(HELLO_PORT, false, move |packet: Vec<u8>| {
        lock(&hub).on_packet(&packet, Instant::now());
    })
    .map_err(|e| e.replace("is the Node bridge or another OSC app running?", "is another Playfield window running?"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let (hub, channel, flag) = (state.hub.clone(), state.channel.clone(), stop.clone());
    let thread = std::thread::Builder::new()
        .name("live-send-reader".into())
        .spawn(move || {
            let mut last_batch = Instant::now();
            let mut last_list = Instant::now();
            while !flag.load(Ordering::Relaxed) {
                let now = Instant::now();
                let chunk = {
                    let mut h = lock(&hub);
                    h.poll(now);
                    if now.duration_since(last_batch) >= BATCH {
                        last_batch = now;
                        h.take_chunk()
                    } else {
                        None
                    }
                };
                if let Some(bytes) = chunk {
                    if let Some(ch) = lock(&channel).as_ref() {
                        let _ = ch.send(InvokeResponseBody::Raw(bytes));
                    }
                }
                if now.duration_since(last_list) >= LIST_EVERY {
                    last_list = now;
                    let list = {
                        let mut h = lock(&hub);
                        h.housekeep(now, pfsend_protocol::pid_alive);
                        h.list(now)
                    };
                    let _ = app.emit("live-send-list", list);
                }
                std::thread::sleep(POLL);
            }
        })
        .map_err(|e| e.to_string())?;
    let port = listener.port();
    *running = Some(Running { listener, stop, thread: Some(thread) });
    Ok(port)
}

#[tauri::command]
pub fn live_send_stop(state: State<LiveSendState>) {
    lock(&state.running).take();
    lock(&state.channel).take();
    lock(&state.hub).subscribe(&[], 0.0);
}

/// Which instances the page wants audio from (by Pairing ID), at its AudioContext's rate.
#[tauri::command]
pub fn live_send_subscribe(state: State<LiveSendState>, ids: Vec<u32>, rate: f64) {
    lock(&state.hub).subscribe(&ids, rate);
}

/// Names and colours per ID (the Live connector's tracks, or names set in Playfield), written back to the plugins.
#[tauri::command]
pub fn live_send_names(state: State<LiveSendState>, names: Vec<SendName>) {
    lock(&state.hub).set_names(names);
}

#[tauri::command]
pub fn live_send_list(state: State<LiveSendState>) -> Vec<InstanceInfo> {
    lock(&state.hub).list(Instant::now())
}

// ── Installing the plugin ───────────────────────────────────────────────────────────────────────

pub const BUNDLE_NAME: &str = "Playfield Send.vst3";

/// `<string>` after `<key>name</key>` in an Info.plist.
pub fn plist_string(xml: &str, key: &str) -> Option<String> {
    let k = xml.find(&format!("<key>{key}</key>"))?;
    let rest = &xml[k..];
    let s = rest.find("<string>")? + 8;
    let e = rest[s..].find("</string>")?;
    Some(rest[s..s + e].trim().to_string())
}

/// A bundle's version (its Info.plist's CFBundleShortVersionString).
pub fn bundle_version(bundle: &Path) -> Option<String> {
    plist_string(&fs::read_to_string(bundle.join("Contents/Info.plist")).ok()?, "CFBundleShortVersionString")
}

/// Does a file or folder carry the quarantine attribute?
#[cfg(target_os = "macos")]
pub fn quarantined(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(p) = std::ffi::CString::new(path.as_os_str().as_bytes()) else { return false };
    let n = unsafe { libc::getxattr(p.as_ptr(), c"com.apple.quarantine".as_ptr(), std::ptr::null_mut(), 0, 0, libc::XATTR_NOFOLLOW) };
    n >= 0
}

#[cfg(not(target_os = "macos"))]
pub fn quarantined(_path: &Path) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn unquarantine(path: &Path) {
    use std::os::unix::ffi::OsStrExt;
    if let Ok(p) = std::ffi::CString::new(path.as_os_str().as_bytes()) {
        unsafe { libc::removexattr(p.as_ptr(), c"com.apple.quarantine".as_ptr(), libc::XATTR_NOFOLLOW) };
    }
}

#[cfg(not(target_os = "macos"))]
fn unquarantine(_path: &Path) {}

/// Copy a folder tree by writing fresh files (contents and permissions only): no extended
/// attributes come along, so nothing carries a quarantine flag from wherever the source came from.
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let ty = e.file_type()?;
        let dest = to.join(e.file_name());
        if ty.is_dir() {
            copy_tree(&e.path(), &dest)?;
        } else if ty.is_symlink() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(fs::read_link(e.path())?, &dest)?;
        } else {
            fs::write(&dest, fs::read(e.path())?)?;
            fs::set_permissions(&dest, fs::metadata(e.path())?.permissions())?;
        }
        unquarantine(&dest);
    }
    unquarantine(to);
    Ok(())
}

/// Swap two paths atomically where the system can (macOS `renamex_np(RENAME_SWAP)`).
#[cfg(target_os = "macos")]
fn swap(a: &Path, b: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let (Ok(pa), Ok(pb)) = (std::ffi::CString::new(a.as_os_str().as_bytes()), std::ffi::CString::new(b.as_os_str().as_bytes())) else { return false };
    unsafe { libc::renamex_np(pa.as_ptr(), pb.as_ptr(), libc::RENAME_SWAP) == 0 }
}

#[cfg(not(target_os = "macos"))]
fn swap(_a: &Path, _b: &Path) -> bool {
    false
}

/// Copy `bundle` into `folder` as "Playfield Send.vst3": written beside it under a temporary name,
/// then swapped in at once, so a Live with the old one loaded keeps running (it holds the old file).
pub fn install_bundle(bundle: &Path, folder: &Path) -> Result<PathBuf, String> {
    if !bundle.join("Contents/MacOS").is_dir() {
        return Err(format!("{} isn’t a plug-in bundle", bundle.display()));
    }
    fs::create_dir_all(folder).map_err(|e| format!("Couldn’t make {}: {e}", folder.display()))?;
    let target = folder.join(BUNDLE_NAME);
    let staging = folder.join(format!(".{BUNDLE_NAME}.installing-{}", std::process::id()));
    let _ = fs::remove_dir_all(&staging);
    copy_tree(bundle, &staging).map_err(|e| {
        let _ = fs::remove_dir_all(&staging);
        format!("Couldn’t copy the plug-in: {e}")
    })?;
    if target.exists() {
        if swap(&staging, &target) {
            // `staging` now holds the old copy.
            let _ = fs::remove_dir_all(&staging);
            return Ok(target);
        }
        let old = folder.join(format!(".{BUNDLE_NAME}.old-{}", std::process::id()));
        let _ = fs::remove_dir_all(&old);
        fs::rename(&target, &old).map_err(|e| format!("Couldn’t move the old plug-in aside: {e}"))?;
        fs::rename(&staging, &target).map_err(|e| format!("Couldn’t put the plug-in in place: {e}"))?;
        let _ = fs::remove_dir_all(&old);
    } else {
        fs::rename(&staging, &target).map_err(|e| format!("Couldn’t put the plug-in in place: {e}"))?;
    }
    Ok(target)
}

/// ~/Library/Audio/Plug-Ins/VST3 (per user: no admin rights; Live scans it by default).
fn vst3_folder() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Audio/Plug-Ins/VST3"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA").map(|a| PathBuf::from(a).join("Programs/Common/VST3"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".vst3"))
    }
}

/// The plug-in shipped with the app: a resource in a built app; the repo's build in development.
fn bundled_plugin(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("plugins").join(BUNDLE_NAME);
        if p.join("Contents/MacOS").is_dir() {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tools/playfield-send/bundle").join(BUNDLE_NAME);
    dev.join("Contents/MacOS").is_dir().then_some(dev)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStatus {
    /// The version this app carries (None: not built into this app).
    pub bundled_version: Option<String>,
    pub installed_version: Option<String>,
    pub installed_path: Option<String>,
    pub folder: Option<String>,
    /// The installed copy has the quarantine attribute (it was downloaded separately).
    pub quarantined: bool,
}

fn plugin_status(app: &AppHandle) -> PluginStatus {
    let folder = vst3_folder();
    let installed = folder.as_ref().map(|f| f.join(BUNDLE_NAME)).filter(|p| p.exists());
    PluginStatus {
        bundled_version: bundled_plugin(app).as_deref().and_then(bundle_version),
        installed_version: installed.as_deref().and_then(bundle_version),
        quarantined: installed.as_deref().map(quarantined).unwrap_or(false),
        installed_path: installed.map(|p| p.display().to_string()),
        folder: folder.map(|p| p.display().to_string()),
    }
}

#[tauri::command]
pub fn pfsend_status(app: AppHandle) -> PluginStatus {
    plugin_status(&app)
}

/// Install (or update) Playfield Send into the per-user VST3 folder.
#[tauri::command]
pub fn pfsend_install(app: AppHandle) -> Result<PluginStatus, String> {
    let bundle = bundled_plugin(&app).ok_or("This build of Playfield doesn’t include the plug-in")?;
    let folder = vst3_folder().ok_or("Couldn’t find your plug-ins folder")?;
    install_bundle(&bundle, &folder)?;
    Ok(plugin_status(&app))
}

#[cfg(test)]
mod tests {
    use super::*;
    use pfsend_protocol::fake::{FakeInstance, FakeOptions};
    use std::net::UdpSocket;

    #[test]
    fn a_sine_keeps_its_pitch_from_44_1_to_48_khz() {
        let (from, to, hz) = (44_100.0, 48_000.0, 1000.0);
        let mut rs = Resampler::new(from, to);
        let mut out = Vec::new();
        let total = 44_100 * 2;
        let input: Vec<f32> = (0..total).flat_map(|i| {
            let v = (std::f64::consts::TAU * hz * i as f64 / from).sin() as f32;
            [v, v]
        }).collect();
        // Odd block sizes, as Live's are.
        let mut at = 0;
        for k in 0.. {
            let n = [128, 441, 256, 1000, 37][k % 5];
            if at >= total { break; }
            let end = (at + n).min(total);
            rs.process(&input[at * 2..end * 2], &mut out);
            at = end;
        }
        let frames = out.len() / 2;
        assert!((frames as f64 - 2.0 * to).abs() < 3.0, "two seconds in, two seconds out ({frames})");
        // Rising zero crossings → frequency.
        let left: Vec<f32> = out.chunks(2).map(|f| f[0]).collect();
        let ups: Vec<usize> = (1..left.len()).filter(|&i| left[i - 1] < 0.0 && left[i] >= 0.0).collect();
        let span = (ups[ups.len() - 1] - ups[0]) as f64 / to;
        let measured = (ups.len() - 1) as f64 / span;
        assert!((measured - hz).abs() < 0.5, "pitch {measured} Hz");
        // And it is still a sine: no clicks between blocks.
        let step_max = left.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
        assert!(step_max < 0.14, "largest step {step_max}");
    }

    #[test]
    fn the_identity_passes_frames_unchanged() {
        let mut rs = Resampler::new(48_000.0, 48_000.0);
        let mut out = Vec::new();
        rs.process(&[0.1, 0.2, 0.3, 0.4], &mut out);
        assert_eq!(out, [0.1, 0.2, 0.3, 0.4]);
    }

    #[test]
    fn chunks_round_trip() {
        let h = ChunkHeader { seq: 7, rate: 48_000.0, s: vec![ChunkPart { id: 4821, n: 2, drop: 0 }, ChunkPart { id: 12, n: 1, drop: 3 }] };
        let a = [0.5f32, -0.5, 0.25, -0.25];
        let b = [1.0f32, -1.0];
        let bytes = encode_chunk(&h, &[&a, &b]);
        let len = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        assert_eq!((4 + len) % 4, 0, "PCM starts 4-byte aligned");
        let (h2, parts) = decode_chunk(&bytes).unwrap();
        assert_eq!(h2, h);
        assert_eq!(parts, vec![a.to_vec(), b.to_vec()]);
    }

    /// A listener on a free port feeding a hub, like live_send_start does on 11102.
    fn hub_with_listener() -> (Arc<Mutex<Hub>>, osc_listener::Listener) {
        let hub = Arc::new(Mutex::new(Hub::new()));
        let h = hub.clone();
        let l = osc_listener::Listener::start(0, false, move |p: Vec<u8>| lock(&h).on_packet(&p, Instant::now())).unwrap();
        (hub, l)
    }

    fn wait_for(mut f: impl FnMut() -> bool, what: &str) {
        let t = Instant::now();
        while !f() {
            assert!(t.elapsed() < Duration::from_secs(5), "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn the_fake_plugin_is_found_metered_and_streamed_to_the_page() {
        let (hub, l) = hub_with_listener();
        let fake = FakeInstance::start(FakeOptions { id: 4821, name: "Drums".into(), index: 501, sample_rate: 44_100.0, block: 128, hello_port: l.port(), ..FakeOptions::default() }).unwrap();
        wait_for(|| lock(&hub).list(Instant::now()).len() == 1, "the hello");
        lock(&hub).subscribe(&[4821], 48_000.0);
        let mut frames = 0usize;
        let started = Instant::now();
        while started.elapsed() < Duration::from_millis(400) {
            let mut h = lock(&hub);
            h.poll(Instant::now());
            if let Some(bytes) = h.take_chunk() {
                let (head, parts) = decode_chunk(&bytes).unwrap();
                assert_eq!(head.rate, 48_000.0);
                assert_eq!(head.s[0].id, 4821);
                frames += parts[0].len() / 2;
            }
            drop(h);
            std::thread::sleep(Duration::from_millis(10));
        }
        // ~400 ms at 48 kHz, give or take the first read and the timing of the sleeps.
        assert!(frames > 12_000 && frames < 24_000, "{frames} frames");
        let list = lock(&hub).list(Instant::now());
        assert_eq!(list[0].name, "Drums");
        assert_eq!(list[0].sample_rate, 44_100.0);
        assert_eq!(list[0].status, SendStatus::Streaming);
        assert!(list[0].level > 0.01 && list[0].subscribed);
        // Heartbeat and names reach the plugin's window.
        lock(&hub).set_names(vec![SendName { id: 4821, label: "Drums".into(), colour: Some(0xFF3300) }]);
        lock(&hub).housekeep(Instant::now(), |_| true);
        let seg = Segment::open(&fake.shm).unwrap();
        assert_eq!(seg.header().app.label.read().as_deref(), Some("Drums"));
        assert_eq!(seg.header().app_colour(), Some(0xFF3300));
        assert!(seg.header().app.heartbeat_ms.load(Ordering::Acquire) > 0);
        drop(seg);
        // A bye removes it.
        fake.stop();
        wait_for(|| lock(&hub).list(Instant::now()).is_empty(), "the bye");
    }

    #[test]
    fn unsubscribed_instances_only_get_a_meter() {
        let (hub, l) = hub_with_listener();
        let _fake = FakeInstance::start(FakeOptions { id: 1234, index: 502, hello_port: l.port(), ..FakeOptions::default() }).unwrap();
        wait_for(|| !lock(&hub).list(Instant::now()).is_empty(), "the hello");
        for _ in 0..20 {
            lock(&hub).poll(Instant::now());
            std::thread::sleep(Duration::from_millis(5));
        }
        let mut h = lock(&hub);
        assert!(h.take_chunk().is_none());
        assert!(h.list(Instant::now())[0].level > 0.0);
        assert!(!h.list(Instant::now())[0].subscribed);
    }

    #[test]
    fn paused_offline_and_a_rate_change() {
        let (hub, l) = hub_with_listener();
        let _fake = FakeInstance::start(FakeOptions {
            id: 77, index: 503, sample_rate: 48_000.0, hello_port: l.port(),
            offline_from: 0.25, offline_to: 0.6, rate_change_after: 0.8, rate_change_to: 44_100.0,
            ..FakeOptions::default()
        }).unwrap();
        wait_for(|| !lock(&hub).list(Instant::now()).is_empty(), "the hello");
        lock(&hub).subscribe(&[77], 48_000.0);
        let mut seen = HashSet::new();
        let started = Instant::now();
        while started.elapsed() < Duration::from_millis(1300) {
            let mut h = lock(&hub);
            h.poll(Instant::now());
            let _ = h.take_chunk();
            let l = h.list(Instant::now());
            seen.insert(format!("{:?}", l[0].status));
            if started.elapsed() > Duration::from_millis(1100) {
                assert_eq!(l[0].sample_rate, 44_100.0, "the new rate is read from the segment");
            }
            drop(h);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(seen.contains("Offline"), "{seen:?}");
        assert!(seen.contains("Streaming"), "{seen:?}");
    }

    #[test]
    fn a_crashed_plugin_is_dropped_and_its_segment_unlinked() {
        let (hub, l) = hub_with_listener();
        let fake = FakeInstance::start(FakeOptions { id: 5, index: 504, hello_port: l.port(), crash_after: 0.2, ..FakeOptions::default() }).unwrap();
        let shm = fake.shm.clone();
        wait_for(|| !lock(&hub).list(Instant::now()).is_empty(), "the hello");
        wait_for(|| fake.finished(), "the crash");
        // The segment is still there (no bye, not unlinked).
        assert!(Segment::open(&shm).is_ok());
        // Seconds later, with its process gone, it is dropped and unlinked.
        lock(&hub).housekeep(Instant::now() + SILENT + Duration::from_secs(1), |_| false);
        assert!(lock(&hub).list(Instant::now()).is_empty());
        assert!(Segment::open(&shm).is_err());
    }

    #[test]
    fn a_stalled_writer_reads_as_paused_and_garbage_is_ignored() {
        let mut hub = Hub::new();
        hub.on_packet(b"not osc at all", Instant::now());
        let mut buf = Vec::new();
        pfsend_protocol::encode_hello(&Hello { id: 1, name: String::new(), shm: "/elsewhere".into(), sample_rate: 48_000.0, channels: 2, pid: 1, version: "1.0.0".into(), generation: 0, flags: 0 }, &mut buf);
        hub.on_packet(&buf, Instant::now());
        assert!(hub.list(Instant::now()).is_empty(), "only /pfsend.* names are mapped");
        // A real segment that nobody writes: Paused once the grace period passes.
        let name = pfsend_protocol::shm_name(std::process::id(), 505);
        let seg = Segment::create(&name, 48_000.0, 1 << 16, std::process::id(), 9).unwrap();
        pfsend_protocol::encode_hello(&Hello { id: 9, name: String::new(), shm: name.clone(), sample_rate: 48_000.0, channels: 2, pid: std::process::id(), version: "1.0.0".into(), generation: 0, flags: 1 }, &mut buf);
        let t0 = Instant::now();
        hub.on_packet(&buf, t0);
        hub.poll(t0);
        assert_eq!(hub.list(t0)[0].status, SendStatus::Streaming);
        hub.poll(t0 + Duration::from_millis(400));
        assert_eq!(hub.list(t0 + Duration::from_millis(400))[0].status, SendStatus::Paused);
        drop(seg);
    }

    #[test]
    fn the_plist_version_and_install_with_an_atomic_swap_and_no_quarantine() {
        let root = std::env::temp_dir().join(format!("pf-send-install-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let make = |dir: &Path, v: &str| {
            fs::create_dir_all(dir.join("Contents/MacOS")).unwrap();
            fs::create_dir_all(dir.join("Contents/Resources")).unwrap();
            fs::write(dir.join("Contents/Info.plist"), format!("<dict><key>CFBundleShortVersionString</key>\n\t<string>{v}</string></dict>")).unwrap();
            fs::write(dir.join("Contents/MacOS/Playfield Send"), b"\xcf\xfa\xed\xfe binary").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(dir.join("Contents/MacOS/Playfield Send"), fs::Permissions::from_mode(0o755)).unwrap();
            }
        };
        let v1 = root.join("app1").join(BUNDLE_NAME);
        let v2 = root.join("app2").join(BUNDLE_NAME);
        make(&v1, "1.0.0");
        make(&v2, "1.1.0");
        // The app's own copy may carry quarantine (copied out of a downloaded disk image).
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::ffi::OsStrExt;
            for p in [v2.clone(), v2.join("Contents/MacOS/Playfield Send")] {
                let c = std::ffi::CString::new(p.as_os_str().as_bytes()).unwrap();
                let val = b"0083;00000000;Safari;";
                let r = unsafe { libc::setxattr(c.as_ptr(), c"com.apple.quarantine".as_ptr(), val.as_ptr() as *const _, val.len(), 0, 0) };
                assert_eq!(r, 0, "set a quarantine flag on the source");
            }
            assert!(quarantined(&v2));
        }
        assert_eq!(bundle_version(&v1).as_deref(), Some("1.0.0"));
        let folder = root.join("Plug-Ins/VST3");
        let at = install_bundle(&v1, &folder).unwrap();
        assert_eq!(bundle_version(&at).as_deref(), Some("1.0.0"));
        // Live has the old one open: its file handle keeps working after the swap.
        let held = fs::File::open(at.join("Contents/MacOS/Playfield Send")).unwrap();
        install_bundle(&v2, &folder).unwrap();
        assert_eq!(bundle_version(&at).as_deref(), Some("1.1.0"));
        assert!(held.metadata().is_ok(), "the old file is still open");
        assert!(!quarantined(&at), "the installed bundle has no quarantine flag");
        assert!(!quarantined(&at.join("Contents/MacOS/Playfield Send")), "nor its binary");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(at.join("Contents/MacOS/Playfield Send")).unwrap().permissions().mode() & 0o111, 0o111, "still executable");
        }
        // Nothing left behind but the plug-in.
        let names: Vec<String> = fs::read_dir(&folder).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        assert_eq!(names, [BUNDLE_NAME]);
        assert!(install_bundle(&root.join("nothing"), &folder).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    /// The real bundle, when it has been built (bash tools/playfield-send/bundle.sh): an installed
    /// copy still passes codesign's check and carries no quarantine flag.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_built_bundle_installs_signed_and_unquarantined() {
        let built = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tools/playfield-send/bundle").join(BUNDLE_NAME);
        if !built.join("Contents/MacOS").is_dir() {
            eprintln!("skipped: the plug-in isn't built");
            return;
        }
        let folder = std::env::temp_dir().join(format!("pf-send-real-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        let at = install_bundle(&built, &folder).unwrap();
        let out = std::process::Command::new("codesign").args(["--verify", "--strict"]).arg(&at).output().unwrap();
        assert!(out.status.success(), "codesign: {}", String::from_utf8_lossy(&out.stderr));
        let x = std::process::Command::new("xattr").arg("-lr").arg(&at).output().unwrap();
        assert!(!String::from_utf8_lossy(&x.stdout).contains("com.apple.quarantine"));
        let _ = fs::remove_dir_all(&folder);
    }

    #[test]
    fn hellos_from_a_real_socket() {
        // The wire: a fake plugin's hello reaches a listener as one datagram the hub understands.
        let rx = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = rx.local_addr().unwrap().port();
        rx.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let fake = FakeInstance::start(FakeOptions { id: 4242, index: 506, hello_port: port, ..FakeOptions::default() }).unwrap();
        let mut buf = [0u8; 512];
        let (n, _) = rx.recv_from(&mut buf).unwrap();
        let mut hub = Hub::new();
        hub.on_packet(&buf[..n], Instant::now());
        assert_eq!(hub.list(Instant::now())[0].id, 4242);
        drop(fake);
    }
}
