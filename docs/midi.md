# MIDI: knob locks, note ranges and pad grids

The Play page's MIDI sources (CC, note, velocity, gate, bend) read every
controller the browser can see. Three additions make a busy rig manageable:
lock a mapping to one knob, give note sources a key range, and use a grid
controller (Push, Launchpad) as the cells of a grid shader.

The reading itself is in `src/play/kit/midi.js`, part of the layer kit, so the
app and exported web pages do the same thing.

## Knob lock

A **MIDI CC** mapping shows an **Active** readout: the control touched last,
with its CC number, channel and device ("CC 21 = 64 · ch 2 · Launch Control
XL").

- **Lock to this knob** binds that exact control (device + channel + CC) to the
  mapping. From then on only that control drives it; the same CC on another
  channel or another device is ignored.
- Lock several controls on one mapping: whichever of them moved last drives it.
  Each lock is a chip with its own × to unlock it.
- **Learn & lock** waits for the next knob you turn and locks it.
- After **Learn** (✦) on a row, the knob you turned is the active input, so
  **Lock to this knob** is one click away.

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
  has Web MIDI output: lit while on (Latch), or while held (Hold, Decay).
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

## Desktop app

The macOS app runs in WKWebView, which has no Web MIDI: controllers don't
reach it yet (a native `midir` bridge is still to do, docs/play-v1-plan.md).
The keyboard stand-in, MIDI files, OSC and the on-screen pads work there.
