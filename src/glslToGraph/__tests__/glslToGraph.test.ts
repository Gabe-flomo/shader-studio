/**
 * The GLSL → node graph experiment: every corpus shader either converts to a
 * graph the compiler accepts, or is refused up front with a reason. Pixel
 * equivalence needs a browser: see tools/g2n-roundtrip.ts + g2n-pixel-compare.mjs
 * (as of writing, 10 of 11 render identically; 08 is refused for `discard`).
 */
import { describe, it, expect } from 'vitest';
import { glslToGraph } from '..';
import { compileGraph } from '../../compiler/graphCompiler';

const files = import.meta.glob('./corpus/*.frag', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const corpus = Object.entries(files).map(([p, src]) => [p.split('/').pop()!, src] as const).sort((a, b) => a[0].localeCompare(b[0]));

describe('GLSL → node graph', () => {
  it.each(corpus.filter(([f]) => !f.startsWith('08')))('%s converts to a graph the compiler accepts', (_f, src) => {
    const r = glslToGraph(src);
    expect(r.report.unsupported).toEqual([]);
    expect(r.nodes.some(n => n.type === 'output' || n.type === 'vec4Output')).toBe(true);
    const c = compileGraph({ nodes: r.nodes });
    expect(c.errors ?? []).toEqual([]);
    expect(c.success).toBe(true);
  });

  it('refuses what a graph can’t hold, and says why', () => {
    const r = glslToGraph(corpus.find(([f]) => f.startsWith('08'))![1]);
    expect(r.nodes).toEqual([]);
    expect(r.report.unsupported.join(' ')).toMatch(/discard/);
    // The preview still says what would have become code, so the user knows before committing.
    expect(r.report.regions.map(x => x.why).join(' ')).toMatch(/rot\(\) returns a mat2/);
  });

  it('is deterministic', () => {
    for (const [, src] of corpus) expect(JSON.stringify(glslToGraph(src))).toBe(JSON.stringify(glslToGraph(src)));
  });

  it('turns literals into sliders and keeps the rest as nodes', () => {
    const r = glslToGraph(corpus.find(([f]) => f.startsWith('01'))![1]);
    const kinds = r.nodes.map(n => n.type);
    expect(kinds).toEqual(expect.arrayContaining(['fragCoord', 'resolution', 'divide', 'subtract', 'length', 'smoothstep', 'floatToVec3', 'output']));
    expect(r.report.stats).toMatchObject({ blocks: 0, regions: 0, sliders: 3 });
    const smooth = r.nodes.find(n => n.type === 'smoothstep')!;
    expect(smooth.params).toMatchObject({ edge0: 0.31, edge1: 0.3 });
  });

  it('reads a Shadertoy shader, carrying helper functions into a region', () => {
    const r = glslToGraph(corpus.find(([f]) => f.startsWith('09'))![1]);
    expect(r.report.notes.join(' ')).toMatch(/mainImage/);
    const fn = r.nodes.find(n => n.type === 'customFn')!;
    expect(String(fn.params.glslFunctions)).toMatch(/float hash21/);
    expect(String(fn.params.glslFunctions)).toMatch(/float fbm/);
  });
});

describe('for loops become iterated groups', () => {
  const by = (prefix: string) => corpus.find(([f]) => f.startsWith(prefix))![1];
  const groupsOf = (src: string) => { const r = glslToGraph(src); return { r, groups: r.nodes.filter(n => n.type === 'group') }; };

  it('a constant loop is one group running that many times, with a Loop Carry per changed variable and a Loop Index', () => {
    const { r, groups } = groupsOf(by('06'));
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.params.iterations).toBe(4);
    const sg = g.params.subgraph as { nodes: { type: string }[]; inputPorts: { label: string; type: string }[]; outputPorts: { label: string }[] };
    expect(sg.nodes.filter(n => n.type === 'loopCarry')).toHaveLength(1);
    expect(sg.nodes.filter(n => n.type === 'loopIndex')).toHaveLength(1);
    expect(sg.outputPorts.map(p => p.label)).toEqual(['a']);
    // Carry init ports come first, in the output ports' order (the compiler pairs them by position).
    expect(sg.inputPorts[0]).toMatchObject({ label: 'a', type: 'float' });
    expect(r.report.stats.loops).toBe(1);
    expect(r.report.notes.join(' ')).toMatch(/iterated group carrying a/);
    const c = compileGraph({ nodes: r.nodes });
    expect(c.success).toBe(true);
    expect(c.fragmentShader).toMatch(/for \(float \w+ = 0\.0; \w+ < 4\.0; \w+\+\+\)/);
  });

  it('carries every variable the body changes, in any type', () => {
    const { groups } = groupsOf(by('13'));
    const sg = groups[0].params.subgraph as { outputPorts: { label: string; type: string }[] };
    expect(sg.outputPorts.map(p => `${p.label}:${p.type}`)).toEqual(['v:float', 'p:vec2', 'a:float']);
  });

  it('a stepped counter is the index scaled and offset', () => {
    const { r, groups } = groupsOf(by('14'));
    expect(groups[0].params.iterations).toBe(4);
    const sg = groups[0].params.subgraph as { nodes: { type: string; params: Record<string, unknown> }[] };
    expect(sg.nodes.find(n => n.type === 'multiply')?.params.b).toBe(2);
    expect(sg.nodes.find(n => n.type === 'add')?.params.b).toBe(1);
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
  });

  it('a branch inside the loop is a ternary block inside the group', () => {
    const { groups } = groupsOf(by('15'));
    const sg = groups[0].params.subgraph as { nodes: { type: string }[]; outputPorts: { label: string }[] };
    expect(sg.nodes.some(n => n.type === 'exprNode')).toBe(true);
    expect(sg.outputPorts.map(p => p.label).sort()).toEqual(['col', 'w']);
  });

  it('a loop with an early exit, or too many iterations, stays code', () => {
    const { r, groups } = groupsOf(by('11'));
    expect(groups).toHaveLength(0);
    expect(r.report.regions.map(x => x.why).join(' ')).toMatch(/loop/);
    const many = glslToGraph('void main(){ float s = 0.0; for (int i = 0; i < 40; i++) { s += 0.01; } gl_FragColor = vec4(vec3(s), 1.0); }');
    expect(many.nodes.filter(n => n.type === 'group')).toHaveLength(0);
    expect(many.report.regions).toHaveLength(1);
  });
});

