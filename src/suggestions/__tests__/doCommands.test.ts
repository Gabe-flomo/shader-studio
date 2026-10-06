/**
 * The Do… bar's command language (suggestions/doCommands.ts, doRefs.ts, lang/commands.ts):
 * a corpus of sentences → the clauses they read as, every runnable one compiles; references and
 * ambiguity; exact graph diffs for the edit verbs; type-check refusals; one undo step per
 * sentence; the reference library covers every verb; docs/do-bar-commands.md is up to date.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { compileGraph } from '../../compiler/graphCompiler';
import { estimateNodeHeight } from '../../store/graphLayout';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { classify, clausesOf, didYouMean, execCommand, type CommandPlan } from '../doCommands';
import { lex, readRef } from '../doRefs';
import { scratchGraph } from '../doScratch';
import { ACTIONS } from '../../lang/vocabulary';
import { COMMAND_VERBS, RECIPES, actionExamples, commandReference, commandsMarkdown, searchReference } from '../../lang/commands';
import { CORPUS } from './doCommandsCorpus';
import shippedDoc from '../../../docs/do-bar-commands.md?raw';

const H = (nd: GraphNode) => estimateNodeHeight(nd);
const run = (text: string, nodes: GraphNode[], selected: string[] = [], picks?: Record<string, string>): CommandPlan => {
  let k = 0;
  return execCommand(text, nodes, { selected, picks, heightOf: H, nextId: () => `t${++k}` });
};
const reads = (p: CommandPlan) => p.clauses.map(c => `${c.verb}${c.status === 'ok' ? '' : `!${c.status}`}`).join(' ');
const compiles = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes });
  expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
};
const conn = (nodes: GraphNode[], id: string, key: string) => {
  const c = nodes.find(nd => nd.id === id)?.inputs[key]?.connection;
  return c ? `${c.nodeId}.${c.outputKey}` : null;
};

describe('grammar: the sentence corpus', () => {
  it('has 80+ sentences, single and multi-clause, with references and edits', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(80);
    expect(CORPUS.filter(([t]) => clausesOf(t).length > 1).length).toBeGreaterThanOrEqual(10);
    expect(new Set(CORPUS.flatMap(([, , , e]) => e.split(' ').map(v => v.replace(/!.*/, ''))))).toEqual(new Set(['build', ...COMMAND_VERBS.map(v => v.id).filter(v => v !== 'reconnect'), 'reconnect']));
  });
  for (const [text, on, selected, expected] of CORPUS) {
    it(`“${text}” → ${expected}`, () => {
      const p = run(text, scratchGraph(on), selected);
      expect(reads(p), p.clauses.map(c => c.message).filter(Boolean).join(' / ')).toBe(expected);
      // A refused clause says why; a fully read sentence runs and compiles.
      for (const c of p.clauses) if (c.status !== 'ok') expect(c.message).toBeTruthy();
      if (p.ok) compiles(p.nodes);
    });
  }
});

