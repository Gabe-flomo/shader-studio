/**
 * commands.ts — the Do… bar's command language as a registry (docs/do-bar-commands.md).
 *
 * The phrase language (vocabulary.ts: shapes, actions, parameters, colours, places) builds new
 * things. This adds the words that edit what is already there — connect, disconnect, insert,
 * multiply, output, switch, delete, rename, duplicate, set, make bigger, group, select — and the
 * glue that strings clauses into one sentence: connectors ("then", "and", "with", "by", "into")
 * and references ("it", "the circle", "the current output", "the node before the output").
 *
 * Everything that reads or documents the language reads it from here: the parser
 * (suggestions/doCommands.ts) takes its verb words from COMMAND_VERBS, and the in-app Commands
 * reference and docs/do-bar-commands.md are generated from `commandReference()`, so the three
 * can't drift. A test checks every verb (and every vocabulary action) has examples that parse.
 *
 * Adding a verb: put it in COMMAND_VERBS with its words, syntax and 2–3 examples, then handle
 * its id in doCommands.ts (`parseClause` and `execClause`). Adding a build action: vocabulary.ts
 * as before; add examples to ACTION_EXAMPLES here (else two plain ones are made for it).
 */
import { ACTIONS, COLOURS, NUMBER_WORDS, PARAMS, PLACES, SHAPES, TARGETS } from './vocabulary';

/** A scratch graph an example runs on ("Show me how"), built in suggestions/doScratch.ts. */
export type ScratchId = 'empty' | 'circle' | 'noise' | 'glow' | 'twoShapes' | 'twoCircles' | 'mixed' | 'pass';

export const SCRATCH_LABELS: Readonly<Record<ScratchId, string>> = {
  empty: 'an empty graph (just an Output)',
  circle: 'UV → Circle SDF → SDF Fill → Output',
  noise: 'UV → Fractal Noise → Palette → Output',
  glow: 'UV → Circle SDF → SDF Glow → Output',
  twoShapes: 'a Circle SDF and a Box SDF, the circle painted on the Output',
  twoCircles: 'two Circle SDFs, the first painted on the Output',
  mixed: 'Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask',
  pass: 'Noise → Palette drawn into a Pass, the Pass on the Output',
};

export interface CommandExample {
  text: string;
  /** The scratch graph "Show me how" runs it on. */
  on: ScratchId;
  /** Nodes selected on that graph first (ids of doScratch.ts). */
  selected?: string[];
  /** One line on what it shows. */
  note?: string;
}

export type VerbGroup = 'build' | 'wire' | 'edit' | 'look' | 'organise';

export interface CommandVerb {
  id: string;
  /** Words that start the clause. The first is the name shown. Multi-word entries are phrases. */
  words: string[];
  group: VerbGroup;
  summary: string;
  /** Syntax lines: <ref> is a reference, <node> a node or shape name, [ ] optional. */
  syntax: string[];
  slots: Array<{ name: string; what: string }>;
  examples: CommandExample[];
  /** What it leaves as "it" for the next clause. */
  result: string;
}

/**
 * The editing verbs. Order matters only for the reference page. Words shared with build actions
 * ("add", "mix", "duplicate", "colour") are told apart by what follows (doCommands.ts
 * `classify`): "add rings" builds, "add it to the noise" combines.
 */
