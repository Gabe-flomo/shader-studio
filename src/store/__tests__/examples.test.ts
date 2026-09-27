import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../exampleGraphs';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../exampleIndex';
import { PLAY_EXAMPLE_KEYS } from '../playExampleIndex';
import type { GraphNode } from '../../types/nodeGraph';
import { parseActionTarget, parseLayerTarget, parsePlayRecord } from '../../types/play';
import { collectPlayCandidates } from '../../play/playControls';
import { klSketchCompile, klSketchPress, klSketchStep } from '../../play/kit/layers.js';
import { kdScriptView } from '../../play/kit/data.js';
import * as threeSlim from '../../play/kit/three-slim.js';
import { takeEventsBetween, takePointerAt, takeValuesAt } from '../../lib/takePlayback';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

const walk = (nodes: GraphNode[], visit: (n: GraphNode) => void) => {
  for (const n of nodes) {
    visit(n);
    const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes) walk(sg.nodes, visit);
  }
};

describe('bundled examples', () => {
  const keys = Object.keys(EXAMPLE_GRAPHS);

  it('are all listed in the index and filed in exactly one folder', () => {
    expect(Object.keys(EXAMPLE_INDEX).sort()).toEqual(keys.sort());
    const filed = EXAMPLE_FOLDERS.flatMap(f => f.keys);
    const missing = keys.filter(k => k !== 'blank' && !filed.includes(k));
    expect(missing, 'examples no folder shows').toEqual([]);
    expect(filed.filter((k, i) => filed.indexOf(k) !== i), 'filed twice').toEqual([]);
    expect(filed.filter(k => !EXAMPLE_GRAPHS[k]), 'folder points at a missing example').toEqual([]);
  });

  it('are written in the current Grid Columns units, so none relies on the load migration', () => {
    // Grid and Grid Pattern's Columns counts cells across the width since version 2
    // (nodes/definitions/gridColumns.ts). An unstamped node here would be doubled on load.
    const old: string[] = [];
    for (const k of keys) {
      walk(EXAMPLE_GRAPHS[k].nodes, n => {
        if ((n.type === 'gridLayout' || n.type === 'gridPattern') && n.params._schemaVersion !== 2) old.push(`${k}: ${n.id}`);
      });
    }
    expect(old).toEqual([]);
  });

  it('use only current node types (no deprecated or unknown nodes)', () => {
    const bad: string[] = [];
    for (const k of keys) {
      walk(EXAMPLE_GRAPHS[k].nodes, n => {
        const def = getNodeDefinition(n.type);
        if (!def) bad.push(`${k}: unknown ${n.type}`);
        else if (def.deprecated) bad.push(`${k}: deprecated ${n.type}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('Play setups point at live params of their own graph, and the index flags them', () => {
    const problems: string[] = [];
    for (const k of keys) {
      const g = EXAMPLE_GRAPHS[k];
      if (!!EXAMPLE_INDEX[k].play !== !!g.play) problems.push(`${k}: index play flag ${EXAMPLE_INDEX[k].play ? 'set' : 'unset'} but graph ${g.play ? 'has' : 'lacks'} a setup`);
      if (!g.play) continue;
      const play = parsePlayRecord(g.play);
      // Nothing may be dropped by the parser: the bundled record has to be exactly valid.
      expect(play, `${k}: play record parses without loss`).toEqual(g.play);
      const nodes = resolveNodeAliases(g.nodes, getNodeDefinition);
      const r = compileGraph({ nodes });
      const targets = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
      const layerIds = new Set(play.layers.map(l => l.id));
      for (const c of play.controls) {
        const lt = parseLayerTarget(c.target) ?? parseActionTarget(c.target);
        if (lt ? !layerIds.has(lt.layerId) : !targets.has(c.target)) problems.push(`${k}: control "${c.label}" targets ${c.target}, which is not a live param or layer`);
      }
      const ids = new Set(play.controls.map(c => c.id));
      for (const m of play.mappings) {
        if (!ids.has(m.controlId)) problems.push(`${k}: mapping ${m.id} drives a missing control`);
        if (m.source.kind === 'control' && !ids.has(m.source.controlId)) problems.push(`${k}: mapping ${m.id} reads a missing control`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the Play folder comes first, numbered in order, and every example has notes', () => {
    const folder = EXAMPLE_FOLDERS[0];
    expect(folder.label).toBe('Play');
    expect(folder.keys).toEqual(PLAY_EXAMPLE_KEYS);
    PLAY_EXAMPLE_KEYS.forEach((k, i) => {
      // The browser sorts by label, so the zero-padded number keeps learning order.
      expect(EXAMPLE_INDEX[k].label.startsWith(`${String(i + 1).padStart(2, '0')} · `), k).toBe(true);
      expect(EXAMPLE_GRAPHS[k].label, k).toBe(EXAMPLE_INDEX[k].label);
      expect(EXAMPLE_GRAPHS[k].play?.notes?.includes('**What it shows.**'), `${k} notes`).toBe(true);
    });
  });

  it('all compile without errors', () => {
    const failures: string[] = [];
    for (const k of keys) {
      const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition);
      const r = compileGraph({ nodes });
      if (!r.success) failures.push(`${k}: ${(r.errors ?? []).join('; ').slice(0, 120)}`);
    }
    expect(failures).toEqual([]);
  });

  it('vectorised arithmetic nodes declare the type their sockets carry (the GPU compiles from params.outputType)', () => {
    const ARITH = new Set(['add', 'subtract', 'multiply', 'divide', 'mix', 'mod', 'abs', 'fractRaw', 'floor', 'ceil', 'smoothstep', 'clamp', 'max', 'minMath']);
    const bad: string[] = [];
    for (const k of keys) {
      walk(EXAMPLE_GRAPHS[k].nodes, n => {
        if (!ARITH.has(n.type)) return;
        const vec = Object.values(n.inputs).map(i => i.type).find(t => t === 'vec2' || t === 'vec3' || t === 'vec4');
        const declared = n.params?.outputType;
        if (vec && declared !== vec) bad.push(`${k}/${n.id} (${n.type}): sockets are ${vec} but params.outputType is ${String(declared)}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('the field-socket combos compile their shapes as field functions (one per wired socket)', () => {
    const expected: Record<string, string[]> = {
      comboGridShapeByWire: ['fieldfn_circ_0_distance', 'fieldfn_pal_0_color'],
      comboArrayStars: ['fieldfn_shape_0_distance', 'fieldfn_pal_0_color'],
      // The group's own Array calls the petal function; Picture only needs the hash → palette.
      comboGridGroupFlower: ['fieldfn_flower_0_g_circ_0_distance', 'fieldfn_flower_0_d', 'fieldfn_flower_0_c'],
      comboArrayGroupMoons: ['fieldfn_moon_0_d', 'fieldfn_pal_0_color'],
    };
    for (const [k, fns] of Object.entries(expected)) {
      const r = compileGraph({ nodes: resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition) });
      expect(r.errors ?? [], k).toEqual([]);
      const defined = [...r.fragmentShader.matchAll(/^(?:float|vec3) (fieldfn_\w+)\(vec2 g_uv,/gm)].map(m => m[1]);
      expect(defined, k).toEqual(fns);
    }
  });

  it('every Script layer compiles and draws frames without an error, pressing each of its buttons', () => {
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
    let count = 0;
    for (const k of keys) {
      for (const l of EXAMPLE_GRAPHS[k].play?.layers ?? []) {
        if (l.kind !== 'script') continue;
        count++;
        // A 3D sketch runs on the app's three.js set (no renderer here: the scene is built, not drawn).
        const st = klSketchCompile(l.code, { mode: l.mode, three: threeSlim });
        expect(st.error, `${k}/${l.id}`).toBeNull();
        const values = l as unknown as Record<string, number>;
        for (let f = 0; f < 90; f++) {
          if (f === 30) for (const d of l.paramDefs) if (d.kind === 'button') klSketchPress(st, d.key, 1);
          const params: Record<string, number> = {};
          for (const d of l.paramDefs) params[d.key] = values[`p_${d.key}`] ?? d.value;
          const s = {
            ctx, width: 640, height: 360, dpr: 1, time: f / 60, dt: 1 / 60, frame: f, params, state: (st as unknown as { state: object }).state,
            mouse: { x: 320 + f, y: 180, over: f > 45, down: f > 60 }, picture: { brightness: (x: number) => x / 640, texture: null },
            null: (name: string) => (name === 'B' ? null : { x: 100 + f, y: 120 }), random: Math.random,
            // The example's own datasets, as the kit hands them to s.data() (the first row current).
            data: (name: string) => { const d = Object.values(EXAMPLE_GRAPHS[k].datasets ?? {}).find(x => x.id === name || x.name === name); if (!d) return null; const v = kdScriptView({ id: d.id, name: d.name, result: d.result }, null); return { ...v, index: 0, current: v.rows[0] ?? null }; },
          };
          expect(klSketchStep(st, s, l.paramDefs, l.clear), `${k}/${l.id} frame ${f}`).toBeNull();
        }
      }
    }
    expect(count).toBeGreaterThanOrEqual(9);
  });

  it('the recorded-take example ships a take that plays back its controls, pointer and presses', () => {
    const take = EXAMPLE_GRAPHS.playTake.play?.takes?.[0];
    expect(take).toBeDefined();
    if (!take) return;
    expect(take.length).toBe(8);
    const controls = new Set(EXAMPLE_GRAPHS.playTake.play!.controls.map(c => c.target));
    for (const tr of take.tracks) if (tr.kind === 'control' && !tr.target!.startsWith('layer:')) expect(controls, tr.id).toContain(tr.target);
    // The figure of eight starts still in the middle and is off to one side a quarter of the way in.
    expect(takePointerAt(take, 0)).toMatchObject({ x: 0.5, y: 0.5, over: true, down: false });
    expect(takePointerAt(take, 2)!.x).toBeCloseTo(0.8, 2);
    const at = takeValuesAt(take, 1.4);
    expect(at.get('radius') as number).toBeGreaterThan(0.2);
    expect(takeEventsBetween(take, -Infinity, 8).map(e => e.do)).toEqual(['script:sparkle', 'script:sparkle', 'script:sparkle', 'script:sparkle']);
  });
});