describe('grammar: clauses and connectors', () => {
  it('splits at commas, "then" and "and" before a verb; keeps modifiers with their clause', () => {
    const texts = (s: string) => clausesOf(s).map(c => c.map(t => t.w).join(' '));
    expect(texts('disconnect the current output, add it to the noise, and output the result')).toEqual(['disconnect the current output', 'add it to the noise', 'output the result']);
    expect(texts('circle in the middle with a glow, falloff 8')).toEqual(['circle in the middle with a glow , falloff 8']);
    expect(texts('group the circle and the glow')).toEqual(['group the circle and the glow']);
    expect(texts('create a noise and then output it')).toEqual(['create a noise', 'output it']);
    expect(texts('copy the glow after that delete it')).toEqual(['copy the glow', 'delete it']);
  });
  it('tells shared words apart by what follows', () => {
    const verb = (s: string) => classify(lex(s)).verb;
    expect(verb('add rings')).toBe('build');
    expect(verb('add it to the noise')).toBe('combine');
    expect(verb('add a voronoi')).toBe('create');
    expect(verb('add a noise')).toBe('build'); // "noise" is the warp action, as before
    expect(verb('mix with blue')).toBe('build');
    expect(verb('mix the palette with the glow')).toBe('combine');
    expect(verb('duplicate 4 times')).toBe('build');
    expect(verb('duplicate the circle')).toBe('duplicate');
    expect(verb('colour it')).toBe('build');
    expect(verb('colour it by time')).toBe('colour');
    expect(verb('turn 45 degrees')).toBe('build');
    expect(verb('turn the circle into a box')).toBe('replace');
    expect(verb('change the radius to 0.3')).toBe('set');
    expect(verb('change the noise to voronoi')).toBe('replace');
    expect(verb('make it hollow')).toBe('build');
    expect(verb('make the circle bigger')).toBe('adjust');
    expect(verb('put a circle in the middle')).toBe('build');
    expect(verb('put a smoothstep before the palette')).toBe('insert');
  });
  it('lexes quoted names, possessives and decimals', () => {
    expect(lex('rename the glow\'s copy to "Big Halo", 0.5.')).toEqual([
      { w: 'rename' }, { w: 'the' }, { w: 'glow' }, { w: "'s", poss: true }, { w: 'copy' }, { w: 'to' }, { w: 'Big Halo', q: true }, { w: ',', sep: true }, { w: '0.5' }, { w: '.', sep: true },
    ]);
  });
  it('the rest previews when one clause can’t be read, with did you mean', () => {
    const p = run('create a noise, frobnicate it, then output the noise', scratchGraph('empty'));
    expect(reads(p)).toBe('create build!error output');
    expect(p.ok).toBe(false);
    expect(p.steps.map(s => s.label)).toEqual(['Add Fractal Noise (FBM)', 'Output Fractal Noise (FBM) · Value']);
    // "It" after a clause that can't run is unknown, not a guess.
    expect(run('create a noise, frobnicate it, then output it', scratchGraph('empty')).clauses[2].message).toMatch(/clause before/);
    expect(run('conect the glow to the output', scratchGraph('mixed')).clauses[0].suggestions).toContain('connect the glow to the output');
    expect(run('create a nosie', scratchGraph('empty')).clauses[0].suggestions?.join(' ')).toMatch(/noise/);
    expect(didYouMean('dleete')).toContain('delete');
  });
  it('a sentence of build phrases goes to the phrase language whole', () => {
    expect(run('circle with a glow then tone map it', scratchGraph('circle'), ['c']).phrase).toBe(true);
    expect(run('glow the circle', scratchGraph('mixed')).phrase).toBeFalsy();
  });
});