export const COMMAND_VERBS: readonly CommandVerb[] = [
  {
    id: 'create', words: ['create', 'new', 'draw', 'make a', 'make an', 'add a', 'add an', 'place'], group: 'build',
    summary: 'Adds a shape (with its UV) or any node by name. Modifiers after it set its values; a value only a move has (falloff → Glow) adds that move.',
    syntax: ['create <node> [with <param> <value>…] [at <place>]'],
    slots: [{ name: 'node', what: 'a shape word (circle, ring, star…) or a node name (noise, palette, Length…)' }, { name: 'param value', what: 'radius 0.3, falloff 8, red…' }],
    examples: [
      { text: 'create a ring with falloff 0.3', on: 'empty', note: 'A ring and an SDF Glow with Brightness 0.3' },
      { text: 'create a noise', on: 'empty' },
      { text: 'add a star at the top left', on: 'circle' },
    ],
    result: 'the new node (or the last move it made)',
  },
  {
    id: 'connect', words: ['connect', 'wire', 'plug', 'link', 'feed', 'hook up', 'attach'], group: 'wire',
    summary: 'Wires an output into an input. Without an input name it takes the first free input that fits; the type check runs first.',
    syntax: ['connect <ref> to <ref> [<input>]', 'connect <ref> to the <input> of <ref>', 'plug <ref> into <ref>'],
    slots: [{ name: 'from', what: 'the node whose output goes' }, { name: 'to', what: 'the node that reads it' }, { name: 'input', what: 'an input by name (tint, distance, value…)' }],
    examples: [
      { text: 'connect the glow to the output', on: 'mixed' },
      { text: 'connect the noise to the tint of the glow', on: 'mixed' },
      { text: 'plug the box into the fill', on: 'twoShapes' },
    ],
    result: 'the node that reads it',
  },
  {
    id: 'disconnect', words: ['disconnect', 'unplug', 'unwire', 'unlink', 'detach', 'cut the wire from'], group: 'wire',
    summary: 'Removes wires. "Disconnect X" removes the wires out of X (from the Output only, when X is the current output); "from Y" only those into Y; "the <input> of Y" clears one input.',
    syntax: ['disconnect <ref> [from <ref>]', 'disconnect the <input> of <ref>'],
    slots: [{ name: 'ref', what: 'what to unplug' }, { name: 'from', what: 'only the wires into this node' }],
    examples: [
      { text: 'disconnect the current output', on: 'noise' },
      { text: 'disconnect the noise from the palette', on: 'noise' },
      { text: 'disconnect the position of the circle', on: 'circle' },
    ],
    result: 'the node that was unplugged',
  },
  {
    id: 'reconnect', words: ['reconnect', 'rewire', 'move the wire from', 'reroute'], group: 'wire',
    summary: 'Moves a node\'s outgoing wires: unplugs everything it feeds, then connects it to the new node.',
    syntax: ['reconnect <ref> to <ref> [<input>]'],
    slots: [{ name: 'from', what: 'the node whose wires move' }, { name: 'to', what: 'where they go' }],
    examples: [
      { text: 'reconnect the circle to the output', on: 'glow' },
      { text: 'rewire the noise to the output', on: 'noise' },
    ],
    result: 'the node that reads it',
  },
  {
    id: 'insert', words: ['insert', 'put', 'slot', 'splice'], group: 'wire',
    summary: 'Puts a new node on a wire: between two wired nodes, after a node (on every wire out of it) or before one (on its first wired input).',
    syntax: ['insert <node> between <ref> and <ref>', 'insert <node> after <ref>', 'insert <node> before <ref>'],
    slots: [{ name: 'node', what: 'the node to add (tone map, luminance, abs…)' }, { name: 'between', what: 'two wired nodes' }],
    examples: [
      { text: 'insert a tone map between the palette and the output', on: 'noise' },
      { text: 'insert an abs after the circle', on: 'circle' },
      { text: 'put a smoothstep before the palette', on: 'noise' },
    ],
    result: 'the inserted node',
  },
  {
    id: 'combine', words: ['multiply', 'times', 'add', 'subtract', 'divide', 'mix', 'blend', 'screen', 'overlay', 'union', 'merge', 'intersect', 'cut'], group: 'wire',
    summary: 'Combines two values with a new node and puts the result where the first one (the base) went. "Add A to B" and "subtract A from B" use B as the base. Numbers work too ("multiply it by 2").',
    syntax: ['multiply <ref> by <ref|number>', 'add <ref> to <ref>', 'subtract <ref> from <ref>', 'mix <ref> with <ref> [by <number>]', 'screen <ref> over <ref>', 'union <ref> with <ref>'],
    slots: [{ name: 'a', what: 'the first value (the base)' }, { name: 'b', what: 'the second value, or a number' }, { name: 'by', what: 'mix amount' }],
    examples: [
      { text: 'multiply the output with the noise', on: 'mixed', note: 'Palette × noise, on the Output' },
      { text: 'add the glow to the palette', on: 'mixed' },
      { text: 'mix the palette with the glow by 0.3', on: 'mixed' },
    ],
    result: 'the new combining node',
  },
  {
    id: 'output', words: ['output', 'show', 'display', 'send to the output', 'preview'], group: 'wire',
    summary: 'Wires a node to the Output (adding an Output on the top level when there is none).',
    syntax: ['output <ref>', 'show <ref>'],
    slots: [{ name: 'ref', what: 'what to show' }],
    examples: [
      { text: 'output the glow', on: 'mixed' },
      { text: 'show the noise', on: 'noise' },
    ],
    result: 'the node shown',
  },
  {
    id: 'replace', words: ['replace', 'switch', 'swap', 'turn', 'change'], group: 'edit',
    summary: 'Switches a node to another type in place, keeping its wires and settings (the card\'s Switch to). Refused when a wire would have nowhere to go, with the types that would work.',
    syntax: ['replace <ref> with <node>', 'switch <ref> to <node>', 'turn <ref> into <node>', 'swap <ref> for <node>'],
    slots: [{ name: 'ref', what: 'the node to switch' }, { name: 'node', what: 'the new type' }],
    examples: [
      { text: 'switch the noise to voronoi', on: 'noise' },
      { text: 'turn the circle into a box', on: 'circle' },
      { text: 'replace the palette with a stops palette', on: 'noise' },
    ],
    result: 'the switched node',
  },
  {
    id: 'delete', words: ['delete', 'remove', 'erase', 'get rid of', 'drop'], group: 'edit',
    summary: 'Removes nodes and the wires into and out of them.',
    syntax: ['delete <ref>', 'delete all <node>s'],
    slots: [{ name: 'ref', what: 'one node, several ("these", "all circles")' }],
    examples: [
      { text: 'delete the glow', on: 'mixed' },
      { text: 'remove all circles', on: 'twoShapes' },
    ],
    result: 'nothing (the next "it" is the last thing before)',
  },
  {
    id: 'rename', words: ['rename', 'call', 'name', 'label'], group: 'edit',
    summary: 'Gives a node a name of its own (its card label). Quote names with spaces.',
    syntax: ['rename <ref> to "<name>"', 'call <ref> "<name>"'],
    slots: [{ name: 'ref', what: 'the node' }, { name: 'name', what: 'the new name' }],
    examples: [
      { text: 'rename the glow to "Halo"', on: 'glow' },
      { text: 'call the noise "Clouds"', on: 'noise' },
    ],
    result: 'the renamed node',
  },
  {
    id: 'duplicate', words: ['duplicate', 'copy', 'clone'], group: 'edit',
    summary: 'Copies a node next to it, with the same settings and the same wires in (nothing reads the copy yet).',
    syntax: ['duplicate <ref>'],
    slots: [{ name: 'ref', what: 'the node to copy' }],
    examples: [
      { text: 'duplicate the circle', on: 'circle' },
      { text: 'copy the glow, then set its falloff to 3', on: 'glow' },
    ],
    result: 'the copy',
  },
  {
    id: 'set', words: ['set', 'change'], group: 'look',
    summary: 'Sets a setting to a value: a number, a colour word, a choice by name, on or off. The setting is found by its name, its label or a vocabulary word (falloff, size, speed…).',
    syntax: ['set the <ref> <param> to <value>', 'set <param> of <ref> to <value>', 'set <ref>\'s <param> to <value>', 'set the <param> to <value>'],
    slots: [{ name: 'ref', what: 'the node (else "it" or the selection)' }, { name: 'param', what: 'a setting' }, { name: 'value', what: 'number, colour, choice, on/off' }],
    examples: [
      { text: 'set the glow falloff to 8', on: 'glow' },
      { text: 'set the radius of the circle to 0.4', on: 'circle' },
      { text: 'set the glow tint to cyan', on: 'glow' },
    ],
    result: 'the node changed',
  },
  {
    id: 'adjust', words: ['make', 'increase', 'raise', 'decrease', 'lower', 'reduce', 'double', 'halve', 'triple'], group: 'look',
    summary: 'Relative changes: bigger / smaller (its size), brighter / dimmer, faster / slower, softer / sharper; "increase X by 0.1"; double, halve.',
    syntax: ['make <ref> bigger|smaller|brighter|dimmer|faster|slower|softer|sharper', 'increase <ref>\'s <param> [by <number>]', 'double the <param> of <ref>'],
    slots: [{ name: 'ref', what: 'the node' }, { name: 'how', what: 'a direction word, or a setting and an amount' }],
    examples: [
      { text: 'make the circle bigger', on: 'circle', note: 'Radius × 1.25' },
      { text: 'make the glow much wider', on: 'glow' },
      { text: 'increase the radius of the circle by 0.1', on: 'circle' },
    ],
    result: 'the node changed',
  },
  {
    id: 'group', words: ['group', 'bundle', 'wrap up'], group: 'organise',
    summary: 'Puts nodes into a group (as Group selection does). Goes last in a sentence.',
    syntax: ['group <ref> [and <ref>…] [as "<name>"]'],
    slots: [{ name: 'refs', what: 'the nodes' }, { name: 'as', what: 'the group\'s name' }],
    examples: [
      { text: 'group the circle and the glow as "Neon"', on: 'glow' },
      { text: 'group these', on: 'twoShapes', selected: ['a', 'b'] },
    ],
    result: 'the group',
  },
  {
    id: 'select', words: ['select', 'pick', 'find', 'highlight'], group: 'organise',
    summary: 'Selects nodes (no change to the graph), so the next command, or the next "this", works on them.',
    syntax: ['select <ref> [and <ref>…]', 'select all <node>s'],
    slots: [{ name: 'refs', what: 'the nodes' }],
    examples: [
      { text: 'select all circles', on: 'twoShapes' },
      { text: 'select the node before the output', on: 'noise' },
    ],
    result: 'the selection',
  },
  {
    id: 'colour', words: ['colour', 'color', 'paint', 'shade'], group: 'look',
    summary: 'Colours a value with a palette. "By <driver>" picks what runs along the palette (the length of the space, the angle, time, noise, any node) and multiplies it by the value; without "by" the value itself drives it.',
    syntax: ['colour <ref> with a palette [by <driver>]', 'colour <ref> by <driver>'],
    slots: [{ name: 'ref', what: 'the value to colour' }, { name: 'driver', what: 'the length of the space · the angle · the x / y of the space · time · noise · <ref>' }],
    examples: [
      { text: 'colour it with a palette by the length of the space', on: 'glow', selected: ['g'] },
      { text: 'colour the noise with a palette', on: 'mixed' },
      { text: 'colour the glow by time', on: 'glow' },
    ],
    result: 'the palette (or what multiplies it)',
  },
];

