# Texture Lab

A Scene builder kind (the **Texture Lab** card on the kind page) for playing with the **Texture tools** on any picture
or video: pick a source, stack tools, reorder, mute and tweak them, and see the result live. It builds a real,
editable graph: each tool is its own Texture tools node, with a Mix after it for its Amount, and a Pass in front of it
when it needs one. Done puts the stack in the graph as one undo step. This is phase 6 of docs/combine-plan.md (the
"Texture builder" there). Not to be confused with the Shader Texture node (docs/texture-builder.md).

Code: `src/textureLab/` (blocks, spec, apply, presets, store, actions, picture) and
`src/components/textureLab/TextureLab.tsx`. Not offered on a phone.

## The window

```
 ┌ Scene builder › Texture Lab ──── undo · redo · before|after · Passes 1/8 · Open as nodes · Surprise me · Done ┐
 │ SOURCE ▣ Room and cat  │     the main preview, live: before | after, the divider draggable   │ the card's     │
 │ STACK  ☼ Blur       0  │                                                                       │ settings       │
 │        # Channel    0  │                                                                       │                │
 │        ∩ Curves     0  │                                                                       │                │
 │        ☼ Glow      +1  │                                                                       │                │
 │ [+ Add a tool]         │                                                                       │                │
 ├────────────────────────┴───────────────────────────────────────────────────────────────────────┴────────────────┤
 │ Thermal · Ink outline · Motion trails · Relief · your presets                                                  │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Source:** the built-in Room and cat or Walkway cat photo, the Ball action clip, a picture of yours (upload, paste,
  the library), a Texture node already in the graph, or what the Output showed when the Scene builder opened. A node of
  yours stays yours: Start over leaves it.
- **Stack:** tools applied top to bottom. Each row has its pass cost (0, +1, +3; amber in the grace zone), an eye
  (show the picture only up to that tool) and mute (a live gate on its Mix: nothing recompiles). Drag rows to reorder,
  or use the card's arrows. **Add a tool** adds after the selected tool.
- **Settings:** the selected tool's card: which output it shows (Edges: lines or the colour on the edges), Amount, then
  the node's own settings by its card's sections, the first open, the rest folded with a one-line summary.
- **Viewport:** the main preview at the viewport's size, with a before | after divider (toggle it in the top bar).
- **Presets:** Thermal, Ink outline, Motion trails (best on a video), Relief; your picture stays. Your own presets save
  from the strip. **Surprise me** picks 2–4 tools from a seed, varied, at most 4 passes.
- No Play controls are added. Right-click a slider for Add to Play controls, as on node cards.

## Tools (Texture tools nodes)

| Group | Tools |
|---|---|
| Find | Segment, Depth, Blob Track, Analyze, Optical Flow |
| Shape the value | Mask, Levels, Curves, Threshold, Channel, Channel Colours |
| Neighbours | Blur, Glow, Edges, Neighbours, Outline (jump flood: Mask → repeated Pass → Jump flood → Outline (distance)) |
| Bend | Read, Displace, Displacement Map, Flow (Flow → Read) |
| Time | Feedback, Change (with its Pass for the frame before), Cache |
| Light & depth | Height Light, Depth fog (Depth Mix with a Depth node), Depth of Field, Tilt-Shift |
| Lens | Chromatic Aberration, Radial Blur |

Not tools: Data Texture, Render Targets, Read Channels, Read Neighbours, Show Data, Shuffle, Sample, Cache Read.
Depth needs its model (a one-time download, offered on the tool's card). Curves picks from the Curves presets; drag its
points on the node card after Done.

## Passes

A tool that reads the pixels round each one (Blur, Glow, Edges…) needs a texture. The source is one; anything a tool
computed is only "this pixel", so Texture Lab puts a **Pass** in front of it (+1). Per-pixel tools (Mask, Levels,
Curves, Threshold, Channel) never need one. Feedback paints the colour so far over the source's texture, so it costs
only its own buffer.

The top bar shows the graph's passes. Past 8 the preview draws at half resolution (the grace zone, amber); at 10 the
lock holds: tools that would add a pass are locked in the add menu with the reason, and a move, preset or source that
would cross it is refused with the lock's toast (docs/pass-node-plan.md).

## The graph

`Source ─► [Pass] ─► Tool ─► Mix (Amount) ─► [Pass] ─► Tool ─► Mix ─► … ─► Output`

The source keeps the build (`params.textureLab`: `{ v: 1, build, spec }`); every node carries `_txRole`
(`source`, `b2:main`, `b2:pass`, `b2:mix`, `b3:flood`…) and `_txBuild`. A rebuild keeps ids by role, so Play controls
and your own wires into sockets Texture Lab doesn't set survive. A setting changed on a node card is what Texture Lab
shows when it reopens (Scene builder → Edit this one). The before | after divider (`view:` roles) is built only while
the window is open.

Examples: `texLabThermal`, `texLabTrails` (store/textureLabExamples.ts), built by Texture Lab itself.
