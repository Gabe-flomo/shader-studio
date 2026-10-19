//! The plugin: one object that is the component, the audio processor and the edit controller
//! (a "single component" VST3: the host finds the controller by querying the component).
//!
//! - **process()** (Live's audio thread): copy the input to the output when they aren't the same
//!   buffers (bit-exact pass-through), then copy the input into the shared-memory ring, and keep
//!   the meter's peaks. No allocation, no locks, no syscalls, no logging. Offline renders (Export,
//!   Freeze) pass through but aren't sent.
//! - **setupProcessing / setActive** (main thread): make the segment for Live's sample rate, or
//!   bump its generation when the rate changes in place.
//! - **Pairing ID** (the one parameter): random on first load, kept in the state, re-rolled when a
//!   duplicated track copies one that is taken (pairing.rs), and Live is told.
//! - **The announce thread** sends a hello a second (announce.rs).

use std::ffi::c_char;
use std::ptr;
use std::slice;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use vst3::Steinberg::Vst::*;
use vst3::Steinberg::*;
use vst3::{uid, Class, ComPtr, ComRef};

use pfsend_protocol::{capacity_for, shm_name, Segment, FLAG_ACTIVE, FLAG_OFFLINE, PAIRING_MAX};

use crate::announce::Announcer;
use crate::pairing::{self, id_to_normalized, normalized_to_id, Rng};
use crate::shared::{raise_peak, Shared};
use crate::strings::{copy_wstring, read_wstring};

/// The Pairing ID parameter's id.
pub const PARAM_PAIRING: ParamID = 0;

/// Every segment this process makes gets the next number (`/pfsend.<pid>.<n>`).
static NEXT_SEGMENT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// The saved state: "PFS1", the ID (u32 LE), the name's length (u8) and bytes.
const STATE_MAGIC: &[u8; 4] = b"PFS1";

struct MainState {
    handler: Option<ComPtr<IComponentHandler>>,
    /// Every segment made (the newest is the live one); freed only in terminate.
    segments: Vec<Box<Segment>>,
    announcer: Option<Announcer>,
    rng: Rng,
    /// The ID was changed by us (a re-roll) and Live hasn't been told yet.
    tell_host: bool,
    in_channels: i32,
    out_channels: i32,
    claimed: bool,
}

pub struct PlayfieldSend {
    pub shared: Arc<Shared>,
    main: Mutex<MainState>,
}

impl Class for PlayfieldSend {
    type Interfaces = (IComponent, IAudioProcessor, IEditController, IProcessContextRequirements);
}

impl PlayfieldSend {
    pub const CID: TUID = uid(0x5046_5345, 0x4E44_0001, 0x9A1C_4B7E, 0x3D2F_6A10);

    pub fn new() -> Self {
        let shared = Arc::new(Shared::new());
        let salt = Arc::as_ptr(&shared) as u64;
        Self {
            shared,
            main: Mutex::new(MainState {
                handler: None,
                segments: Vec::new(),
                announcer: None,
                rng: Rng::new(salt),
                tell_host: false,
                in_channels: 2,
                out_channels: 2,
                claimed: false,
            }),
        }
    }

    fn main(&self) -> std::sync::MutexGuard<'_, MainState> {
        self.main.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The registry's key for this instance.
    fn owner(&self) -> usize {
        Arc::as_ptr(&self.shared) as usize
    }

    pub fn pairing_id(&self) -> u32 {
        self.shared.pairing_id.load(Ordering::Relaxed)
    }

    /// Take `wanted` (or a fresh ID), store it everywhere, and remember to tell Live if it changed.
    fn claim(&self, m: &mut MainState, wanted: Option<u32>) {
        let c = pairing::claim(self.owner(), wanted, &mut m.rng);
        m.claimed = true;
        self.set_id(c.id);
        if c.rerolled {
            m.tell_host = true;
        }
    }

    fn set_id(&self, id: u32) {
        self.shared.pairing_id.store(id, Ordering::Relaxed);
        if let Some(seg) = self.shared.segment() {
            seg.header().pairing_id.store(id, Ordering::Release);
        }
    }