/** What a builder command opens or does (builders/doBuilders.ts reads and plans it, builders/open.ts runs it). */
export type BuilderCommandId =
  | 'open-scene-builder' | 'new-3d-scene' | 'edit-scene' | 'new-2d-scene' | 'new-expression'
  | 'open-grid-rules' | 'new-grid-rules' | 'edit-rules'
  | 'open-agent-rules' | 'new-agent-rules' | 'new-3d-agents' | 'new-3d-agents-shape'
  | 'show-recipe' | 'copy-recipe';

export interface BuilderCommand {
  id: BuilderCommandId;
  /** The whole phrase (the first is the name shown). "the", "a" and "please" are ignored, so "open scene builder" is "open the scene builder". */
  words: string[];
  summary: string;
  /** What it works on when it needs a node. */
  target?: string;
  examples: CommandExample[];
}

/**
 * The builder commands: whole phrases that open a builder (docs/node-browser.md, "Builders"), not
 * clauses. They are read before the rest of the language, so "show the recipe" never means
 * "output the node called recipe".
 */
export const BUILDER_COMMANDS: readonly BuilderCommand[] = [
  {
    id: 'open-scene-builder', words: ['open the scene builder', 'open the 3d scene builder', 'scene builder', '3d scene builder', 'open the builder'],
    summary: 'Opens the 3D Scene Builder on a new scene (its Templates tab). Build adds the scene to the graph.',
    examples: [{ text: 'open the scene builder', on: 'empty' }, { text: 'scene builder', on: 'empty' }],
  },
  {
    id: 'new-3d-scene', words: ['new 3d scene', 'new scene', 'make a 3d scene', 'build a 3d scene', 'create a 3d scene', 'start a 3d scene'],
    summary: 'The same: the 3D Scene Builder on a new scene.',
    examples: [{ text: 'new 3d scene', on: 'empty' }, { text: 'build a 3d scene', on: 'empty' }],
  },
  {
    id: 'new-2d-scene', words: ['new 2d scene', 'open the 2d scene builder', '2d scene builder', 'make a 2d scene', 'build a 2d scene', 'create a 2d scene', 'start a 2d scene', 'new 2d grid'],
    summary: 'Opens the 2D Scene Builder on a new scene: shapes, space, a grid with ripples, functions and a look. Build adds it to the graph.',
    examples: [{ text: 'new 2d scene', on: 'empty' }, { text: '2d scene builder', on: 'empty' }],
  },
  // 'new-expression' (the Expression Builder) is hidden for now: its code stays, the Do… bar no longer offers it.
  {
    id: 'edit-scene', words: ['edit this scene', 'edit the scene', 'edit it in the scene builder', 'edit in the scene builder', 'open this scene', 'open it in the scene builder', 'rebuild this scene'],
    summary: 'Opens the 3D Scene Builder on a scene it built (as the Scene Group\'s right-click Edit in Scene Builder does).',
    target: 'the selected node\'s built scene, else the only built scene in the graph',
    examples: [{ text: 'edit this scene', on: 'empty', note: 'With a built Scene Group (or any node of it) selected' }, { text: 'edit it in the scene builder', on: 'empty', note: 'With a built Scene Group selected' }],
  },
  {
    id: 'open-grid-rules', words: ['open grid rules', 'open the grid rules editor', 'grid rules editor', 'open the grid editor'],
    summary: 'Opens the Grid Rules editor of the selected Grid Rules node (else the only one); with none in the graph, adds one first.',
    target: 'the selected Grid Rules node, else the only one',
    examples: [{ text: 'open grid rules', on: 'empty' }, { text: 'open the grid rules editor', on: 'empty' }],
  },
  {
    id: 'new-grid-rules', words: ['new grid rules', 'add grid rules', 'new grid rules node', 'add a grid rules node', 'new cellular automaton', 'new automaton'],
    summary: 'Adds a Grid Rules node (on the Output when the graph is empty) and opens its editor.',
    examples: [{ text: 'new grid rules', on: 'empty' }, { text: 'new cellular automaton', on: 'empty' }],
  },
  {
    id: 'edit-rules', words: ['edit the rules', 'edit rules', 'edit its rules', 'edit the rule', 'open the rules', 'open its rules'],
    summary: 'Opens the rules of the selected Grid Rules node (its editor) or rules Agents group (its rules editor); else of the only one in the graph.',
    target: 'the selected Grid Rules node or rules Agents group, else the only one',
    examples: [{ text: 'edit the rules', on: 'empty', note: 'With a Grid Rules node or a rules Agents group selected' }, { text: 'edit its rules', on: 'empty', note: 'With a rules Agents group selected' }],
  },
  {
    id: 'open-agent-rules', words: ['open agent rules', 'open the agent rules editor', 'agent rules editor', 'open the agents rules'],
    summary: 'Opens the rules editor of the selected rules Agents group (else the only one); with none in the graph, adds one first.',
    target: 'the selected rules Agents group, else the only one',
    examples: [{ text: 'open agent rules', on: 'empty' }, { text: 'open the agent rules editor', on: 'empty' }],
  },
  {
    id: 'new-agent-rules', words: ['new agent rules', 'add agent rules', 'new agents with rules', 'new rules agents', 'add an agents group with rules'],
    summary: 'Adds an Agents group in rules mode (Emit → Agents → Deposit → Trail field → palette, on the Output) and opens its rules.',
    examples: [{ text: 'new agent rules', on: 'empty' }, { text: 'new agents with rules', on: 'empty' }],
  },
  {
    id: 'new-3d-agents', words: ['new 3d agents', 'new 3d agent rules', 'add 3d agents', 'make 3d agents', 'new agents in 3d', '3d agent builder', 'open the 3d agent builder', 'new 3d swarm', 'new 3d slime'],
    summary: 'Adds 3D agents (Emit in a Ball → Agents in Space 3D, rules mode → Deposit → a volume Trail, Draw agents through an orbiting camera, on the Output) and opens their rules: Space 2D / 3D, 3D templates, the camera on the Look tab.',
    examples: [{ text: 'new 3d agents', on: 'empty' }, { text: '3d agent builder', on: 'empty' }],
  },
  {
    id: 'new-3d-agents-shape', words: ['new 3d agents round a shape', 'new 3d agents around a shape', '3d agents round a shape', '3d agents around a shape', 'new 3d agents round a torus', 'agents round a torus', 'agents around a shape'],
    summary: 'Adds 3D agents round a ray-marched torus (the 3D slime with Collide (3D scene), drawn through the March Camera and hidden behind the torus, on the Output) and opens their rules; Look → Around a shape picks a Sphere or a Box.',
    examples: [{ text: 'new 3d agents round a shape', on: 'empty' }, { text: 'agents round a torus', on: 'empty' }],
  },
  {
    id: 'show-recipe', words: ['show the recipe', 'show recipe', 'show its recipe', 'what is the recipe', 'show the rule', 'show me the recipe'],
    summary: 'Shows the recipe chip of a builder-made node expanded: a built scene\'s recipe, a Grid Rules node\'s rule, a rules group\'s rules.',
    target: 'the selected builder-made node, else the only one',
    examples: [{ text: 'show the recipe', on: 'empty', note: 'With a built Scene Group selected' }, { text: 'show the rule', on: 'empty', note: 'With a Grid Rules node selected' }],
  },
  {
    id: 'copy-recipe', words: ['copy the recipe', 'copy recipe', 'copy its recipe', 'copy the rule'],
    summary: 'Copies the recipe (or the rule, or the rules as sentences) of a builder-made node to the clipboard.',
    target: 'the selected builder-made node, else the only one',
    examples: [{ text: 'copy the recipe', on: 'empty', note: 'With a built Scene Group selected' }, { text: 'copy the rule', on: 'empty', note: 'With a Grid Rules node selected' }],
  },
];

