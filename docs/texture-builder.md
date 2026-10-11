# Shader Texture (the texture builder)

A node that holds **its own shader graph, drawn into a texture**. "Load a texture" is the Texture node; "Create a new texture" is this. Its output wires anywhere a texture goes: an Agents group's food or birth picture, Grid Rules' start, a mask, Depth, the Texture tools, Sample / Edges / Blur / Glow (texture).

## Using it

- **Add one** from the node browser (Sources, next to Texture; search also finds "Create a new texture", "Texture builder", "Procedural texture"), or press **Create a new texture** on an empty Texture card: a Shader Texture takes its place, wired where the Texture was.
- **The card** shows the texture live, its size and its GPU time when drawn, an **Edit inside** button and **Start from: Noise · Gradient · Circles · Stripes** (replaces the inside; one undo step).
- **Edit inside** (or double-click the header or the picture) opens its graph like a group, with a panel showing the live texture and a Done button (Esc works too). The inside ends in **Texture Output** (Color, Alpha), which can't be deleted. There are no group input or output terminals: the inside is self-contained. **UV inside runs −1 to 1 across the texture's own square**, whatever the picture's shape. The eye on a node inside shows that node over the picture.
- **Inside:**
  - Entering frames the inside's nodes (beside the panel). Leaving goes back to the view you had outside. This holds for every way in and out (Edit inside, double-click, Esc, Done, the breadcrumb) and for every group, Pass and Agents group too.
  - The minimap shows the inside's nodes, not the top level's.
  - **The main preview shows the texture you are editing**, stretched over the picture. **Preview shows: This texture · Where it's used** on the panel flips it to the graph's own output, with this texture in it. Both follow edits inside live. The choice is kept for the session (default This texture). The eye on a node inside still wins over both.
- **Settings:**
  - **Resolution:** 128, 256, 512 (default), 1024 or 2048 square, or Match the picture.
  - **Update:**
    - **On change** (default): drawn again only when a slider or a Play control it reads changes, or the clock when a Time node is inside. A still texture costs nothing per frame.
    - **Every frame.**
    - **Once:** drawn when the graph inside (or its target) changes, then kept.
  - **Filter:** Linear or Nearest.
  - **Edges:** Repeat (default), Clamp or Mirror.
  - **Format:** Half float or 8-bit.
- **Outputs:** **Texture** (a sampler), plus **Color** and **Alpha**, the texture at this pixel (stretched over the picture).
- **Turn into a Shader Texture:**
  - **On a selection** (right-click, top level): the selected nodes become the inside. The node whose output leaves the selection feeds Texture Output, and whatever read it reads the new node's Color. A UV, Time, Constant or Colour Picker the selection reads from outside is copied in. Any other wire from outside can't come along (a Shader Texture has no inputs), and a notice names it.
  - **On a plain group** (right-click → Turn into a Shader Texture): its inside, with its first output port as the result. This works when the group reads nothing through its inputs.

## Examples

**Passes 10 · A Shader Texture feeds the slime.** *Food rings* (UV → noise → rings) is drawn once into a 512 × 512 texture. Its Color is the Grow toward a picture slime's Food, which feeds the Emit's Where ƒ and the Trail's Add, so the veins grow into rings. Change Count inside and the texture is drawn again.

## Under the hood

It reuses the Pass machinery; there is no second renderer.

- **Compile** (`compiler/shaderTextureExpand.ts`). Before the pass cut, each Shader Texture is opened into:
  - its inner nodes, which keep their ids. A clash gets `<nodeId>__` in front, as `passGroups.ts` does. The node's `innerId::key` overrides (written when a slider moves inside) are applied.
  - a **Pass with the node's own id**. Every wire out of the node reads the Pass, and the Pass card thumbnail registry, timers and probes find it by that id.

  Texture Output's wires feed the Pass. An Output or group terminal left inside is dropped. The Pass carries:
  - `__size`, the fixed px, or scale 1 for Match the picture;
  - `__update`;
  - `__alwaysLive`, so it draws before anything reads it and the card and the inside preview show it;
  - `__stillTime`, set when no Time node is inside.

  `hasPassNode` counts a Shader Texture, so a graph with one takes the pass compile. A Shader Texture inside a plain group is opened after `passGroups` opens the group. Its card reads only Texture, Color and Alpha (the Pass's Previous and Step aren't probed).
- **PassProgram** gains `size?` (a fixed square size), `update?` ('change' | 'once') and `stillTime?`. They are present only when set, so every other pass compiles exactly as before (golden snapshots unchanged; one new entry for the new example).
- **Schedule** (`play/kit/passPlan.js`):
  - `ppSize(w, h, scale, size)` makes a fixed square, and `ppTargetKey` includes it, so a resize leaves it alone.
  - `ppKeeps(p, drawnSig, sig)` decides whether a pass keeps its picture this frame. It applies only to a pass with `update`, and never to one that keeps a Previous, repeats, or reads other passes.