describe('references', () => {
  const g = scratchGraph('twoCircles');
  const env = (selected: string[] = [], subject: { id: string } | null = null) => ({ nodes: g, selected, subject });
  const ref = (s: string, e = env()) => readRef(lex(s), 0, e);
  it('by pronoun, selection and role', () => {
    expect(ref('it', env([], { id: 'b' }))).toMatchObject({ ok: true, ids: ['b'] });
    expect(ref('it', env(['a']))).toMatchObject({ ok: true, ids: ['a'] });
    expect(ref('it')).toMatchObject({ ok: true, ids: ['f'] });
    expect(ref('these', env(['a', 'b']))).toMatchObject({ ok: true, ids: ['a', 'b'] });
    expect(ref('the current output')).toMatchObject({ ok: true, ids: ['f'], key: 'result', via: 'output-role' });
    expect(ref('what feeds the output')).toMatchObject({ ok: true, ids: ['f'] });
  });
  it('by label, type and name', () => {
    const labelled = g.map(nd => (nd.id === 'b' ? { ...nd, params: { ...nd.params, label: 'Moon' } } : nd));
    expect(readRef(lex('"Moon"'), 0, { nodes: labelled, selected: [], subject: null })).toMatchObject({ ok: true, ids: ['b'] });
    expect(readRef(lex("the 'moon' node"), 0, { nodes: labelled, selected: [], subject: null })).toMatchObject({ ok: true, ids: ['b'], used: 3 });
    expect(ref('the fill')).toMatchObject({ ok: true, ids: ['f'] });
    expect(ref('SDF Fill')).toMatchObject({ ok: true, ids: ['f'] });
    expect(ref('the output')).toMatchObject({ ok: true, ids: ['o'], via: 'output-node' });
    expect(ref('the uv')).toMatchObject({ ok: true, ids: ['u'] });
  });
  it('by position', () => {
    expect(ref('the node before the output')).toMatchObject({ ok: true, ids: ['f'] });
    expect(ref('the node after the uv')).toMatchObject({ ok: true, ids: ['a'] });
    expect(ref('the first circle')).toMatchObject({ ok: true, ids: ['a'] });
    expect(ref('the second circle')).toMatchObject({ ok: true, ids: ['b'] });
    expect(ref('the last circle')).toMatchObject({ ok: true, ids: ['b'] });
    expect(ref('circle 2')).toMatchObject({ ok: true, ids: ['b'] });
    expect(ref('all circles')).toMatchObject({ ok: true, ids: ['a', 'b'], many: true });
  });
  it('greedy: leaves the words after the name (a setting)', () => {
    expect(readRef(lex('the fill antialias'), 0, env())).toMatchObject({ ok: true, ids: ['f'], used: 2 });
  });
  it('ambiguity: the selected one or the last result wins, else every candidate', () => {
    expect(ref('the circle', env(['b']))).toMatchObject({ ok: true, ids: ['b'] });
    expect(ref('the circle', env([], { id: 'a' }))).toMatchObject({ ok: true, ids: ['a'] });
    const r = ref('the circle');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.candidates).toEqual(['a', 'b']);
  });
  it('a pick in the preview, then the pick resolves it', () => {
    const p = run('make the circle bigger', g);
    expect(p.clauses[0].status).toBe('pick');
    expect(p.clauses[0].pick?.options.map(o => o.id)).toEqual(['a', 'b']);
    expect(p.clauses[0].pick?.options[0].label).toMatch(/into SDF Fill/);
    const picked = run('make the circle bigger', g, [], { [p.clauses[0].pick!.key]: 'b' });
    expect(picked.ok).toBe(true);
    expect(picked.nodes.find(nd => nd.id === 'b')!.params.radius).toBeCloseTo(0.1875);
    expect(picked.nodes.find(nd => nd.id === 'a')!.params.radius).toBe(g.find(nd => nd.id === 'a')!.params.radius);
  });
  it('nothing matches: says so, with names close to it', () => {
    const r = ref('the circel');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.suggestions).toContain('the circle');
    const missing = run('multiply the circle by the square', scratchGraph('mixed'));
    expect(missing.clauses[0].suggestions).toContain('create a square, then multiply the circle by it');
  });
});

