# Code Explorer

The Code Explorer shows how GLSL code uses a function. It searches the examples, your saved graphs, your presets and shaders, and more. Type `smoothstep` and you don't get a plain list of matching lines. You get the handful of **ways** people use it, ranked by how often each appears. Each way comes with real examples you can open where they were written.

Everything runs on your computer. No AI is involved: every result is a count, a grouping or a sentence someone wrote by hand.

## Where to find it

- **GLSL page**: the **Code Explorer** button (the `</>` icon, next to Discover functions) opens it as a column beside the editor.
- **Files**: the home page has an **Explore code** card. Type a function or a few words, or pick one of the suggestions.
- **Expression Block and Custom Function editors**: put the caret on a function name and press **How is this used?** in the header.
- **The Functions panel** in those editors: right-click any function.

## What you can ask

**A function name**, such as `smoothstep`, `mix` or `fract`. You get:

- **A header**, for example *55 calls in 30 places · written*.
- **Pattern cards**, the ways the function is used, most common first. Each card shows:
  - a name from the pattern library when the shape is a known idiom (*Soft circle*, *Sine hash*), otherwise the shape itself, and a plain-words sentence about a real example of it (*"A soft-edged circle of radius 0.22."*), both from the Expression explainer (docs/expression-explainer.md)
  - the pattern's shape, where `#` is a number, `_` is a name and `…` is the inside of another call: `smoothstep(#, #, length(…))`
  - how many times it appears, and a small bar chart of where (which example folder, saved graphs, presets…)
  - the usual values of its number arguments (*arg 1: median 0.22 (0.1 → 0.7)*) and how often it is flipped with `1.0 − …`
  - **variants**: the exact shapes behind the card (`length(_a - _b)` versus `length(_a - vec2(#, #))`). A **merged** shape covers several close variants, with `?` where they differ.
  - **instances**: the real lines, coloured like the editor with the call highlighted. Each line says where it lives (example, node, line) and has an **Open** button.
- **Inside** (folded at first): the calls it usually sits inside, such as `mix › smoothstep`, and the kinds of statement it appears in (`float x =`, `return`…).
- **Flow**: what feeds it and where its result goes, for example `length → smoothstep → mix`.
- **Used alongside**: the functions called in the same statement (click one to show only the uses that have both) and in the same node or function. The *lift* number says how much more often two functions appear together than they would by chance.

**Plain words**, such as `soft circle edge`, `random`, `repeat tile` or `brightness`. A built-in list of synonyms links everyday words to code: *soft* finds `smoothstep`, *circle* finds `length`, *random* finds hashes. You get the patterns that match best. Click one to see that function with the pattern opened.

The **Everything / Mine / Examples** switch limits where it looks.

## Open (jump to source)

**Open** on an instance takes you to the line where it is written:

- **Example or saved graph**: the graph opens in the Studio. If the graph open now has unsaved changes, you're asked first. Then the node is selected, its editor opens and the line is selected and briefly highlighted. Input expressions open the input's expression editor.
- **Node inside a group**: the Studio enters the group first, up to two levels deep. Deeper nodes, and nodes in sealed groups, show the outermost group instead.
- **Saved shader**: opens on the GLSL page with the line selected.
- **Linked `.glsl` file**: opens on the GLSL page as unsaved text, with the line selected.
- **Convert example**: opens on the Convert page.
- **Presentation**: opens on the Present page.
- **Preset**: opens the Files page.
- **Function Builder function**: opens the Function Builder.

## What it reads (phase 1: written code)

| Source | What counts |
|---|---|
| Examples and saved graphs | Expression Block lines and results, Custom Function bodies and helper functions, input expressions, in groups at any depth |
| The open graph | The same, as you edit it, whether or not it's saved |
| Presets | Custom Function, Expression and group presets, and Function Builder functions |
| GLSL page | Saved shaders |
| Convert page | Its example shaders and the shader you are converting |
| Linked folders | `.glsl`, `.frag`, `.vert` and similar files, up to 256 KB each and 400 per folder |
| Present | GLSL you typed into code blocks |

Code the compiler generates from nodes isn't searched yet. That comes in phase 2.

## Where else is this used?

The Expression explainer's **Where else is this used?** dialog also asks the Code Explorer's index, so it lists matches in your saved graphs, presets, shaders, linked files and presentations, each with **Open**.

## Keeping it current

The index lives in this browser, in IndexedDB. It is built in the background, off the main thread, so the app stays responsive. The examples come with a ready-made index, so the Explorer is ready as soon as it opens.

Only things that changed are indexed again. That happens when you save a graph, a preset or a shader, when you import or convert something, and a moment after you edit the open graph.

**Rebuild**, at the top of the Explorer, deletes the stored index and builds it again from scratch. The index is not part of a profile export, because it can always be rebuilt from your content.
