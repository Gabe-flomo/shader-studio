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
- On the Layers page: a layer property that is already a control has **Open its details** in its right-click menu (the + menu on touch), and an open button beside its check on desktop. A property that isn't a control offers nothing new.
- In the Rules page's Graph view (`docs/graph-view.md`): a click on a source, a rule or a control.

**Keep open:** the open button in the window's header turns it into a floating panel (`detail/FloatingPanel.tsx`): no scrim and no Esc, so the page behind stays usable (drag sliders, Map, drop a source's grip on a control). It starts at the bottom right and its header drags it anywhere. Back, Forward and the links work as in the window; opening another detail shows it in the panel. Its X closes it, and the next detail opens as a window again (`detailStore.ts` `pinned`, reset on close). Not on phones, where a detail fills the screen.

What each section lists is worked out in `src/play/detailModel.ts`, which is pure and tested.