describe('edit commands: exact diffs', () => {
  it('the brief’s sentence: disconnect, add, output', () => {
    const g = scratchGraph('mixed');
    const p = run('disconnect the current output, add it to the noise, and output the result', g);
    expect(p.ok).toBe(true);
    expect(p.steps.map(s => [s.label, s.wires, s.unwires])).toEqual([
      ['Disconnect the current output (Palette)', [], ['Palette · Color → Output · Color']],
      ['Add Fractal Noise (FBM) with Palette', ['Fractal Noise (FBM) · Value → Add · A', 'Palette · Color → Add · B'], []],
      ['Output Add · Result', ['Add · Result → Output · Color'], []],
    ]);
    const add = p.nodes.find(nd => nd.type === 'add')!;
    expect(add.outputs.result.type).toBe('vec3');
    expect(conn(p.nodes, 'o', 'color')).toBe(`${add.id}.result`);
    expect(conn(p.nodes, 'p', 'value')).toBe('f.value');
    compiles(p.nodes);
  });
  it('the brief’s build sentence: ring, palette by length, multiply, output', () => {
    const p = run('create a ring with falloff 0.3, colour it with a palette by the length of the space, multiply it by the circle, then output it', scratchGraph('circle'));
    expect(p.ok).toBe(true);
    expect(p.steps.map(s => s.label)).toEqual([
      'Add Ring SDF', 'Glow · falloff 0.3', 'Colour SDF Glow with a palette by the length of the space', 'Multiply Multiply with Circle SDF', 'Output Multiply · Result',
    ]);
    const glow = p.nodes.find(nd => nd.type === 'light')!;
    expect(glow.params.brightness).toBe(0.3);
    const len = p.nodes.find(nd => nd.type === 'length')!;
    const pal = p.nodes.find(nd => nd.type === 'palette')!;
    expect(conn(p.nodes, pal.id, 'value')).toBe(`${len.id}.output`);
    const [m1, m2] = p.nodes.filter(nd => nd.type === 'multiply');
    expect(conn(p.nodes, m1.id, 'b')).toBe(`${glow.id}.glow`);
    expect(conn(p.nodes, m2.id, 'a')).toBe(`${m1.id}.result`);
    expect(conn(p.nodes, m2.id, 'b')).toBe('c.distance');
    expect(conn(p.nodes, 'o', 'color')).toBe(`${m2.id}.result`);
    compiles(p.nodes);
  });
  it('connect, insert, replace, delete, rename, duplicate, set, adjust', () => {
    const noise = scratchGraph('noise');
    const ins = run('insert a tone map between the palette and the output', noise);
    const tm = ins.nodes.find(nd => nd.type === 'toneMap')!;
    expect([conn(ins.nodes, tm.id, 'color'), conn(ins.nodes, 'o', 'color')]).toEqual(['p.color', `${tm.id}.color`]);
    expect(ins.steps[0].unwires).toEqual(['Palette · Color → Output · Color']);

    const c = run('connect the noise to the tint of the glow', scratchGraph('mixed'));
    expect(conn(c.nodes, 'g', 'tint')).toBe('f.value');
    expect(c.steps[0].notes.join(' ')).toMatch(/converted on the wire/);

    const sw = run('switch the noise to voronoi', noise);
    expect(sw.nodes.find(nd => nd.id === 'f')!.type).toBe('voronoi');
    expect(conn(sw.nodes, 'f', 'uv')).toBe('u.uv');
    expect(conn(sw.nodes, 'p', 'value')).toMatch(/^f\./);

    const del = run('delete the glow', scratchGraph('mixed'));
    expect(del.nodes.some(nd => nd.id === 'g')).toBe(false);
    expect(del.steps[0].removes).toEqual(['SDF Glow']);

    const ren = run('rename the glow to "Halo"', scratchGraph('glow'));
    expect(ren.nodes.find(nd => nd.id === 'g')!.params.label).toBe('Halo');

    const dup = run('duplicate the circle', scratchGraph('circle'));
    const copy = dup.nodes.find(nd => nd.type === 'circleSDF' && nd.id !== 'c')!;
    expect(conn(dup.nodes, copy.id, 'position')).toBe('u.uv');
    expect(dup.select).toEqual([copy.id]);

    const set = run('set the glow falloff to 8', scratchGraph('glow'));
    expect(set.steps[0].params).toEqual(['SDF Glow · Falloff 10 → 8']);
    const tint = run('set the glow tint to cyan', scratchGraph('glow'));
    expect(tint.nodes.find(nd => nd.id === 'g')!.params.tint).toEqual([0.2, 0.9, 1]);

    expect(run('make the circle bigger', scratchGraph('circle')).steps[0].params).toEqual(['Circle SDF · Radius 0.3 → 0.375']);
    expect(run('make the glow much wider', scratchGraph('glow')).steps[0].params).toEqual(['SDF Glow · Falloff 10 → 6.25']);
    expect(run('increase the radius of the circle by 0.1', scratchGraph('circle')).steps[0].params).toEqual(['Circle SDF · Radius 0.3 → 0.4']);
    expect(run('halve the radius of the circle', scratchGraph('circle')).steps[0].params).toEqual(['Circle SDF · Radius 0.3 → 0.15']);
  });
  it('combine puts the result where the base went', () => {
    const p = run('multiply the output with the noise', scratchGraph('mixed'));
    const m = p.nodes.find(nd => nd.type === 'multiply')!;
    expect([conn(p.nodes, m.id, 'a'), conn(p.nodes, m.id, 'b'), conn(p.nodes, 'o', 'color')]).toEqual(['p.color', 'f.value', `${m.id}.result`]);
    const u = run('union the circle with the box', scratchGraph('twoShapes'));
    const un = u.nodes.find(nd => nd.type === 'sdfUnion')!;
    expect(conn(u.nodes, 'f', 'd')).toBe(`${un.id}.dist`);
    compiles(u.nodes);
  });
  it('group and select are deferred to the store', () => {
    const p = run('group the circle and the glow as "Neon"', scratchGraph('glow'));
    expect(p.group).toEqual({ ids: ['c', 'g'], label: 'Neon' });
    expect(run('select all circles', scratchGraph('twoCircles')).select).toEqual(['a', 'b']);
  });
});