    /// Tell Live the parameter's value changed (a re-roll). Main thread.
    fn tell_host_if_needed(&self, m: &mut MainState) {
        if !m.tell_host {
            return;
        }
        if let Some(h) = m.handler.as_ref() {
            m.tell_host = false;
            unsafe {
                h.restartComponent(RestartFlags_::kParamValuesChanged as i32);
            }
        }
    }

    /// The segment for Live's current rate: kept (a generation bump when only the rate changed),
    /// or a new one when the ring would be too small.
    fn ensure_segment(&self, m: &mut MainState, sample_rate: f64) -> bool {
        let need = capacity_for(sample_rate);
        if let Some(seg) = m.segments.last() {
            let h = seg.header();
            if h.capacity_frames >= need {
                if h.sample_rate() != sample_rate {
                    h.sample_rate.store(sample_rate.to_bits(), Ordering::Release);
                    h.generation.fetch_add(1, Ordering::AcqRel);
                }
                return true;
            }
        }
        let pid = std::process::id();
        let name = shm_name(pid, NEXT_SEGMENT.fetch_add(1, Ordering::Relaxed));
        match Segment::create(&name, sample_rate, need, pid, self.pairing_id()) {
            Ok(seg) => {
                let seg = Box::new(seg);
                if let Ok(mut a) = self.shared.announce.lock() {
                    seg.header().name.write(&a.1);
                    a.0 = name;
                }
                let p = &*seg as *const Segment as *mut Segment;
                m.segments.push(seg);
                self.shared.seg.store(p, Ordering::Release);
                true
            }
            // Couldn't make one (out of shm space?): the plugin still passes audio through.
            Err(_) => false,
        }
    }

    fn write_state(&self, stream: *mut IBStream) -> tresult {
        let Some(s) = (unsafe { ComRef::from_raw(stream) }) else { return kInvalidArgument };
        let name = self.shared.announce.lock().map(|a| a.1.clone()).unwrap_or_default();
        let name = &name.as_bytes()[..name.len().min(255)];
        let mut out = Vec::with_capacity(9 + name.len());
        out.extend_from_slice(STATE_MAGIC);
        out.extend_from_slice(&self.pairing_id().to_le_bytes());
        out.push(name.len() as u8);
        out.extend_from_slice(name);
        let mut written = 0;
        let r = unsafe { s.write(out.as_mut_ptr() as *mut _, out.len() as i32, &mut written) };
        if r == kResultOk && written as usize == out.len() { kResultOk } else { kResultFalse }
    }

    fn read_state(stream: *mut IBStream) -> Option<(u32, String)> {
        let s = unsafe { ComRef::from_raw(stream) }?;
        let mut head = [0u8; 9];
        let mut got = 0;
        if unsafe { s.read(head.as_mut_ptr() as *mut _, 9, &mut got) } != kResultOk || got != 9 || &head[..4] != STATE_MAGIC {
            return None;
        }
        let id = u32::from_le_bytes([head[4], head[5], head[6], head[7]]).min(PAIRING_MAX);
        let mut name = vec![0u8; head[8] as usize];
        if !name.is_empty() {
            let mut n = 0;
            unsafe { s.read(name.as_mut_ptr() as *mut _, name.len() as i32, &mut n) };
            name.truncate(n.max(0) as usize);
        }
        Some((id, String::from_utf8_lossy(&name).into_owned()))
    }

    /// The audio thread's work, on plain slices (process() unpacks the host's buffers into these).
    /// Returns nothing; never allocates, locks or blocks.
    #[inline]
    pub fn send_block(&self, left: &[f32], right: &[f32], frames: usize, offline: bool) {
        let sh = &*self.shared;
        let mut pl = 0f32;
        let mut pr = 0f32;
        for i in 0..frames.min(left.len()).min(right.len()) {
            pl = pl.max(left[i].abs());
            pr = pr.max(right[i].abs());
        }
        raise_peak(&sh.peak[0], pl);
        raise_peak(&sh.peak[1], pr);
        if offline != sh.offline.load(Ordering::Relaxed) {
            sh.offline.store(offline, Ordering::Relaxed);
            if let Some(seg) = sh.segment() {
                seg.header().set_flag(FLAG_OFFLINE, offline);
            }
        }
        if offline {
            return;
        }
        let p = sh.seg.load(Ordering::Acquire);
        if let Some(seg) = unsafe { p.as_ref() } {
            seg.write(left, right, frames);
        }
        sh.frames.fetch_add(frames as u64, Ordering::Relaxed);
    }
}

