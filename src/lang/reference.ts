/**
 * reference.ts — the one reference, generated from the registry (docs/playfield-language-plan.md
 * §8.8): the in-app Commands reference (ⓘ in the Do… bar), docs/do-bar-commands.md and
 * docs/playfield-language.md all come from here, so they can't drift from what the parser reads.
 *
 *  - fullReference(): the bar's verbs, actions, builders, objects, modifiers, references, connectors
 *    and recipes (commands.ts), each verb with its canonical form, plus every head of every dialect
 *    (picture, edit, scene, grid, agents, pass) with its words, settings, ranges and examples.
 *  - languageMarkdown(): docs/playfield-language.md.
 */
import { commandReference, commandsMarkdown, type ReferenceEntry } from './commands';
import { EDIT_SYNTAX, VERB_HEAD, registry, type Dialect, type Entry } from './registry';
import { COLOUR_NAMES } from './colours';
import { PALETTES } from '../sceneBuilder/output';
// The dialects' words register themselves on import.
import './dialects/grid';
import './dialects/agents';

const DIALECT_TITLES: Record<Dialect, string> = {
  picture: '2D picture', edit: 'Edits', scene: '3D scene', grid: 'Grid Rules', agents: 'Agent Rules', pass: 'Passes',
};
const ORDER: Dialect[] = ['picture', 'edit', 'pass', 'scene', 'grid', 'agents'];

const randText = (r: Entry['params'][number]['rand']) => (!r ? '' : r.kind === 'num' ? `${r.lo}–${r.hi}${r.log ? ' (log)' : ''}${r.int ? ', whole' : ''}` : r.kind === 'vec' ? `(${r.lo}…${r.hi})×${r.n}` : r.kind === 'colour' ? 'a harmonious colour' : r.options.join(' | '));

/** A head's signature: its word, its primary bare, the rest key=. */
export function signatureText(e: Entry): string {
  const head = e.kind === 'combine' ? `${e.words[0]}(a, b)` : e.words[0];
  return [head, ...e.params.map(p => (p.primary ? `[${p.key}]` : `${p.key}=`)), ...(e.flags ?? []).slice(0, 4).map(f => `[${f}]`)].join(' ');
}

const firstDialect = (e: Entry) => ORDER.find(d => e.dialects.includes(d)) ?? e.dialects[0];

function languageEntries(): ReferenceEntry[] {
  const seen = new Set<string>();
  const out: ReferenceEntry[] = [];
  for (const e of registry()) {
    if (seen.has(e.id) || e.id === 'grid:settings') continue;
    seen.add(e.id);
    const d = firstDialect(e);
    const settings = e.params.map(p => ({ name: `${p.key}${p.primary ? ' (bare)' : ''}`, what: [p.label && p.label !== p.key ? p.label : '', p.hint ?? '', p.options ? p.options.join(', ') : '', p.def !== undefined && typeof p.def !== 'object' ? `default ${p.def}` : '', p.rand ? `random: ${randText(p.rand)}` : ''].filter(Boolean).join(' · ') || p.type }));
    out.push({
      id: `lang:${e.id}`, kind: 'language', title: `${e.kind === 'combine' ? `${e.words[0]}( )` : e.words[0]}`, words: e.words,
      summary: `${DIALECT_TITLES[d]} · ${e.kind}. ${e.summary}${e.words.length > 1 ? ` Also: ${e.words.slice(1).join(', ')}.` : ''}${e.deprecated ? ` Old words (still read, with a hint): ${Object.keys(e.deprecated).join(', ')}.` : ''}`,
      syntax: [signatureText(e)], slots: settings, group: d,
      examples: e.examples.map(text => ({ text, on: 'empty' as const })),
    });
  }
  return out;
}

/** Everything the reference shows: the bar's own entries (verbs with their canonical form) and every head of the language. */
export function fullReference(): ReferenceEntry[] {
  const base = commandReference().map(r => {
    if (r.kind !== 'verb') return r;
    const id = r.id.replace(/^verb:/, '');
    const canon = EDIT_SYNTAX[id];
    return canon ? { ...r, summary: `${r.summary} Canonical: ${canon.join(' · ')}${VERB_HEAD[id] && VERB_HEAD[id] !== r.title ? ` (the verb is ${VERB_HEAD[id]})` : ''}.`, syntax: [...canon, ...r.syntax] } : r;
  });
  return [...base, ...languageEntries()];
}

/** docs/do-bar-commands.md, from the one reference. */
export const fullCommandsMarkdown = () => commandsMarkdown(fullReference());

