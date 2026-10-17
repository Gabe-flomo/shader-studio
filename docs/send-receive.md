# Send and Receive

Wireless links, like TouchDesigner's Select / Null or Houdini's Object Merge. A **Send** shares its Value
under a **Name**; a **Receive** anywhere in the graph picks that Send and gives back the same Value: at the top
level, inside a group, inside a group inside a group, or inside an Agents group. No wire crosses a group's edge
and no group port has to be made.

Example: Examples › Send & Receive › "a beat and a picture, into two groups" (`src/store/sendReceiveExamples.ts`).

## The nodes (`src/nodes/definitions/sendReceive.ts`)

- **Send** (Utility): input Value, output Value (the same, so it can sit in the middle of a chain), setting Name.
  It carries a float, vec2, vec3, vec4, mat2, mat3 or a texture, and takes the type of the wire into it.
- **Receive** (Utility): output Value, typed as its Send. The card has a picker listing every Send in the graph
  (inside groups too) as `name · type · where`. It stores the Send's node **id** (`params.sendId`), so renaming
  a Send just works; `params.name` remembers the Send's name, for the message when that Send is deleted.
- With no Send picked, or the Send deleted, the Value is 0 (black for a texture) and the card says so.
  That is not a compile error.

Types are kept in step by `syncSendReceiveTypes` (`src/compiler/sendReceive.ts`), run at the start of every
store compile next to `syncAgentSpaces`: a Send's sockets take the type of the wire into it, a Receive's output
its Send's type. A chain (a Receive feeding another Send) settles in a few rounds.

Field sockets are not carried: a Send's Value is one value per pixel, not a function of position.

## How it compiles (`src/compiler/sendReceive.ts`)

`compileGraph` first calls `resolveSendReceive`, which turns each Receive into a real wire to its Send, on a
copy of the graph:

1. The Receive gets a hidden input `__via` (never stored).
2. If the Send and Receive are in different scopes, the value is routed through ports added for this compile:
   - **up** out of each group the Send is in, below the scope both share: an output port `sr_<sendId>` wired
     to the Send's Value (or the port of the group below it);
   - **down** into each group the Receive is in: an input port `sr_<sendId>` fed from the level above and
     read inside through the group-port sentinel. An Agents group's port is added to its Agent Inputs node's
     added inputs, which is how the Agents compile brings outer values into the walkers' update program.
3. Several Receives of one Send share the ports.

After that the graph is ordinary: the group compiler, Pass cutting (including a Pass inside a group), Agents
programs, ordering, dead-code removal and the type checks all see wires and ports they already handle. A
Receive compiles to `T receive_x = send_y;` (a texture is passed on as the sampler's name, with no code, so
a texture Send/Receive produces exactly the shader the wire would).

The store resolves the graph before building a preview graph too, so the eye on a node inside a group still
reaches a Send outside it.

### Groups, loops, Passes

| Case | Behaviour |
| --- | --- |
| Receive inside a plain group (any depth, iterated or not) | Through input ports. The value is the same every iteration. |
| Send inside a plain group, read outside | Through output ports. Out of an **iterated** group the value is the one after the last iteration (what an output port of that group gives). |
| Receive inside an Agents group | Through the Agent Inputs node's added inputs, into the update program. |
| Send inside an Agents group, read outside | Refused, with a message: an Agents group's inside runs per walker. |
| Any other kind of group (3D scene groups, march loops, Shader Texture, …) | Refused, naming the group: those compile into functions or programs of their own. Wire through a group input instead. |
| A Receive feeding a Pass, or a Pass inside a group | Works: the Pass's program gathers what its input needs, Send included. |
| Texture Sends (a Pass's Texture, a Texture input) | Carried as the sampler name; Sample (texture) and the texture tools read it as from a wire. |

### Loops

A link that would make a loop is refused with a named error, like a wire that would close one:

> Send "beat" and its Receive make a loop: Receive → Sin → Send → Receive. A node can’t use its own result
> in the same frame: the Receive must not feed (through any wires or groups) the Send it reads.

This includes a group that sends a value and also, through a Receive at the level above, takes it back in
(`G → Receive → G`): a group compiles as one piece, so it can't feed itself.

## UI (`src/components/NodeGraph/SendReceiveCardBody.tsx`)

- Send card: a chip **→ N receivers**; each click jumps to the next Receive (opening its group). A warning when
  another Send has the same Name, and when it has none.
- Receive card: the Send picker, a chip **← from Send “beat”** that jumps to the Send, or the missing-Send message.
- While dragging a wire, a Send's input lights up for anything it can carry.

Copying a Receive keeps reading the original Send; copying a Send and its Receives together leaves the copied
Receives reading the original Send (pick the copy in their list).

## Tests

`src/compiler/__tests__/sendReceive.test.ts`: same picture as a wire (CPU-run shader), into an iterated group,
out of a group and group-to-nested-group, after-the-loop value, Agents group, type following, missing Send,
loop refusal (three shapes), refused group kinds, rename, texture (identical shader to the wire), Pass
programs, JSON round trip, the example.