impl Default for PlayfieldSend {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for PlayfieldSend {
    fn drop(&mut self) {
        // Normally terminate() did all this; a host that never called it still leaves nothing behind.
        self.shared.seg.store(ptr::null_mut(), Ordering::Release);
        let mut m = self.main();
        if let Some(a) = m.announcer.take() {
            a.stop();
        }
        m.segments.clear();
        drop(m);
        pairing::release(self.owner());
    }
}

// ── IPluginBase ─────────────────────────────────────────────────────────────────────────────────

impl IPluginBaseTrait for PlayfieldSend {
    unsafe fn initialize(&self, _context: *mut FUnknown) -> tresult {
        let mut m = self.main();
        if !m.claimed {
            self.claim(&mut m, None);
        }
        // (Unit tests don't announce: a running Playfield would list them.)
        if m.announcer.is_none() && !cfg!(test) {
            m.announcer = Announcer::start(self.shared.clone());
        }
        kResultOk
    }

    unsafe fn terminate(&self) -> tresult {
        self.shared.seg.store(ptr::null_mut(), Ordering::Release);
        let mut m = self.main();
        if let Some(a) = m.announcer.take() {
            a.stop(); // says bye
        }
        m.segments.clear(); // unlinks
        m.handler = None;
        m.claimed = false;
        drop(m);
        pairing::release(self.owner());
        kResultOk
    }
}

// ── IComponent ──────────────────────────────────────────────────────────────────────────────────

impl IComponentTrait for PlayfieldSend {
    unsafe fn getControllerClassId(&self, _class_id: *mut TUID) -> tresult {
        // Single component: the host queries this object for IEditController.
        kResultFalse
    }

    unsafe fn setIoMode(&self, _mode: IoMode) -> tresult {
        kResultOk
    }

    unsafe fn getBusCount(&self, media_type: MediaType, _dir: BusDirection) -> i32 {
        if media_type == MediaTypes_::kAudio as MediaType { 1 } else { 0 }
    }

    unsafe fn getBusInfo(&self, media_type: MediaType, dir: BusDirection, index: i32, bus: *mut BusInfo) -> tresult {
        if media_type != MediaTypes_::kAudio as MediaType || index != 0 || bus.is_null() {
            return kInvalidArgument;
        }
        let m = self.main();
        let bus = &mut *bus;
        bus.mediaType = MediaTypes_::kAudio as MediaType;
        bus.direction = dir;
        bus.busType = BusTypes_::kMain as BusType;
        bus.flags = BusInfo_::BusFlags_::kDefaultActive as u32;
        if dir == BusDirections_::kInput as BusDirection {
            bus.channelCount = m.in_channels;
            copy_wstring("Input", &mut bus.name);
        } else {
            bus.channelCount = m.out_channels;
            copy_wstring("Output", &mut bus.name);
        }
        kResultOk
    }

    unsafe fn getRoutingInfo(&self, _in_info: *mut RoutingInfo, _out_info: *mut RoutingInfo) -> tresult {
        kNotImplemented
    }

    unsafe fn activateBus(&self, _media_type: MediaType, _dir: BusDirection, _index: i32, _state: TBool) -> tresult {
        kResultOk
    }

    unsafe fn setActive(&self, state: TBool) -> tresult {
        let on = state != 0;
        let mut m = self.main();
        if on {
            let sr = self.shared.sample_rate();
            self.ensure_segment(&mut m, sr);
        }
        self.shared.active.store(on, Ordering::Relaxed);
        if let Some(seg) = self.shared.segment() {
            seg.header().set_flag(FLAG_ACTIVE, on);
        }
        self.tell_host_if_needed(&mut m);
        kResultOk
    }

    unsafe fn setState(&self, state: *mut IBStream) -> tresult {
        let Some((id, name)) = Self::read_state(state) else { return kResultFalse };
        let mut m = self.main();
        if let Ok(mut a) = self.shared.announce.lock() {
            a.1 = name.clone();
        }
        if let Some(seg) = self.shared.segment() {
            seg.header().name.write(&name);
        }
        // A duplicated track's copy finds its ID taken and keeps a fresh one.
        self.claim(&mut m, Some(id));
        self.tell_host_if_needed(&mut m);
        kResultOk
    }

