# Presets: layer sets and rack presets

Two kinds of reusable piece on the Play page, kept on this device beside drum
kits and the Finish stack's presets, and listed on the Files page under
**Presets → Layer sets** and **Presets → Racks**:

- a **layer set** is a group of layers saved *with everything that comes with
  them*: the controls on them, the mappings and actions between them, the
  signals they send, their mattes, relationships, readers and sound effects.
  Loading one brings the whole thing back, wired, in any setup;
- a **rack preset** is one Audio engine rack: an instrument and its effects
  chain with their state, and the rack controls picked with Configure. It is
  *just the rack*: no mappings, no tape.

Code: `src/play/layerSets.ts`, `src/play/rackPresets.ts` (pure, over a KV),
`src/play/playRefs.ts` (every reference a Play record's pieces make, one
visitor), `src/components/play/presetsUi.ts` (the app's side),
`src/components/play/layers/SaveSetDialog.tsx`. Tests:
`src/play/__tests__/layerSets.test.ts`, `src/play/__tests__/rackPresets.test.ts`.

## The boundary rule

**Wiring travels only with complete things.** A layer set is complete: the
layers, and what connects them to each other, come as one. A rack is a
component: it goes into someone else's setup, where the wiring is theirs, so a
rack preset carries none.

For a layer set, "complete" is decided piece by piece: a piece comes along
only when **everything it names is inside the set**. Anything that touches the
set but names something outside is left out and listed in the save dialog
("Not included: mapping Lows → Radius (“Radius” isn't in the set)"), on the
set's item page, and in the record (`excluded`).

## Layer sets

### Saving

Pick layers in the Layers list (⇧-click a range, ⌘/Ctrl-click one at a time,
or **Select** and tap on a phone; a picked folder brings every layer inside
it), then **Save as a set…** in the bar that appears. It is also in the
Layers page's ⋯ menu (the picked layers, or the selected one) and in a
folder's ⋯ menu. The dialog asks for a **name**, an optional **note**, and
keeps a **poster** of the picture as it is (a 384×216 JPEG from the render
loop's own copy of the frame; untick it to save none). It lists what is in
the set, the files its layers use, and what is not included. Saving under a
name you already have replaces that set (it keeps its id).

What a set holds (`captureLayerSet`):

| Piece | Comes along when |
|---|---|
| Layers | picked, in list order; the Background layer never joins a set |
| Folders | the folders (and nested folders, #359) holding set layers, cut down to them |
| Controls | on a set layer's property or action; a reader's control when the readers come; a control a carried mapping reads as its source (see below) |
| Mappings | onto a carried control, when their source reads only what the set holds (a set layer, a carried control or reader) or nothing of the setup's (a MIDI knob, an LFO, a key…) |
| Actions | on a set layer, fired from one, or listening for a signal the set sends (a catch, a split, another carried action's signal), all their references inside |
| Signals | the ones carried pieces send or listen for (by id; see Loading) |
| Pairs | both controls carried; their pair mappings likewise |
| Conditions | inside a trigger, an increment or a pair axis: `ctl:` a carried control, `map:` a carried mapping, `layer:` / `dist:` set layers or hand points |
| Mattes | a layer's matte when the matte layer is in the set; the Background's matte when its matte layer is (`backgroundMatte`) |
| Relationships | the members in the set; others leave the relationship |
| Audio readers | when they listen to a set layer's sound (a Video layer, a Drum pad layer) |
| Sound effects | a set layer's own chain (`layer:<id>` in `audioFx`) |
| Layer kinds | the saved kinds its Script layers are made from |
| Media | pictures are inside the layers already (image layers, sprites); videos and sounds are named by their library id, or kept as a **linked-folder reference** (`linked:<folder>/<path>`) with the path (`media`) |

A **control on the shader** (a graph param) that a carried mapping reads as
its source comes along with its target, without whatever drives it; loading
checks that the open graph has that node, and leaves it out (with what used
it) when it doesn't. Links inside a layer to a layer outside the set (a
follow, a cloner's source, a portal's target, a path's corner) are cleared
and listed.

**Not carried:** a Data layer's dataset (datasets live in the graph file; the
layer keeps its name and shows it again where the graph has it), the Finish
stack, the Audio engine, takes and the tape, projection, hands settings, the
pad grid, the MIDI file.

### Loading

**Add layer → Layer sets** (search finds them by name or note), or **Add to
Play** on the set's Files item page. `loadLayerSet`:

- gives every piece a **fresh id** (layers, folders, controls, mappings,
  actions, readers, pairs) and rewires every reference to the new ids
  (`playRefs.ts`), so the same set can be added twice;
- puts the layers **after the selected layer**, or at the **top of the list**
  (just under the Background) when none is selected (from Files: always the top),
  inside a **folder named after the set** ("Sparky", "Sparky (2)"…) that holds
  the set's own folders;
- names layers and controls apart from the setup's: "Ring (2)", and "Ring (2) ·
  Size" for a control that followed the layer's name; other names get " (2)";
- **signals are names**: one the setup already has (same name) is used, others
  are added;
- readers come in only when the setup has none of its own (one input at a
  time); the Background's matte only when the setup has a Background layer and
  no matte yet. Either way the toast says what wasn't added;
- is **one undo step** ("Added the set “…”").

### Storage and files

One list in localStorage, `shader-studio:layer-sets` (like drum kits), so sets
travel in library ZIPs, `.playfile` library items, profile ZIPs (merged by id
and name, like the other preset lists) and the workspace folder
(`presets/layer sets/*.set.json`). Each set:

```json
{
  "id": "lset_…", "name": "Spark ring", "savedAt": 1790631642740,
  "note": "Hover the ring to speed the sparks; click it for a burst.",
  "poster": "data:image/jpeg;base64,…",
  "play": { "version": 1, "layers": […], "controls": […], "mappings": […], "actions": […], "groups": […], "signals": […] },
  "backgroundMatte": { "id": "layer_…", "mode": "luma" },
  "media": [{ "id": "vid_…", "kind": "video", "linked": false, "name": "clip.mp4", "layer": "Clip" }],
  "excluded": ["mapping Lows → Radius (“Radius” isn't in the set)"]
}
```

`play` is shaped like a Play record, so `parsePlayRecord` checks it on every
read (a hand-edited or damaged set loads what is valid).

**As a file**: a set's item page (or its ⋯ menu) → **Export as .playfile…**
writes it as a `library` item, with the **videos and sounds its layers name**
as `video` items (`videoIdsIn` finds `videoId` / `sampleId` / linked
`libraryId` in the set's JSON). Importing the `.playfile` elsewhere puts the
set in that device's list (a clash keeps both, "Name (2)") and the media in its
library under the same ids, so the loaded layers find them. Library ZIPs and
profile ZIPs keep linked-folder files as references (Relink… on a computer
without the folder), as everywhere else (docs/linked-folders.md).

Limits: a set lives in localStorage with the rest of the library (a few MB in
a browser), and its embedded pictures count; the poster is capped at 400 KB.
Script layers' own "list of layers" parameters are not rewired.

## Rack presets

### Saving

On a track in the Arrangement view (Engine): its ⋯ menu (or right-click the
header) → **Save as preset…**, then a name. `rackPresetFrom` keeps:

- the **instrument**: an Audio Unit with its **whole state**: the app asks the
  engine for each plug-in's state first (`ae_state_get`, the same path as
  "Keep its settings"), so what is dialled in the plug-in's own window comes
  back; the sample player's zones; the Granulator's sample and settings;
- the **effects**, in order, each with its state, parameters and on/off
  (bypass);
- the **rack controls** picked with Configure (≤ 8 a slot), with their names,
  ranges and values (the values live in the slots' `params`);
- its 8 **Macros** (docs/audio-engine.md, "Macros"): names, colours, values,
  and each target's range and curve; targets on an effect move to the new
  rack's effect ids, targets on a device left out go. A macro with targets
  gets its Play control; mappings onto it don't come (wiring);
- a Granulator's **Sound effects** (its `rack:<id>` chain, Finish → Sound);
- the **Listener**, when the audio readers listen to this rack, and where it
  sits in the chain;
- MIDI input and channel, volume and colour. (Racks have no pan.)

Not kept (wiring, or the setup's): mappings onto its controls, its clips and
automation on the tape, "Grains from" a layer, a layer's sound sent through it,
the Drum pad layer it follows, the computer keyboard (one rack at a time),
mute. The save toast lists what was left out.

### Loading

- **Add track → From a preset…** adds a rack (a free name; up to 8 tracks);
- a track's ⋯ → **Replace with preset…** puts the preset's instrument,
  effects and controls on that track: its name, colour, clips and the Drum
  pad layer it follows stay, its MIDI input, channel and volume come from the
  preset; the old devices' controls go, with the mappings onto them and their
  automation (the toast says how many mappings);
- **Add as a track** on the preset's Files item page.

Fresh ids for the rack and its effects; its rack controls become Play controls
in the slot's group ("Clouds · Granulator"), deduped by name; no mappings. An
**Audio Unit this computer doesn't have** (by the engine's scanned plug-in
list, desktop) is left out and named ("“Juno-60” isn't on this computer, so it
was left out"); the rest loads. Before the plug-ins are scanned, and in a
browser, Audio Unit devices are kept (heard in the desktop app), as with a
setup made there. The Listener is placed only when the setup's readers aren't
listening somewhere already. One undo step.

**As a Finish → Sound chain:** Add track → From a preset… also lists the
presets that have Sound effects (a Granulator's chain) under "Only its Sound
effects, on Finish → Sound"; picking one appends those effects to the master
chain. Audio Unit effects run in the engine and have no web version, so a
preset of Audio Units has nothing to give there.

### Storage

`shader-studio:rack-presets`, one list, the same travel as layer sets
(`presets/racks/*.rack.json` in the workspace folder). A preset's samples
(sample player zones, a Granulator's sound) are named by `sampleId`, so a
`.playfile` export bundles them.

## See also

- docs/files-page.md (item pages), docs/playfile-format.md, docs/linked-folders.md
- docs/audio-engine.md (racks, Configure, Listeners), docs/drum-pads.md (drum kits, the same storage pattern)
