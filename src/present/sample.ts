/**
 * sample.ts — the presentation the Present page offers first: ray marching
 * in eight steps, built from the Learn 3D lessons (and one Play example, to
 * show mappings). Every block type is in it, so it is also the page's end to
 * end test.
 */
import { snapshotExample } from './snapshot';
import { PRESENTATION_VERSION, newId, type Block, type InteractiveBlock, type Presentation, type PresentSource, type Step } from '../types/presentation';

export const SAMPLE_TITLE = 'Ray marching, step by step';

const RAY_LOOP = `float t = 0.0;                 // how far along the ray
for (int i = 0; i < 64; i++) {
  vec3 p = ro + t * rd;        // the point we have reached
  float d = length(p) - 0.8;   // the scene: one sphere
  if (d < 0.0005) break;       // close enough: a hit
  t += d;                      // the safe jump
}`;

export async function buildSamplePresentation(now = Date.now()): Promise<Presentation> {
  const keys = ['learn3dCamera', 'learn3dDistance', 'learn3dMarch', 'learn3dLight', 'learn3dCombine', 'playLfo', 'learn3dVolume', 'learn3dGI'] as const;
  const src: Record<string, PresentSource> = {};
  for (const k of keys) {
    const r = await snapshotExample(k);
    if (!r.ok) throw new Error(`${k}: ${r.error}`);
    src[k] = r.source;
  }
  const text = (markdown: string): Block => ({ type: 'text', id: newId('b'), markdown });
  const interactive = (k: string, markdown: string, controls: InteractiveBlock['controls'], more: Partial<InteractiveBlock> = {}): Block =>
    ({ type: 'interactive', id: newId('b'), source: src[k].id, markdown, controls, layout: 'side', aspect: '4:3', pointer: true, ...more });
  const step = (title: string, blocks: Block[], columns: 1 | 2 = 1): Step => ({ id: newId('s'), title, columns, blocks });
  const lightNode = src.learn3dLight.shader.nodes.find(n => n.id === 'lit');

  const steps: Step[] = [
    step('One ray per pixel', [
      text(`A ray marcher draws a 3D scene with no triangles. For every pixel it sends out a **ray**: a half-line that starts at the camera $\\mathbf{o}$ and heads off in a direction $\\mathbf{d}$.

$$
\\mathbf{p}(t) = \\mathbf{o} + t\\,\\mathbf{d}, \\qquad t \\ge 0
$$

Below, each pixel's direction $\\mathbf{d}$ is painted as a colour: more red is further toward $+x$, more green is up, more blue is toward $+z$. You are looking at the fan of rays itself.`),
      { type: 'render', id: newId('b'), source: src.learn3dCamera.id, aspect: '16:9', width: 'full', pointer: false, caption: 'March Camera’s Ray Dir, painted as colour' },
    ]),
    step('A shape is a distance', [
      interactive('learn3dDistance', `A sphere of radius $r$ is one line of maths: how far any point $\\mathbf{p}$ is from its surface.

$$d(\\mathbf{p}) = \\lVert \\mathbf{p} \\rVert - r$$

Negative inside, positive outside, zero on the surface (the white line). Move [[control:z]] to slide the sheet through the sphere, and [[control:r]] to grow it. The bands keep going where there is no surface at all: the distance exists everywhere.`, [
        { controlId: 'z', label: 'Slice depth', hint: 'Where the flat sheet cuts through 3D space', showMappings: true },
        { controlId: 'r', label: 'Radius r', showMappings: true },
      ]),
    ]),
    step('The march', [
      text(`A ray can't be tested against a shape directly, but the distance says how far away the nearest surface is, so the ray can safely jump exactly that far:

$$t_{i+1} = t_i + d(\\mathbf{o} + t_i\\,\\mathbf{d})$$

It stops when $d < \\varepsilon$ (a hit) or when it runs out of steps. The picture counts the jumps: rays aimed at the middle land in a few, rays that skim past the edge take the most.`),
      { type: 'render', id: newId('b'), source: src.learn3dMarch.id, aspect: '1:1', width: 'full', pointer: false, caption: 'Steps per pixel: dark is a few, yellow is all of them' },
    ], 2),
    step('The loop in code', [
      text('The whole idea fits in a few lines of GLSL. Line 6 is the safe jump from the last step.'),
      { type: 'code', id: newId('b'), language: 'glsl', code: RAY_LOOP, highlightLines: [[6, 6]], caption: 'A minimal march toward one sphere' },
    ]),
    step('Light is a dot product', [
      interactive('learn3dLight', `Where the ray stops, the surface faces along its **normal** $\\mathbf{n}$. With the sun in direction $\\mathbf{l}$, the brightness is

$$L = \\max(0,\\ \\mathbf{n}\\cdot\\mathbf{l})$$

1 facing the sun, 0 side-on or facing away. Move [[control:x]] and [[control:y]]: the bright side follows the sun.`, [
        { controlId: 'x', label: 'Sun left–right', showMappings: true },
        { controlId: 'y', label: 'Sun up–down', hint: 'Below −0.5 the sun is under the floor', showMappings: true },
        { controlId: 'c', label: 'Surface colour', showMappings: true },
      ]),
      ...(lightNode ? [{ type: 'code', id: newId('b'), language: 'glsl', from: { source: src.learn3dLight.id, node: lightNode.id }, caption: 'The Multi-Light node’s part of the generated shader' } as Block] : []),
    ]),
    step('Combining shapes', [
      interactive('learn3dCombine', `A scene with two shapes is still one distance: the distance to the *nearer* one, $\\min(d_1, d_2)$. A smooth minimum melts them together:

$$h = \\operatorname{clamp}\\!\\left(\\tfrac12 + \\tfrac{d_2 - d_1}{2k},\\,0,\\,1\\right),\\quad d = \\operatorname{mix}(d_2, d_1, h) - k\\,h\\,(1-h)$$

Raise [[control:k]] from 0 and watch the crease fill in, then turn the [[control:a]] to see the join from the side.`, [
        { controlId: 'k', label: 'Blend radius k', showMappings: true },
        { controlId: 'a', label: 'Camera angle', showMappings: true },
      ], { layout: 'stacked', aspect: '16:9' }),
    ]),
    step('Let the Play drive it', [
      interactive('playLfo', `A control doesn't have to be dragged. In a Play, a **mapping** can move it: an LFO, the mouse, a key, a MIDI knob. The badge under each slider says what drives it, and while something does, the slider follows on its own.

Here a sine breathes [[control:radius]] at a quarter of a cycle a second and a triangle sways [[control:x]].`, [
        { controlId: 'radius', label: 'Radius', showMappings: true },
        { controlId: 'x', label: 'Position', showMappings: true },
        { controlId: 'tint', label: 'Tint', hint: 'A clock pulses its brightness on the beat', showMappings: true },
      ]),
    ]),
    step('Two ways to finish', [
      { type: 'render', id: newId('b'), source: src.learn3dVolume.id, aspect: '4:3', width: 'full', pointer: false, caption: 'Left, the loop stops at the surface; right, it walks through and glows' },
      { type: 'render', id: newId('b'), source: src.learn3dGI.id, aspect: '4:3', width: 'full', pointer: false, caption: 'Left, one light; right, GI: shadows, sky, bounce and reflections' },
      text(`The same march can end in different ways. A **volumetric** loop never stops at the surface: it adds a little light at every step, so the shape glows like a gas. A **GI** loop sends more rays from the hit point (toward the light for shadows, around it for occlusion, a bounce and a reflection), each one another march through the same scene.

Open any of these in the Studio from the source list to see how it's wired.`),
    ], 2),
  ];
  return { version: PRESENTATION_VERSION, title: SAMPLE_TITLE, steps, sources: keys.map(k => src[k]), createdAt: now, updatedAt: now };
}