    unsafe fn getState(&self, state: *mut IBStream) -> tresult {
        self.write_state(state)
    }
}

// ── IAudioProcessor ─────────────────────────────────────────────────────────────────────────────

impl IAudioProcessorTrait for PlayfieldSend {
    unsafe fn setBusArrangements(&self, inputs: *mut SpeakerArrangement, num_ins: i32, outputs: *mut SpeakerArrangement, num_outs: i32) -> tresult {
        if num_ins != 1 || num_outs != 1 || inputs.is_null() || outputs.is_null() {
            return kResultFalse;
        }
        let (i, o) = (*inputs, *outputs);
        let ch = |a: SpeakerArrangement| if a == SpeakerArr::kStereo { Some(2) } else if a == SpeakerArr::kMono { Some(1) } else { None };
        match (ch(i), ch(o)) {
            (Some(a), Some(b)) if a == b => {
                let mut m = self.main();
                m.in_channels = a;
                m.out_channels = b;
                kResultTrue
            }
            _ => kResultFalse,
        }
    }

    unsafe fn getBusArrangement(&self, dir: BusDirection, index: i32, arr: *mut SpeakerArrangement) -> tresult {
        if index != 0 || arr.is_null() {
            return kInvalidArgument;
        }
        let m = self.main();
        let ch = if dir == BusDirections_::kInput as BusDirection { m.in_channels } else { m.out_channels };
        *arr = if ch == 1 { SpeakerArr::kMono } else { SpeakerArr::kStereo };
        kResultOk
    }

    unsafe fn canProcessSampleSize(&self, size: i32) -> tresult {
        if size == SymbolicSampleSizes_::kSample32 as i32 { kResultTrue } else { kResultFalse }
    }

    unsafe fn getLatencySamples(&self) -> u32 {
        0
    }

    unsafe fn setupProcessing(&self, setup: *mut ProcessSetup) -> tresult {
        let Some(setup) = setup.as_ref() else { return kInvalidArgument };
        if setup.symbolicSampleSize != SymbolicSampleSizes_::kSample32 as i32 || !(setup.sampleRate > 0.0) {
            return kResultFalse;
        }
        self.shared.sample_rate.store(setup.sampleRate.to_bits(), Ordering::Relaxed);
        let offline = setup.processMode == ProcessModes_::kOffline as i32;
        self.shared.offline.store(offline, Ordering::Relaxed);
        let mut m = self.main();
        if self.ensure_segment(&mut m, setup.sampleRate) {
            if let Some(seg) = self.shared.segment() {
                seg.header().set_flag(FLAG_OFFLINE, offline);
            }
        }
        kResultOk
    }

    unsafe fn setProcessing(&self, state: TBool) -> tresult {
        self.shared.processing.store(state != 0, Ordering::Relaxed);
        kResultOk
    }

