//! midi.rs — native MIDI for the desktop app (WKWebView has no Web MIDI).
//!
//! On macOS this talks to CoreMIDI directly (the `coremidi` crate): one
//! client for the life of the app, one input port per source the page asks
//! for, one output port for everything sent. Elsewhere `midir` stands in.
//! Each incoming message goes to the webview as a `midi://message` event
//! `{ device, id, bytes, len, timestamp }`, emitted from CoreMIDI's callback
//! thread. src/lib/midiTauri.ts is the other half: it polls `midi_list` for
//! hot-plug while MIDI is in use, opens every input the user hasn't switched
//! off, and sends pad lights with `midi_send`.
//!
//! Sources are identified by CoreMIDI's unique id (`id`), never by name: two
//! controllers with the same name are two ports, and a port with no name
//! still works. `offline` sources (a device macOS remembers but that isn't
//! plugged in) are listed, so the Monitor can show them, but can't be opened.
//!
//! Packets are split by a per-port `Parser` that keeps running status and
//! sysex state across packets and never lets a sysex without its 0xF7 swallow
//! the channel messages after it (the Akai MPK mini sends a sysex burst on
//! connect). Sysex reaches the page too, trimmed to `SYSEX_KEEP` bytes with
//! the real length in `len`, so the Monitor can show what a controller says.
//!
//! Nothing here panics on a bad port or a vanished device: every command
//! returns `Err(String)` for the page to show.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

pub const MESSAGE_EVENT: &str = "midi://message";
/// Sysex bytes kept in a message for the page (the whole length is in `len`).
pub const SYSEX_KEEP: usize = 64;
/// A sysex longer than this without its 0xF7 is dropped, and parsing carries on.
pub const SYSEX_MAX: usize = 4096;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Port {
    /// CoreMIDI's unique id (midir's port id elsewhere): stable while the device is known to the system.
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    /// The system remembers the device but it isn't connected: it can't be opened.
    pub offline: bool,
    /// We are listening to it.
    pub open: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Ports {
    pub inputs: Vec<Port>,
    pub outputs: Vec<Port>,
}

/// One MIDI message as the page receives it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct MidiMessage {
    /// The input's name (what knob locks and racks match on).
    pub device: String,
    /// The input's id, for the Monitor (two devices with one name are told apart).
    pub id: String,
    pub bytes: Vec<u8>,
    /// The whole message's length: more than `bytes.len()` for a trimmed sysex.
    pub len: usize,
    /// Microseconds since the Unix epoch, when the bridge received it.
    pub timestamp: u64,
}

fn now_micros() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0)
}

/// Every whole message in a packet, as the page gets it (sysex trimmed).
fn messages_for_page(parser: &mut Parser, data: &[u8], device: &str, id: &str, at: u64) -> Vec<MidiMessage> {
    parser
        .feed(data)
        .into_iter()
        .map(|m| {
            let len = m.len();
            let bytes = if len > SYSEX_KEEP { m[..SYSEX_KEEP].to_vec() } else { m };
            MidiMessage { device: device.to_string(), id: id.to_string(), bytes, len, timestamp: at }
        })
        .collect()
}

#[derive(Default)]
pub struct MidiState(Mutex<Option<backend::Bridge>>);

fn with_bridge<T>(state: &MidiState, f: impl FnOnce(&mut backend::Bridge) -> Result<T, String>) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|_| "MIDI state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(backend::Bridge::new()?);
    }
    f(guard.as_mut().expect("bridge was just made"))
}

/// Every input and output port, with its stable id, name, maker and whether it's offline or open.
#[tauri::command]
pub fn midi_list(state: State<MidiState>) -> Result<Ports, String> {
    with_bridge(&state, |b| Ok(b.list()))
}

/// Listen to input `id`. Already open: nothing to do. Offline: an error.
#[tauri::command]
pub fn midi_open_input(app: AppHandle, state: State<MidiState>, id: String) -> Result<(), String> {
    with_bridge(&state, |b| b.open_input(app, &id))
}

#[tauri::command]
pub fn midi_close_input(state: State<MidiState>, id: String) -> Result<(), String> {
    with_bridge(&state, |b| {
        b.close_input(&id);
        Ok(())
    })
}

#[tauri::command]
pub fn midi_open_output(state: State<MidiState>, id: String) -> Result<(), String> {
    with_bridge(&state, |b| b.open_output(&id))
}

#[tauri::command]
pub fn midi_close_output(state: State<MidiState>, id: String) -> Result<(), String> {
    with_bridge(&state, |b| {
        b.close_output(&id);
        Ok(())
    })
}

