//! midi.rs — native MIDI for the desktop app (WKWebView has no Web MIDI).
//!
//! `midir` (CoreMIDI on macOS) lists, opens and closes ports; each incoming
//! message goes to the webview as a `midi://message` event
//! `{ device, bytes, timestamp }`, emitted from midir's callback thread.
//! src/lib/midiTauri.ts is the other half: it polls `midi_list` for hot-plug
//! while MIDI is in use, opens every input the user hasn't switched off, and
//! sends pad lights with `midi_send`.
//!
//! Nothing here panics on a bad port or a vanished device: every command
//! returns `Err(String)` for the page to show.

use std::collections::HashMap;
use std::sync::Mutex;

use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const CLIENT: &str = "Playfield";
pub const MESSAGE_EVENT: &str = "midi://message";

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Port {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Ports {
    pub inputs: Vec<Port>,
    pub outputs: Vec<Port>,
}

/// One MIDI message as the page receives it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct MidiMessage {
    pub device: String,
    pub bytes: Vec<u8>,
    /// Microseconds, from midir (CoreMIDI host time based).
    pub timestamp: u64,
}

#[derive(Default)]
pub struct MidiState {
    inputs: Mutex<HashMap<String, MidiInputConnection<()>>>,
    outputs: Mutex<HashMap<String, MidiOutputConnection>>,
}

fn lock_err<T>(_: T) -> String {
    "MIDI state is unavailable".into()
}

/// Every input and output port, with midir's stable id and its name.
#[tauri::command]
pub fn midi_list() -> Result<Ports, String> {
    let input = MidiInput::new(CLIENT).map_err(|e| format!("Couldn't start MIDI: {e}"))?;
    let output = MidiOutput::new(CLIENT).map_err(|e| format!("Couldn't start MIDI: {e}"))?;
    let inputs = input
        .ports()
        .iter()
        .filter_map(|p| input.port_name(p).ok().map(|name| Port { id: p.id(), name }))
        .collect();
    let outputs = output
        .ports()
        .iter()
        .filter_map(|p| output.port_name(p).ok().map(|name| Port { id: p.id(), name }))
        .collect();
    Ok(Ports { inputs, outputs })
}

/// Listen to input `id`. Already open: nothing to do.
#[tauri::command]
pub fn midi_open_input(app: AppHandle, state: State<MidiState>, id: String) -> Result<(), String> {
    let mut open = state.inputs.lock().map_err(lock_err)?;
    if open.contains_key(&id) {
        return Ok(());
    }
    let mut input = MidiInput::new(CLIENT).map_err(|e| format!("Couldn't start MIDI: {e}"))?;
    // Sysex, clock and active sensing: the engine doesn't read them, and clock alone is 24 events a beat.
    input.ignore(Ignore::All);
    let port = input
        .find_port_by_id(&id)
        .ok_or_else(|| "That MIDI input isn't connected any more".to_string())?;
    let name = input.port_name(&port).map_err(|e| e.to_string())?;
    let device = name.clone();
    let conn = input
        .connect(
            &port,
            "playfield-in",
            move |timestamp, data, _| {
                for bytes in split_messages(data) {
                    let _ = app.emit(MESSAGE_EVENT, MidiMessage { device: device.clone(), bytes, timestamp });
                }
            },
            (),
        )
        .map_err(|e| format!("Couldn't open {name}: {e}"))?;
    open.insert(id, conn);
    Ok(())
}

#[tauri::command]
pub fn midi_close_input(state: State<MidiState>, id: String) -> Result<(), String> {
    if let Some(conn) = state.inputs.lock().map_err(lock_err)?.remove(&id) {
        conn.close();
    }
    Ok(())
}