    unsafe fn process(&self, data: *mut ProcessData) -> tresult {
        let Some(d) = data.as_ref() else { return kInvalidArgument };
        // The Pairing ID changed by the host (automation, Live's generic editor, the Remote Script).
        if let Some(changes) = ComRef::from_raw(d.inputParameterChanges) {
            for i in 0..changes.getParameterCount() {
                if let Some(q) = ComRef::from_raw(changes.getParameterData(i)) {
                    if q.getParameterId() == PARAM_PAIRING {
                        let n = q.getPointCount();
                        let (mut off, mut v) = (0, 0.0);
                        if n > 0 && q.getPoint(n - 1, &mut off, &mut v) == kResultTrue {
                            let id = normalized_to_id(v);
                            self.shared.pairing_id.store(id, Ordering::Relaxed);
                            if let Some(seg) = self.shared.segment() {
                                seg.header().pairing_id.store(id, Ordering::Relaxed);
                            }
                        }
                    }
                }
            }
        }
        let frames = d.numSamples.max(0) as usize;
        if frames == 0 || d.numInputs < 1 || d.numOutputs < 1 || d.inputs.is_null() || d.outputs.is_null() {
            return kResultOk;
        }
        if d.symbolicSampleSize != SymbolicSampleSizes_::kSample32 as i32 {
            return kResultOk;
        }
        let inb = &*d.inputs;
        let outb = &mut *d.outputs;
        let in_ch = inb.numChannels.max(0) as usize;
        let out_ch = outb.numChannels.max(0) as usize;
        let ins = inb.__field0.channelBuffers32;
        let outs = outb.__field0.channelBuffers32;
        if ins.is_null() || outs.is_null() || in_ch == 0 {
            return kResultOk;
        }
        let ins = slice::from_raw_parts(ins as *const *mut f32, in_ch);
        let outs = slice::from_raw_parts(outs as *const *mut f32, out_ch);
        // Pass-through, bit-exact: the same buffers (in place) need nothing; otherwise copy.
        for (c, &dst) in outs.iter().enumerate() {
            let src = ins[c.min(in_ch - 1)];
            if dst.is_null() || src.is_null() {
                continue;
            }
            if src != dst {
                ptr::copy(src as *const f32, dst, frames);
            }
        }
        outb.silenceFlags = inb.silenceFlags;
        if ins[0].is_null() {
            return kResultOk;
        }
        let left = slice::from_raw_parts(ins[0] as *const f32, frames);
        let right = if in_ch > 1 && !ins[1].is_null() { slice::from_raw_parts(ins[1] as *const f32, frames) } else { left };
        let offline = d.processMode == ProcessModes_::kOffline as i32;
        self.send_block(left, right, frames, offline);
        kResultOk
    }

    unsafe fn getTailSamples(&self) -> u32 {
        0
    }
}

impl IProcessContextRequirementsTrait for PlayfieldSend {
    unsafe fn getProcessContextRequirements(&self) -> u32 {
        0
    }
}

// ── IEditController ─────────────────────────────────────────────────────────────────────────────

impl IEditControllerTrait for PlayfieldSend {
    unsafe fn setComponentState(&self, _state: *mut IBStream) -> tresult {
        // Single component: the component's setState already applied it (and may have re-rolled the
        // ID, which this copy of the old state must not undo).
        kResultOk
    }

    unsafe fn setState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getParameterCount(&self) -> i32 {
        1
    }

    unsafe fn getParameterInfo(&self, index: i32, info: *mut ParameterInfo) -> tresult {
        if index != 0 || info.is_null() {
            return kInvalidArgument;
        }
        let info = &mut *info;
        info.id = PARAM_PAIRING;
        copy_wstring("Pairing ID", &mut info.title);
        copy_wstring("Pairing", &mut info.shortTitle);
        copy_wstring("", &mut info.units);
        info.stepCount = PAIRING_MAX as i32;
        info.defaultNormalizedValue = 0.0;
        info.unitId = 0;
        // Automatable so Live lists it for the Remote Script (Live only exposes automatable plugin
        // parameters in a device's parameter list); nobody needs to automate it.
        info.flags = ParameterInfo_::ParameterFlags_::kCanAutomate as i32;
        kResultOk
    }

    unsafe fn getParamStringByValue(&self, id: ParamID, value: ParamValue, string: *mut String128) -> tresult {
        if id != PARAM_PAIRING || string.is_null() {
            return kInvalidArgument;
        }
        copy_wstring(&normalized_to_id(value).to_string(), &mut *string);
        kResultOk
    }

    unsafe fn getParamValueByString(&self, id: ParamID, string: *mut TChar, value: *mut ParamValue) -> tresult {
        if id != PARAM_PAIRING || string.is_null() || value.is_null() {
            return kInvalidArgument;
        }
        match read_wstring(string).trim().parse::<u32>() {
            Ok(n) if n <= PAIRING_MAX => {
                *value = id_to_normalized(n);
                kResultOk
            }
            _ => kResultFalse,
        }
    }

    unsafe fn normalizedParamToPlain(&self, id: ParamID, value: ParamValue) -> ParamValue {
        if id == PARAM_PAIRING { normalized_to_id(value) as f64 } else { 0.0 }
    }

    unsafe fn plainParamToNormalized(&self, id: ParamID, plain: ParamValue) -> ParamValue {
        if id == PARAM_PAIRING { id_to_normalized(plain.max(0.0).round() as u32) } else { 0.0 }
    }

    unsafe fn getParamNormalized(&self, id: ParamID) -> ParamValue {
        if id == PARAM_PAIRING { id_to_normalized(self.pairing_id()) } else { 0.0 }
    }

