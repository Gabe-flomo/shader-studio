# Detail windows (implementation guide, phase 5)

One window (`src/components/play/detail/DetailWindow.tsx`, on the shared Modal shell) shows a control, a source or a rule. **Back** and **Forward** walk what it has shown (`detailStore.ts`); opening something new drops what was ahead. Every name in it opens that thing's page in the same window. Edits are live and undoable, as everywhere else on Play.

| Page | Shows |
| --- | --- |
| A control | Its live trace. **Show layer** (a layer number), **Show in shader graph** (a Studio parameter: reveals the node and opens the Studio), **Rule from this**. **Comes from** (each source routed onto it, and pair mappings), **Signals on this** (rules whose conditions read it), **Do** (rules acting on its layer), **Goes to** (controls it drives through a control source). |
| A source | Its live reading, its card (a mapping's row or a source card, with Learn and Map), **Goes to** (its routes' controls) and **Signals on this** (rules reading `src:`/`map:` it). |
| A rule | A badge when it is in a loop, its rule card (When, Options, Do), **Listens to** (the controls, sources and rules its inputs read) and **Listened to by** (rules, mappings and sources that take it). |

Ways to open it:
- On the Inputs board: a control's "driven by" chip, or the open button on a control's hover tools, a mapping card or a source card.
- On the Rules page: the open button on a rule card.

What each section lists is worked out in `src/play/detailModel.ts`, which is pure and tested.

Not done yet: a pop-out window, and opening from a layer's property rows and from the graph view (phase 6).