/// Send one channel message (note, CC… no sysex) to output `id`, opening it first if needed.
#[tauri::command]
pub fn midi_send(state: State<MidiState>, id: String, bytes: Vec<u8>) -> Result<(), String> {
    if !is_sendable(&bytes) {
        return Err("Only short channel messages can be sent".into());
    }
    with_bridge(&state, |b| b.send(&id, &bytes))
}

// ─── CoreMIDI (macOS) ────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod backend {
    use super::*;
    use coremidi::{Client, Destination, Destinations, InputPort, Object, OutputPort, PacketBuffer, Properties, Source, Sources};
    use std::collections::HashMap;

    const CLIENT: &str = "Playfield";

    /// An open source: its port (one per source, so the callback knows the source) and the source itself.
    struct OpenInput {
        port: InputPort,
        source: Source,
    }

    pub struct Bridge {
        client: Client,
        output: OutputPort,
        inputs: HashMap<String, OpenInput>,
    }

    fn id_of(o: &Object) -> String {
        o.unique_id().map(|u| u.to_string()).unwrap_or_default()
    }

    fn name_of(o: &Object, id: &str) -> String {
        let name = o.display_name().or_else(|| o.name()).unwrap_or_default();
        if name.trim().is_empty() { format!("MIDI port {id}") } else { name }
    }

    fn manufacturer_of(o: &Object) -> String {
        o.get_property(&Properties::manufacturer()).unwrap_or_default()
    }

    fn offline(o: &Object) -> bool {
        o.get_property(&Properties::offline()).unwrap_or(false)
    }

    fn find_source(id: &str) -> Option<Source> {
        Sources.into_iter().find(|s| id_of(s) == id)
    }

    fn find_destination(id: &str) -> Option<Destination> {
        Destinations.into_iter().find(|d| id_of(d) == id)
    }

    impl Bridge {
        pub fn new() -> Result<Self, String> {
            let client = Client::new(CLIENT).map_err(|e| format!("Couldn't start CoreMIDI (status {e})"))?;
            let output = client.output_port("playfield-out").map_err(|e| format!("Couldn't make a MIDI output port (status {e})"))?;
            Ok(Self { client, output, inputs: HashMap::new() })
        }

        pub fn list(&mut self) -> Ports {
            // A source that vanished (or reappeared under a new id) drops its port.
            let live: Vec<String> = Sources.into_iter().map(|s| id_of(&s)).collect();
            let gone: Vec<String> = self.inputs.keys().filter(|k| !live.contains(k)).cloned().collect();
            for id in gone {
                self.close_input(&id);
            }
            let inputs = Sources
                .into_iter()
                .map(|s| {
                    let id = id_of(&s);
                    Port { name: name_of(&s, &id), manufacturer: manufacturer_of(&s), offline: offline(&s), open: self.inputs.contains_key(&id), id }
                })
                .collect();
            let outputs = Destinations
                .into_iter()
                .map(|d| {
                    let id = id_of(&d);
                    Port { name: name_of(&d, &id), manufacturer: manufacturer_of(&d), offline: offline(&d), open: true, id }
                })
                .collect();
            Ports { inputs, outputs }
        }

        pub fn open_input(&mut self, app: AppHandle, id: &str) -> Result<(), String> {
            if self.inputs.contains_key(id) {
                return Ok(());
            }
            let source = find_source(id).ok_or_else(|| "That MIDI input isn't connected any more".to_string())?;
            let name = name_of(&source, id);
            if offline(&source) {
                return Err(format!("{name} is offline (not plugged in)"));
            }
            let device = name.clone();
            let port_id = id.to_string();
            let mut parser = Parser::default();
            let port = self
                .client
                .input_port(&format!("playfield-in-{id}"), move |packets| {
                    let at = now_micros();
                    for p in packets.iter() {
                        for m in messages_for_page(&mut parser, p.data(), &device, &port_id, at) {
                            let _ = app.emit(MESSAGE_EVENT, m);
                        }
                    }
                })
                .map_err(|e| format!("Couldn't make a port for {name} (status {e})"))?;
            port.connect_source(&source).map_err(|e| format!("Couldn't open {name} (status {e})"))?;
            self.inputs.insert(id.to_string(), OpenInput { port, source });
            Ok(())
        }

        pub fn close_input(&mut self, id: &str) {
            if let Some(open) = self.inputs.remove(id) {
                let _ = open.port.disconnect_source(&open.source);
            }
        }

        /// One output port serves every destination: nothing to open, but the destination must exist.
        pub fn open_output(&mut self, id: &str) -> Result<(), String> {
            find_destination(id).map(|_| ()).ok_or_else(|| "That MIDI output isn't connected any more".to_string())
        }

        pub fn close_output(&mut self, _id: &str) {}

        pub fn send(&mut self, id: &str, bytes: &[u8]) -> Result<(), String> {
            let dest = find_destination(id).ok_or_else(|| "That MIDI output isn't connected any more".to_string())?;
            let packets = PacketBuffer::new(0, bytes);
            self.output.send(&dest, &packets).map_err(|e| format!("Couldn't send (status {e})"))
        }
    }
}

