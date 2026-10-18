# Time Cube builder

The Time Cube builder is the Scene builder's **Time Cube** kind: a window for putting a video on screen as a box of
time ([time-cube.md](time-cube.md)) or as a stack of cards ([frame-stack.md](frame-stack.md)) and changing it
without wiring. It writes the graph you would wire by hand:

```
Time Cube ─► Time Cube View  (or Frame Stack) ─► Output
                  ▲
LFO ──────────────┘  (when something is animated: the slice, the scan, the spread, the morph…)
```

It adds no settings of its own. Every control is a param of one of those real nodes, drawn from the node's own
definition (its label, range, hint and when it shows), so the builder has every control the cards have, and a new
setting on a card shows up in the builder by itself. Every node has a note.

## Opening it

- **Scene builder → Time Cube** (the kind page's card with a box of frames, its slice sweeping). The kind page asks
  to clear a graph no builder made first, as for every kind ([scene-builder.md](scene-builder.md)).
- **A Time Cube the builder made:** the Scene builder offers **Edit this one** (it reopens on the build as it is
  now, hand edits included), Start over or Add another.

## Built as you go

The picture is drawn by the main preview, so the builder's viewport **is** the main preview, at the viewport's own
size (`LiveViewport ownSize`, as in the Splat builder), with Pause / Play and ↺ at its bottom right (the app's
clock and its one true reset, `LiveViewport clock`), and every change is built into the graph at once
(`timeCubeBuilder/actions.ts`):

- opening on a new scene builds it (the Box of time preset): one undo step, "Time Cube builder: built a time cube";
- each change after that is synced quietly, once a frame at most. A slider only writes the node's param and its
  uniform in one store write (no recompile); a menu or a switch compiles once. Cube ⇄ Stack and the LFO on or off
  rewire, keeping each node's id by its role (`source`, `view`, `stack`, `drive`), so Play controls stay pointed at
  them;
- a built node changed somewhere else (its card's Choose video or Edit clip…, a slider on the card) is taken back
  into the builder, so it always shows what the graph has;
- closing (Done, ×, or back to the kinds) makes the session one undo step, "Time Cube builder: changed the time
  cube". Inside the window ⌘Z / ⌘⇧Z undo the builder's own history and the graph follows.

**Done** closes and frames the nodes on the graph; **Open as nodes** (ƒ) does the same and selects the View or Frame
Stack. Since every edit is already in the graph, there is never a draft to keep: closing loses nothing.

## The sections

The node cards' own sections are grouped into the builder's; each is a folding card (the first open), with the
card's summary ("4 controls · 1 changed", "Off").

| Section | Box of time (Time Cube View) | Stack of cards (Frame Stack) |
|---|---|---|
| **Source** | The Time Cube card itself (Choose video: the built-in Ball action clip, the painted test clip, a Library video or a file; Edit clip…; the build's progress and its strip of frames), then Frames, Frames from, Frame order | the same |
| **Shape** | **A box of time / A stack of cards**; Shape (roundness, edge softness, bulge), Box (stack along, time stretch, box size) | the switch; Layout (layout, morph to, cards, spacing), Shape (radius, face out, arc, tube, turns, fan, columns), Cards (size, stretch, corners, thickness, opacity, border, backs) |
| **Time** | **Animate with an LFO** (what it moves, wave, speed, middle, reach); Slice (slice or flow, offset, before / after opacity, feather, slice face, tilts) | the LFO; Scan, Playback (what each card shows, speed, shift, delay), Order (shuffle) |
| **Colour** | Glow & tint (rim glow, side tint), Picture (brightness, contrast, dark is clear), Colour key with its "everything else" and animate (the hue shift and drift are colour shifting) | brightness, contrast, border, edge and highlight colours, shading |
| **Highlights & motion** | Highlights (switch, count, spacing, start, thickness, how they move, opacity, tint, outline, others, send through), Frame motion | Scatter (spread, offset, turn, seed, drift), Highlights |
| **Space** | Repeat (switch, along, gap, copies each side, mirror every other, turn per copy), Each copy (time per copy, how it steps, hue per copy), Warp (twist, bend, wave or noise; each box or the whole space; amount, frequency, speed), Far & fog (far, fog, step for a wired Space). See [timecube-space.md](timecube-space.md) | a note: Space is for the box |
| **Camera** | distance, angle, elevation, orbit, translate X / Y / Z, flatten, zoom | lens, distance, view size, angle, elevation, orbit, zoom |
| **Look** | shadow, quality, background; Outline | Focus (depth of field), background |

A test checks that every setting with a section on the three cards is in exactly one builder section.

Every number is a `BuilderSlider`: double-click resets it, typing past the end widens it, and right-click opens the
node card's Play menu (Add to Play controls). A socket the LFO drives says so instead of showing its slider. Quick
controls (the 2D Scene Builder's pins) aren't offered here: the shell only has them for the 2D builder.

The Time Cube reads a video, so the source is a video (Ball action, built in, by default): a webcam or a texture isn't something the
node can stack.

## Presets

Thirteen, read straight from the Time Cube and Frame Stack example folders (`timeCubeBuilder/presets.ts`): each is its
example's Time Cube frames, its View's or Frame Stack's settings and the LFO it wires. **Your video and its clip
stay**; the other display's settings stay too.

| Preset | From the example |
|---|---|
| Box of time | Time cube: a video as a box of time |
| Soft pill | Time cube: soft pill |
| Highlights loop | Time cube: highlighted frames loop |
| Flow | Time cube: flow |
| Isolate a colour | Time cube: isolate a colour |
| Long exposure | Time cube: long exposure |
| Infinite hall of cubes | Time cube: infinite hall |
| Twisted time | Time cube: twisted time |
| Time train | Time cube: time train |
| Isometric cards | Frame stack: isometric cards |
| Ring of frames | Frame stack: ring of frames |
| Drift apart | Frame stack: drift apart and back |
| Stack to ring | Frame stack: stack to ring |

Their pictures (and the kind page's) are drawn on the CPU (`timeCubeBuilder/picture.ts`): the Ball action clip's rings
of balls on a few frames, as a box or as cards, in the preset's own colours.

## Surprise me

`timeCubeBuilder/surprise.ts`: from a seed, a box (about two times in three) or cards, built on one of the presets
and varied inside ranges that read well: see-through past and a feather, the shape, a rim glow and pastel sides from
one palette, sometimes highlighted frames or a colour key; or a layout (sometimes morphing to another), the scan's
lift, borders, sometimes highlights or a scatter; a lens; a calm light or dark background; the camera at a pleasant
angle; an LFO on the slice or scan most of the time. The same seed gives the same scene; your video stays; one undo
step. The seed is shown and can be typed.

## Code

| | |
|---|---|
| `src/timeCubeBuilder/spec.ts` | the spec (each role's params, the LFO), the card section → builder section map, summaries |
| `src/timeCubeBuilder/apply.ts` | spec → graph (`applyTimeCube`), roles, reading a build back (`specOfBuild`) |
| `src/timeCubeBuilder/actions.ts` | open, Edit this one, the live sync, taking back card edits, the session's undo step, Done |
| `src/timeCubeBuilder/presets.ts`, `surprise.ts`, `picture.ts` | presets from the examples, Surprise me, the CPU pictures |
| `src/components/timeCubeBuilder/TimeCubeBuilder.tsx` | the window, the sections drawn from the node definitions |

Tests: `src/timeCubeBuilder/__tests__/timeCubeBuilder.test.ts` (every setting in one section; each section writes
its node's param with no rewire, the uniform too; Cube ⇄ Stack and the LFO rewire keeping ids; every preset, every
LFO target and Surprise me compile; a card's change is taken back; Done and the one undo step; Edit this one reopens
as built) and the kind page in `src/components/builders/__tests__/sceneBuilderShell.test.tsx`.
