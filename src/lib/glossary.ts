/**
 * glossary.ts — one name per idea in the app's chrome (docs/glossary.md is the readable copy).
 *
 * `GLOSSARY` is the list of concepts and the one word each gets on screen; `BANNED` is the
 * words those names replaced, which a test (lib/__tests__/glossary.test.ts) keeps out of the
 * chrome: page tabs, rail names, shortcut labels, menu rows and toolbar tooltips. Node labels
 * and node categories are not chrome (they live in the node definitions) and get their own pass.
 *
 * Pure data: nothing in the app reads this at run time.
 */

export interface GlossaryTerm {
  /** The word on screen. */
  name: string;
  /** What it means, in one line. */
  means: string;
  /** Words not to use for it. */
  avoid: readonly string[];
}

export const GLOSSARY: readonly GlossaryTerm[] = [
  { name: 'Code', means: 'The top-level page for code: the shader editor, Convert, Functions and Node packs, as tabs', avoid: ['GLSL (as a page)', 'Builder (as a page)'] },
  { name: 'Shader', means: 'Code page tab: write a fragment shader by hand and run it', avoid: ['GLSL page', 'GLSL editor'] },
  { name: 'Convert', means: 'Code page tab: turn GLSL into nodes', avoid: [] },
  { name: 'Functions', means: 'Code page tab: plot and compose functions, then send them to the graph', avoid: ['Builder', 'Function Builder (in navigation)'] },
  { name: 'Node packs', means: 'Code page tab: make and share packs of node types', avoid: [] },
  { name: 'Builder', means: 'Only the Scene builders (2D, 3D, Agents, Grid, Splat, Time Cube, Warp) that write a graph for you', avoid: [] },
  { name: 'Publish node', means: 'Turn a graph, a group or GLSL into your own node type (the sidebar panel)', avoid: ['Node Builder'] },
  { name: 'Import shader', means: 'The top bar button: a .glsl file becomes a node in the graph', avoid: ['GLSL (as a button)'] },
  { name: 'Generated code', means: 'The graph’s own GLSL, in the drawer under the Studio canvas', avoid: ['GLSL code', 'GLSL output'] },
  { name: 'Finish', means: 'The graph’s one stack of effects over the whole picture (grade, lens, film, time), after the graph: Play → Finish, the Studio’s Finish button and a builder’s Look → Finish all edit it. Its presets are Finish presets', avoid: ['Look (as the rail or its effects)', 'Finish stack (as a preset kind)'] },
  { name: 'Effects', means: 'Effect nodes in the graph (the node library’s Effects, a builder’s Effects page, the built-in effect groups); also Sound’s tab of effects on each sound and the master', avoid: [] },
  { name: 'Look', means: 'Only a section inside one builder or layer editor: how that one thing is drawn', avoid: [] },
  { name: 'Controls', means: 'Play’s section of sliders, buttons and pads people play, with what drives them', avoid: ['Inputs', 'Mappings (as a section)'] },
  { name: 'Sources', means: 'What drives a control: a key, a knob, the mouse, a hand, an LFO. A mapping is one source → control row', avoid: ['Inputs', 'Mappings (as a list title)'] },
  { name: 'Inputs & media', means: 'The node library row of UV, Time, Mouse, Texture, MIDI and data nodes (category “Sources” in the definitions)', avoid: ['Sources (as a node row)'] },
  { name: 'Sound', means: 'Play’s section for the Audio engine: its tabs are Arrangement (racks, the tape) and Effects (the effects on each sound)', avoid: ['Engine (as a section)', 'Sound (as its own tab)'] },
  { name: 'Rules', means: 'Play’s When/Do section. A signal is one event a rule listens for', avoid: ['Signals (as the section)'] },
  { name: 'Set a control · Nudge a control', means: 'A rule’s Do on a control’s own value, as if its slider moved: Set puts it at a value, Nudge adds a step (stopping at the ends, or wrapping round); they need no layers', avoid: ['Jump a control', 'Increment (that is a mapping’s Step)'] },
  { name: 'arrives', means: 'How a rule with no When of its own reads when other rules send it: “When Reached arrives · sent by …”', avoid: ['Nothing yet (for a rule that is sent)'] },
  { name: 'MIDI file · Pad grid', means: 'Source kinds in Sources’ “+ Map” picker (under MIDI), one of each per setup, their cards in the Sources column', avoid: ['MIDI file page', 'Pad grid page (they are not Controls sub-tabs)'] },
  { name: 'Record video', means: 'The top bar Record’s first tab (and Stage’s Record video): the picture rendered or recorded to a video file, or a Snapshot PNG', avoid: ['Video (as the tab)'] },
  { name: 'Record performance (take)', means: 'The top bar Record’s second tab (and Stage’s button): your moves kept as keyframes, a take, to watch back and export as a video', avoid: ['Performance (as the tab)', 'Record a performance', 'Start performance'] },
  { name: 'Takes', means: 'The recorded performances. Their home is Sound → Arrangement → Takes (watch, rename, delete, Export video…); Record and Stage list them too', avoid: ['Render… (as a take’s button)', 'Make a take (as a transport button)'] },
  { name: 'Arm track', means: 'The ● on a Sound track: the transport’s Record records the armed tracks onto the tape', avoid: ['Record enable'] },
  { name: 'Behaviours', means: 'Ready-made rules and sources in one library: the Rules header, the Rules start pane, and the Controls and Sources empty states', avoid: ['Templates', 'Recipes (for these)'] },
  { name: 'Next', means: 'The one suggestion surface: next moves for the selected node, learned from your graphs', avoid: [] },
  { name: 'App settings', means: 'The app’s own preferences, in the top bar’s ⋯ menu', avoid: [] },
  { name: 'Library', means: 'What you saved that goes on the graph (group presets first, My nodes, functions, Expression Blocks, transforms, palettes) and your media, drawn like the Nodes list: the sidebar entry, Files → Library. Saved graphs are the top bar’s Load', avoid: ['Saved Graphs', 'Saved Keyframes'] },
  { name: 'Storage', means: 'How much is saved and where: the workspace folder, backups, the browser’s room (the Files page only)', avoid: ['Library (for the space meter)'] },
  { name: 'Nodes reference', means: 'Every node type with its sockets, picture and GLSL, under Help', avoid: [] },
  { name: 'colour', means: 'UI copy spells it the British way (node labels such as “Color Ramp” are a later pass)', avoid: ['color'] },
];

