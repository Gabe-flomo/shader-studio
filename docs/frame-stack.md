# Frame Stack: a video's frames as cards

A **Time Cube** decodes a video into frames (see [time-cube.md](time-cube.md)).
**Time Cube View** draws them as one solid box of time. **Frame Stack** draws
each frame as its own thin card, and you arrange and animate the cards:

- line them up in a stack, fan them like a hand of cards, stand them round a
  ring or a torus, wind them up a helix, or lay them out as a contact sheet;
- morph from one arrangement to another;
- scatter them, and let them drift apart and come back together;
- scan through them, so the card at the scan pops out;
- highlight one card every few, travelling with the scan;
- shuffle them into a random order;
- choose what each card plays: its own frame, the video with a delay from
  card to card, or one frame on every card;
- blur cards out of focus, like a camera lens.

## The node

**Frame Stack** is in the 3D Scene category. Wire a Time Cube's **Volume**
into it and its **Color** into the Output. When you add one on its own, it
works like Time Cube View: it reads the nearest Time Cube (or brings one with
the test clip), and in a graph that already ray-marches a scene it joins it
(the March Camera's rays, the loop's picture behind, the loop's distance in
front).

### Sockets

| Socket | What it takes |
|---|---|
| Volume | A Time Cube's Volume. |
| Offset | The scan, 0 to 1. Wire Time or an LFO here to sweep. |
| Spread | The scatter, 0 to 1. Wire an LFO here for apart and back. |
| Morph | Layout to Morph to, 0 to 1. |
| Shuffle | Time order to random order, 0 to 1. Wiring it turns Order to Shuffle. |
| Ray Origin / Ray Dir | A March Camera's rays. Unwired: the built-in orbit camera. |
| Background | What is behind the cards, such as a March Loop's Color. |
| Scene distance | A March Loop's Distance. Scene surfaces nearer than a card hide it. |

The outputs are **Color** (the cards over the background) and **Alpha** (how
much of the pixel the cards cover).

### Settings

Every slider is a live uniform: dragging it never recompiles the shader. The
menus (Layout, Morph to, Order, Depth of field, Each card shows, Lens, Backs,
With the scan) recompile, because each writes different code. Sections fold;
only Layout starts open.