    unsafe fn setParamNormalized(&self, id: ParamID, value: ParamValue) -> tresult {
        if id != PARAM_PAIRING {
            return kInvalidArgument;
        }
        let wanted = normalized_to_id(value);
        if wanted == self.pairing_id() {
            return kResultOk;
        }
        // Set by hand (or by the Remote Script): honoured unless another instance has it.
        let mut m = self.main();
        self.claim(&mut m, Some(wanted));
        kResultOk
    }

    unsafe fn setComponentHandler(&self, handler: *mut IComponentHandler) -> tresult {
        let mut m = self.main();
        m.handler = ComRef::from_raw(handler).map(|h| h.to_com_ptr());
        self.tell_host_if_needed(&mut m);
        kResultOk
    }

    unsafe fn createView(&self, name: *const c_char) -> *mut IPlugView {
        if name.is_null() || std::ffi::CStr::from_ptr(name).to_bytes() != b"editor" {
            return ptr::null_mut();
        }
        crate::view::create(self.shared.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pfsend_protocol::RingReader;

    fn setup(p: &PlayfieldSend, rate: f64, mode: i32) {
        let mut s = ProcessSetup { processMode: mode, symbolicSampleSize: SymbolicSampleSizes_::kSample32 as i32, maxSamplesPerBlock: 512, sampleRate: rate };
        assert_eq!(unsafe { p.setupProcessing(&mut s) }, kResultOk);
    }

    /// Run process() on host-style buffers: separate in/out (or the same, in place).
    fn run(p: &PlayfieldSend, input: &mut [Vec<f32>; 2], output: &mut [Vec<f32>; 2], in_place: bool, mode: i32) {
        let n = input[0].len();
        let mut inp = [input[0].as_mut_ptr(), input[1].as_mut_ptr()];
        let mut outp = if in_place { inp } else { [output[0].as_mut_ptr(), output[1].as_mut_ptr()] };
        let mut ib = AudioBusBuffers { numChannels: 2, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: inp.as_mut_ptr() } };
        let mut ob = AudioBusBuffers { numChannels: 2, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: outp.as_mut_ptr() } };
        let mut d = ProcessData {
            processMode: mode,
            symbolicSampleSize: SymbolicSampleSizes_::kSample32 as i32,
            numSamples: n as i32,
            numInputs: 1,
            numOutputs: 1,
            inputs: &mut ib,
            outputs: &mut ob,
            inputParameterChanges: ptr::null_mut(),
            outputParameterChanges: ptr::null_mut(),
            inputEvents: ptr::null_mut(),
            outputEvents: ptr::null_mut(),
            processContext: ptr::null_mut(),
        };
        assert_eq!(unsafe { p.process(&mut d) }, kResultOk);
    }

    fn noise(n: usize, seed: u32) -> Vec<f32> {
        let mut x = seed.wrapping_mul(2_654_435_761) | 1;
        (0..n).map(|_| { x ^= x << 13; x ^= x >> 17; x ^= x << 5; (x as f32 / u32::MAX as f32) * 2.0 - 1.0 }).collect()
    }