fn open_output(open: &mut HashMap<String, MidiOutputConnection>, id: &str) -> Result<(), String> {
    if open.contains_key(id) {
        return Ok(());
    }
    let output = MidiOutput::new(CLIENT).map_err(|e| format!("Couldn't start MIDI: {e}"))?;
    let port = output
        .find_port_by_id(id)
        .ok_or_else(|| "That MIDI output isn't connected any more".to_string())?;
    let name = output.port_name(&port).unwrap_or_default();
    let conn = output
        .connect(&port, "playfield-out")
        .map_err(|e| format!("Couldn't open {name}: {e}"))?;
    open.insert(id.to_string(), conn);
    Ok(())
}

#[tauri::command]
pub fn midi_open_output(state: State<MidiState>, id: String) -> Result<(), String> {
    open_output(&mut *state.outputs.lock().map_err(lock_err)?, &id)
}

#[tauri::command]
pub fn midi_close_output(state: State<MidiState>, id: String) -> Result<(), String> {
    if let Some(conn) = state.outputs.lock().map_err(lock_err)?.remove(&id) {
        conn.close();
    }
    Ok(())
}

/// Send one channel message (note, CC… no sysex) to output `id`, opening it first if needed.
#[tauri::command]
pub fn midi_send(state: State<MidiState>, id: String, bytes: Vec<u8>) -> Result<(), String> {
    if !is_sendable(&bytes) {
        return Err("Only short channel messages can be sent".into());
    }
    let mut open = state.outputs.lock().map_err(lock_err)?;
    open_output(&mut open, &id)?;
    let conn = open.get_mut(&id).ok_or("MIDI output not open")?;
    if let Err(e) = conn.send(&bytes) {
        // The device probably went away: drop the connection so the next send reopens it.
        open.remove(&id);
        return Err(format!("Couldn't send: {e}"));
    }
    Ok(())
}

/// A channel message (0x80–0xEF) of the right length.
pub fn is_sendable(bytes: &[u8]) -> bool {
    match bytes.first() {
        Some(&s) if (0x80..0xf0).contains(&s) => {
            bytes.len() == message_len(s) && bytes[1..].iter().all(|b| *b < 0x80)
        }
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

/// Split a CoreMIDI packet into whole messages: a packet can carry several,
/// and later ones can use running status (the previous channel status). Sysex
/// is dropped; bytes that don't make a whole message are too.
pub fn split_messages(data: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut running: Option<u8> = None;
    let mut i = 0;
    while i < data.len() {
        let b = data[i];
        if b == 0xf0 {
            // Skip the sysex through its 0xF7 (or to the end).
            i += 1;
            while i < data.len() && data[i] != 0xf7 {
                i += 1;
            }
            i += 1;
            running = None;
            continue;
        }
        let (status, start) = if b >= 0x80 {
            (b, i + 1)
        } else if let Some(s) = running {
            (s, i)
        } else {
            i += 1; // a stray data byte
            continue;
        };
        let need = message_len(status) - 1;
        if start + need > data.len() {
            break;
        }
        let mut msg = Vec::with_capacity(need + 1);
        msg.push(status);
        msg.extend_from_slice(&data[start..start + need]);
        out.push(msg);
        if (0x80..0xf0).contains(&status) {
            running = Some(status);
        } else if status < 0xf8 {
            running = None; // system common cancels running status; realtime doesn't
        }
        i = start + need;
    }
    out
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
    fn drops_sysex_and_partial_messages() {
        assert_eq!(split_messages(&[0xf0, 1, 2, 3, 0xf7, 0x80, 60, 0]), vec![vec![0x80, 60, 0]]);
        assert_eq!(split_messages(&[0x90, 60]), Vec::<Vec<u8>>::new());
        assert_eq!(split_messages(&[5, 6]), Vec::<Vec<u8>>::new());
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
        let m = MidiMessage { device: "Launchpad X".into(), bytes: vec![0x90, 11, 127], timestamp: 42 };
        assert_eq!(
            serde_json::to_string(&m).unwrap(),
            r#"{"device":"Launchpad X","bytes":[144,11,127],"timestamp":42}"#
        );
    }
}