// ─── midir (other platforms) ─────────────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
mod backend {
    use super::*;
    use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
    use std::collections::HashMap;

    const CLIENT: &str = "Playfield";

    pub struct Bridge {
        /// Kept for listing, so a scan doesn't make a new client every time.
        lister_in: MidiInput,
        lister_out: MidiOutput,
        inputs: HashMap<String, MidiInputConnection<()>>,
        outputs: HashMap<String, MidiOutputConnection>,
    }

    impl Bridge {
        pub fn new() -> Result<Self, String> {
            let lister_in = MidiInput::new(CLIENT).map_err(|e| format!("Couldn't start MIDI: {e}"))?;
            let lister_out = MidiOutput::new(CLIENT).map_err(|e| format!("Couldn't start MIDI: {e}"))?;
            Ok(Self { lister_in, lister_out, inputs: HashMap::new(), outputs: HashMap::new() })
        }

        pub fn list(&mut self) -> Ports {
            let inputs = self
                .lister_in
                .ports()
                .iter()
                .map(|p| {
                    let id = p.id();
                    let name = self.lister_in.port_name(p).unwrap_or_default();
                    Port { name: if name.is_empty() { format!("MIDI port {id}") } else { name }, manufacturer: String::new(), offline: false, open: self.inputs.contains_key(&id), id }
                })
                .collect();
            let outputs = self
                .lister_out
                .ports()
                .iter()
                .map(|p| {
                    let id = p.id();
                    let name = self.lister_out.port_name(p).unwrap_or_default();
                    Port { name: if name.is_empty() { format!("MIDI port {id}") } else { name }, manufacturer: String::new(), offline: false, open: self.outputs.contains_key(&id), id }
                })
                .collect();
            Ports { inputs, outputs }
        }

        pub fn open_input(&mut self, app: AppHandle, id: &str) -> Result<(), String> {
            if self.inputs.contains_key(id) {
                return Ok(());
            }
            let mut input = MidiInput::new(CLIENT).map_err(|e| format!("Couldn't start MIDI: {e}"))?;
            // Clock alone is 24 events a beat; sysex stays, for the Monitor.
            input.ignore(Ignore::Time | Ignore::ActiveSense);
            let port = input.find_port_by_id(id).ok_or_else(|| "That MIDI input isn't connected any more".to_string())?;
            let name = input.port_name(&port).map_err(|e| e.to_string())?;
            let device = name.clone();
            let port_id = id.to_string();
            let mut parser = Parser::default();
            let conn = input
                .connect(
                    &port,
                    "playfield-in",
                    move |_stamp, data, _| {
                        let at = now_micros();
                        for m in messages_for_page(&mut parser, data, &device, &port_id, at) {
                            let _ = app.emit(MESSAGE_EVENT, m);
                        }
                    },
                    (),
                )
                .map_err(|e| format!("Couldn't open {name}: {e}"))?;
            self.inputs.insert(id.to_string(), conn);
            Ok(())
        }

        pub fn close_input(&mut self, id: &str) {
            if let Some(conn) = self.inputs.remove(id) {
                conn.close();
            }
        }

        pub fn open_output(&mut self, id: &str) -> Result<(), String> {
            if self.outputs.contains_key(id) {
                return Ok(());
            }
            let output = MidiOutput::new(CLIENT).map_err(|e| format!("Couldn't start MIDI: {e}"))?;
            let port = output.find_port_by_id(id).ok_or_else(|| "That MIDI output isn't connected any more".to_string())?;
            let name = output.port_name(&port).unwrap_or_default();
            let conn = output.connect(&port, "playfield-out").map_err(|e| format!("Couldn't open {name}: {e}"))?;
            self.outputs.insert(id.to_string(), conn);
            Ok(())
        }

        pub fn close_output(&mut self, id: &str) {
            if let Some(conn) = self.outputs.remove(id) {
                conn.close();
            }
        }

