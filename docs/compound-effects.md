# Built-in compound effects

Ready-made groups from the "Textures That Remember" guide (section 10), in the node palette's
**Presets** tab under **Built-in effects**. Click to see what one does, double-click or drag to place it.
Each is a plain group: open it (double-click) to see the nodes, with notes on each. Its sliders are on
the group card; ⌘-click one to hide it.

| Effect | In → out | What's inside |
|---|---|---|
| Long exposure | colour → colour | A running average in a Pass: `mix(last average, now, 1 / Frames)`. Moving things streak; it never brightens past the true colour. |
| Trails where it moves | colour → colour | Change (texture) finds motion; only moving parts are fed to a Feedback (texture) as Fresh. |
| Datamosh | colour → colour | Change gives Motion and Direction; Feedback drags last frame along Direction (× Push) and lays the new picture only where nothing moved. |
| Kaleidoscope feedback | colour → colour | Feedback reads through a polar fold (Segments wedges), a little zoomed and turned, so symmetry compounds. |
| Ripples (waves) | → colour | The wave equation on a Data Texture (height now, height a frame ago; full float): Read neighbours gives the Laplacian and Gradient; drops shaped up-in-the-middle, down-round-it (no water added, so no raised patch is left inside the rings); lit from the slope only. Speed under 0.5 stays stable. |

Every effect counts its Passes toward the 8-Pass limit (one or two each) and is cleared by ↺.

Code: `src/store/compoundEffects.ts` (the subgraphs), placed with the store's `placeSubgraphAsGroup`, so
each placement gets fresh ids. Tests: `src/store/__tests__/compoundEffects.test.ts` places each one,
wires it and compiles the graph.

## Not built yet (from the guide)

Smoke (velocity carrying dye), pixel sorting, falling sand and Data Texture particles: they need more
than a fixed group (a Pass with Repeat and parity, or per-particle drawing) and are left for later.
