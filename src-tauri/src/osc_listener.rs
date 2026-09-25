//! osc_listener.rs — receive OSC over UDP inside the desktop app, so the Play
//! page can take OSC from Ableton or TouchOSC with one click and no bridge.
//!
//! Deliberately free of Tauri types: `Listener::start` takes a callback that
//! gets each raw datagram; lib.rs forwards them to the webview as
//! `osc-packet` events and the page decodes them (src/lib/osc/decode.js), the
//! same decoder the Node bridge uses. Unit-tested on its own with
//! `rustc --edition 2021 --test src-tauri/src/osc_listener.rs`.

use std::io::ErrorKind;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

pub struct Listener {
    stop: Arc<AtomicBool>,
    port: u16,
    lan: bool,
    thread: Option<JoinHandle<()>>,
}

impl Listener {
    /// Bind `port` (0 picks a free one) on 127.0.0.1, or on every interface
    /// when `lan` is true (for a phone running TouchOSC), and call `on_packet`
    /// with every datagram until stopped.
    pub fn start<F>(port: u16, lan: bool, mut on_packet: F) -> Result<Self, String>
    where
        F: FnMut(Vec<u8>) + Send + 'static,
    {
        let host = if lan { "0.0.0.0" } else { "127.0.0.1" };
        let socket = UdpSocket::bind((host, port)).map_err(|e| {
            if e.kind() == ErrorKind::AddrInUse {
                format!("UDP port {port} is already in use (is the Node bridge or another OSC app running?)")
            } else {
                format!("Couldn't listen on UDP port {port}: {e}")
            }
        })?;
        // Wake up regularly so a stop request is noticed without a packet arriving.
        socket
            .set_read_timeout(Some(Duration::from_millis(200)))
            .map_err(|e| e.to_string())?;
        let actual = socket.local_addr().map_err(|e| e.to_string())?.port();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::Builder::new()
            .name("osc-listener".into())
            .spawn(move || {
                let mut buf = vec![0u8; 65_536];
                while !flag.load(Ordering::Relaxed) {
                    match socket.recv_from(&mut buf) {
                        Ok((n, _from)) => on_packet(buf[..n].to_vec()),
                        Err(e) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => continue,
                        Err(_) => break,
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { stop, port: actual, lan, thread: Some(thread) })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn lan(&self) -> bool {
        self.lan
    }

    /// Stop and wait for the thread (at most one read timeout).
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn delivers_datagrams_and_stops() {
        let (tx, rx) = mpsc::channel();
        let l = Listener::start(0, false, move |p| {
            let _ = tx.send(p);
        })
        .expect("bind");
        let port = l.port();
        assert!(port > 0);
        let out = UdpSocket::bind("127.0.0.1:0").unwrap();
        // "/a\0\0" ",f\0\0" 0.5f32
        let packet = [b'/', b'a', 0, 0, b',', b'f', 0, 0, 0x3f, 0, 0, 0];
        out.send_to(&packet, ("127.0.0.1", port)).unwrap();
        let got = rx.recv_timeout(Duration::from_secs(2)).expect("packet");
        assert_eq!(got, packet.to_vec());
        l.stop();
        // After stopping, the port is free again.
        let again = UdpSocket::bind(("127.0.0.1", port));
        assert!(again.is_ok());
    }

    #[test]
    fn a_taken_port_is_a_clear_error() {
        let hold = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = hold.local_addr().unwrap().port();
        let err = Listener::start(port, false, |_| {}).err().expect("should fail");
        assert!(err.contains("already in use"), "{err}");
    }
}
