# MIDI: knob locks, note ranges and pad grids

The Play page's MIDI sources (CC, note, velocity, gate, bend) read every
controller the browser (or the desktop app) can see. Three additions make a busy rig manageable:
lock a mapping to one knob, give note sources a key range, and use a grid
controller (Push, Launchpad) as the cells of a grid shader.

The reading itself is in `src/play/kit/midi.js`, part of the layer kit, so the
app and exported web pages do the same thing.

## A new knob mapping

A **MIDI CC** row added with **Add** (or switched to MIDI CC in the picker)
starts **unassigned**: it has no CC number yet and shows a pulsing "Turn a
knob…". The first CC that moves on any enabled device becomes its CC and
channel, the row flashes, and the **Knob** row reads "CC 70 · ch 1 · MPK
mini 3". Until then the row reads nothing and leaves its control alone.

Nothing is assigned while another row is listening on its own (Learn, Change…,
Set range, the pad grid's Learn) or while an Audio engine rack has the
computer keyboard. With several unassigned rows, each knob fills one row: the
knob still turning doesn't take the next row too.

The controls on a CC row:

- the **CC number** field and the **channel** select in the source row (type a
  CC if you know it; the field appears once the row has one);
- **Knob**: what the row follows. **Change…** waits for the next knob you turn
  and takes its CC (and channel) instead; Esc keeps the current one;
- **Learn** (✦) on the row replaces the whole source with the next input of
  any kind (a key, a note, the mouse);
- **Lock to this knob** (below): a lock on top of the CC.

Stored as `cc` on the source; a source without `cc` is unassigned. Older
records keep whatever CC they have (the old default was 1, and a row typed to
CC 1 on purpose can't be told from one that was never touched, so both stay).
`src/lib/midiAutoLearn.ts` does the assigning; `src/lib/__tests__/midiAutoLearn.test.ts`
covers it.

## Knob lock

**Learn** and **Change…** pick the CC. **Lock** goes further: it ties the row
to a device as well, so the same CC from another controller is ignored.

A **MIDI CC** mapping shows an **Active** readout: the control touched last,
with its CC number, channel and device ("CC 21 = 64 · ch 2 · Launch Control
XL").

- **Lock to this knob** binds that exact control (device + channel + CC) to the
  mapping. From then on only that control drives it; the same CC on another
  channel or another device is ignored.
- Lock several controls on one mapping: whichever of them moved last drives it.
  Each lock is a chip with its own × to unlock it.
- Unlocking removes only the device binding: the row keeps the lock's CC and
  follows it from any device again (the chip's tooltip says so).
- After **Learn** (✦) or **Change…** on a row, the knob you turned is the
  active input, so **Lock to this knob** is one click away.

The Studio's **MIDI Input** node has the same **Active** row and a **Lock**
button: it locks a CC output (adding it if needed) to the knob touched last.
Click a "locked" chip on a CC row to unlock it.

Stored on the source as `locks: [{ device, channel, cc }]` (`device` '' and
`channel` 0 mean any). A MIDI file and the keyboard stand-in have no device
name, so a lock taken from them matches any device.

## Note range

**MIDI note**, **velocity** and **gate** sources have a **Notes** row:

- **Set range**: press the lowest key, then the highest (the prompts say which
  is next; Esc cancels). The order doesn't matter.
- **Learn a note** (velocity and gate): press one key or pad, and only that
  note drives the row (a range of one; **Change note…** picks another, **Any
  note** drops it). A pad as a gate, in one press.
- The range shows as note names (C2–G3) and each end can be typed as a name
  (C2, F#3, Db4) or a number (36).
- Only notes inside the range count. A **note** source then reads 0 at the low
  end and 1 at the high end, so the range fills the mapping's output range.
  Velocity and gate follow the last note inside the range.
- **Reset to full range** drops it.

Stored as `range: [lo, hi]` on the source. Middle C (60) is C4.

## Pad grid (Push, Launchpad)

**Mappings → Set up a pad grid** adds the grid (`record.padGrid`). Its card:

- **Pads**: the layout. *Push 2 / 3* (User mode, notes 36–99, bottom-left to
  top-right), *Launchpad (programmer)* (X, Mini MK3, Pro MK3, MK2: 11–88, ten
  notes a row), *Launchpad (classic)* (original, S, Mini MK1/MK2 X-Y layout).
- **Learn the grid**: tap the bottom-left pad, then the top-right one. The
  layout is worked out from the two notes and the pad count (8 × 8 unless you
  change it in the prompt), rows of consecutive notes first, else columns. The
  device you tapped becomes the grid's device.
- **From**: which device and channel (Any by default: a keyboard's notes that
  fall on pad notes light cells too, so pick the controller).
- **Cells**: the shader grid's columns and rows (up to 32 × 32).
- **Align**: an offset in cells, a scale in cells per pad (2: each pad covers
  2 × 2 cells), Flip X / Flip Y, and **Fit** to scale the pads over the cells.
- **A hit**: *Hold* (lit while held, fading over Release after), *Latch* (each
  hit toggles), *Decay* (each hit flashes and fades over Release). *Velocity*
  scales the level by how hard the pad was hit.
- **Light the pads** sends each pad's state back as a note on the output with
  the same name as the device (Launchpad green, Push white), where the browser
  has Web MIDI output or in the desktop app: lit while on (Latch), or while held (Hold, Decay).
- The picture of the cells lights live and can be clicked like pads (Shift for
  full velocity), so the grid works with no controller attached. Cells no pad
  reaches are faint.

Pads send note on/off; pressure comes from poly aftertouch (0xA0) per pad, or
channel pressure (0xD0) for every held pad.

### In the graph: the Pad Grid node

**Pad Grid** (Sources) reads the cells. Each pixel gets its cell (the cells
tile the picture, column 0 left, row 0 bottom):

| Output | |
| --- | --- |
| Level | the cell's level, 0–1 (hold, latch or decay) |
| Velocity, Pressure, Held | the cell's last hit, aftertouch, 1 while held |
| Cell ID | column and row |
| Local | the pixel's offset from the cell's centre, in UV units |
| Cell Size | a cell's width and height in UV units |
| Last Pad, Last Velocity | the cell the last hit landed on (−1 before any) |

Wire a **Cell** input (a Grid's or a Cell node's Cell ID) to read a given
cell instead of the one under the pixel. The shader sees `u_padGrid` (a
cols × rows RGBA texture: level, velocity, pressure, held), `u_padGridSize`
(0 × 0 when there is no pad grid, and every cell reads 0) and `u_padLast`.

Example: **Play → Pad grid (Push, Launchpad)**. UV → Pad Grid → Circle SDF on
Local with its radius from Level → SDF Glow.

### As a mapping source

**Pad grid** (Devices) reads the last pad's **X** and **Y** (0–1 across the
pads), **Velocity**, **Pressure**, **Gate** (any pad held) or one **Cell**'s
level by column and row.

## Takes, renders and web pages

- Mappings from locked knobs and ranged notes are recorded in takes like any
  control. The pad grid's cells are recorded too (`pad` tracks: `c<index>` per
  cell that lit, and the last pad), and playing back or rendering a take sets
  them instead of live pads.
- Cells change on the graph clock, so a MIDI file driving the pads renders
  the same every time. With the clock paused a fading cell holds.
- Exported pages read locks, ranges and the pad grid (Enable MIDI in the
  player). The page's pad grid has no on-screen pads and doesn't light the
  controller.

## Monitor

**Monitor** (the button on the MIDI status chip in Mappings, and the antenna
button in the Engine tab's header) is for "is my controller getting through,
and what exactly does it send?":

- **Sources**: every input the system knows, connected or not: its name, its
  maker, its id (CoreMIDI's unique id in the app, the browser's port id on the
  web), and its state: **open** (we listen to it), **offline** (macOS
  remembers the device but it isn't plugged in), **switched off here**, or why
  it couldn't be opened. Behind that, how many messages it has sent.
- **Messages**: a live log of the newest 200 raw messages, filtered to one
  device or all: the time, the device, the bytes in hex and what they mean
  ("Note on C2 (36) vel 90 · ch 10", "CC 1 Mod wheel = 64", "SysEx Akai (12
  bytes)", "Clock", "Program 3"). Sysex and system messages show here even
  though the engine ignores them; a long sysex shows its first 64 bytes and
  its length. **Pause** freezes the log (the counts keep going), **Clear**
  empties it, **Copy** puts the sources and the log on the clipboard as text,
  ready for a bug report.
- The keyboard stand-in, a MIDI file and `__shaderStudioDev.midiEngine.handleBytes(...)`
  show as "(no device)". `__shaderStudioDev.midiMonitor.text()` is the same log
  in the console.

`src/lib/midiMonitor.ts` (the ring buffer and the decoding, `describeMidiBytes`),
`src/components/play/MidiMonitor.tsx` (the view).

### When a controller doesn't show, or shows and stays silent

1. **Not in Sources at all**: macOS doesn't see it. Check Audio MIDI Setup →
   MIDI Studio: a grey icon is offline. Try another cable or port (some
   USB-C hubs drop MIDI class devices), and a controller with a mode switch
   (an MPK mini's program or DAW mode) should be in its plain MIDI mode.
2. **Listed as offline**: the system remembers it from before; plug it in
   and it turns to open within two seconds (the app scans every 2 s while the
   window is visible; **Connect** scans at once).
3. **Listed but not open, with a reason**: read it. "Couldn't open" usually
   means another app holds the port exclusively; quit that app or press
   Connect. "Switched off here": click the device's name on the MIDI status
   chip to listen again.
4. **Open but no messages when you play**: the controller isn't sending on
   its USB MIDI port (some send on a second port or over Bluetooth), or is
   sending only sysex (its editor mode). Watch the log while pressing pads
   and keys, turning knobs; if it stays empty, the device's own
   configuration is the place to look.
5. **Messages arrive but nothing plays**: check what the log says against the
   rack or mapping. Pads on **channel 10** need the rack on **All channels**
   (the default) or channel 10; a rack limited to one device must name this
   one (two devices with the same name are still two ports, and both work). A
   knob lock binds an exact device + channel + CC. A note range on a mapping
   excludes notes outside it.
6. **Copy** the Monitor and send it with a bug report: it names every source
   with its id and state and lists what each one sent.

## Desktop app

The macOS app runs in WKWebView, which has no Web MIDI, so it reads MIDI
natively: `src-tauri/src/midi.rs` talks to **CoreMIDI directly** (the
`coremidi` crate; `midir` stands in on other platforms), and
`src/lib/midiTauri.ts` is its web half. `src/lib/midiTransport.ts` picks Web
MIDI in a browser and the bridge in the app (`__TAURI_INTERNALS__`), so the
engine, knob locks, note ranges and pad grids work the same in both.

- **One client** for the life of the app, **one input port per source** we
  listen to, one output port for everything sent. A scan (`midi_list`) reads
  the system's source list from that client; nothing is created or torn down
  per scan, so scanning every 2 s costs nothing and never hits CoreMIDI's
  client limits.
- **Ports are known by id**, CoreMIDI's unique id, never by name: two
  controllers with the same name are two ports and both are opened; a port
  with an empty name is shown as "MIDI port <id>". The name is still what
  knob locks, pad grids and racks match on.
- **Offline** sources (`kMIDIPropertyOffline`: a device macOS remembers but
  that isn't connected) are listed with `offline: true` so the Monitor can
  show them, and are never opened; the moment one comes online the next scan
  opens it. A device plugged in before launch is opened on the first scan.
- **Commands**: `midi_list` (inputs and outputs, `{ id, name, manufacturer,
  offline, open }`), `midi_open_input` / `midi_close_input`,
  `midi_open_output` / `midi_close_output`, `midi_send` (one channel message;
  sysex is refused).
- **Messages** arrive as `midi://message` events `{ device, id, bytes, len,
  timestamp }` from CoreMIDI's callback thread, one per message. A per-port
  parser (`midi.rs Parser`, unit-tested) splits a packet carrying several
  messages, keeps **running status** across packets, and treats **sysex**
  carefully: a sysex comes out whole even when split over packets, a realtime
  byte inside it comes out on its own, and a sysex that never gets its 0xF7
  (or passes 4 KB) is dropped the moment another status byte arrives, so a
  controller's sysex burst on connect (the MPK mini's, say) can never swallow
  the notes that follow it. Sysex reaches the page trimmed to 64 bytes with
  the real `len`, for the Monitor only; the engine ignores it. Clock and
  active sensing are dropped in Rust.
- **Devices**: every connected input is opened when MIDI is first used (a MIDI
  node, a MIDI mapping, or a rack on the Play page). The port list is read
  again every 2 s while the window is visible, so plugging a controller in or
  out is picked up on its own; Connect re-scans at once.
- **Per device**: with two or more inputs, the Play page's MIDI status lists
  them; click one to ignore it (and click again to listen). The desktop app
  closes an ignored port; a browser drops its messages. Remembered on this
  computer (`shader-studio:midi:off`), in both.
- **Pad lights** go to the output with the same name as the grid's device.
- **Names** are CoreMIDI's display names. They're usually what Chrome shows,
  but a lock taken in the browser may name a device slightly differently;
  if a locked knob stops responding in the app, lock it again there.
- **Tests**: `cargo test --lib midi` covers the parser (running status
  across packets, sysex with messages after it, sysex split over packets,
  unterminated and oversize sysex, realtime inside sysex, trimming) and the
  event shape; `src/lib/__tests__/midiTransport.test.ts` covers the web half
  (ports by id, duplicate and empty names, offline ports, hot-plug, sysex to
  the Monitor).

No capability entries are needed: the app's own commands aren't gated by the
capability file (there is no app permission manifest), and events use
`core:default`. macOS asks for no permission to read MIDI.

To try it without hardware, turn on the IAC Driver (Audio MIDI Setup → MIDI
Studio → IAC Driver → Device is online) and send to it from a DAW; or call
`__shaderStudioDev.midiEngine.handleBytes(0xb0, 21, 64, 'Test')` in the
devtools console.