    #[test]
    fn passes_audio_through_bit_exact_and_fills_the_ring() {
        let p = PlayfieldSend::new();
        unsafe { p.initialize(ptr::null_mut()) };
        setup(&p, 48_000.0, ProcessModes_::kRealtime as i32);
        unsafe { p.setActive(1) };
        let seg = Segment::open(p.shared.segment().unwrap().name()).unwrap();
        let mut reader = RingReader::new();
        let mut got = Vec::new();
        unsafe { reader.read(seg.header(), seg.ring(), &mut got, usize::MAX) };
        let mut sent = Vec::new();
        for (k, n) in [512usize, 128, 1, 333, 64].into_iter().enumerate() {
            let mut input = [noise(n, k as u32 * 2 + 1), noise(n, k as u32 * 2 + 2)];
            // Include values whose bits matter: -0.0, subnormals, NaN's payload.
            input[0][0] = -0.0;
            if n > 2 { input[1][1] = f32::from_bits(1); }
            let keep = input.clone();
            let mut output = [vec![9.0; n], vec![9.0; n]];
            run(&p, &mut input, &mut output, false, ProcessModes_::kRealtime as i32);
            for c in 0..2 {
                assert!(keep[c].iter().zip(&output[c]).all(|(a, b)| a.to_bits() == b.to_bits()), "channel {c} isn't bit-exact");
                assert_eq!(input[c], keep[c], "the input is untouched");
            }
            for i in 0..n {
                sent.push(keep[0][i]);
                sent.push(keep[1][i]);
            }
        }
        unsafe { reader.read(seg.header(), seg.ring(), &mut got, usize::MAX) };
        assert_eq!(got.len(), sent.len());
        assert!(got.iter().zip(&sent).all(|(a, b)| a.to_bits() == b.to_bits()));
        // In place: nothing to copy, still sent.
        let mut buf = [noise(256, 99), noise(256, 98)];
        let keep = buf.clone();
        let mut unused = [vec![], vec![]];
        run(&p, &mut buf, &mut unused, true, ProcessModes_::kRealtime as i32);
        assert_eq!(buf, keep);
        assert_eq!(unsafe { reader.read(seg.header(), seg.ring(), &mut got, usize::MAX) }.frames, 256);
        let peaks = p.shared.take_peaks();
        assert!(peaks[0] > 0.5 && peaks[0] <= 1.0);
        assert_eq!(p.shared.take_peaks(), [0.0, 0.0], "taken");
        unsafe { p.setActive(0) };
        unsafe { p.terminate() };
    }

    #[test]
    fn offline_renders_pass_through_but_are_not_sent() {
        let p = PlayfieldSend::new();
        unsafe { p.initialize(ptr::null_mut()) };
        setup(&p, 44_100.0, ProcessModes_::kRealtime as i32);
        unsafe { p.setActive(1) };
        let seg = Segment::open(p.shared.segment().unwrap().name()).unwrap();
        let before = seg.header().write_frame.load(Ordering::Acquire);
        let mut input = [noise(512, 5), noise(512, 6)];
        let keep = input.clone();
        let mut output = [vec![0.0; 512], vec![0.0; 512]];
        run(&p, &mut input, &mut output, false, ProcessModes_::kOffline as i32);
        assert_eq!(output, keep);
        assert_eq!(seg.header().write_frame.load(Ordering::Acquire), before);
        assert_ne!(seg.header().flags() & FLAG_OFFLINE, 0);
        // Back to real time: flag off, frames flow.
        run(&p, &mut input, &mut output, false, ProcessModes_::kRealtime as i32);
        assert_eq!(seg.header().flags() & FLAG_OFFLINE, 0);
        assert_eq!(seg.header().write_frame.load(Ordering::Acquire), before + 512);
        unsafe { p.terminate() };
    }

    #[test]
    fn a_rate_change_bumps_the_generation_or_makes_a_bigger_segment() {
        let p = PlayfieldSend::new();
        unsafe { p.initialize(ptr::null_mut()) };
        setup(&p, 48_000.0, ProcessModes_::kRealtime as i32);
        let first = p.shared.segment().unwrap().name().to_string();
        // 44.1 kHz fits the same ring: same segment, next generation.
        unsafe { p.setActive(0) };
        setup(&p, 44_100.0, ProcessModes_::kRealtime as i32);
        let h = p.shared.segment().unwrap().header();
        assert_eq!(p.shared.segment().unwrap().name(), first);
        assert_eq!(h.generation.load(Ordering::Acquire), 1);
        assert_eq!(h.sample_rate(), 44_100.0);
        // 96 kHz needs a longer ring: a new segment, announced under its new name.
        setup(&p, 96_000.0, ProcessModes_::kRealtime as i32);
        let second = p.shared.segment().unwrap().name().to_string();
        assert_ne!(second, first);
        assert_eq!(p.shared.announce.lock().unwrap().0, second);
        assert_eq!(p.shared.segment().unwrap().header().capacity_frames, 131_072);
        unsafe { p.terminate() };
        assert!(Segment::open(&first).is_err() && Segment::open(&second).is_err(), "terminate unlinks every segment");
    }