        pub fn send(&mut self, id: &str, bytes: &[u8]) -> Result<(), String> {
            self.open_output(id)?;
            let conn = self.outputs.get_mut(id).ok_or("MIDI output not open")?;
            if let Err(e) = conn.send(bytes) {
                // The device probably went away: drop the connection so the next send reopens it.
                self.outputs.remove(id);
                return Err(format!("Couldn't send: {e}"));
            }
            Ok(())
        }
    }
}

// ─── Parsing (shared, tested) ────────────────────────────────────────────────

/// A channel message (0x80–0xEF) of the right length.
pub fn is_sendable(bytes: &[u8]) -> bool {
    match bytes.first() {
        Some(&s) if (0x80..0xf0).contains(&s) => bytes.len() == message_len(s) && bytes[1..].iter().all(|b| *b < 0x80),
        _ => false,
    }
}

/// Length of a message starting with status byte `s` (sysex: 0, read to 0xF7).
fn message_len(s: u8) -> usize {
    match s {
        0xc0..=0xdf => 2,
        0x80..=0xef => 3,
        0xf1 | 0xf3 => 2,
        0xf2 => 3,
        0xf0 => 0,
        _ => 1,
    }
}

/// Splits a stream of CoreMIDI packets into whole messages, one parser per
/// port so running status and a sysex spanning packets carry over.
///
/// - Several messages in one packet come out one by one; later ones may use
///   running status (the previous channel status).
/// - A sysex (0xF0 … 0xF7) comes out whole, even split over packets, and a
///   realtime byte (clock, start…) inside it comes out on its own without
///   breaking it, as the spec allows.
/// - A sysex that never ends (no 0xF7) is dropped the moment another status
///   byte arrives, or once it passes `SYSEX_MAX` bytes: the messages after it
///   are never swallowed.
/// - Data bytes with no status to belong to are skipped; a message cut off at
///   the end of a packet waits for the rest.
#[derive(Default)]
pub struct Parser {
    running: Option<u8>,
    sysex: Option<Vec<u8>>,
    /// A channel/common message waiting for its data bytes across packets.
    partial: Vec<u8>,
}

impl Parser {
    pub fn feed(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        for &b in data {
            // Realtime bytes stand alone anywhere, even inside a sysex or a partial message.
            if b >= 0xf8 {
                out.push(vec![b]);
                continue;
            }
            if let Some(sx) = self.sysex.as_mut() {
                if b == 0xf7 {
                    sx.push(b);
                    out.push(self.sysex.take().unwrap());
                    continue;
                }
                if b < 0x80 {
                    if sx.len() < SYSEX_MAX { sx.push(b); } else { self.sysex = None; }
                    continue;
                }
                // Another status byte: the sysex lost its end. Drop it, read this byte normally.
                self.sysex = None;
            }
            if b == 0xf0 {
                self.partial.clear();
                self.sysex = Some(vec![b]);
                continue;
            }
            if b == 0xf7 {
                continue; // an end-of-sysex with no sysex (one we dropped): nothing to end
            }
            if b >= 0x80 {
                self.partial.clear();
                self.partial.push(b);
                if (0x80..0xf0).contains(&b) {
                    self.running = Some(b);
                } else {
                    self.running = None; // system common cancels running status
                }
            } else if self.partial.is_empty() {
                match self.running {
                    Some(s) => self.partial.push(s),
                    None => continue, // a stray data byte
                }
                self.partial.push(b);
            } else {
                self.partial.push(b);
            }
            let status = self.partial[0];
            if self.partial.len() == message_len(status) {
                out.push(std::mem::take(&mut self.partial));
            }
        }
        out
    }
}

