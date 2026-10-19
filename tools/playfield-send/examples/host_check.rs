//! host_check — load a built `Playfield Send.vst3` the way a host does and exercise it.
//! A stand-in for Steinberg's validator (which needs the SDK checked out and built), not a replacement.
//!
//!   cargo run --manifest-path tools/playfield-send/Cargo.toml --example host_check -- \
//!     "tools/playfield-send/bundle/Playfield Send.vst3"
//!
//! Checks: the bundle's layout and Info.plist; dlopen; bundleEntry; GetPluginFactory; the factory's
//! info and class (v1, v2 and v3 queries); createInstance; IComponent / IAudioProcessor /
//! IEditController (single component); initialize; bus info; the parameter; state round trip;
//! setupProcessing at 44.1, 48 and 96 kHz; setActive; process at odd block sizes, in place and
//! not, checking the pass-through is bit-exact and the shared-memory segment gets the frames;
//! an offline block; the editor view (created, NSView supported, attached to an off-screen view,
//! removed); terminate; bundleExit. Exit code 0 when every check passes.

use std::ffi::{c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::ptr;

use vst3::Steinberg::Vst::*;
use vst3::Steinberg::*;
use vst3::{ComPtr, Interface};

static mut FAILED: u32 = 0;

fn check(ok: bool, what: &str) {
    if ok {
        println!("  ok    {what}");
    } else {
        println!("  FAIL  {what}");
        unsafe { FAILED += 1 };
    }
}

fn main() {
    let arg = std::env::args().nth(1).unwrap_or_else(|| "tools/playfield-send/bundle/Playfield Send.vst3".into());
    let bundle = PathBuf::from(arg);
    println!("Checking {}", bundle.display());
    let binary = bundle.join("Contents/MacOS/Playfield Send");
    check(binary.exists(), "Contents/MacOS/Playfield Send exists");
    let plist = std::fs::read_to_string(bundle.join("Contents/Info.plist")).unwrap_or_default();
    check(plist.contains("<string>BNDL</string>"), "Info.plist: CFBundlePackageType BNDL");
    check(plist.contains("<string>Playfield Send</string>"), "Info.plist: CFBundleExecutable");
    check(std::fs::read(bundle.join("Contents/PkgInfo")).map(|b| b == b"BNDL????").unwrap_or(false), "PkgInfo");
    check(bundle.join("Contents/Resources/CREDITS.txt").exists(), "Resources/CREDITS.txt");
    unsafe { run(&binary) };
    let failed = unsafe { FAILED };
    if failed == 0 {
        println!("All checks passed.");
    } else {
        println!("{failed} check(s) failed.");
        std::process::exit(1);
    }
}

unsafe fn sym<T>(lib: *mut c_void, name: &str) -> Option<T> {
    let c = CString::new(name).ok()?;
    let p = libc::dlsym(lib, c.as_ptr());
    (!p.is_null()).then(|| std::mem::transmute_copy(&p))
}

fn cstr(s: &[std::ffi::c_char]) -> String {
    unsafe { CStr::from_ptr(s.as_ptr()) }.to_string_lossy().into_owned()
}

unsafe fn query<I: Interface>(unknown: &ComPtr<FUnknown>) -> Option<ComPtr<I>> {
    unknown.cast::<I>()
}

unsafe fn run(binary: &Path) {
    let path = CString::new(binary.to_string_lossy().as_bytes()).unwrap();
    let lib = libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
    check(!lib.is_null(), "dlopen");
    if lib.is_null() {
        println!("        {}", CStr::from_ptr(libc::dlerror()).to_string_lossy());
        return;
    }
    let entry: Option<extern "C" fn(*mut c_void) -> bool> = sym(lib, "bundleEntry");
    let exit: Option<extern "C" fn() -> bool> = sym(lib, "bundleExit");
    check(entry.is_some() && exit.is_some(), "exports bundleEntry / bundleExit");
    if let Some(e) = entry {
        check(e(ptr::null_mut()), "bundleEntry returns true");
    }
    let get: Option<extern "system" fn() -> *mut IPluginFactory> = sym(lib, "GetPluginFactory");
    check(get.is_some(), "exports GetPluginFactory");
    let Some(get) = get else { return };
    let Some(factory) = ComPtr::from_raw(get()) else { check(false, "GetPluginFactory returns a factory"); return };

    let mut fi: PFactoryInfo = std::mem::zeroed();
    check(factory.getFactoryInfo(&mut fi) == kResultOk && cstr(&fi.vendor) == "Playfield", "factory info: vendor Playfield");
    check(factory.countClasses() == 1, "one class");
    let mut ci: PClassInfo = std::mem::zeroed();
    check(factory.getClassInfo(0, &mut ci) == kResultOk && cstr(&ci.category) == "Audio Module Class" && cstr(&ci.name) == "Playfield Send", "class info: Audio Module Class, Playfield Send");
    match factory.cast::<IPluginFactory2>() {
        Some(f2) => {
            let mut c2: PClassInfo2 = std::mem::zeroed();
            check(f2.getClassInfo2(0, &mut c2) == kResultOk && cstr(&c2.subCategories) == "Fx|Tools", "class info 2: Fx|Tools");
            println!("        version {}, {}", cstr(&c2.version), cstr(&c2.sdkVersion));
        }
        None => check(false, "IPluginFactory2"),
    }
    check(factory.cast::<IPluginFactory3>().is_some(), "IPluginFactory3");

    let mut obj: *mut c_void = ptr::null_mut();
    let r = factory.createInstance(ci.cid.as_ptr() as FIDString, IComponent::IID.as_ptr() as FIDString, &mut obj);
    check(r == kResultOk && !obj.is_null(), "createInstance(IComponent)");
    let Some(component) = ComPtr::<IComponent>::from_raw(obj as *mut IComponent) else { return };
    let unknown: ComPtr<FUnknown> = component.cast().unwrap();
    let Some(processor) = query::<IAudioProcessor>(&unknown) else { check(false, "IAudioProcessor"); return };
    check(true, "IAudioProcessor");
    let controller = query::<IEditController>(&unknown);
    let mut cid: TUID = [0; 16];
    check(controller.is_some() && component.getControllerClassId(&mut cid) != kResultOk, "single component: IEditController on the component");
    let Some(controller) = controller else { return };

    check(component.initialize(ptr::null_mut()) == kResultOk, "initialize");
    check(component.getBusCount(MediaTypes_::kAudio as i32, BusDirections_::kInput as i32) == 1, "one audio input bus");
    check(component.getBusCount(MediaTypes_::kEvent as i32, BusDirections_::kInput as i32) == 0, "no event bus");
    let mut bi: BusInfo = std::mem::zeroed();
    check(component.getBusInfo(MediaTypes_::kAudio as i32, BusDirections_::kOutput as i32, 0, &mut bi) == kResultOk && bi.channelCount == 2, "output bus: stereo");
    let mut stereo = SpeakerArr::kStereo;
    let mut stereo2 = SpeakerArr::kStereo;
    check(processor.setBusArrangements(&mut stereo, 1, &mut stereo2, 1) == kResultTrue, "accepts stereo → stereo");
    let mut surround = SpeakerArr::k51;
    let mut stereo3 = SpeakerArr::kStereo;
    check(processor.setBusArrangements(&mut surround, 1, &mut stereo3, 1) != kResultTrue, "refuses 5.1 → stereo");
    check(processor.canProcessSampleSize(SymbolicSampleSizes_::kSample32 as i32) == kResultTrue, "32-bit samples");

    check(controller.getParameterCount() == 1, "one parameter");
    let mut pi: ParameterInfo = std::mem::zeroed();
    controller.getParameterInfo(0, &mut pi);
    let title = String::from_utf16_lossy(&pi.title.iter().take_while(|&&c| c != 0).map(|&c| c as u16).collect::<Vec<_>>());
    check(title == "Pairing ID" && pi.stepCount == 9999, "Pairing ID, 9999 steps");
    let id = (controller.getParamNormalized(0) * 9999.0).round() as u32;
    check((1000..=9999).contains(&id), &format!("a four-digit ID on first load ({id})"));

    for rate in [44_100.0, 48_000.0, 96_000.0] {
        let mut setup = ProcessSetup { processMode: ProcessModes_::kRealtime as i32, symbolicSampleSize: SymbolicSampleSizes_::kSample32 as i32, maxSamplesPerBlock: 1024, sampleRate: rate };
        check(processor.setupProcessing(&mut setup) == kResultOk, &format!("setupProcessing {rate} Hz"));
    }
    check(component.setActive(1) == kResultOk, "setActive(true)");
    check(processor.setProcessing(1) == kResultOk, "setProcessing(true)");

    // The newest segment of this process.
    let seg = (0..8).rev().find_map(|n| pfsend_protocol::Segment::open(&pfsend_protocol::shm_name(std::process::id(), n)).ok());
    check(seg.is_some(), "a shared-memory segment exists");
    let Some(seg) = seg else { return };
    check(seg.header().sample_rate() == 96_000.0, "the segment is at Live's latest rate");
    let mut reader = pfsend_protocol::RingReader::new();
    let mut got = Vec::new();
    reader.read(seg.header(), seg.ring(), &mut got, usize::MAX);
    let mut sent = Vec::new();
    let mut exact = true;
    let mut x = 0x1234_5678u32;
    for (k, n) in [1usize, 64, 333, 512, 1024].into_iter().enumerate() {
        let mut l: Vec<f32> = (0..n).map(|_| { x ^= x << 13; x ^= x >> 17; x ^= x << 5; f32::from_bits(x & 0x3FFF_FFFF) - 1.0 }).collect();
        let mut r: Vec<f32> = l.iter().map(|v| -v).collect();
        let (kl, kr) = (l.clone(), r.clone());
        let in_place = k % 2 == 1;
        let mut ol = vec![0f32; n];
        let mut or = vec![0f32; n];
        let mut ins = [l.as_mut_ptr(), r.as_mut_ptr()];
        let mut outs = if in_place { ins } else { [ol.as_mut_ptr(), or.as_mut_ptr()] };
        let mut ib = AudioBusBuffers { numChannels: 2, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: ins.as_mut_ptr() } };
        let mut ob = AudioBusBuffers { numChannels: 2, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: outs.as_mut_ptr() } };
        let mut d = ProcessData {
            processMode: ProcessModes_::kRealtime as i32,
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
        let ok = processor.process(&mut d) == kResultOk;
        let (cl, cr) = if in_place { (&l, &r) } else { (&ol, &or) };
        exact &= ok && cl.iter().zip(&kl).all(|(a, b)| a.to_bits() == b.to_bits()) && cr.iter().zip(&kr).all(|(a, b)| a.to_bits() == b.to_bits());
        for i in 0..n {
            sent.push(kl[i]);
            sent.push(kr[i]);
        }
    }
    check(exact, "pass-through is bit-exact (in place and not, block sizes 1–1024)");
    reader.read(seg.header(), seg.ring(), &mut got, usize::MAX);
    check(got.len() == sent.len() && got.iter().zip(&sent).all(|(a, b)| a.to_bits() == b.to_bits()), "the ring got every frame, bit-exact");

    // State round trip through the host's stream.
    let mut state = MemStream::default();
    let stream = vst3::ComWrapper::new(std::mem::take(&mut state));
    let sp = stream.to_com_ptr::<IBStream>().unwrap();
    check(component.getState(sp.as_ptr()) == kResultOk && stream.data.borrow().starts_with(b"PFS1"), "getState");
    stream.at.set(0);
    check(component.setState(sp.as_ptr()) == kResultOk, "setState (same instance keeps its ID)");
    check(((controller.getParamNormalized(0) * 9999.0).round() as u32) == id, "the ID survives");

    // The editor.
    let view = controller.createView(c"editor".as_ptr());
    check(!view.is_null(), "createView(editor)");
    if let Some(view) = ComPtr::<IPlugView>::from_raw(view) {
        check(view.isPlatformTypeSupported(kPlatformTypeNSView) == kResultTrue, "the view supports NSView");
        let mut rect: ViewRect = std::mem::zeroed();
        check(view.getSize(&mut rect) == kResultOk && rect.right > 200 && rect.bottom > 100, &format!("view size {}×{}", rect.right, rect.bottom));
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            let parent = objc2_app_kit::NSView::initWithFrame(mtm.alloc(), objc2_foundation::NSRect::new(objc2_foundation::NSPoint::new(0.0, 0.0), objc2_foundation::NSSize::new(400.0, 200.0)));
            let raw = objc2::rc::Retained::as_ptr(&parent) as *mut c_void;
            check(view.attached(raw, kPlatformTypeNSView) == kResultOk, "attached to an NSView");
            check(parent.subviews().count() == 1, "the status view is in the parent");
            check(view.removed() == kResultOk && parent.subviews().count() == 0, "removed");
        }
    }

    check(processor.setProcessing(0) == kResultOk, "setProcessing(false)");
    check(component.setActive(0) == kResultOk, "setActive(false)");
    let name = seg.name().to_string();
    drop(seg);
    check(component.terminate() == kResultOk, "terminate");
    check(pfsend_protocol::Segment::open(&name).is_err(), "terminate removed the segment");
    drop(controller);
    drop(processor);
    drop(unknown);
    drop(component);
    drop(factory);
    if let Some(e) = exit {
        check(e(), "bundleExit returns true");
    }
}