/** docs/playfield-language.md: the grammar, the dialects and every head, generated (a test keeps it in step). */
export function languageMarkdown(): string {
  const L: string[] = [
    '# The Playfield language',
    '',
    '<!-- Generated from src/lang/registry.ts and src/lang/reference.ts by `npm run docs:language`. Don\'t edit by hand: a test fails when it is out of date. -->',
    '',
    'One language for the Do… bar, the 3D Scene Builder\'s recipe, Grid Rules and Agent Rules (the plan and its decisions: [playfield-language-plan.md](playfield-language-plan.md)).',
    'A line is **clauses** separated by `·` (or `•`, `|`, `;`, a new line). A clause is a **head word** and its settings: `key=value`, the primary value bare (`twist 0.5`), flags (`glass`, `walls`), `(…)` for items, `@modifier(…)` for one item.',
    'Plain English in the Do… bar is sugar: the bar shows each sentence\'s canonical line under the box.',
    '',
    '```',
    'circle r=0.3 · glow falloff=8 · colour by length                          2D picture',
    'surface · sphere r=1 @move(0,1,0) · smooth-union(box, torus) k=0.5        3D scene',
    'grid life walls board=480                                                  Grid Rules',
    'species Ants: when searching and food ahead > 0.5 do become carrying       Agent Rules',
    'noise · colour by it · pass "Soft" scale=1/2 · blur 4                      passes',
    'connect noise → glow.tint · set glow falloff=8                             edits',
    '```',
    '',
    '## Values',
    '',
    '| Value | Written |',
    '|---|---|',
    '| number | `1`, `-0.5`, `.25`, `1e-3`; angles `30deg` `30°` `0.5rad`; time `0.5s` `200ms`; rate `1/s`; percent `60%`; count `6x` |',
    '| vector | `(x,y)`, `(x,y,z)`; one number fills every part |',
    `| colour | \`#rgb\`, \`#rrggbb\`, \`(r,g,b)\` in 0–1, or a name: ${COLOUR_NAMES.join(' ')} |`,
    '| list, range | `survive=2,3`, `born=34..45` |',
    '| name | `Body`, `"My shape"` |',
    '| code | `{u + 0.2 * lap_u}` (one line of GLSL) |',
    '| random | `random`, `random(0.2..2)`, `random(red, teal)`; a leading `random` draws every unset setting; `seed=42` (or a word) repeats it |',
    `| palette | ${PALETTES.map(p => p.key).join(', ')} |`,
    '',
    '## References (edits)',
    '',
    'Edit verbs leave "the" out: `set glow falloff=8`. A clause that is only a reference keeps it: `the hexagon · glow`.',
    '',
    '| Form | Means |',
    '|---|---|',
    '| `it` | what the clause before made (first: the selection, else what the Output shows) |',
    '| `this`, `these` | the selected node, the selected nodes |',
    '| `picture` | what the Output shows |',
    '| `"Halo"` | the node labelled Halo |',
    '| `circle`, `circle#2`, `circle#last` | a node by its type or shape word, by canvas order |',
    '| `glow.tint` | an input of a node |',
    '| `before output`, `after circle` | along the chain |',
    '| `all circles`, `circle and glow` | several |',
    '',
    '## Choosing the dialect',
    '',
    '- A header decides: `grid`, `agents` / `species`, a render mode (`surface`, `volumetric`, `glass`, `gi`).',
    '- Otherwise a line with a 3D-only word (a 3D shape, a scene setting, an `@` warp) is a 3D scene, and anything else a 2D picture or an edit.',
    '- A line that mixes 3D-only and 2D-only words is refused: one line is one or the other.',
    '- `grid` is needed only where a preset\'s name is also another word (`grid swirl`, `grid ripples`).',
    '- Agent rules on one line follow their species after a colon: `species Slime: always do wander 7deg`.',
    '',
  ];
  const all = languageEntries();
  for (const d of ORDER) {
    const list = all.filter(e => e.group === d);
    if (!list.length) continue;
    L.push(`## ${DIALECT_TITLES[d]}`, '');
    L.push('| Head | Also | Settings | Example |', '|---|---|---|---|');
    for (const e of list) {
      const esc = (s: string) => s.replace(/\|/g, '\\|');
      L.push(`| \`${esc(e.syntax[0])}\` | ${esc(e.words.slice(1).join(', '))} | ${esc(e.slots.map(s => `${s.name}: ${s.what}`).join('; '))} | ${e.examples[0] ? `\`${esc(e.examples[0].text)}\`` : ''} |`);
    }
    L.push('');
  }
  return L.join('\n');
}
