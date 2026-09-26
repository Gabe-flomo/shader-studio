# More than one output

A Custom Function and an Expression Block can output more than their result,
so a card can hand out a colour *and* a depth, a warped position *and* its
distance, without a second card recomputing the same thing.

## Custom Function: extra outputs

In the editor, under **Also outputs**, add a name and a type. It works like a
GLSL `out` parameter: the body assigns it by name (`depth = d * 2.0;`,
`n = vec3(uv, d);`), each one is an output socket on the card, and it starts
at zero in case the body never assigns it. The return value is still the
`Result` socket.

```glsl
float d = length(uv);
depth = d * 2.0;      // an extra output
n = vec3(uv, d);      // another
return d;             // Result
```

## Expression Block: exposed variables

Under **Also outputs**, every input and every typed line variable
(`float d = …`, `vec2 q = …`) is offered as a chip; click one to expose it.
The socket carries the variable as it is *after* all the lines ran, so an
input that lines modified (`p *= 2.0`) comes out modified, and the type is
the input's or the line's.

## How it compiles

Both are ordinary output keys on the node (`node.outputs`), so wires, the
wire colours, the socket tooltips and the compiler treat them like any other
output. The definitions declare one variable per extra output before the
card's block and copy into it (`float b_d; { … b_d = d; }`), and return it in
`outputVars`, which is how downstream cards read it. Changing the outputs
rebuilds the sockets in one undo step and drops any wire into an output that
went away.

## Where this leads

- The converter keeps a GLSL function with `out` parameters as a Custom
  Function today by packing the values; it can now emit the extra outputs
  directly, one socket per out parameter.
- The Publish Node flow can offer the extra outputs as the published node's
  outputs.