/// One packet through a fresh parser (tests).
#[cfg(test)]
pub fn split_messages(data: &[u8]) -> Vec<Vec<u8>> {
    Parser::default().feed(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_packets_with_running_status() {
        assert_eq!(split_messages(&[0xb0, 21, 64]), vec![vec![0xb0, 21, 64]]);
        assert_eq!(
            split_messages(&[0x90, 60, 100, 62, 90, 0xc1, 5]),
            vec![vec![0x90, 60, 100], vec![0x90, 62, 90], vec![0xc1, 5]]
        );
        // Realtime clock between messages doesn't break running status.
        assert_eq!(
            split_messages(&[0xb0, 1, 2, 0xf8, 3, 4]),
            vec![vec![0xb0, 1, 2], vec![0xf8], vec![0xb0, 3, 4]]
        );
    }

    #[test]
    fn running_status_and_a_cut_message_carry_over_packets() {
        let mut p = Parser::default();
        assert_eq!(p.feed(&[0x99, 36, 100]), vec![vec![0x99, 36, 100]]);
        // The Akai's pads on channel 10, running status in the next packet.
        assert_eq!(p.feed(&[38, 90]), vec![vec![0x99, 38, 90]]);
        // A message cut off at the end of a packet finishes with the next one.
        assert_eq!(p.feed(&[0x90, 60]), Vec::<Vec<u8>>::new());
        assert_eq!(p.feed(&[127]), vec![vec![0x90, 60, 127]]);
        // A stray data byte with nothing to belong to is skipped.
        let mut q = Parser::default();
        assert_eq!(q.feed(&[5, 6]), Vec::<Vec<u8>>::new());
    }

    #[test]
    fn sysex_comes_out_whole_and_the_messages_after_it_too() {
        // Sysex followed by a note in the same packet (the bug that swallowed everything after it).
        assert_eq!(
            split_messages(&[0xf0, 0x47, 0x7f, 0x49, 0xf7, 0x90, 60, 100]),
            vec![vec![0xf0, 0x47, 0x7f, 0x49, 0xf7], vec![0x90, 60, 100]]
        );
        // Split over packets.
        let mut p = Parser::default();
        assert_eq!(p.feed(&[0xf0, 0x47, 0x7f]), Vec::<Vec<u8>>::new());
        assert_eq!(p.feed(&[0x49, 0x01]), Vec::<Vec<u8>>::new());
        assert_eq!(p.feed(&[0x02, 0xf7, 0xb0, 1, 64]), vec![vec![0xf0, 0x47, 0x7f, 0x49, 0x01, 0x02, 0xf7], vec![0xb0, 1, 64]]);
        // A clock tick inside a sysex is its own message; the sysex is intact.
        assert_eq!(
            split_messages(&[0xf0, 1, 0xf8, 2, 0xf7]),
            vec![vec![0xf8], vec![0xf0, 1, 2, 0xf7]]
        );
    }

    #[test]
    fn a_sysex_without_its_end_never_wedges_the_parser() {
        let mut p = Parser::default();
        assert_eq!(p.feed(&[0xf0, 0x47, 0x7f]), Vec::<Vec<u8>>::new());
        // No 0xF7 ever came; the next status byte drops the sysex and is read normally.
        assert_eq!(p.feed(&[0x90, 60, 100, 0x80, 60, 0]), vec![vec![0x90, 60, 100], vec![0x80, 60, 0]]);
        // Far too long: dropped, and what follows still arrives.
        let mut q = Parser::default();
        let mut burst = vec![0xf0];
        burst.extend(std::iter::repeat(0x01).take(SYSEX_MAX + 10));
        assert_eq!(q.feed(&burst), Vec::<Vec<u8>>::new());
        assert_eq!(q.feed(&[0xf7, 0x99, 36, 1]), vec![vec![0x99, 36, 1]]);
    }

    #[test]
    fn a_long_sysex_is_trimmed_for_the_page_with_its_length() {
        let mut p = Parser::default();
        let mut sx = vec![0xf0];
        sx.extend(std::iter::repeat(0x11).take(200));
        sx.push(0xf7);
        sx.extend([0x90, 60, 1]);
        let out = messages_for_page(&mut p, &sx, "MPK mini 3", "12345", 7);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].bytes.len(), SYSEX_KEEP);
        assert_eq!(out[0].len, 202);
        assert_eq!(out[0].bytes[0], 0xf0);
        assert_eq!(out[1], MidiMessage { device: "MPK mini 3".into(), id: "12345".into(), bytes: vec![0x90, 60, 1], len: 3, timestamp: 7 });
    }

    #[test]
    fn only_channel_messages_are_sendable() {
        assert!(is_sendable(&[0x90, 36, 127]));
        assert!(is_sendable(&[0xc0, 3]));
        assert!(!is_sendable(&[0x90, 36]));
        assert!(!is_sendable(&[0xf0, 1, 0xf7]));
        assert!(!is_sendable(&[0x90, 200, 1]));
        assert!(!is_sendable(&[]));
    }

    #[test]
    fn message_serializes_for_the_page() {
        let m = MidiMessage { device: "Launchpad X".into(), id: "-1234".into(), bytes: vec![0x90, 11, 127], len: 3, timestamp: 42 };
        assert_eq!(
            serde_json::to_string(&m).unwrap(),
            r#"{"device":"Launchpad X","id":"-1234","bytes":[144,11,127],"len":3,"timestamp":42}"#
        );
        let p = Port { id: "1".into(), name: "MPK mini 3".into(), manufacturer: "Akai".into(), offline: true, open: false };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"id":"1","name":"MPK mini 3","manufacturer":"Akai","offline":true,"open":false}"#
        );
    }
}