/** Words that join clauses or name a verb's second slot. */
export const CONNECTORS: ReadonlyArray<{ words: string[]; role: string; example: string }> = [
  { words: [',', ';', 'then', 'and then', 'after that', 'next', 'finally'], role: 'Starts a new clause. Each clause builds on what the last one made ("it").', example: 'create a circle, then output it' },
  { words: ['and'], role: 'Starts a new clause when a verb follows; else lists references ("the circle and the glow").', example: 'disconnect the current output and output the noise' },
  { words: ['with'], role: 'A modifier ("with falloff 8"), a palette ("with a palette") or the second value ("multiply it with the noise").', example: 'mix the palette with the glow' },
  { words: ['by'], role: 'An amount ("by 0.5"), the second value ("multiply it by the circle") or a palette\'s driver ("by the length of the space").', example: 'multiply it by 2' },
  { words: ['to', 'into', 'onto'], role: 'Where something goes ("connect A to B", "plug A into B", "rename X to …", "set X to 8").', example: 'connect the glow to the output' },
  { words: ['between', 'after', 'before'], role: 'Where an inserted node goes.', example: 'insert a tone map between the palette and the output' },
  { words: ['from'], role: 'Which wires ("disconnect A from B"), the base of a subtraction.', example: 'subtract the circle from the noise' },
  { words: ['of', '\'s'], role: 'A setting or input of a node ("the radius of the circle", "the circle\'s radius").', example: 'set the circle\'s radius to 0.2' },
  { words: ['as'], role: 'A name ("group these as \'Neon\'").', example: 'group these as "Neon"' },
];

