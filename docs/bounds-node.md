# Bounds

Keeps a number or a position inside a range (or a box). Source: `src/nodes/definitions/bounds.ts`. In the library under **Math → Interp**, next to Clamp.

## Behaviour

What happens when the Value goes past an edge:

- **Clip**: it stops at the edge (Clamp).
- **Wrap**: it leaves one side and comes back in on the other, like Pac-Man.
- **Bounce**: it goes back and forth between the edges, like a ball between walls (ping-pong). However far the input has gone, the output is always inside.
- **Soft**: it slows down as it nears the edge and never quite reaches it. **Softness** is how much of the range is spent slowing down (0 is a hard stop, 1 starts easing from the middle).

## Settings

- The **type pills** (f, v2, v3) make it a number, a 2D position or a 3D position. A wire of another type sets them for you.
- **Min** and **Max**: one pair for a number; for a vector, a pair per axis (**Range X**, **Range Y**, **Range Z**), the sides of the box.
- Wiring **Min** or **Max** sets that edge for every axis at once (a moving box, a box from another node).

## Outputs

- **Value**: the input, kept inside.
- **Inside**: 1 when the input was inside on every axis, 0 when it was out. With Soft it fades past the edge.
- **Direction**: with Bounce, +1 per axis while the output moves the same way as the input and −1 on the way back. Multiply a velocity, a heading or a colour by it to flip it at each wall. 1 for the other behaviours.

## What it is for

Things that drift away: copies in a Repeat or Grid moved by noise or a steady drift, a counter, Time. Put Bounds after the position and they stay in their box.

Agents have the same choice built in: **Move**'s Edges (Wrap, Bounce, Slide) keeps walkers on the picture. Bounds is the same idea for anything else.

## Example

**Grid · Bounds: copies bouncing in their boxes** (Grid folder): each cell's ball drifts its own way for ever; Bounds (Bounce) keeps it in its box, Direction changes its shade at each bounce, and the wall lights up where the ball meets it.