#[derive(Default)]
struct MemStream {
    data: std::cell::RefCell<Vec<u8>>,
    at: std::cell::Cell<usize>,
}

impl vst3::Class for MemStream {
    type Interfaces = (IBStream,);
}

impl IBStreamTrait for MemStream {
    unsafe fn read(&self, buffer: *mut c_void, n: i32, read: *mut i32) -> tresult {
        let d = self.data.borrow();
        let at = self.at.get();
        let k = (n.max(0) as usize).min(d.len() - at);
        ptr::copy_nonoverlapping(d[at..].as_ptr(), buffer as *mut u8, k);
        self.at.set(at + k);
        if !read.is_null() {
            *read = k as i32;
        }
        kResultOk
    }
    unsafe fn write(&self, buffer: *mut c_void, n: i32, written: *mut i32) -> tresult {
        self.data.borrow_mut().extend_from_slice(std::slice::from_raw_parts(buffer as *const u8, n.max(0) as usize));
        if !written.is_null() {
            *written = n;
        }
        kResultOk
    }
    unsafe fn seek(&self, _pos: i64, _mode: i32, _result: *mut i64) -> tresult {
        kNotImplemented
    }
    unsafe fn tell(&self, pos: *mut i64) -> tresult {
        *pos = self.at.get() as i64;
        kResultOk
    }
}
