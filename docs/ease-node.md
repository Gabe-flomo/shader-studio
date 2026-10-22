# Ease

Moves a value from **From** to **To** along a named easing curve: the ones motion designers know (Sine, Cubic, Back, Elastic, Bounce…). "Slide in with ease-out back" is one node. Source: `src/nodes/definitions/ease.ts`. In the library under **Animation**, next to LFO. (The **Shaper** node, under Shapers, has Golan Levin's mathematical curves; Ease has the named motion ones.)

## Two ways to drive it

- **Leave Value unwired** and it plays by itself from **Time** (the global clock unless you wire one), as **Loop**, **Duration** and **Hold** say.
- **Wire a 0 to 1 progress into Value** (a slider, a Remap of X, an LFO, another Ease's Progress) and it just bends that. Loop, Duration and Hold are then unused. Values outside 0 to 1 are held at 0 or 1.

## Settings

- **Curve**: which easing curve (below).
- **Direction**: where the curve acts. **In**: at the start (slow away, fast arrival). **Out**: at the end (fast away, slow arrival; the usual one for things arriving). **In-Out**: slow at both ends. **Out-In**: fast at both ends, slow in the middle.
- **Loop** (Value unwired): **Once** waits Hold seconds, moves, then stays at the end. **Repeat** moves, holds at the end, jumps back, holds at the start, and again. **Ping-pong** goes there, holds, and plays the move backwards to come back, holds, and again.
- **Duration**: seconds one move takes.
- **Hold**: seconds it waits at each end before moving again, so a loop pauses between moves. With Once, the wait before it starts.
- **Amount** (Back and Elastic only): Back, how far it overshoots (1 is the usual, about 10%; 0 is none). Elastic, how many wobbles (1 is the usual).
- **Steps** (Steps only): how many equal jumps.
- **From** and **To**: the output range, 0 and 1 by default. Type any numbers: a position, a radius, an angle in radians.

To start later (one dot after another, a menu item after its panel), wire **Time** from a Subtract: Time less the delay.

## The curves

- **Linear**: constant speed, no easing; mechanical.
- **Sine**: the gentlest ease; soft and natural.
- **Quad**: a light ease (x²); the everyday choice.
- **Cubic**: firmer (x³); clearly slow at the ends.
- **Quart**: strong (x⁴); a long slow start or finish.
- **Quint**: stronger still (x⁵); almost still, then quick.
- **Expo**: the most extreme; hardly moves, then rushes.
- **Circ**: a quarter circle; a sudden, sharp change of pace.
- **Back (overshoot)**: pulls back before leaving (In) or goes past the end and settles (Out).
- **Elastic**: springs about the end like a plucked ruler.
- **Bounce**: bounces against the end like a dropped ball (Out).
- **Steps**: a staircase; jumps in equal steps with nothing between.

The formulas are Robert Penner's easing equations as easings.net writes them. Each curve is written once in its In form, and Out, In-Out and Out-In are made from it, so In and Out match easings.net exactly; In-Out matches too, except Back and Elastic, whose In-Out easings.net tunes a little differently.

## Outputs

- **Value**: From…To, eased. Back and Elastic go a little past To (or From).
- **Progress**: the 0 to 1 progress before easing, a straight line. Handy to drive a colour or a second node in step.
- **Speed**: how fast Value is changing: per second when it plays by itself (negative on the way back of a Ping-pong, 0 while holding), per unit of progress when Value is wired. Use it for motion blur, squash and stretch, or a glow while moving.

## How it compiles

Curve, Direction and Loop are picked when the shader is built: each Curve × Direction becomes one small GLSL function (`ssEase_bounce_out` and so on), so changing them rebuilds the shader. Duration, Hold, Amount, Steps, From and To are live sliders (uniforms): moving them, mapping them in Play or wiring them never rebuilds. Speed is measured by a small step either side (a central difference).

## Examples (Ease & Motion folder)

- **Ease: a bouncing ball**: Bounce Out on the ball's height, Repeat with a Hold; Speed brightens it while it moves.
- **Ease: a menu sliding in**: Back Out on a panel's X, Ping-pong with a Hold; a second Ease on a later Time brings the items in after it.
- **Ease: an elastic logo pop**: Elastic Out on a star's size, with an Expo Out ring.
- **Ease: a wave of dots**: one Ease in every grid cell, each cell's Time a little later along the diagonal, so the move rolls across as a wave.
- **Ease: the curves side by side**: six curves on one chart, Value wired from the X position.
- **Ease: a ping-pong pan**: Sine In-Out, Ping-pong, sliding a pattern back and forth like a camera on a slider.