export interface BannedWord {
  /** Matched against each chrome string (after `${…}` in template strings is taken out). */
  pattern: RegExp;
  /** What to write instead. */
  use: string;
  /** Strings that may match the pattern anyway (a node's own label, say). */
  allow?: RegExp;
}

export const BANNED: readonly BannedWord[] = [
  { pattern: /\bNode Builder\b/, use: 'Publish node' },
  { pattern: /^Builder\b/, use: 'Functions (a tab of the Code page); “Builder” is only a Scene builder' },
  { pattern: /^GLSL$/, use: 'Import shader (the button) or Code (the page)' },
  { pattern: /\bGLSL page\b/, use: 'the Code page (its Shader tab)' },
  { pattern: /\bGo to (Mappings|Engine|Inputs|Look|Signals)\b/, use: 'the rail’s own name: Controls, Sources, Finish, Sound, Rules' },
  { pattern: /^(Inputs|Look|Engine|Mappings|Signals)( ·.*)?$/, use: 'Controls, Finish, Sound, Sources or Rules' },
  { pattern: /\bSaved (Graphs|Keyframes)\b/, use: 'Load (saved graphs) or the keyframe editor’s Presets' },
  { pattern: /\bRecord a performance\b|\bStart performance\b/, use: 'Record performance (take), and Start the take' },
  { pattern: /\b(MIDI file|Pad grid) (page|tab)\b/, use: 'the MIDI file / Pad grid source (“+ Map” → MIDI), not a Controls page' },
  { pattern: /\b[Cc]olor\b/, use: 'colour', allow: /\bAdd Color node\b|\bColor constant node\b/ },
];

/** A template string's text without its `${…}` parts (nested ones too; an unclosed one runs to the end). */
function withoutPlaceholders(text: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$' && text[i + 1] === '{') { depth++; i++; continue; }
    if (depth > 0) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; continue; }
    out += text[i];
  }
  return out;
}

/** A chrome string's problems: one line per banned word it uses. */
export function glossaryProblems(text: string): string[] {
  const t = withoutPlaceholders(text).replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  for (const b of BANNED) {
    if (!b.pattern.test(t)) continue;
    if (b.allow?.test(t)) continue;
    out.push(`“${t}”: use ${b.use}`);
  }
  return out;
}