/** The ways a sentence names a node. Resolution order is the order here. */
export const REFERENCE_FORMS: ReadonlyArray<{ form: string; words: string[]; means: string; example: string }> = [
  { form: 'The last result', words: ['it', 'that', 'the result', 'the last one', 'the new one', 'the previous one'], means: 'What the clause before made; in the first clause, the selection, else what the Output shows.', example: 'create a noise, then output it' },
  { form: 'The selection', words: ['this', 'these', 'them', 'those', 'both', 'the selection', 'the selected nodes'], means: 'The selected node ("this") or nodes ("these").', example: 'group these' },
  { form: 'By name or label', words: ['"Glow"', 'the \'Halo\' node', 'Circle SDF', 'the glow node'], means: 'A quoted name is a node\'s own label; unquoted, a node type\'s name ("Circle SDF", "fractal noise").', example: 'rename "Halo" to "Rim"' },
  { form: 'By type', words: ['the circle', 'the noise', 'the palette', 'the output', 'the glow', 'the uv'], means: 'A shape word or node kind. When several match, the selected one (or the last result) wins; else the preview asks which, pointing at them on the canvas.', example: 'make the circle bigger' },
  { form: 'By role', words: ['the current output', 'what the output shows', 'what feeds the output', 'the picture'], means: 'The node wired into the Output.', example: 'disconnect the current output' },
  { form: 'By position', words: ['the node before <ref>', 'the node after <ref>', 'the first <type>', 'the second <type>', 'the last <type>', '<type> 2'], means: 'Along the chain (before: what feeds its first wired input; after: the first thing it feeds), or by order on the canvas (left to right).', example: 'select the node before the output' },
  { form: 'Several', words: ['all <type>s', 'every <type>', '<ref> and <ref>'], means: 'For delete, group and select.', example: 'delete all circles' },
];

/** Relative words for "make … bigger" and the settings they move (doCommands.ts). */
export const RELATIVE_WORDS: Readonly<Record<string, { role: 'size' | 'intensity' | 'speed' | 'softness' | 'count'; dir: 1 | -1 }>> = {
  bigger: { role: 'size', dir: 1 }, larger: { role: 'size', dir: 1 }, wider: { role: 'size', dir: 1 }, thicker: { role: 'size', dir: 1 }, taller: { role: 'size', dir: 1 },
  smaller: { role: 'size', dir: -1 }, thinner: { role: 'size', dir: -1 }, narrower: { role: 'size', dir: -1 }, tighter: { role: 'size', dir: -1 }, shorter: { role: 'size', dir: -1 },
  brighter: { role: 'intensity', dir: 1 }, stronger: { role: 'intensity', dir: 1 }, louder: { role: 'intensity', dir: 1 },
  dimmer: { role: 'intensity', dir: -1 }, darker: { role: 'intensity', dir: -1 }, weaker: { role: 'intensity', dir: -1 }, fainter: { role: 'intensity', dir: -1 },
  faster: { role: 'speed', dir: 1 }, quicker: { role: 'speed', dir: 1 }, slower: { role: 'speed', dir: -1 },
  softer: { role: 'softness', dir: 1 }, smoother: { role: 'softness', dir: 1 }, blurrier: { role: 'softness', dir: 1 },
  sharper: { role: 'softness', dir: -1 }, harder: { role: 'softness', dir: -1 }, crisper: { role: 'softness', dir: -1 },
  busier: { role: 'count', dir: 1 }, denser: { role: 'count', dir: 1 }, sparser: { role: 'count', dir: -1 },
};

/** How far a relative word goes: × factor, or with "much" / "a bit". */
export const RELATIVE_STEP = { normal: 1.25, much: 1.6, bit: 1.1 } as const;

/** Examples for the build actions (vocabulary ACTIONS), by id. Actions with none get two plain ones. */
export const ACTION_EXAMPLES: Readonly<Record<string, CommandExample[]>> = {
  glow: [{ text: 'circle with a glow, falloff 8', on: 'empty' }, { text: 'glow it red', on: 'circle', selected: ['c'] }],
  rings: [{ text: 'add 8 rings', on: 'circle', selected: ['c'] }, { text: 'ring with 12 rings', on: 'empty' }],
  outline: [{ text: 'outline it width 0.02', on: 'circle', selected: ['c'] }, { text: 'hexagon with an outline', on: 'empty' }],
  onion: [{ text: 'make it hollow', on: 'circle', selected: ['c'] }, { text: 'a square with an onion 0.03', on: 'empty' }],
  round: [{ text: 'rounder by 0.05', on: 'circle', selected: ['c'] }, { text: 'box, then round it 0.04', on: 'empty' }],
  blend: [{ text: 'blend it with a box', on: 'circle', selected: ['c'] }, { text: 'smoothly blend these', on: 'twoShapes', selected: ['a', 'b'] }],
  'mask-from': [{ text: 'mask', on: 'circle', selected: ['c'] }, { text: 'heart, then mask it', on: 'empty' }],
  warp: [{ text: 'warp it', on: 'circle', selected: ['c'] }, { text: 'warp the space 0.6', on: 'noise', selected: ['f'] }],
  swirl: [{ text: 'swirl the space 3', on: 'circle', selected: ['c'] }, { text: 'star with a swirl', on: 'empty' }],
  twist: [{ text: 'twist the space 0.5', on: 'circle', selected: ['c'] }, { text: 'box, then twist it 2', on: 'empty' }],
  polar: [{ text: 'polar', on: 'circle', selected: ['c'] }, { text: 'polar the noise', on: 'noise' }],
  mirror: [{ text: 'mirror both ways', on: 'circle', selected: ['c'] }, { text: 'mirror it', on: 'noise', selected: ['f'] }],
  repeat: [{ text: 'repeat 5 times', on: 'circle', selected: ['c'] }, { text: 'make it repeat 6 times around', on: 'circle', selected: ['c'] }],
  'zoom-rotate': [{ text: 'rotate 45 degrees', on: 'circle', selected: ['c'] }, { text: 'zoom 2', on: 'noise', selected: ['f'] }],
  'code-here': [{ text: 'custom code', on: 'circle', selected: ['c'] }, { text: 'custom code on the noise', on: 'noise' }],
  'mix-with': [{ text: 'mix with blue', on: 'noise', selected: ['p'] }, { text: 'mix these colours', on: 'mixed', selected: ['p', 'g'] }],
  palette: [{ text: 'palette', on: 'noise', selected: ['p'] }, { text: 'colour it', on: 'noise', selected: ['f'] }],
  'tone-map': [{ text: 'tone map it', on: 'noise', selected: ['p'] }, { text: 'tone map the picture', on: 'glow' }],
  grade: [{ text: 'grade it', on: 'noise', selected: ['p'] }, { text: 'colour grade the picture', on: 'glow' }],
  brighten: [{ text: 'brighter by 0.3', on: 'noise', selected: ['p'] }, { text: 'brighten the picture', on: 'glow' }],
  grain: [{ text: 'add grain 0.1', on: 'noise', selected: ['p'] }, { text: 'grain the picture', on: 'glow' }],
  'blend-with': [{ text: 'screen blend', on: 'noise', selected: ['p'] }, { text: 'overlay it', on: 'noise', selected: ['p'] }],
  'soft-edge': [{ text: 'soften', on: 'mixed', selected: ['m'] }, { text: 'feather it 0.3', on: 'mixed', selected: ['m'] }],
  invert: [{ text: 'invert', on: 'mixed', selected: ['m'] }, { text: 'invert it', on: 'mixed', selected: ['m'] }],
  'grow-mask': [{ text: 'shrink', on: 'mixed', selected: ['m'] }, { text: 'erode it 0.1', on: 'mixed', selected: ['m'] }],
  'mix-two': [{ text: 'mix two pictures', on: 'mixed', selected: ['m'] }, { text: 'cut between two pictures', on: 'mixed', selected: ['m'] }],
  'blur-texture': [{ text: 'blur it', on: 'pass', selected: ['pass'] }, { text: 'blur it by 4', on: 'pass', selected: ['pass'] }],
  trails: [{ text: 'trails', on: 'glow', selected: ['g'] }, { text: 'circle with a glow, then trails on the picture', on: 'empty' }],
  flow: [{ text: 'flow', on: 'pass', selected: ['pass'] }, { text: 'stream it', on: 'pass', selected: ['pass'] }],
  remap: [{ text: 'remap', on: 'noise', selected: ['f'] }, { text: 'normalize it', on: 'noise', selected: ['f'] }],
};