    /// A tiny IBStream over a Vec, for the state tests.
    struct Stream {
        data: std::cell::RefCell<Vec<u8>>,
        at: std::cell::Cell<usize>,
    }
    impl Class for Stream {
        type Interfaces = (IBStream,);
    }
    impl IBStreamTrait for Stream {
        unsafe fn read(&self, buffer: *mut std::ffi::c_void, n: i32, read: *mut i32) -> tresult {
            let d = self.data.borrow();
            let at = self.at.get();
            let k = (n.max(0) as usize).min(d.len() - at);
            ptr::copy_nonoverlapping(d[at..].as_ptr(), buffer as *mut u8, k);
            self.at.set(at + k);
            if !read.is_null() { *read = k as i32; }
            kResultOk
        }
        unsafe fn write(&self, buffer: *mut std::ffi::c_void, n: i32, written: *mut i32) -> tresult {
            self.data.borrow_mut().extend_from_slice(slice::from_raw_parts(buffer as *const u8, n as usize));
            if !written.is_null() { *written = n; }
            kResultOk
        }
        unsafe fn seek(&self, _pos: i64, _mode: i32, _result: *mut i64) -> tresult { kNotImplemented }
        unsafe fn tell(&self, pos: *mut i64) -> tresult { *pos = self.at.get() as i64; kResultOk }
    }

    #[test]
    fn the_state_keeps_the_id_and_a_duplicate_rerolls() {
        let a = PlayfieldSend::new();
        unsafe { a.initialize(ptr::null_mut()) };
        let id = a.pairing_id();
        assert!((1000..=9999).contains(&id));
        let s = vst3::ComWrapper::new(Stream { data: Default::default(), at: Default::default() });
        let sp = s.to_com_ptr::<IBStream>().unwrap();
        assert_eq!(unsafe { IComponentTrait::getState(&a, sp.as_ptr()) }, kResultOk);
        // Reopening the set: a fresh instance restores the same ID (the original is gone).
        unsafe { a.terminate() };
        let b = PlayfieldSend::new();
        unsafe { b.initialize(ptr::null_mut()) };
        s.at.set(0);
        assert_eq!(unsafe { IComponentTrait::setState(&b, sp.as_ptr()) }, kResultOk);
        assert_eq!(b.pairing_id(), id);
        // Duplicating the track: the copy gets the same state while b is alive, and re-rolls.
        let c = PlayfieldSend::new();
        unsafe { c.initialize(ptr::null_mut()) };
        s.at.set(0);
        assert_eq!(unsafe { IComponentTrait::setState(&c, sp.as_ptr()) }, kResultOk);
        assert_ne!(c.pairing_id(), id);
        assert!(c.main().tell_host, "Live is told once it gives us a handler");
        // The host's view of the parameter follows.
        assert_eq!(normalized_to_id(unsafe { c.getParamNormalized(PARAM_PAIRING) }), c.pairing_id());
        // Garbage state is refused, the ID kept.
        let junk = vst3::ComWrapper::new(Stream { data: std::cell::RefCell::new(b"nope".to_vec()), at: Default::default() });
        let jp = junk.to_com_ptr::<IBStream>().unwrap();
        assert_eq!(unsafe { IComponentTrait::setState(&b, jp.as_ptr()) }, kResultFalse);
        assert_eq!(b.pairing_id(), id);
        unsafe { b.terminate() };
        unsafe { c.terminate() };
    }

    #[test]
    fn the_parameter_reads_as_four_digits() {
        let p = PlayfieldSend::new();
        let mut s: String128 = [0; 128];
        unsafe { p.getParamStringByValue(PARAM_PAIRING, id_to_normalized(4821), &mut s) };
        assert_eq!(unsafe { crate::strings::read_wstring(s.as_ptr()) }, "4821");
        let mut text: Vec<u16> = "0042".encode_utf16().chain([0]).collect();
        let mut v = 0.0;
        assert_eq!(unsafe { p.getParamValueByString(PARAM_PAIRING, text.as_mut_ptr() as *mut TChar, &mut v) }, kResultOk);
        assert_eq!(normalized_to_id(v), 42);
        let mut info: ParameterInfo = unsafe { std::mem::zeroed() };
        unsafe { p.getParameterInfo(0, &mut info) };
        assert_eq!(info.stepCount, 9999);
        assert_eq!(unsafe { crate::strings::read_wstring(info.title.as_ptr()) }, "Pairing ID");
    }
}