| Section | Setting | What it does |
|---|---|---|
| Layout | Layout | **Stack**, **Fan**, **Ring / torus**, **Helix** or **Grid**. |
| | Morph to | A second layout. **No morph** by default. |
| | Morph, Stagger | 0 is Layout, 1 is Morph to. Stagger sends the first cards first. |
| | Cards | How many cards, 1 to 128. Each shows a frame, spread evenly through the Time Cube. |
| | Spacing | The gap between cards: along a stack, up a helix, between grid cells, and behind each other in a fan. |
| Shape | Radius | Ring and helix: the distance from the centre. Fan: how far below the cards it pivots. |
| | Face out | Ring and helix: 0 turns the cards along the ring (a rolodex), 1 turns them outward. |
| | Arc | Ring: how much of the circle the cards go round. |
| | Tube, Windings | Ring: a tube the cards also wind round, making a torus. The cards roll with the tube. |
| | Turns | Helix: how many times round. |
| | Fan angle° | Fan: the spread from the first card to the last. |
| | Columns | Grid: cards a row. 0 makes it about square. |
| Cards | Card size, Stretch | The card's height. The width follows the video's shape, times Stretch. |
| | Corners | 0 square, 1 fully round. |
| | Thickness | The card's edge shows in Edge colour from the side. |
| | Opacity | Only the four nearest cards at a pixel are drawn, so keep it high where many overlap. |
| | Border, Border colour | A frame round each picture. |
| | Backs | The picture (mirrored), or Plain (Border colour). |
| | Shading | Darkens cards turned away from the camera. |
| Scatter | Spread | 0 tidy; 1 every card at its full random offset. |
| | Offset, Turn | How far a card can move and turn, at Spread 1. |
| | Seed | Another set of offsets. |
| | Drift, Drift speed | A slow wander of its own for each card. |
| Scan | Offset | Where the scan is: 0 the first card, 1 the last. |
| | Lift, Pull out, Scale, Tilt° | What the card at the scan does: rises along its own up, comes forward, grows, tips back. |
| | Gap | Cards either side slide apart, in cards. |
| | Falloff | Neighbours move too, less and less (a wave). 0 moves only the one card. |
| | Before opacity | How solid the cards before the scan are. |
| Highlights | Count, First card, Every | Count cards, Every apart, from First card. Count 0 turns them off. |
| | With the scan | **Travel** (the default): counted from the scan's card, wrapping round the end, so the highlights loop as it sweeps. **Stay put**: fixed cards. |
| | Lift, Scale, Outline, Tint, Highlight colour | How highlighted cards stand out. |
| | Dim others | Darkens every card that is not highlighted. |
| Order | Order, Shuffle, Shuffle seed | **Shuffle** sends each card to its own place in a seeded random order. A card keeps its frame; only its place changes. |
| Focus | Depth of field | **Off**, **Focus at a distance**, or **Focus on the scan card**. |
| | Focus | Where it is sharp, as a share of the distance to the centre: 1 the centre, 0.6 nearer. The same as the Particles node's Focus. |
| | Blur, Max blur | How strong (the Particles node's Blur: at 1, a card twice the focus distance away blurs about 26 pixels of 720), and the most, in pixels of a 720-high picture. |
| Playback | Each card shows | **Its own frame**; **the video, each card a little later** (a time echo); or **one frame on every card**. |
| | Play speed, Shift, Delay, Frame | Frames a second; frames to move every card on; frames between cards (echo); which frame (frozen). |
| | Brightness, Contrast | Applied to every frame. |
| Camera | Lens | **Perspective** or **Isometric** (orthographic: far cards as big as near ones). Built-in camera only. |
| | Cam Distance, View size, Angle, Elevation, Orbit speed, Zoom | The orbit camera, as Time Cube View's. View size is the isometric zoom. Elevation 0.62 is true isometric. |
| | Background | Behind the cards when nothing is wired to Background. |

## Examples (Frame Stack folder)

Every example uses the built-in test clip, and every node carries a note.

- **Frame stack: isometric cards.** A long diagonal stack on a light page,
  isometric lens. The scan opens a gap and pulls one card out.
- **Frame stack: ring of frames.** Cards on edge round a ring on black, with
  white borders, the camera circling. The card at the scan rises as it
  passes.
- **Frame stack: drift apart and back.** An LFO on Spread: the stack comes
  apart, the cards wander, and they gather again.
- **Frame stack: highlighted frames loop.** Four cards, eight apart, lit and
  lifted out of a dimmed stack, travelling with the scan.
- **Frame stack: stack to ring.** An LFO on Morph, with Stagger.
- **Frame stack: ring in shallow focus.** Depth of field: the near cards
  sharp, the far side of the ring blurred.
- **Frame stack: shuffle the contact sheet.** A grid that shuffles itself and
  comes back, from an LFO on Shuffle.

## How it draws

Each card is a thin box: a rounded rectangle with a thickness. Nothing is
ray-marched. For each pixel:

1. **Which cards the ray can meet.** For a stack, a helix, a ring and a grid
   this is worked out from the layout. The ray is clipped to the box,
   cylinder, ring or plane the cards sit in, and that piece of the ray gives
   the run of card indices it can reach. The run is widened by how far a
   card can stray: scatter, drift, lifts, the scan's gap, blur. A ring gives
   two runs, near side first. Fans, morphs and part-done shuffles test every
   card inside one sphere round them all.
2. **The nearest four hits.** Each card in the run gets a bounding-sphere
   test, then the exact ray test against its slab and rounded outline. The
   nearest four hits are kept in order in two vec4s, with no arrays. Once a
   solid card is hit, anything wholly behind it is skipped. A stack is walked
   near to far and stops there.
3. **Compositing.** Only those four cards read the atlas: front to back,
   each with its frame, border, highlight, edge and shading. With depth of
   field on, each reads 12 taps over its circle of confusion, and its edge
   softens by the same amount.

The cards' layout maths is in `lib/frameStack/layout.ts`, mirrored by the
GLSL and checked by the tests. The runs of cards only skip work. A hidden
`_cull: false` param makes the node test every card. In headless Chrome,
renders of every example and of tilted, scattered, shuffled, blurred, torus,
open-arc, fan and inside-the-stack cases came out identical, pixel for pixel,
with and without it.

The shuffle is a true permutation: a three-round Feistel network on the
smallest square holding the card count, walking the cycle until it lands
inside. Every card gets its own place, and the reverse finds which card is
in a place. Its code is only written into the shader when Order is Shuffle,
because it is heavy.

## Performance

These timings were measured in headless Chrome (ANGLE Metal) on an Apple M3
Pro. They are GPU time from `EXT_disjoint_timer_query_webgl2` at
**1920 × 1080**. The figures are the best of 25 frames, because other apps
were using the GPU at the same time. Medians under that load ran 1.2 to 3
times higher.

| Graph | GPU ms at 1080p |
|---|---|
| Example: isometric cards (40 cards) | 0.42 |
| Example: ring of frames (40) | 1.0 |
| Example: drift apart, Spread near 0 / near 1 (36) | 0.3 / 3.4 |
| Example: highlighted frames loop (48) | 0.45 |
| Example: stack to ring, mid-morph (40) | 1.2 |
| Example: ring in shallow focus (40), depth of field on / off / on the scan card | 2.6 / 2.0 / 2.6 |
| Example: shuffle, mid-flight / shuffled (36) | 0.5 / 0.45 |

The drift example was later cut to 30 cards. Its Spread-near-1 time was not
measured again, because the GPU was busy at that point; at about 0.1 ms a
card, it should be near 2.9 ms.

| Cards | 32 | 64 | 128 |
|---|---|---|---|
| Stack, isometric | 0.38 | 0.64 | 0.85 |
| Stack, perspective, looking along it | 0.27 | 0.47 | 0.70 |
| Ring | 0.85 | 1.5 | 2.9 |
| Ring with depth of field | 2.1 | 3.9 | 7.8 |
| Grid | 0.30 | 0.39 | 0.65 |
| Scattered (Spread 1, Offset 1.6) | 2.9 | 5.6 | 9.7 |
| Morph, mid-way | 1.0 | 2.9 | 10.4 |

The default node (a stack of 48) and every example stay under about 3 ms. A
tidy layout costs little per card, because only the cards a ray can reach are
tested. Scatter, morphs, fans and part-done shuffles test every card, at about
0.1 ms a card at 1080p. Keep the count down when you use them, or animate
Spread back to 0. Depth of field reads 12 taps on each card it blurs.

## Limits

- **Four layers.** Only the four nearest cards at a pixel are composited. With
  low Opacity or Before opacity and many cards overlapping, cards further back
  drop out.
- **No mipmaps.** The atlas is read with plain bilinear filtering, as Time
  Cube's is. A small card showing a large frame can shimmer, so use a smaller
  Frame size on the Time Cube for many small cards.
- **128 cards** at most. One card shows one frame, so a 256-frame Time Cube
  shows every other frame at 128 cards.
- The **isometric lens** is the built-in camera only. A wired March Camera
  brings its own lens.
- **Depth of field** blurs each card's picture and edges. It doesn't spread
  light past the card's outline the way a real lens does.
- Exported web pages and offline renders (Record's exports, Bake) take Frame
  Stack as they take Time Cube View. The atlas travels as the Time Cube's
  JPEG, and renders wait for its build.
- **Not tested:** inside groups and Pass programs; the mobile card; the
  desktop app (WKWebView).

## Code

| Part | Where |
|---|---|
| Layout, scatter, scan, highlight, shuffle and frame maths (pure) | `src/lib/frameStack/layout.ts` |
| The node and its GLSL | `src/nodes/definitions/frameStack.ts` |
| Examples | `src/store/frameStackExamples.ts` (**Frame Stack** folder) |
| Adding one with a Time Cube, joining a scene | `src/lib/timeCube/autoWire.ts` (shared with Time Cube View) |
| Tests | `src/lib/frameStack/__tests__/frameStack.test.ts` |

The tests cover each layout and the morph, scatter by seed, the scan's wave
and gap, the highlights' modular maths, the shuffle permutation, the
card-count caps and the playback frames. They also check that every slider is
a live uniform and that two slider values compile to the same shader. Further
cases: the wires, a March Camera, every layout and morph pair, only the code
a setting needs, one shared sampler, and adding the node to a graph.
`compiler/__tests__/goldenShaders.test.ts` leaves out the Frame Stack folder,
so every other graph compiles byte for byte as before.