/** Longer sentences that build classic looks. Each runs on its scratch graph without a refusal (tested). */
export const RECIPES: ReadonlyArray<{ id: string; name: string; text: string; on: ScratchId; why: string }> = [
  { id: 'glowing-ring', name: 'Glowing ring', text: 'create a ring radius 0.3 with a glow falloff 6 cyan, then tone map the picture', on: 'empty', why: 'A ring\'s distance lit by SDF Glow, tone mapped so the core doesn\'t clip.' },
  { id: 'palette-by-distance', name: 'Palette by distance', text: 'create a ring with falloff 0.3, colour it with a palette by the length of the space, multiply it by the circle, then output it', on: 'circle', why: 'Colour that changes with the distance from the centre, lit by the ring\'s glow and cut by the circle.' },
  { id: 'warped-noise', name: 'Warped noise', text: 'create a noise, warp it 0.6, then colour it with a palette and output it', on: 'empty', why: 'Domain warp on the noise\'s UV, then the value through a cosine palette.' },
  { id: 'neon-outline', name: 'Neon outline', text: 'create a hexagon with an outline width 0.01 pink, glow the hexagon falloff 12 pink, then tone map the picture', on: 'empty', why: 'A thin outline for the tube, a glow on the same shape for the halo, tone mapped.' },
  { id: 'feedback-trails', name: 'Feedback trails', text: 'circle at the top left with a glow, then trails on the picture', on: 'empty', why: 'Fade keeps the last frames: anything that moves leaves a trail.' },
  { id: 'kaleidoscope', name: 'Kaleidoscope star', text: 'star with a glow falloff 4, then repeat it 6 times around', on: 'empty', why: 'Angular Repeat folds the space into wedges round the centre.' },
  { id: 'swirled-rings', name: 'Swirled rings', text: 'circle with 12 rings, then swirl the space 2', on: 'empty', why: 'Rings round the shape, the space swirled in front of it.' },
  { id: 'noise-on-shape', name: 'Noise on a shape', text: 'disconnect the current output, add it to the noise, and output the result', on: 'mixed', why: 'Edits an existing graph: the picture added to the noise, then shown.' },
];

// ── The reference model ─────────────────────────────────────────────────────

export interface ReferenceEntry {
  id: string;
  kind: 'verb' | 'action' | 'builder' | 'object' | 'modifier' | 'reference' | 'connector' | 'recipe' | 'language';
  title: string;
  words: string[];
  summary: string;
  syntax: string[];
  slots: Array<{ name: string; what: string }>;
  examples: CommandExample[];
  group?: string;
}

const actionSummary: Record<string, string> = {
  glow: 'Light round a shape (SDF Glow); on a colour, Bloom; on a texture, Glow (texture).',
  rings: 'Lines at every step away from a shape.',
  outline: 'A line along a shape\'s edge (on a texture: Edges).',
  onion: 'Makes a shape a hollow shell.',
  round: 'Grows a shape (Offset).',
  blend: 'Smooth union with another shape.',
  'mask-from': 'A 0…1 mask from a shape (SDF Mask).',
  warp: 'Noise warp in front of the space (Domain Warp).',
  swirl: 'Swirls the space.',
  twist: 'Twists the space (an Expression Block).',
  polar: 'Polar coordinates.',
  mirror: 'Mirrors the space (x, y or both).',
  repeat: 'Tiles the space; "around" repeats round the centre.',
  'zoom-rotate': 'Zoom / rotate the space (UV Transform).',
  'code-here': 'An Expression Block on the wire, for code of your own.',
  'mix-with': 'Mixes a colour with another (OkLab Mix); "these" mixes two selected.',
  palette: 'Recolours by brightness; on a number, the number through a palette.',
  'tone-map': 'Brings bright values back into range (ACES).',
  grade: 'Lift / Gamma / Gain.',
  brighten: 'Raises brightness.',
  grain: 'Film grain.',
  'blend-with': 'Blend Modes (screen, overlay, multiply…).',
  'soft-edge': 'Softens a mask\'s edge.',
  invert: 'Inverts a mask.',
  'grow-mask': 'Grows or shrinks a mask.',
  'mix-two': 'A mask picks between two pictures.',
  'blur-texture': 'Blurs a texture (a Pass).',
  trails: 'Feedback trails (Fade).',
  flow: 'Flows a texture along a field.',
  remap: 'Remaps a number into 0…1.',
};