- **App** (`lib/passRunner.ts`). Before drawing a Shader Texture, the runner builds its signature:
  - **Once:** the program's material, the target key and a binding epoch.
  - **On change:** the same, plus the values of the uniforms its program reads (`uniformsRead`: those named after their declaration; textures by id and version; `u_time` skipped with `stillTime`).

  An unchanged signature keeps the picture and still binds its texture. The target remembers what it was drawn with (`drawn`), and `clearPrevious` (a new render, reset time) forgets it.
- **Pages** (`play/kit/passHost.js`): the bundle carries `size`, `update` and `reads`. Once draws a single time per target. On change draws every frame on a page, because the page has no cheap view of the values a program reads, so it never shows a stale texture.
- **Store.**
  - `defaultSubgraphFor('shaderTexture', params)` builds the starter (`nodes/shaderTextureStarters.ts`).
  - Entering one uses the ordinary group path. The inside's eye preview compiles the inner graph alone.
  - **What the main preview shows inside** (`insideShaderTexture`, `shownShaderTexture`, `insideTextureView`). With This texture, `compile()` compiles the node's Color on an Output (`buildPreviewGraph`, or `buildGroupPreviewGraph` inside a plain group), so the texture is drawn by its own pass. Show passes still lists the whole graph's passes. A store subscription recompiles when the scope or the choice changes what is shown. The choice is in sessionStorage (`playfield.insideTextureView`).
  - Starters, Create a new texture and Turn into a Shader Texture are each one undo step through `rewriteTopLevel` (`components/shaderTexture/actions.ts`).
- **UI.**
  - `components/shaderTexture/ShaderTextureCardBody.tsx` holds the card body and the inside panel. Both register the node id with `passThumbRegistry`, and only one is mounted at a time.
  - NodeComponent mounts the body and lets a double-click enter.
  - NodeGraph hides the group terminals inside, shows the panel, names the breadcrumb and adds the context-menu items. The panel holds the Preview shows switch.
  - **Framing** (`components/NodeGraph/scopeView.ts`). A layout effect on `activeGroupPath` saves the outer view, frames the new scope's cards with `frameNodes`, and frames again a frame later with measured sizes unless something else moved the view. Leaving restores the saved view. A pending focus request (revealNode) takes priority. Before, nothing moved the view on entry, so the inside appeared wherever the outer view happened to be.
  - **Minimap.** It was drawn from the top-level `nodes` while inside, so it showed the outer graph. It now gets the open scope's nodes and draws measured card sizes, redrawing when they change.
  - TextureCardBody has the Create a new texture button.

## Tests

`src/compiler/__tests__/shaderTexture.test.ts`:

- **Compile:**
  - every starter;
  - drawn when unwired;
  - Match the picture and Every frame;
  - overrides;
  - two copies;
  - inside a plain group;
  - an Output left inside.
- **Food and starts:**
  - a slime's Food and Trail Add;
  - Emit Picture;
  - Grid Rules' start image.
- **Render target and Update:**
  - fixed size and key;
  - `ppKeeps`;
  - `uniformsRead`;
  - On change, Once and Every frame on a recording renderer;
  - the clock ignored without a Time node;
  - the page host drawing Once a single time.
- **Save, load and undo:** the store saves and loads, and undo works.
- **Inside:** `insideShaderTexture` (top level, inside a plain group, not inside other groups); entering shows the texture and leaving shows the output; Where it's used shows the output, follows edits inside and is kept for the session; the eye still wins.

`src/components/NodeGraph/__tests__/scopeView.test.tsx`: `frameNodes` (centring, zoom cap, measured sizes, inset); `scopeChange`; NodeGraph framing a Shader Texture's and a plain group's inside on entry, restoring the outer view on exitGroup, exitToDepth and exitToRoot, and the minimap getting the open scope's nodes.
- **Edits:** starters, from a Texture node, from a selection and a plain group, and the refusal message.

## Not done yet

- **Inputs into a Shader Texture.** Wiring a value or texture from outside isn't possible yet; ports like a group's would be next.
- **On change on exported pages** draws every frame.
- **Nested Shader Textures.** One inside another's inside compiles, but a Pass inside a plain group inside a Shader Texture isn't opened.
- **Copies share inner ids.** A pasted copy's inside keeps the same inner ids, and the compile prefixes them. A slider inside the second copy then recompiles instead of moving a uniform live.
- **Turn into a Shader Texture** works on the top level only.
- **Aspect.** The texture is square (unless Match the picture), so Color stretches it over a wide picture. The main preview inside stretches it the same way.
