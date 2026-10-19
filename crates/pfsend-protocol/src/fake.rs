//! A fake Playfield Send: instances that write a test tone through the real protocol (a segment and
//! hellos), the way the plugin does inside Live. Used by `pfsend-fake` (by hand, with the app),
//! and by src-tauri's tests in-process.
//!
//! Each instance plays a sine (220 Hz × its number by default) with a beat-shaped swell at 120 bpm,
//! so meters and the page's bands move. Options misbehave on purpose: timing jitter, stalls, a
//! sample-rate change part-way, Live's offline render, and a crash (no bye, the segment left behind).

use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::{capacity_for, encode_bye, encode_hello, shm_name, Hello, Segment, FLAG_ACTIVE, FLAG_OFFLINE, PLUGIN_VERSION};

#[derive(Debug, Clone)]
pub struct FakeOptions {
    pub id: u32,
    pub name: String,
    /// The `<n>` in `/pfsend.<pid>.<n>` (distinct per instance in one process).
    pub index: u32,
    pub sample_rate: f64,
    pub block: usize,
    pub tone_hz: f64,
    /// Where hellos go (11102 for the app; a free port in tests).
    pub hello_port: u16,
    /// Each block's wait varies by up to this many ms.
    pub jitter_ms: f64,
    /// Every `stall_every` seconds, write nothing for `stall_ms`.
    pub stall_every: f64,
    pub stall_ms: f64,
    /// After this many seconds, switch to `rate_change_to` (the plugin's setupProcessing path).
    pub rate_change_after: f64,
    pub rate_change_to: f64,
    /// Between these seconds, behave as Live's offline export (flag set, nothing written).
    pub offline_from: f64,
    pub offline_to: f64,
    /// After this many seconds, stop as if Live crashed: no bye, the segment's name left behind.
    pub crash_after: f64,
}

impl Default for FakeOptions {
    fn default() -> Self {
        Self {
            id: 4821,
            name: String::new(),
            index: 0,
            sample_rate: 48_000.0,
            block: 256,
            tone_hz: 220.0,
            hello_port: crate::HELLO_PORT,
            jitter_ms: 0.0,
            stall_every: 0.0,
            stall_ms: 0.0,
            rate_change_after: 0.0,
            rate_change_to: 0.0,
            offline_from: 0.0,
            offline_to: 0.0,
            crash_after: 0.0,
        }
    }
}

/// A running fake instance. Dropping it stops it (with a bye, unless it "crashed").
pub struct FakeInstance {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    pub shm: String,
}

impl FakeInstance {
    pub fn start(o: FakeOptions) -> std::io::Result<Self> {
        let pid = std::process::id();
        let shm = shm_name(pid, o.index);
        let mut seg = Segment::create(&shm, o.sample_rate, capacity_for(o.sample_rate.max(o.rate_change_to)), pid, o.id)?;
        seg.header().name.write(&o.name);
        seg.header().set_flag(FLAG_ACTIVE, true);
        let sock = UdpSocket::bind("127.0.0.1:0")?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let shm_for_thread = shm.clone();
        let thread = std::thread::Builder::new().name(format!("pfsend-fake-{}", o.id)).spawn(move || {
            let shm = shm_for_thread;
            let started = Instant::now();
            let mut rate = o.sample_rate;
            let mut generation = 0u32;
            let mut written: u64 = 0;
            let mut since_rate = Instant::now();
            let mut phase = 0.0f64;
            let mut beat_t = 0.0f64;
            let mut left = vec![0f32; o.block];
            let mut right = vec![0f32; o.block];
            let mut buf = Vec::with_capacity(256);
            let mut last_hello = Instant::now() - Duration::from_secs(2);
            let mut seed = 0x9E37_79B9_7F4A_7C15u64 ^ o.id as u64;
            let mut rand = move || {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                (seed >> 11) as f64 / (1u64 << 53) as f64
            };
            let mut crashed = false;
            while !flag.load(Ordering::Relaxed) {
                let t = started.elapsed().as_secs_f64();
                if o.crash_after > 0.0 && t >= o.crash_after {
                    crashed = true;
                    break;
                }
                if o.rate_change_after > 0.0 && o.rate_change_to > 0.0 && rate != o.rate_change_to && t >= o.rate_change_after {
                    // Live: setActive(false), setupProcessing(new rate), setActive(true).
                    rate = o.rate_change_to;
                    seg.header().sample_rate.store(rate.to_bits(), Ordering::Release);
                    generation = seg.header().generation.fetch_add(1, Ordering::AcqRel) + 1;
                    written = 0;
                    since_rate = Instant::now();
                }
                let offline = o.offline_to > o.offline_from && t >= o.offline_from && t < o.offline_to;
                seg.header().set_flag(FLAG_OFFLINE, offline);
                let stalled = o.stall_every > 0.0 && (t % o.stall_every) < o.stall_ms / 1000.0;
                if last_hello.elapsed() >= Duration::from_secs(1) {
                    last_hello = Instant::now();
                    let h = Hello {
                        id: o.id,
                        name: o.name.clone(),
                        shm: shm.clone(),
                        sample_rate: rate as f32,
                        channels: 2,
                        pid,
                        version: PLUGIN_VERSION.into(),
                        generation,
                        flags: seg.header().flags(),
                    };
                    encode_hello(&h, &mut buf);
                    let _ = sock.send_to(&buf, ("127.0.0.1", o.hello_port));
                }
                // Real time: write the blocks that are due.
                let due = (since_rate.elapsed().as_secs_f64() * rate) as u64;
                while written + o.block as u64 <= due {
                    for i in 0..o.block {
                        let swell = (-(beat_t % 0.5) * 8.0).exp();
                        let v = (phase.sin() * (0.15 + 0.35 * swell)) as f32;
                        left[i] = v;
                        right[i] = v * 0.9;
                        phase = (phase + std::f64::consts::TAU * o.tone_hz / rate) % std::f64::consts::TAU;
                        beat_t += 1.0 / rate;
                    }
                    if !offline && !stalled {
                        seg.write(&left, &right, o.block);
                    }
                    written += o.block as u64;
                }
                let block_ms = o.block as f64 / rate * 1000.0;
                let wait = (block_ms + (rand() * 2.0 - 1.0) * o.jitter_ms).max(0.5);
                std::thread::sleep(Duration::from_secs_f64(wait / 1000.0));
            }
            if crashed {
                seg.leak_name();
            } else {
                encode_bye(&shm, &mut buf);
                let _ = sock.send_to(&buf, ("127.0.0.1", o.hello_port));
            }
            drop(seg);
        })?;
        Ok(Self { stop, thread: Some(thread), shm })
    }

    /// Stop now (a clean bye).
    pub fn stop(mut self) {
        self.shutdown();
    }

    /// Has the thread ended by itself (a crash)?
    pub fn finished(&self) -> bool {
        self.thread.as_ref().map(|t| t.is_finished()).unwrap_or(true)
    }

    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for FakeInstance {
    fn drop(&mut self) {
        self.shutdown();
    }
}
