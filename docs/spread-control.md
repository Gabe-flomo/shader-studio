# Spread: sliders offset together

*Written 28 Sep 2026.*

A **Spread** is a group of sliders on the Controls page that move together by
proportional amounts. Put sliders in it in an order; the Spread's **Amount**
then offsets each member by *Amount × curve(its place) × its range*, so the
first slider might get nothing and the last the whole amount, or the reverse,
or any curve between. It is one knob for a whole rack of parameters — sizes of
five layers fanning out, a row of delays lengthening, a chord of pitches.

## Making one

Right-click a slider → **Spread → New Spread with this**, or **Add to
<Spread>** for one that exists. A slider is in one Spread at most; a Spread
takes up to 64. The Spread's card sits at the top of the Controls page
(`SpreadsSection.tsx`); its **Amount** and **Shift** are ordinary controls on
the board ("Spread 1 · Amount"), so they map, learn, increment, quick-link and
record like any slider.

## The card

| Setting | What it does |
| --- | --- |
| Order | The members, first to last; ↑/↓ move one, × takes it out (the slider stays). Each row shows its share of Amount as a bar, its own value and the value now. |
| Curve | How much of Amount each place gets: linear, ease in / out / in–out, exponential, sine, or custom (a handful of points across the order). **Invert** turns it round. |
| Amount | −1 … 1: at the curve's top, this much of the member's range is added (negative subtracts). |
| Shift | Rotates the order: 1 makes the second member the first. Fractions glide between places, so animating Shift walks the offset around the group. |
| Mode | **Offset**: members keep their own values and the curve rides on top. **Reset**: the same, plus a **Reset** that puts every member back to its slider's minimum (whatever the minimum is set to now) so the curve lays the offsets from there; a signal name in *Reset on* does it when that signal fires. |

Members stay adjustable: move a member's own slider and the offset rides on
the new value. A mapping on a member still drives it; the order is

    source → member's own value → + Amount × curve(place) × range → clamped to the member's range

(`lib/playEngine.ts` `tickSpreads`, last in the frame). Takes record Amount
and Shift, and website exports play Spreads with the same maths
(`play/kit/spread.js`, in `SSKit.spread`).

## Where things live

`types/play.ts` (`PlaySpread`, `spreadTarget`), `play/spreads.ts` (edits, one
undo step each), `play/spreadReset.ts` (Reset), `play/kit/spread.js` (the
maths), `components/play/SpreadsSection.tsx` (the card). Tests:
`play/__tests__/spread.test.ts`.
