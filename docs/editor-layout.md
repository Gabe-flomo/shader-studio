# Big editors — the split-panel layout

*Written 28 Sep 2026, after a UX pass over the layers with lots of settings
(drum pads, particles, relationship, video, Finish → Grade).*

Some layer and Finish editors have more settings than fit comfortably in
the sidebar's narrow card. Those get the **full editor**: it only shows in
the split view's big Layers panel (`ctx.big`, `src/components/play/PlaySplitArea.tsx`)
or, on phones, in a full-screen sheet. The sidebar keeps a small summary
card instead (see `DrumPadEditor`'s `DrumPadSummary` for the pattern).

## The scaffold

`BigEditorScaffold` (`src/components/play/layers/BigEditorScaffold.tsx`)
wraps a full editor's `Section` cards. It is layout only — it does not
change how a `Section` folds or stores its state (`Section.tsx` /
`playUi.ts` still own that), it just gives the panel:

- **Collapsed by default.** Every `Section` folds on mount except the one
  marked `primary` (Relationship's Members, Particles' Birth and death,
  Video's Video, Finish → Grade's Basic…) — pick the section you almost
  always open first. A folded `Section` can take a `summary` (a one-line
  glance at what's set: `"Walls: bounce · wrap"`), so folding doesn't hide
  that anything is there. Fold state is remembered per `<kind>:<title>`
  (`playUi.ts`'s `folded`), same as before.
- **Expand all / Collapse all.** Pass `kind` to `BigEditorScaffold` (the
  same string every one of its `Section`s uses) and its strip (or, with
  fewer than 4 sections, a small row above the content) gets the two
  buttons, driven by `playUi.ts`'s `expandAllSections` / `collapseAllSections`.
  A `Section` registers itself under its `kind` on mount so these know
  every title to flip, without either file importing the other.

- A **jump strip**, sticky under the panel's header, once the editor has
  **4 or more sections**. Below that a strip is just more chrome above two
  or three cards, so it doesn't render — `sections.length >= 4` is the
  whole rule. The strip tracks scrolling and highlights whichever section
  is nearest the top.
- The same layout on a phone sheet: one column, no special-casing needed,
  because the scaffold doesn't touch width — a `Section`'s own content
  still decides that.

To use it, give each `Section` a matching `id` (an anchor the strip
scrolls to) and list them in the order they appear:

```tsx
return (
  <BigEditorScaffold sections={[
    { id: 'particles-motion', label: 'Motion' },
    { id: 'particles-birth', label: 'Birth and death' },
    { id: 'particles-flocking', label: 'Flocking' },
    { id: 'particles-attractor', label: 'Attractor' },
    { id: 'particles-look', label: 'Look' },
  ]}>
    <Section id="particles-motion" kind="particles" title="Motion">…</Section>
    …
  </BigEditorScaffold>
);
```

Only list sections that can actually show (skip a conditional one, like
Relationship's "Catch", when its condition is off) — the strip should
never offer a jump to nothing.

Applied so far: `DrumPadEditor` (Pads · Pad *N* · Kit — no strip, 3
sections), `ParticlesEditor` (Motion · Birth and death · Flocking ·
Attractor · Look), `RelationshipEditor` (Members · Relationship · Motion ·
Walls · Catch · Debug), `VideoEditor` (Video · Playback · Sound ·
Position · Look), and Finish's `GradeEditor` (Basic · Curves · Colour
wheels · Split toning · HSL secondary · Tone and amount).

## Two short numeric rows side by side

`TwoCol` (same file) is a thin helper for a wide panel (`usePlaySplit`'s
`wide`, from `WIDE_PANEL_PX` = 640) to lay two short numeric rows next to
each other instead of always stacking. It's a plain CSS grid when `wide`
is true and a normal block otherwise — nothing fancier. Reach for it only
where two rows are genuinely short and related (not for anything with a
slider that wants the full row's width).

## Fixing overflow as you go

A few patterns kept showing up across editors and are worth checking for
in any new one:

- **A toggle's own label overflowing the card.** `Toggle` (`src/components/ui/Choice.tsx`)
  takes a `fullWidth` prop that lets its label wrap onto more lines
  instead of running past the card; `FieldKit.toggle()`
  (`src/components/play/layers/fields.tsx`) already passes it, so any
  editor built with `f.toggle(label, key, what, hint)` gets this for
  free. Keep `what` short (a few words, like "Show forces"); put the long
  explanation in `hint` (the tooltip), not in `what` — a long `what` is
  what caused the original overflow (Shape's Invert toggle had the whole
  explanation as its switch label).
- **Long select labels.** Keep option labels short and put the fuller
  explanation in the option's `title` (a native tooltip) or the row's
  `hint`, the same as toggles.
- **A slider row's value chip pushing the ruler off the card.** Wrap the
  ruler in a `flex: 1, minWidth: 0` container (already how `FieldKit.prop()`
  lays its rows out) so the chip and any trailing button keep their own
  width and the ruler gives way, not the other way round.

## What a new big editor (the Granulator, when it lands) should do

1. Build it with `Section` and `FieldKit` like the others — don't fork
   either.
2. Once it has 4+ sections, wrap it in `BigEditorScaffold` and give each
   `Section` a matching `id`; pass `kind` too, so Expand all / Collapse all
   reaches every section. Mark exactly one `Section` `primary`.
3. Keep a short summary card for the sidebar; only mount the full editor
   when `ctx.big` (or on the phone sheet).
4. If a section has a live meter or visual (a spectrum, a waveform), give
   it a fixed height so the rows around it don't jostle as the reading
   changes.

## The sidebar list, with more than a few layers

Past ~4 layers, `LayersPanel.tsx`'s `LayerRow` shows an unselected card as
just its header (name, kind, visibility) and opens it on selection, so the
list doesn't turn into a wall of every card's settings stacked at once. A
manual fold (the row's own chevron) sticks until that layer's selected
state changes again. "Always expand cards", in the Layers tab's header,
turns this off for people who want every card open all the time. This
only applies to the plain sidebar list — the split view's list is always
header-only, with the full editor beside it.


## Tabs by default

*Added 29 Sep 2026.* Every layer editor with two or more `Section`s shows them as
**tabs**: one section at a time, a strip of tabs on top (sticky in the big
panel, a compact scrolling row in the sidebar card), the open tab remembered per
layer (`playUi.ts` `sectionTabs`, scope `layer:<id>`; an editor on its own, like
Finish → Grade, remembers per kind). A fresh layer opens on its `primary`
section. Sections register themselves with the host (`sectionTabs.ts`), so a
conditional section simply appears and disappears as a tab, and if the open one
goes, the primary shows; a section with its own switch shows a dot for on/off,
and a `summary` becomes the tab's tooltip. A tab opened once stays mounted while
hidden, so nothing held inside it is lost on a switch. `revealSection(layerId,
key)` opens a layer on a given tab (reveals from notes, controls and effects use
it). **Show all**, at the end of the strip, stacks every section instead — the
folded-by-default layout above, with Expand all / Collapse all — one global
choice (`sectionsShowAll`); **Tabs** brings the strip back. ←/→ move between
tabs when the strip has focus. Server rendering and the host's first render
show the stacked cards, so the first paint isn't empty.
