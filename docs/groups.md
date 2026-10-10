# Groups

Group-like nodes are cards whose work happens inside a subgraph you open with a double-click: **Group**, **Scene Group**, **Space Warp Group**, **March Loop / GI Lit March Group** and **Agents**. See also `docs/iterated-groups.md`, `docs/agents-group.md` and `docs/gi-lit-march-group.md`.

## Group sockets

Every group shows and edits its sockets the same way. The model is `src/nodes/groupPorts.ts` and the look is `src/components/NodeGraph/GroupPorts.tsx`.

- **Built in:** the group type always has it, for example a March Loop's Ray Origin and Color, a Scene Group's Scene, or an Agents group's Emit. It shows a small **lock** before its name, in the muted text colour. It can't be renamed or removed.
- **Added:** it was added by you, for example a Group's own inputs and outputs, an input added to a March Loop from outside, or an Agents group's Trail. Its name is in the main text colour, followed by its type in words (number, x, y, colour / xyz, image, 3D scene).
  - **Rename:** double-click the name.
  - **Remove:** click **×**, which sits on the side away from the socket.
- **Adding:** a full-width **+ Add an input** or **+ Add an output** button sits at the bottom of the list. It opens a name field, a type choice, and Cancel / Add.

Where each group adds its sockets, from inside the group:

| Group | Inputs | Outputs |
|---|---|---|
| Group | the **Group inputs** card: Number, x, y, Colour, 4, Image | the **Group output** card: Number, x, y, Colour, 4 |
| March Loop / GI Lit March | **Group Inputs**: Number, x, y, Colour, 4, Image | built in; **Outputs on the card** shows or hides each one |
| Agents | **Agent Inputs**: Number, x, y, Colour, 4, Image, Scene | built in |
| Scene Group / Space Warp | none (Scene Pos is the input) | built in (Scene) |

An added input's key is made from its name so it is a valid GLSL name: `My speed` becomes `My_speed`, and the key never repeats one the group already has (`portKeyFor`). The label keeps what you typed.

Anchored inner nodes (Scene Pos, Scene Output, Group Inputs / Output, Agent Inputs / Output) show the same lock in their header and can't be deleted.

## Nodes that belong inside a 3D render

Some nodes only work inside a 3D group, so they are offered only there (`src/nodes/addScope.ts`). This applies to the node browser, the search palette (Space), the Do bar's node picks and the Do language's `create` completions.

| Node | Offered |
|---|---|
| Scene Pos | inside a Scene Group or a Space Warp Group |
| Scene Output | inside a Scene Group that doesn't have one yet |
| Scene Distance | inside a March Loop / GI Lit March Group |

Graphs that already have these nodes somewhere else still load and compile as before. Only what is offered changes.

## A 3D shape on its own

A 3D shape, transform, boolean op or 3D fractal added on the top level gets its own scene, as **one undo step**: a March Camera, then a Scene Group with the shape inside, wired from Scene Pos to Scene Output, then a March Loop whose Color goes to the Output. The Scene Group lands where the node was dropped. When the graph already draws a scene, the shape joins that Scene Group instead. Inside a Scene Group a shape is added as usual.

The rules live in `src/nodes/smart3d.ts` and `src/nodes/scene3dShapes.ts`. Time Cube View, Time Slice and Frame Stack bring their own setup (`src/lib/timeCube/autoWire.ts`) and are never wrapped.