describe('type checks', () => {
  it('refuses a wire whose types don’t fit, with fixes', () => {
    const g = [n('uv', 'u', 0, 0), n('palette', 'p', 400, 0), n('circleSDF', 'c', 400, 400), n('light', 'l', 800, 0), n('output', 'o', 1200, 0)];
    const p = run('connect the palette to the brightness of the glow', g);
    expect(p.clauses[0].status).toBe('error');
    expect(p.clauses[0].message).toMatch(/Type check: Palette · Color is a colour \(vec3\); SDF Glow · Brightness takes a number/);
    expect(p.clauses[0].suggestions).toContain('create a luminance, connect the palette to it, then connect it to the glow');
    expect(p.nodes).toBe(g);
    // The fix runs.
    const fixed = run(p.clauses[0].suggestions![0], g);
    expect(fixed.ok).toBe(true);
    const lum = fixed.nodes.find(nd => nd.type === 'luminance')!;
    expect(conn(fixed.nodes, lum.id, 'color')).toBe('p.color');
    expect(conn(fixed.nodes, 'l', 'brightness')).toBe(`${lum.id}.result`);
  });
  it('refuses combining a colour as a distance, loops, and switches that drop wires', () => {
    expect(run('union the palette with the circle', scratchGraph('mixed')).clauses[0].message).toMatch(/Type check: Union takes two distances/);
    expect(run('connect the glow to the circle', scratchGraph('glow')).clauses[0].message).toMatch(/loop/);
    const sw = run('switch the circle to a palette', scratchGraph('circle'));
    expect(sw.clauses[0].message).toMatch(/Can’t switch Circle SDF to Palette/);
  });
});

