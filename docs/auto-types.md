# Auto types: math nodes take the type wired into them

Asked 22 October 2026. Code: `src/nodes/autoType.ts` (pure), wired into the store's `connectNodes`,
`disconnectInput`, `disconnectOutput`, `changeNodeVectorType` and `setNodeTypeAuto`. Tests:
`src/nodes/__tests__/autoType.test.ts`.

## What it does

Per-channel math nodes are **Auto** by default. These are Add, Subtract, Multiply, Divide, Mix, Sin,
Cos, Exp, Log, Pow, Negate, Floor, Ceil, Round, Fract, Sqrt, Sign, Abs, Tanh, Mod, Min, Max, Step,
Smoothstep and Clamp. Wire a colour and a float into Multiply and you get a colour, with no type to
pick and no special node.

- **The widest wins.** The node takes the widest type wired into its main sockets (float < vec2 <
  vec3 < vec4). Every narrower wire is promoted by the graph's one wire rule
  (`lib/typesCompatible.ts`). A float spreads into every channel, which is GLSL's `colour * 0.5`.
  vec2 → vec3 adds 0, and vec3 → vec4 adds alpha 1.
- **Main sockets only.** These are the operands (A and B, or Input). The other settings keep their own
  type: Mix's T, Sin's Freq and Amp, Pow's exponent, Clamp's Min/Max, Smoothstep's edges and Step's edge
  stay floats. GLSL takes a float there for any vector.
- **Taking a wire off** narrows the node to the widest type still wired in. With nothing left wired in,
  it keeps the type it has.
- **Downstream follows.** An Auto node fed by one that changed works its type out again, and so on
  down the chain.
- **When it can't fit**, the wire is refused with a note saying why. For example, a vec2 and a vec4 in
  the same Add (GLSL can't mix them), or a Multiply that would turn into a vec2 while it feeds Sin's
  Freq (always a float). Nothing changes when a wire is refused. When a wire is taken off and the
  narrower type wouldn't fit downstream, the types stay as they were.

## The card

The type row reads **auto · f · v2 · v3 · v4**.

- On Auto, the **auto** pill is lit and the type in use has a dashed outline.
- **Picking a type locks it** (`params.typeLocked`): the node keeps that type whatever is wired in, as
  before. Wires that can still become the new type stay on: a float spreads, vec3 → vec2 truncates.
  Only those that can't come off.
- Clicking **auto** unlocks the node and works its type out from its wires again.
- While a wire is being dragged, the main sockets of an Auto node light up for any number or vector.

## What keeps its type

- **Length, Dot and Normalize** need a vector of a set size, and **Constant** and **Bounds** are
  defined by their own values. They keep their pills only (`FIXED_VECTOR_NODES`).
- **Existing graphs are unchanged.** Inference runs only when a wire is made or taken off, never on
  load or on compile, so a saved graph renders exactly as it was. A node in an older graph is Auto
  (it has no lock) from its next wire change.
- Dropping a node onto a wire already took the wire's type (`nodeDrop.insertIntoWire`). It still does,
  and the node stays Auto.

## The pickers

Smart connect, the mobile connect lists (Connect existing, the wiring rows' candidates, a new node
placed for a socket) and the mobile new-node pairings all use `inputTakes()`. They offer an Auto
node's main sockets to any number or vector, as a drag would. A plain-rule fit still ranks first.
Search's Related group already did this through `genTypeFor` (`wireFit.ts`).
