# Audio readers

An **audio reader** is a dot on the spectrum that reads one frequency band as 0–1: a kick near 60 Hz, a hi-hat near 8 kHz. Readers listen to one input at a time (`audioReaders.input`): the live input (mic, interface, virtual cable), an Audio Input node's song, a Video layer's sound (`video:<layerId>`), a Drum pad layer (`pads:<layerId>`) or an Audio engine rack (`engine:<rackId>`). The maths (band → dB → 0–1 → attack/release) is in `src/play/audioReaders.ts`, read once a frame by `src/lib/audioReaderBank.ts`; exported websites carry a line-for-line copy in `src/play/runtime/play-runtime.js`.

## Every reader is a control

A reader is made from the Audio readers panel, a track's Listener device (Audio engine), the Video card or the Drum pads card, and wherever it is made it comes with (`src/play/readerControls.ts`, `addReader`):

- a **float control**, 0–1, target `reader:<readerId>::level`, labelled with the reader's name, in a **control group** named after what the readers listen to: **Audio readers · Live**, **Audio readers · Rack 1**, **Audio readers · Video 1**, **Audio readers · Kit**, **Audio readers · <song>**;
- a **mapping** reader → control (0–1, linear, no smoothing), an ordinary mapping, so the control shows the reader's live level and a website carries it like any other.

So a reader can be used as **Another control** in a mapping, in **conditions** (`ctl:<id>`), in **pairs**, and it records into takes as a control. The control's slider follows the sound; there is nothing to set by hand (its base value is 0, and the engine writes no uniform for it: the value is the control's live value only, in the app and in the web runtime).

- **Renaming** the reader (on the panel, or the control on the panel) renames the other.
- **Deleting** the reader deletes its control, the mappings on that control and the ones reading it, and every mapping and action that read the reader (`removeReader`); the trash on the control does the same. One undo step.
- **Changing the readers' input** moves their controls to the new group (`setReaderInput`); renaming a rack regroups them too (`regroupReaderControls`).
- **Older setups** are left as saved: the Controls section shows a one-time chip, "Add controls for N readers" (`addMissingReaderControls`), which can be dismissed for that set of readers. The **Reader · name** mapping source keeps working as before.

Controls with a `group` (`PlayControl.group`) sit together under a folding heading in the Controls list and in the split view, where the first of them is. Groups are a light thing: a label on the control, nothing else.

## On the source card

Under a Listener's spectrum, the Video card's and the Drum pads card's, and behind **N readers** on the Live audio chip, the readers listening there are listed with their colour, name and a live meter (`src/components/play/ReaderDots.tsx`). Clicking a name opens the panel on that reader; **Controls →** opens the Controls section and highlights the group (`usePlayUi.revealControlGroup`). The Audio readers panel keeps the editing (frequency, width, gain, attack, release, colour, order), with its own **Controls →** per reader.

## Names

A new reader is named by the band its centre sits in, numbered when the band already has one:

| Band | Hz |
| --- | --- |
| Sub | < 60 |
| Lows | 60–250 |
| Low mids | 250–500 |
| Mids | 500–2k |
| High mids | 2k–4k |
| Highs | 4k–10k |
| Air | > 10k |

"Lows", then "Lows 2". Dragging a reader into another band (or typing a new frequency) renames it only while its name is still an automatic one (a band name, numbered or not, or an old frequency name like "120 Hz"); a custom name sticks. The control follows the reader's name.

## Where things are

| Piece | File |
| --- | --- |
| Bands, names, the control and its mapping, the record edits | `src/play/readerControls.ts` |
| The `reader:` target | `src/types/play.ts` (`readerControlTarget`, `parseReaderTarget`), `src/play/playControls.ts` (reads 0), `src/lib/playEngine.ts` (no uniform) |
| The panel | `src/components/play/AudioReadersPanel.tsx`, `readersPanelUi.ts` |
| Dots with meters on the cards | `src/components/play/ReaderDots.tsx`; the Listener device `engine/DeviceChain.tsx` (`RackSpectrum` in `engine/RackParts.tsx`), video `layers/VideoEditor.tsx`, pads `layers/DrumPadEditor.tsx`, the chip `chips.tsx` |
| Control groups and the chip | `src/components/play/PlayPage.tsx` (`ControlGroup`), `playUi.ts` |
| The website | `src/play/runtime/play-runtime.js` (`readerTarget`) |
| Tests | `src/play/__tests__/readerControls.test.ts`, `audioReaders.test.ts` |
