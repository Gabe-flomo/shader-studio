//! The announce thread: once a second, a hello to 127.0.0.1:11102 so the Playfield desktop app
//! can find this instance's segment (macOS can't list shm segments); a bye when it stops.
//! A plain thread, never the audio thread. With no app running nothing listens, and a UDP send to
//! a closed local port costs nothing.

use std::net::UdpSocket;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use pfsend_protocol::{encode_bye, encode_hello, Hello, HELLO_PORT, PLUGIN_VERSION};

use crate::shared::Shared;

pub struct Announcer {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
    port: u16,
}

impl Announcer {
    pub fn start(shared: Arc<Shared>) -> Option<Self> {
        Self::start_on(shared, HELLO_PORT)
    }

    /// `port`: tests send to their own socket.
    pub fn start_on(shared: Arc<Shared>, port: u16) -> Option<Self> {
        shared.stop.store(false, Ordering::Relaxed);
        let sh = shared.clone();
        let thread = std::thread::Builder::new()
            .name("playfield-send-announce".into())
            .spawn(move || {
                let Ok(sock) = UdpSocket::bind("127.0.0.1:0") else { return };
                let mut buf = Vec::with_capacity(256);
                let mut tick = 0u32;
                while !sh.stop.load(Ordering::Relaxed) {
                    if tick % 10 == 0 {
                        if let Some(h) = hello(&sh) {
                            encode_hello(&h, &mut buf);
                            let _ = sock.send_to(&buf, ("127.0.0.1", port));
                        }
                    }
                    tick = tick.wrapping_add(1);
                    std::thread::sleep(Duration::from_millis(100));
                }
            })
            .ok()?;
        Some(Self { shared, thread: Some(thread), port })
    }

    /// Stop the thread and say bye for the current segment.
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.shared.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
            let shm = self.shared.announce.lock().map(|a| a.0.clone()).unwrap_or_default();
            if !shm.is_empty() {
                if let Ok(sock) = UdpSocket::bind("127.0.0.1:0") {
                    let mut buf = Vec::new();
                    encode_bye(&shm, &mut buf);
                    let _ = sock.send_to(&buf, ("127.0.0.1", self.port));
                }
            }
        }
    }
}

impl Drop for Announcer {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// This instance's hello, once it has a segment.
pub fn hello(sh: &Shared) -> Option<Hello> {
    let (shm, name) = sh.announce.lock().map(|a| a.clone()).ok()?;
    if shm.is_empty() {
        return None;
    }
    let seg = sh.segment()?;
    let h = seg.header();
    Some(Hello {
        id: sh.pairing_id.load(Ordering::Relaxed),
        name,
        shm,
        sample_rate: h.sample_rate() as f32,
        channels: 2,
        pid: std::process::id(),
        version: PLUGIN_VERSION.into(),
        generation: h.generation.load(Ordering::Relaxed),
        flags: h.flags(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use pfsend_protocol::{capacity_for, decode_message, shm_name, Message, Segment};

    #[test]
    fn says_hello_then_bye() {
        let rx = UdpSocket::bind("127.0.0.1:0").unwrap();
        rx.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let port = rx.local_addr().unwrap().port();
        let sh = Arc::new(Shared::new());
        let name = shm_name(std::process::id(), 7001);
        let seg = Box::new(Segment::create(&name, 48_000.0, capacity_for(48_000.0), std::process::id(), 4821).unwrap());
        sh.seg.store(&*seg as *const Segment as *mut Segment, Ordering::Release);
        sh.pairing_id.store(4821, Ordering::Relaxed);
        *sh.announce.lock().unwrap() = (name.clone(), String::new());
        let a = Announcer::start_on(sh.clone(), port).unwrap();
        let mut buf = [0u8; 1024];
        let (n, _) = rx.recv_from(&mut buf).expect("a hello within a second");
        match decode_message(&buf[..n]) {
            Some(Message::Hello(h)) => {
                assert_eq!((h.id, h.shm.as_str(), h.sample_rate, h.version.as_str()), (4821, name.as_str(), 48_000.0, PLUGIN_VERSION));
            }
            other => panic!("not a hello: {other:?}"),
        }
        a.stop();
        // Drain hellos until the bye.
        loop {
            let (n, _) = rx.recv_from(&mut buf).expect("a bye");
            if let Some(Message::Bye { shm }) = decode_message(&buf[..n]) {
                assert_eq!(shm, name);
                break;
            }
        }
        sh.seg.store(std::ptr::null_mut(), Ordering::Release);
        drop(seg);
    }
}