describe('what a pasted shader brings along', () => {
  const ok = (src: string) => { const r = glslToGraph(src); expect(r.report.unsupported).toEqual([]); const c = compileGraph({ nodes: r.nodes }); expect(c.errors ?? []).toEqual([]); return { r, c }; };

  it('const globals: values for main() and blocks, text for regions, one Constants card for the named numbers', () => {
    const { r, c } = ok('const float SIZE = 0.3;\nconst vec2 PAD = vec2(0.6, 0.4);\nconst float PI = 3.14159265;\nfloat cell(vec2 p) { return length(mod(p, SIZE + PAD.x) - PAD) - SIZE * 0.5; }\nvoid main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; float d = cell(uv * 4.0) * PI; float k = SIZE; gl_FragColor = vec4(vec3(d + k), 1.0); }');
    const cards = r.nodes.filter(n => n.type === 'constants');
    expect(cards).toHaveLength(1);
    const items = cards[0].params.items as Array<{ key: string; value: number; slider: boolean }>;
    expect(items.map(i => i.key)).toContain('SIZE');
    expect(items.every(i => i.slider === false)).toBe(true);
    // The region's text has the consts; PI is renamed so it can't clash with the compiled shader's macro.
    const region = r.nodes.find(n => n.type === 'customFn')!;
    expect(String(region.params.glslFunctions)).toMatch(/const float SIZE = 0\.3;/);
    expect(c.fragmentShader).toMatch(/PI_/);
    expect(c.fragmentShader).not.toMatch(/const float PI =/);
  });

  it('a call with out arguments: one region returning the results packed, blocks pulling them apart', () => {
    const { r, c } = ok('vec3 pattern(vec2 p, float t, out float field, out vec2 grad) { field = length(p) * t; grad = p * 2.0; return vec3(field, grad); }\nvoid main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; float field; vec2 grad; vec3 col = pattern(uv, u_time, field, grad); col += vec3(field) * grad.x; gl_FragColor = vec4(col, 1.0); }');
    const regions = r.nodes.filter(n => n.type === 'customFn');
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions.some(g => String(g.params.body).includes('float field = 0.0;') && String(g.params.body).includes('vec2 grad = vec2(0.0);'))).toBe(true);
    expect(r.report.regions.map(x => x.why).join(' ')).toMatch(/pattern\(\) with field, grad as out arguments/);
    expect(c.fragmentShader).not.toMatch(/__r/);
  });

  it('overloaded helpers all come along, and a helper named like a built-in is renamed', () => {
    const { r, c } = ok('vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }\nvec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }\nfloat smin(float a, float b, float k) { return a + b - sqrt((a - b) * (a - b) + k); }\nfloat n(vec3 p) { vec4 q = mod289(vec4(p, 1.0)); vec3 r = mod289(p); return smin(q.x, r.y, 0.5); }\nvoid main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; gl_FragColor = vec4(vec3(n(vec3(uv, u_time))), 1.0); }');
    const region = r.nodes.find(n => n.type === 'customFn')!;
    const helpers = String(region.params.glslFunctions);
    expect(helpers).toMatch(/vec3 mod289\(vec3/);
    expect(helpers).toMatch(/vec4 mod289\(vec4/);
    expect(helpers).toMatch(/float smin_\(/);
    expect(r.report.notes.join(' ')).toMatch(/Renamed smin/);
    expect(c.fragmentShader).toMatch(/smin_\(/);
  });

  it('numbers fold into the sockets’ own sliders; three in 0..1 are a Color card; a named number is a fixed constant', () => {
    const { r } = ok('void main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; float ang = 5.0; vec3 tint = vec3(0.98, 0.96, 0.93); float m = smoothstep(0.1, 0.4, uv.x * ang); gl_FragColor = vec4(tint * m, 1.0); }');
    expect(r.nodes.filter(n => n.type === 'constant')).toHaveLength(0);
    expect(r.nodes.filter(n => n.type === 'colorPicker')).toHaveLength(1);
    expect(r.nodes.find(n => n.type === 'colorPicker')!.params.color).toEqual([0.98, 0.96, 0.93]);
    const card = r.nodes.find(n => n.type === 'constants')!;
    expect((card.params.items as Array<{ key: string; value: number; slider: boolean }>)).toEqual([{ key: 'ang', label: 'ang', type: 'float', value: 5, slider: false }]);
    expect(card.outputs.ang).toMatchObject({ type: 'float' });
    const smooth = r.nodes.find(n => n.type === 'smoothstep')!;
    expect(smooth.params).toMatchObject({ edge0: 0.1, edge1: 0.4 });
  });

  it('reads a Shadertoy paste through the shared translator and says so', () => {
    const { r } = ok('void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.y; fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0); }');
    expect(r.report.notes.join(' ')).toMatch(/Read as Shadertoy/);
    expect(r.report.blocks.map(b => b.code).join(' ')).not.toMatch(/vec3\(resolution, 1\.0\)\.y/);
  });

  it('prunes what nothing reads', () => {
    const { r } = ok('const float UNUSED = 2.0;\nvoid main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; float dead = uv.x * 3.0; gl_FragColor = vec4(vec3(uv.y), 1.0); }');
    expect(r.nodes.some(n => n.type === 'constants')).toBe(false);
    expect(r.nodes.filter(n => n.type === 'multiply')).toHaveLength(0);
  });
});

describe('inexact nodes are offered with a warning, or kept as code on request', () => {
  const src = 'void main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; float k = uv.x - 0.5; float v = 0.1 / k; gl_FragColor = vec4(vec3(v), 1.0); }';
  it('warns and marks the node', () => {
    const r = glslToGraph(src);
    expect(r.report.warnings).toHaveLength(1);
    expect(r.report.warnings[0].why).toMatch(/Divide node guards/);
    const n = r.nodes.find(x => x.id === r.report.warnings[0].nodeId)!;
    expect(n.type).toBe('divide');
    expect(n.params.__importWarning).toBeTruthy();
    expect(r.report.blocks).toHaveLength(0);
  });
  it('becomes a block when asked, keeping the same warning id', () => {
    const first = glslToGraph(src);
    const r = glslToGraph(src, { asBlock: new Set([first.report.warnings[0].id]) });
    expect(r.report.warnings[0].id).toBe(first.report.warnings[0].id);
    expect(r.report.warnings[0].nodeId).toBeUndefined();
    expect(r.report.blocks.map(b => b.code)).toEqual(['0.1 / k']);
    expect(r.nodes.find(n => n.type === 'exprNode')!.params.__importedCode).toBe('block');
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
  });

  it('expands #defines without their trailing comments, function-like ones with arguments, and leaves flags alone', () => {
    const r = glslToGraph('#define W 2. // frequency\n#define FLAG\n#define SQ(x) ((x)*(x))\n#define N(U,T) (U + (T).x)\nvoid main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; gl_FragColor = vec4(vec3(sin(N(SQ(uv.x), vec2(W, 0.0)) + u_time)), 1.0); }');
    expect(r.report.notes.some(n => /3 #defines expanded/.test(n))).toBe(true);
    expect(r.nodes.length).toBeGreaterThan(0);
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
  });

  it('reads arrays as named slots, unrolls a loop that indexes by its counter, and narrows and part-swizzles vectors', () => {
    const r = glslToGraph('void main(){ vec3 p[3]; p[0] = vec3(0.2, 0.3, 0.4); p[1] = vec3(0.5); p[2] = vec3(0.1, 0.2, 0.9); vec2 s = vec2(0.0); for (int i = 0; i < 3; i++) { s += vec2(p[i]) * float(i) + p[i].zx; } gl_FragColor = vec4(s, p[2].z, 1.0); }');
    expect(r.report.unsupported).toEqual([]);
    expect(r.report.notes.some(n => /Loop over i \(3×\) unrolled/.test(n))).toBe(true);
    expect(r.report.stats.loops).toBe(1);
    expect(r.nodes.some(n => n.type === 'group')).toBe(false); // unrolled, not an iterated group
    const c = compileGraph({ nodes: r.nodes });
    expect(c.errors ?? []).toEqual([]);
    expect(c.success).toBe(true);
    // Limits are said plainly
    expect(glslToGraph('void main(){ float a[3]; int k = int(u_time); a[k] = 1.0; gl_FragColor = vec4(a[0]); }').report.unsupported.some(u => /indexed by a value/.test(u))).toBe(true);
    expect(glslToGraph('void main(){ float a[2]; gl_FragColor = vec4(a[5]); }').report.unsupported.some(u => /outside the array/.test(u))).toBe(true);
  });
});