/** Examples for an action: curated, else two plain ones that use its first word. */
export function actionExamples(id: string): CommandExample[] {
  const curated = ACTION_EXAMPLES[id];
  if (curated?.length) return curated;
  const a = ACTIONS.find(x => x.id === id);
  const w = a?.words[0] ?? id;
  return [{ text: `${w} it`, on: 'circle', selected: ['c'] }, { text: w, on: 'noise', selected: ['p'] }];
}

/** Everything the reference shows, in order: verbs, actions, builders, objects, modifiers, references, connectors, recipes. */
export function commandReference(): ReferenceEntry[] {
  const out: ReferenceEntry[] = [];
  for (const v of COMMAND_VERBS) {
    out.push({ id: `verb:${v.id}`, kind: 'verb', title: v.words[0], words: v.words, summary: `${v.summary} Leaves as "it": ${v.result}.`, syntax: v.syntax, slots: v.slots, examples: v.examples, group: v.group });
  }
  for (const a of ACTIONS) {
    const variants = a.variants?.map(x => `${a.words[0]} … ${x.words[0]} (${x.id})`) ?? [];
    out.push({
      id: `action:${a.id}`, kind: 'action', title: a.words[0], words: a.words, summary: actionSummary[a.id] ?? `The ${a.id} move.`,
      syntax: [`${a.words[0]} [it | the space | the picture | <ref>] [<param> <value>] [<colour>]`, ...variants], slots: [], examples: actionExamples(a.id), group: 'build',
    });
  }
  for (const b of BUILDER_COMMANDS) {
    out.push({
      id: `builder:${b.id}`, kind: 'builder', title: b.words[0], words: b.words, summary: b.target ? `${b.summary} Works on ${b.target}.` : b.summary,
      syntax: [], slots: [], examples: b.examples, group: 'builders',
    });
  }
  const shapes2d = SHAPES.filter(s => s.node2d);
  out.push({
    id: 'object:shapes', kind: 'object', title: 'Shapes', words: shapes2d.map(s => s.words[0]),
    summary: 'A shape word makes the shape (with a UV in front): "circle", "ring radius 0.3", "heart at the top left". With "the" it names one already there. 3D shapes go to the 3D Scene Builder.',
    syntax: ['<shape> [radius <number>] [at <place>] [with <action>…]'], slots: shapes2d.map(s => ({ name: s.words[0], what: s.words.slice(1, 5).join(', ') || s.id })),
    examples: [{ text: 'heart at the top left with rings', on: 'empty' }, { text: 'a box at the top right', on: 'empty' }],
  });
  out.push({
    id: 'object:nodes', kind: 'object', title: 'Nodes by name', words: ['noise', 'palette', 'glow', 'uv', 'time', 'length', 'luminance', 'tone map', 'fill', 'mix'],
    summary: 'Any node by its name ("Fractal Noise", "Stops Palette", "Smoothstep") or a short word for it: noise, palette, glow, fill, uv, time, length.',
    syntax: ['create <node>', 'insert <node> after <ref>', 'switch <ref> to <node>'], slots: [],
    examples: [{ text: 'create a voronoi', on: 'empty' }, { text: 'insert a luminance between the palette and the output', on: 'noise' }],
  });
  out.push({
    id: 'modifier:params', kind: 'modifier', title: 'Values', words: Object.keys(PARAMS),
    summary: 'A setting word and a number fill a slot: "falloff 8", "6 times", "by 0.5", "45 degrees". A bare number fills the first number slot.',
    syntax: ['<param> <number>', '<number> <param>'], slots: Object.entries(PARAMS).map(([k, w]) => ({ name: k, what: w.join(', ') })),
    examples: [{ text: 'glow falloff 4', on: 'circle', selected: ['c'] }, { text: 'repeat 5 times', on: 'circle', selected: ['c'] }],
  });
  out.push({
    id: 'modifier:colours', kind: 'modifier', title: 'Colours', words: Object.keys(COLOURS),
    summary: 'A colour word or #rrggbb fills a colour slot (a glow\'s tint, a mix colour) or sets a colour setting.',
    syntax: ['<colour>', '#rrggbb'], slots: [], examples: [{ text: 'glow it red', on: 'circle', selected: ['c'] }, { text: 'set the glow tint to #ff8800', on: 'glow' }],
  });
  out.push({
    id: 'modifier:places', kind: 'modifier', title: 'Places', words: Object.keys(PLACES),
    summary: 'Where a new shape sits.', syntax: ['at <place>', 'in the <place>'], slots: [],
    examples: [{ text: 'circle in the middle', on: 'empty' }, { text: 'star at the bottom right', on: 'empty' }],
  });
  out.push({
    id: 'modifier:numbers', kind: 'modifier', title: 'Numbers', words: Object.keys(NUMBER_WORDS).filter(w => w !== 'a' && w !== 'an'),
    summary: 'Digits, number words (six, half, a dozen) and "6x".', syntax: ['<number>'], slots: [],
    examples: [{ text: 'repeat it six times', on: 'circle', selected: ['c'] }, { text: 'tile it 3x', on: 'circle', selected: ['c'] }],
  });
  out.push({
    id: 'modifier:relative', kind: 'modifier', title: 'Relative words', words: Object.keys(RELATIVE_WORDS),
    summary: `With "make": × ${RELATIVE_STEP.normal} (× ${RELATIVE_STEP.much} with "much", × ${RELATIVE_STEP.bit} with "a bit"), or the opposite. Size, intensity, speed, softness or count, by the node's own settings.`,
    syntax: ['make <ref> [much | a bit] <word>'], slots: [], examples: [{ text: 'make the circle a bit smaller', on: 'circle' }, { text: 'make the noise faster', on: 'noise' }],
  });
  for (const r of REFERENCE_FORMS) {
    out.push({ id: `reference:${r.form.toLowerCase().replace(/\W+/g, '-')}`, kind: 'reference', title: r.form, words: r.words, summary: r.means, syntax: [], slots: [], examples: [{ text: r.example, on: r.example.includes('these') ? 'twoShapes' : r.example.includes('"Halo"') ? 'glow' : r.example.includes('circles') ? 'twoShapes' : r.example.includes('output') ? 'noise' : 'circle', selected: r.example.includes('these') ? ['a', 'b'] : undefined }] });
  }
  out.push({
    id: 'reference:targets', kind: 'reference', title: 'Build targets', words: Object.values(TARGETS).flat(),
    summary: 'Words a build action works on: the selection ("it"), two selected ("these"), a node\'s space (UV) input ("the space"), what the Output shows ("the picture").',
    syntax: ['<action> it', '<action> the space', '<action> the picture'], slots: [], examples: [{ text: 'twist the space 0.5', on: 'circle', selected: ['c'] }, { text: 'tone map the picture', on: 'glow' }],
  });
  for (const c of CONNECTORS) {
    out.push({ id: `connector:${c.words[0] === ',' ? 'comma' : c.words[0].replace(/\W+/g, '')}`, kind: 'connector', title: c.words.join(' · '), words: c.words, summary: c.role, syntax: [], slots: [], examples: [{ text: c.example, on: c.example.includes('these') ? 'twoShapes' : 'mixed', selected: c.example.includes('these') ? ['a', 'b'] : undefined }] });
  }
  for (const r of RECIPES) {
    out.push({ id: `recipe:${r.id}`, kind: 'recipe', title: r.name, words: [], summary: r.why, syntax: [r.text], slots: [], examples: [{ text: r.text, on: r.on }] });
  }
  return out;
}