describe('one undo step', () => {
  it('a multi-clause sentence is one undo step, and undo takes it all back', async () => {
    const { useNodeGraphStore, undoManager } = await import('../../store/useNodeGraphStore');
    const st = useNodeGraphStore.getState();
    useNodeGraphStore.setState({ nodes: scratchGraph('mixed'), activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
    const before = useNodeGraphStore.getState().nodes;
    const depth = undoManager.canUndo;
    const plan = st.runCommand('disconnect the current output, add it to the noise, and output the result');
    expect(plan.ok).toBe(true);
    expect(undoManager.canUndo).toBe(depth + 1);
    expect(undoManager.top()?.label).toBe('Do: disconnect the current output, add it to the noise, and output the result');
    const after = useNodeGraphStore.getState().nodes;
    expect(after.some(nd => nd.type === 'add')).toBe(true);
    useNodeGraphStore.getState().undo();
    expect(useNodeGraphStore.getState().nodes.map(nd => nd.id)).toEqual(before.map(nd => nd.id));
    expect(conn(useNodeGraphStore.getState().nodes, 'o', 'color')).toBe('p.color');
  });
  it('a group at the end goes in the same step', async () => {
    const { useNodeGraphStore, undoManager } = await import('../../store/useNodeGraphStore');
    useNodeGraphStore.setState({ nodes: scratchGraph('glow'), activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
    const depth = undoManager.canUndo;
    const plan = useNodeGraphStore.getState().runCommand('set the glow falloff to 4, then group the circle and the glow as "Neon"');
    expect(plan.ok).toBe(true);
    expect(undoManager.canUndo).toBe(depth + 1);
    const grp = useNodeGraphStore.getState().nodes.find(nd => nd.type === 'group');
    expect(grp?.params.label).toBe('Neon');
    useNodeGraphStore.getState().undo();
    expect(useNodeGraphStore.getState().nodes.some(nd => nd.type === 'group')).toBe(false);
    expect(useNodeGraphStore.getState().nodes.find(nd => nd.id === 'g')!.params.brightness).toBe(10);
  });
  it('a refused sentence changes nothing', async () => {
    const { useNodeGraphStore, undoManager } = await import('../../store/useNodeGraphStore');
    useNodeGraphStore.setState({ nodes: scratchGraph('mixed'), activeGroupPath: [] });
    const before = useNodeGraphStore.getState().nodes;
    const depth = undoManager.canUndo;
    expect(useNodeGraphStore.getState().runCommand('output the glow, then union the palette with the circle').ok).toBe(false);
    expect(useNodeGraphStore.getState().nodes).toBe(before);
    expect(undoManager.canUndo).toBe(depth);
  });
});

describe('the reference library', () => {
  const entries = commandReference();
  it('covers every verb and every build action, with 2+ examples that read as that verb', () => {
    for (const v of COMMAND_VERBS) {
      const e = entries.find(x => x.id === `verb:${v.id}`);
      expect(e, v.id).toBeTruthy();
      expect(v.examples.length, v.id).toBeGreaterThanOrEqual(2);
      expect(v.syntax.length, v.id).toBeGreaterThanOrEqual(1);
      for (const x of v.examples) expect(classify(clausesOf(x.text)[0]).verb, x.text).toBe(v.id);
    }
    for (const a of ACTIONS) {
      expect(entries.some(x => x.id === `action:${a.id}`), a.id).toBe(true);
      expect(actionExamples(a.id).length, a.id).toBeGreaterThanOrEqual(2);
    }
    for (const k of ['object', 'modifier', 'reference', 'connector', 'recipe'] as const) expect(entries.some(e => e.kind === k), k).toBe(true);
  });
  for (const e of entries) {
    for (const x of e.examples) {
      it(`${e.id}: “${x.text}” runs on its scratch graph`, () => {
        const p = run(x.text, scratchGraph(x.on), x.selected);
        expect(p.clauses.filter(c => c.status !== 'ok').map(c => c.message)).toEqual([]);
        expect(p.ok).toBe(true);
        compiles(p.nodes);
      });
    }
  }
  it('every recipe has several clauses', () => {
    for (const r of RECIPES) expect(clausesOf(r.text).length, r.id).toBeGreaterThanOrEqual(2);
  });
  it('is searchable', () => {
    expect(searchReference(entries, 'between').map(e => e.id)).toContain('verb:insert');
    expect(searchReference(entries, 'the node before').map(e => e.id)).toContain('reference:by-position');
    expect(searchReference(entries, 'trails').map(e => e.id)).toEqual(expect.arrayContaining(['action:trails', 'recipe:feedback-trails']));
  });
});

describe('docs/do-bar-commands.md', () => {
  const write = !!(import.meta.env as Record<string, unknown>).WRITE_DOCS;
  it('writes the doc when asked', async () => {
    if (!write) return;
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync: (f: URL, s: string) => void };
    fs.writeFileSync(new URL('../../../docs/do-bar-commands.md', import.meta.url), commandsMarkdown());
  });
  it('is generated from the registry and up to date (npm run docs:do-bar)', () => {
    if (write) return;
    expect(shippedDoc).toBe(commandsMarkdown());
    for (const v of COMMAND_VERBS) expect(shippedDoc).toContain(`### ${v.words[0]}`);
  });
});
