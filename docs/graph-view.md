# Graph view (implementation guide, phase 6)

The Rules page has a **Board / Graph** toggle in its header. **Graph** draws the whole setup, left to right, in the page's full panel (`src/components/play/rules/PlayGraphView.tsx`). It is read-only: everything in it is worked out from the record, and nothing new is stored. The toggle shows only when the page is wide; on phones and narrow panels the Rules page is the board alone. Starting a Quick rule (+ Rule, Rule from this) goes back to the board.

| Column | Shows |
| --- | --- |
| Sources | The record's sources and the old mappings (read as sources, `rtSourcesOf`). A source that reads a control is drawn as wires from that control instead. |
| Rules | Every rule, with its structure badge (starts a chain, branches, merges, in a loop…). A rule fed by another rule sits a column to its right, so a chain reads left to right. |
| Controls | One card per layer (its `layer:<id>::…` and `act:<id>::…` controls), then the shader graph, Finish and other controls. Controls nothing touches are faint. |
| Layers acted on | Each layer a rule's reactions act on. |

Wires:
- **Value** (solid, accent): a route from a source to a control, or a control to a control through a control source. Labelled **Set** or **Add**, and the route's delay when it has one.
- **Signal** (dashed, purple): a rule's inputs (another rule, labelled *starts* / *stops* and its delay; a source `src:`; a control `ctl:` or the layer number a control stands for), a rule sending a signal (*sends*), a source that hears a rule, and a rule's reactions on a layer (labelled with the verbs).
- **Loop** (amber, thicker): the wires between the rules of one loop, found as the Rules page finds them (`signalStructure`).

Using it:
- Click a source, rule or control to open its detail window (`docs/detail-windows.md`); click a layer, or a layer card's heading, to show the layer on the Layers page.
- Hover a box to bring its own wires forward.
- Drag to pan; the wheel or a pinch zooms about the pointer; **Fit** shows it all (it also fits when it opens and when the drawing changes size).

How it is built (both pure and tested in `src/play/__tests__/playGraph.test.ts`):
- `src/play/playGraph.ts`: the record → nodes, groups and edges, with logical columns.
- `src/play/playGraphLayout.ts`: positions. Layered columns, each a stack of groups; a few barycentre sweeps order each column (and the rows in a control card) by what feeds it, to cut crossings; ties keep their place, so the same setup always lays out the same way. Also the wire shapes, Fit and zoom.

Not done yet: editing from the graph (wiring by dragging), moving boxes by hand, and a minimap.