/** Search the reference: every word of the query must appear in the entry's text. */
export function searchReference(entries: ReferenceEntry[], query: string): ReferenceEntry[] {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!q.length) return entries;
  return entries.filter(e => {
    const hay = [e.title, e.summary, ...e.words, ...e.syntax, ...e.examples.map(x => x.text), e.kind].join(' ').toLowerCase();
    return q.every(w => hay.includes(w));
  });
}

const KIND_TITLES: Record<ReferenceEntry['kind'], string> = {
  verb: 'Verbs: editing what is there', action: 'Verbs: build actions', builder: 'Builders: opening a builder', object: 'Objects', modifier: 'Modifiers', reference: 'References', connector: 'Connectors', recipe: 'Recipes',
  language: 'The language: every head word (canonical)',
};
export const REFERENCE_SECTIONS = KIND_TITLES;

/** docs/do-bar-commands.md, generated (a test keeps the file in step; WRITE_DOCS=1 rewrites it). */
export function commandsMarkdown(entries: ReferenceEntry[] = commandReference()): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const lines: string[] = [
    '# Do… bar commands',
    '',
    '<!-- Generated from src/lang/commands.ts, src/lang/vocabulary.ts and src/lang/registry.ts (src/lang/reference.ts) by `npm run docs:do-bar`. Don\'t edit by hand: a test fails when it is out of date. -->',
    '',
    'The Do… bar (⌘K) reads a small command language: no AI, the same sentence always does the same thing.',
    'A sentence is one or more **clauses**; each starts with a **verb**, names **objects** and **references**, and takes **modifiers**.',
    'Clauses are joined by **connectors** ("then", ",", "and" before a verb) and each builds on what the last one made ("it").',
    'Before Enter the preview lists every step with the nodes, wires and values it will make; a clause it can\'t read is marked, with "did you mean", and the rest still previews.',
    'A whole sentence is one undo step, and wires are type-checked before anything changes.',
    '',
    '```',
    'sentence  := clause ( connector clause )*',
    'connector := "," | ";" | "then" | "and then" | "and" (before a verb) | "after that" | "next" | "finally"',
    'clause    := verb object? reference* modifier*      (edit verbs: connect, insert, multiply…)',
    '           | shape-or-action-phrase                 (build phrases: "circle with a glow, falloff 8")',
    'reference := pronoun | "quoted label" | [ordinal] type-name [number] | role | "the node before|after" reference',
    'modifier  := param number | number param | colour | place | "by" number | "much" | "a bit"',
    '```',
    '',
    'In the app: the **?** in the Do… bar, or Keys → Do… bar commands. Every example can be tried in the bar or shown step by step.',
    '',
    'The **builders** (the 3D Scene Builder, Grid Rules, Agent Rules) open from whole phrases: "new 3d scene", "new grid rules", "edit the rules", "show the recipe" (see Builders below). They are also the first section of the node browser and the empty-canvas right-click menu\'s Builders.',
    '',
  ];
  for (const kind of Object.keys(KIND_TITLES) as ReferenceEntry['kind'][]) {
    const list = entries.filter(e => e.kind === kind);
    if (!list.length) continue;
    lines.push(`## ${KIND_TITLES[kind]}`, '');
    for (const e of list) {
      lines.push(`### ${e.title}`, '');
      lines.push(e.summary, '');
      if (e.words.length && kind !== 'recipe') lines.push(`Words: ${e.words.slice(0, 40).map(w => `\`${w}\``).join(', ')}${e.words.length > 40 ? ', …' : ''}`, '');
      if (e.syntax.length) lines.push('```', ...e.syntax, '```', '');
      if (e.slots.length) {
        lines.push('| Slot | What |', '|---|---|');
        for (const s of e.slots) lines.push(`| ${esc(s.name)} | ${esc(s.what)} |`);
        lines.push('');
      }
      if (e.examples.length && kind !== 'recipe') {
        lines.push('Examples:', '');
        for (const x of e.examples) lines.push(kind === 'builder' ? `- \`${x.text}\`${x.note ? ` — ${x.note}` : ''}` : `- \`${x.text}\` — on ${SCRATCH_LABELS[x.on]}${x.selected ? ` (${x.selected.length > 1 ? 'two nodes' : 'one node'} selected)` : ''}${x.note ? `. ${x.note}` : ''}`);
        lines.push('');
      }
    }
  }
  lines.push('## Limits', '');
  for (const l of COMMAND_LIMITS) lines.push(`- ${l}`);
  lines.push('');
  return lines.join('\n');
}

/** What the language doesn't do (shown in the docs and the reference). */
export const COMMAND_LIMITS: readonly string[] = [
  'One level at a time: commands work on the graph level being edited (inside a group, its nodes); "output" needs the top level.',
  'Group goes last in a sentence, and the Output can\'t be grouped.',
  'References name nodes by type, label, role or position; a node\'s id is not a word.',
  'Build actions on a node named in the clause ("glow the circle") work on one node; two-node moves use "these".',
  'Relative changes move one setting (the first that fits its role); name the setting for another ("increase the speed of the noise").',
  'Unknown words in a build clause are listed and skipped; an edit clause with an unknown reference is refused with suggestions.',
];
