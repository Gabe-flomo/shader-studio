/**
 * passExamplesMore.ts — Passes 2 to 5 (docs/pass-node-plan.md): particles
 * born on edges, feedback trails, reaction-diffusion and a glow of the bright
 * parts only. Built from the node definitions (graphBuilder.ts) and listed in
 * the Passes folder after Passes 1 · Edge glow (passExamples.ts).
 *
 * Every node carries a plain-language comment saying what it does and why it
 * is there; an Expression Block's comment explains each named line
 * ("name: …"). The comments land in the generated code too.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import type { PlayRecord } from '../types/play';
import { ctl, n } from './graphBuilder';
import { growPictureNodes } from './agentExamplesP3';

export const PASS_EXAMPLE_INDEX_MORE: Record<string, { label: string; description: string; play: true }> = {
  passParticleEdges: {
    label: 'Passes 2 · Particles born on edges', play: true,
    description: 'Glowing blobs drift in the dark; a Pass holds the picture, Edges (texture) finds their outlines, a second Pass holds the outlines, and a Particles node is born on them (its Emit from socket): sparks peel off the edges and rise.',
  },
  passFeedbackTrails: {
    label: 'Passes 3 · Feedback trails', play: true,
    description: 'Three lights draw trails that fade and drift: a Pass reads its own picture from the frame before (its Previous output) a little zoomed and turned, dims it and adds the lights again. Feedback per Pass, in the same frame.',
  },
  passReactionDiffusion: {
    label: 'Passes 4 · Reaction-diffusion', play: true,
    description: 'Gray-Scott reaction-diffusion grown in a half-size Pass: each frame it reads its own state from the frame before, spreads it (Blur (texture) as the neighbours), reacts the two chemicals and stores the result. A wandering seed draws coral that keeps growing.',
  },
  passGlowBright: {
    label: 'Passes 5 · Glow only the bright parts', play: true,
    description: 'A neon sign on a brick wall: only what is brighter than Threshold (the tubes) is kept, drawn into a half-size Pass, blurred twice and added back over the picture. The notes show how to inspect a pass: the eye, a selected card\'s values, Show passes and the per-pass rows in Performance.',
  },
  passSlimeEdges: {
    label: 'Passes 6 · Slime along edges', play: true,
    description: 'An Agents group that senses a Pass: a picture is drawn into a Pass, Edges (texture) finds its outlines, and those outlines are the slime\'s food (painted into its Trail field) and where its walkers are born, so a million walkers trace the picture\'s edges in living veins.',
  },
};

/** A node comment (shown on the card's Comment tab and, as // lines, in the generated code). */
const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

function playRecord(controls: PlayRecord['controls'], notes: string): PlayRecord {
  return { version: 1, controls, mappings: [], layers: [], notes };
}

/**
 * An Expression Block: named inputs (wired as given), lines `type name = rhs`, a result. Its note
 * must explain every named line as "name: …" (the examples test checks it).
 */
function expr(id: string, x: number, y: number, o: {
  label: string; outputType: 'float' | 'vec2' | 'vec3';
  inputs: Array<[name: string, type: 'float' | 'vec2' | 'vec3', from: [string, string]]>;
  lines: Array<[lhs: string, rhs: string]>;
  result: string; note: string[];
}): GraphNode {
  const node = n('exprNode', id, x, y, {
    label: o.label,
    inputs: o.inputs.map(([name, type]) => ({ name, type, slider: null })),
    outputType: o.outputType,
    lines: o.lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
    result: o.result, expr: o.result,
    ...note(o.note),
  });
  node.inputs = Object.fromEntries(o.inputs.map(([name, type, from]) => [name, { type, label: name, connection: { nodeId: from[0], outputKey: from[1] } }]));
  node.outputs = { result: { type: o.outputType, label: 'Result' } };
  return node;
}

const uvNode = (x: number, y: number, what: string) => n('uv', 'uv', x, y, note(`UV: this pixel's place in the picture (centred: a picture height is 2, x runs across by the aspect). ${what}`));
const outNode = (x: number, y: number, from: [string, string], what: string) => n('output', 'out', x, y, note(`Output: ${what}`), { color: from });

export function buildPassExamplesMore(): Record<string, ExampleGraph> {
  const graphs: Record<string, ExampleGraph> = {};

  // ── 2 · Particles born on edges: picture → Pass A → Edges → Pass B → Particles (Emit from) ──
  graphs.passParticleEdges = {
    ...PASS_EXAMPLE_INDEX_MORE.passParticleEdges,
    counter: 40,
    nodes: [
      uvNode(40, 240, 'The blobs below are drawn at it.'),
      expr('blobs', 300, 220, {
        label: 'Drifting blobs', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [
          ['vec2 a', 'vec2(sin(t * 0.31), cos(t * 0.23)) * vec2(1.0, 0.4)'],
          ['vec2 b', 'vec2(cos(t * 0.21 + 2.0), sin(t * 0.35 + 1.0)) * vec2(1.1, 0.42)'],
          ['vec2 c', 'vec2(sin(t * 0.17 + 4.0), sin(t * 0.27 + 3.0)) * vec2(0.85, 0.3)'],
          ['float field', '0.045 / dot(uv - a, uv - a) + 0.035 / dot(uv - b, uv - b) + 0.03 / dot(uv - c, uv - c)'],
          ['float inside', 'smoothstep(0.95, 1.05, field)'],
          ['vec3 fill', 'vec3(0.34, 0.05, 0.03)'],
          ['vec3 back', 'vec3(0.02, 0.025, 0.05) * (1.4 - 0.6 * length(uv))'],
        ],
        result: 'mix(back, fill, inside)',
        note: [
          'What: the picture whose outlines the particles are born on: three soft blobs (metaballs) that drift and merge, in lava colours on a dark backdrop. Any picture works here: a Texture Input, a Video, a 3D scene.',
          'Why an Expression Block: a metaball field is one formula; as cards it would be a dozen.',
          't is the clock (the block reads Time itself), so the blobs move.',
          'a: the first blob\'s centre, on a slow loop round the picture.',
          'b: the second blob\'s centre, on a different loop so they meet and part.',
          'c: the third blob\'s centre.',
          'field: how much blob is here: each centre adds its strength over the squared distance, so close blobs melt into one.',
          'inside: 1 inside the blobs (field above 1), 0 outside, with a soft edge one pixel or two wide. Its outline is what Edges finds.',
          'fill: the blobs\' colour, one flat dark red: a gradient inside would have edges of its own, and the sparks should come only off the outlines.',
          'back: the dark backdrop, a little lighter in the centre.',
          'result: the backdrop with the blobs over it.',
        ],
      }),
      n('pass', 'passPicture', 620, 220, { label: 'Pass A · picture',
        ...note('Pass A draws the picture into a texture of its own first, so Edges can read the pixels round each one (inside one shader a node only sees its own pixel). It is also read back below as the picture under the sparks, so the blobs are drawn once.') },
        { color: ['blobs', 'result'] }),
      n('edgesTexture', 'edges', 880, 220, { strength: 4, width: 1.5,
        ...note('Edges (texture) reads Pass A at the 8 pixels round this one (a 3×3 Sobel on brightness): Edges is 1 on the blobs\' outlines and 0 on flat colour. Width is how far apart the reads are, in picture pixels; Strength turns faint edges up.') },
        { texture: ['passPicture', 'texture'] }),
      n('floatToVec3', 'edgeLines', 1140, 220, note('Float → Color: the edge strength as a grey colour (white lines on black), because a Pass stores a colour.'), { input: ['edges', 'edges'] }),
      n('pass', 'passEdges', 1400, 220, { label: 'Pass B · edges', scale: '0.5',
        ...note('Pass B holds the outlines as a texture: the particles\' Emit from samples it, so they are born where it is bright. Scale ½: a quarter of the pixels, and the lines come out a little softer and wider, easier to land on. It draws before the particles step each frame.') },
        { color: ['edgeLines', 'rgb'] }),
      n('gpuParticles', 'sparks', 1680, 300, {
        count: '1m', emitter: 'disk', emit: 'stream', life: 2.2, speed: 0.14, spread: 1, threshold: 0.3,
        gravity: -0.25, wind: 0.03, turbulence: 0.7, scale: 1.4, swirl: 0, attract: 0, drag: 1.3,
        size: 2, brightness: 7, palette: 'ember', colorBy: 'life', glow: 1.1, lights: '0',
        ...note([
          'Particles: a million sparks, born on the blobs\' outlines and flying off them.',
          'Emit from is wired to Pass B\'s Texture: each new particle tries random points of it and is born where it is bright, so they come off the edges as the blobs move. Image threshold (0.3) is how bright a place must be; brighter edges get more births.',
          'Speed sends each one off in a random direction (Spread 1); Gravity below 0 makes them rise like embers, Turbulence curls them, Life 2.2 s keeps them short. Brightness is high (7) because a particle that finds no outline to be born on waits for its next turn, so fewer are alive at once than the count says. Over is left empty: the Particles output (the sparks alone) is composited behind the blobs below.',
        ]),
      }, { emitFrom: ['passEdges', 'texture'] }),
      n('blurTexture', 'rimGlow', 1680, 620, { method: 'smooth', radius: 9,
        ...note('Blur (texture) spreads Pass B\'s outlines into a soft orange rim glow, so the blobs look hot at their edges where the sparks come from. Pass B is a texture already, and Smooth reads it in two small hidden passes.') },
        { texture: ['passEdges', 'texture'] }),
      expr('composite', 1960, 300, {
        label: 'Blobs over the sparks', outputType: 'vec3',
        inputs: [['picture', 'vec3', ['passPicture', 'color']], ['sparks', 'vec3', ['sparks', 'particles']], ['rim', 'vec3', ['rimGlow', 'color']]],
        lines: [
          ['float luma', 'dot(picture, vec3(0.299, 0.587, 0.114))'],
          ['float body', 'smoothstep(0.06, 0.1, luma)'],
          ['vec3 heat', 'rim.r * vec3(1.0, 0.42, 0.1) * 1.6'],
          ['vec3 behind', 'picture + sparks'],
        ],
        result: 'mix(behind, picture, body) + heat',
        note: [
          'What: lays the blobs over the sparks, so the half that fly inwards hide behind them and the sparks seem to peel off the outlines.',
          'picture: Pass A read back at this pixel (its Color output), so the blob formula isn\'t computed a second time.',
          'sparks: the Particles node\'s Particles output, the sparks\' light on its own.',
          'rim: the blurred outlines (Blur (texture) of Pass B).',
          'luma: the picture\'s brightness: the blobs are dark red, the backdrop nearly black.',
          'body: 1 on a blob, 0 on the backdrop, with a soft rim.',
          'heat: the rim glow tinted orange, as if the edges were hot.',
          'behind: the backdrop with the sparks added.',
          'result: the blob where there is one, the sparks over the backdrop everywhere else, and the hot rim over both.',
        ],
      }),
      outNode(2220, 300, ['composite', 'result'], 'the blobs with sparks peeling off their outlines. This program runs last, after Pass A, Pass B and the particles.'),
    ],
    play: playRecord([
      ctl('rise', 'sparks::gravity', 'Rise (negative: up)', -1, 1, 0.01),
      ctl('curl', 'sparks::turbulence', 'Turbulence', 0, 3, 0.01),
      ctl('life', 'sparks::life', 'Life', 0.2, 8, 0.1),
      ctl('edge', 'sparks::threshold', 'Edge threshold', 0, 1, 0.01),
      ctl('strength', 'edges::strength', 'Edge strength', 0, 10, 0.05),
    ], `**What it shows.** Particles born from a Pass. A picture is drawn into Pass A, Edges (texture) finds its outlines, Pass B holds them, and the Particles node's **Emit from** socket samples Pass B: every spark is born where the outlines are bright, so they peel off the blobs as they move.

**How it is built.** An Expression Block draws three drifting metaballs. Pass A stores them; Edges (texture) reads Pass A round each pixel; Float → Color makes the edge strength a colour; Pass B (½ size) stores the lines. The Particles node's Emit from is wired to Pass B's Texture; a last Expression Block lays the blobs (Pass A read back) over the sparks. Each frame Pass A and Pass B draw first, then the particles step (so births see this frame's edges), then the picture.

**Try.** Raise Edge threshold to keep only the strongest outlines; drop it to 0.05 for sparks off every soft edge too. Set Rise to 0 and Turbulence to 2 for smoke. Swap the blobs for a Texture Input or a Video (wire it into Pass A) to make a photo's outlines spark. Wire Pass B's Texture into Glow (texture) and add it over the output for glowing edges as well.`),
  };

  // ── 3 · Feedback trails: lights + (the frame before, zoomed, turned, faded) → Pass → itself ──
  graphs.passFeedbackTrails = {
    ...PASS_EXAMPLE_INDEX_MORE.passFeedbackTrails,
    counter: 40,
    nodes: [
      uvNode(40, 240, 'The lights are drawn at it and the warp below moves it.'),
      expr('lights', 300, 140, {
        label: 'Three lights', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [
          ['vec2 p1', 'vec2(sin(t * 1.3), sin(t * 1.7 + 1.0)) * vec2(0.75, 0.4)'],
          ['vec2 p2', 'vec2(sin(t * 0.9 + 2.0), cos(t * 1.1)) * vec2(0.6, 0.45)'],
          ['vec2 p3', 'vec2(cos(t * 1.5 + 4.0), sin(t * 0.8 + 3.0)) * vec2(0.8, 0.35)'],
          ['vec3 c1', 'vec3(1.0, 0.35, 0.12) * 0.0008 / (dot(uv - p1, uv - p1) + 0.0004)'],
          ['vec3 c2', 'vec3(0.15, 0.55, 1.0) * 0.0008 / (dot(uv - p2, uv - p2) + 0.0004)'],
          ['vec3 c3', 'vec3(0.85, 0.2, 1.0) * 0.0008 / (dot(uv - p3, uv - p3) + 0.0004)'],
        ],
        result: 'c1 + c2 + c3',
        note: [
          'What: three small lights that wander the picture on looping paths. They are this frame\'s fresh paint; the trails are what the Pass keeps of them.',
          't is the clock (the block reads Time itself).',
          'p1: where the orange light is now (a Lissajous loop).',
          'p2: where the blue light is now.',
          'p3: where the violet light is now.',
          'c1: the orange light\'s glow here: bright at its centre, falling off with the squared distance (above 1 in the middle, which the half-float Pass keeps).',
          'c2: the blue light\'s glow.',
          'c3: the violet light\'s glow.',
          'result: the three added together.',
        ],
      }),
      n('constant', 'swirl', 40, 460, { value: 0.006, label: 'Swirl',
        ...note('How far the old picture turns each frame, in radians: the trails spiral. A constant (not a slider inside the block) so Play can drive it: see the Swirl control.') }),
      expr('drift', 300, 420, {
        label: 'Drift the old picture', outputType: 'vec2',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['swirl', 'float', ['swirl', 'value']]],
        lines: [
          ['vec2 zoomed', 'uv * 0.993'],
          ['vec2 turned', 'vec2(zoomed.x * cos(swirl) - zoomed.y * sin(swirl), zoomed.x * sin(swirl) + zoomed.y * cos(swirl))'],
          ['vec2 wobble', '0.0015 * vec2(sin(uv.y * 9.0 + t), cos(uv.x * 9.0 - t))'],
        ],
        result: 'turned + wobble',
        note: [
          'What: where to read last frame\'s picture for this pixel. Reading a little nearer the centre, turned a little, makes the old picture grow outwards and spiral each frame: the trails drift instead of sitting still.',
          'zoomed: this pixel pulled 0.7% towards the centre (reading inwards pushes the picture out).',
          'turned: that point turned by Swirl (a 2D rotation), so the trails curl.',
          'wobble: a tiny wavy push that changes with t, so the trails ripple like smoke.',
          'result: the point to read, wired into Sample (texture)\'s UV.',
        ],
      }),
      n('sampleTexture', 'echo', 620, 420, {
        ...note('Sample (texture) reads the Trails pass\'s Previous output (its own picture from the frame before) at the drifted point. This is the feedback: the Pass sees what it drew last frame.') },
        { texture: ['trails', 'previous'], uv: ['drift', 'result'] }),
      n('constant', 'decay', 620, 620, { value: 0.975, label: 'Decay',
        ...note('How much of last frame survives: 0.975 keeps 97.5% each frame, so a trail fades to half in about 27 frames. Closer to 1: longer trails. A constant so Play can drive it.') }),
      expr('feed', 900, 260, {
        label: 'Fade and add', outputType: 'vec3',
        inputs: [['fresh', 'vec3', ['lights', 'result']], ['old', 'vec3', ['echo', 'color']], ['decay', 'float', ['decay', 'value']]],
        lines: [
          ['vec3 faded', 'max(old * decay - 0.004, vec3(0.0))'],
          ['vec3 aged', 'faded * vec3(0.985, 0.995, 1.0)'],
        ],
        result: 'fresh + aged',
        note: [
          'What: the next picture for the Trails pass: last frame\'s, faded, with this frame\'s lights painted on top.',
          'faded: the old picture times Decay, minus a tiny bit, so it dies away completely (no haze builds up) unless the lights paint it again.',
          'aged: the faded picture cooled a little each frame (red fades first, then green), so old trails turn bluish as they fade.',
          'result: this frame\'s lights added over the aged trails.',
        ],
      }),
      n('pass', 'trails', 1180, 260, { label: 'Trails',
        ...note('Trails: the Pass that keeps the picture. What is wired into it is drawn into its texture; its Previous output (read by Sample (texture) on the left) hands that picture back next frame, which closes the loop. Half float, so the bright cores above 1 aren\'t clipped while they fade.') },
        { color: ['feed', 'result'] }),
      expr('tone', 1440, 260, {
        label: 'Soft highlights', outputType: 'vec3',
        inputs: [['hdr', 'vec3', ['trails', 'color']]],
        lines: [['vec3 soft', 'hdr / (1.0 + hdr * 0.5)']],
        result: 'pow(soft, vec3(0.85))',
        note: [
          'What: brings the trails\' bright parts (above 1) back into range smoothly, so the lights\' cores don\'t flatten to white.',
          'hdr: the Trails pass at this pixel (its Color output).',
          'soft: a gentle roll-off: dim values stay as they are, bright ones bend down towards 2.',
          'result: a slight lift of the mid-tones, so the faint ends of the trails show.',
        ],
      }),
      outNode(1700, 260, ['tone', 'result'], 'the trails, toned. The Trails pass draws first each frame; this program reads it.'),
    ],
    play: playRecord([
      ctl('decay', 'decay::value', 'Decay (trail length)', 0.8, 0.995, 0.001),
      ctl('swirl', 'swirl::value', 'Swirl', -0.03, 0.03, 0.0005),
    ], `**What it shows.** Feedback in a Pass. The Trails pass reads its own picture from the frame before (its **Previous** output), warps it a little, fades it and adds three moving lights on top. What it draws comes back next frame, so the lights leave trails that drift, spiral and cool as they fade.

**How it is built.** Three lights (an Expression Block) are this frame's paint. Drift the old picture computes where to read last frame's picture (a little nearer the centre and turned by Swirl); Sample (texture) reads the Trails pass's Previous there. Fade and add multiplies it by Decay and adds the lights; that goes into the Trails pass, whose Previous closes the loop. Soft highlights tones the result for the output.

**Try.** Decay 0.99 for long comet tails, 0.9 for short sparks. Swirl negative turns the other way; 0 makes them stream straight out. Set the Trails pass to ½ for softer, cheaper trails. Replace the lights with anything (a shape, a video, the mouse) and it leaves trails too.`),
  };

  // ── 4 · Reaction-diffusion (Gray-Scott) at ½: state from the frame before → step → Pass ──
  graphs.passReactionDiffusion = {
    ...PASS_EXAMPLE_INDEX_MORE.passReactionDiffusion,
    counter: 40,
    nodes: [
      uvNode(40, 520, 'The seed below is placed with it.'),
      n('sampleTexture', 'state', 300, 160, {
        ...note('Sample (texture) reads the chemicals at this pixel from the frame before: the Reaction-diffusion pass\'s Previous output. Red holds 1 − A (so a black, empty texture means A = 1 everywhere), green holds B.') },
        { texture: ['rd', 'previous'] }),
      n('blurTexture', 'neighbours', 300, 360, { method: 'smooth', radius: 2,
        ...note('Blur (texture) averages the same Previous over a small disc round this pixel (2 picture pixels, one texel at ½): the neighbours. Neighbours minus this pixel is how the chemicals spread (the Laplacian).') },
        { texture: ['rd', 'previous'] }),
      expr('seed', 300, 560, {
        label: 'Seed', outputType: 'float',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [
          ['vec2 at', 'vec2(sin(t * 0.31), sin(t * 0.43 + 1.0)) * vec2(0.8, 0.45)'],
          ['float wander', 'smoothstep(0.035, 0.02, length(uv - at))'],
          ['float still', 'smoothstep(0.03, 0.015, length(uv - vec2(-0.5, 0.1))) + smoothstep(0.03, 0.015, length(uv - vec2(0.55, -0.2)))'],
        ],
        result: 'max(wander, still)',
        note: [
          'What: where chemical B is added, so the pattern has somewhere to start (an empty texture stays empty forever).',
          't is the clock (the block reads Time itself).',
          'at: a point wandering slowly round the picture.',
          'wander: a small dot at that point: the coral grows along its path.',
          'still: two dots that stay put and keep a pattern going even where the wanderer hasn\'t been.',
          'result: 1 inside either, 0 elsewhere.',
        ],
      }),
      n('constant', 'feed', 560, 620, { value: 0.0545, label: 'Feed',
        ...note('Feed (f): how fast A is topped up. With Kill it picks the pattern: 0.0545 / 0.062 grows coral, 0.0367 / 0.0649 splits into dots (mitosis), 0.078 / 0.061 makes worms. A constant so Play can drive it.') }),
      n('constant', 'kill', 560, 780, { value: 0.062, label: 'Kill',
        ...note('Kill (k): how fast B is removed. Small changes matter: try steps of 0.001. A constant so Play can drive it.') }),
      expr('step', 820, 300, {
        label: 'Gray-Scott step', outputType: 'vec3',
        inputs: [
          ['prev', 'vec3', ['state', 'color']], ['mean', 'vec3', ['neighbours', 'color']], ['seed', 'float', ['seed', 'result']],
          ['feed', 'float', ['feed', 'value']], ['kill', 'float', ['kill', 'value']],
        ],
        lines: [
          ['float a', '1.0 - prev.r'],
          ['float b', 'prev.g'],
          ['float lapA', '(1.0 - mean.r) - a'],
          ['float lapB', 'mean.g - b'],
          ['float react', 'a * b * b'],
          ['float na', 'a + lapA - react + feed * (1.0 - a)'],
          ['float nb', 'b + 0.5 * lapB + react - (kill + feed) * b + seed * 0.5'],
        ],
        result: 'vec3(1.0 - clamp(na, 0.0, 1.0), clamp(nb, 0.0, 1.0), 0.0)',
        note: [
          'What: one step of the Gray-Scott model. Two chemicals spread at different speeds; B eats A to make more B; A is fed in and B dies off. Where the balance is right, coral, dots or worms grow.',
          'a: chemical A here (stored as 1 − A in red).',
          'b: chemical B here (green).',
          'lapA: how A spreads: the neighbours\' A minus this pixel\'s, scaled to match a 3×3 Laplacian.',
          'lapB: the same for B.',
          'react: the reaction: B turns A into more B, a·b·b of it.',
          'na: next A: it spreads at full speed, is used up by the reaction and topped up by Feed.',
          'nb: next B: it spreads at half speed, grows by the reaction, dies at Kill + Feed, and is added where Seed is.',
          'result: both kept between 0 and 1, packed back as (1 − A, B, 0) for the Pass.',
        ],
      }),
      n('pass', 'rd', 1100, 300, { label: 'Reaction-diffusion', scale: '0.5',
        ...note('Reaction-diffusion: the Pass that holds the two chemicals, at ½ size (a quarter of the pixels, so cheaper, and the pattern\'s cells come out twice as big on screen). Its Previous output, read by Sample and Blur on the left, hands the state back next frame: one simulation step per frame. Half float keeps the small differences the model needs.') },
        { color: ['step', 'result'] }),
      expr('shade', 1360, 300, {
        label: 'Colour the coral', outputType: 'vec3',
        inputs: [['chem', 'vec3', ['rd', 'color']]],
        lines: [
          ['float b', 'chem.g'],
          ['float body', 'smoothstep(0.08, 0.3, b)'],
          ['vec3 deep', 'vec3(0.015, 0.03, 0.07)'],
          ['vec3 coral', 'mix(vec3(0.05, 0.5, 0.58), vec3(1.0, 0.5, 0.36), smoothstep(0.18, 0.36, b)) * (0.75 + 0.6 * b)'],
        ],
        result: 'mix(deep, coral, body)',
        note: [
          'What: turns the chemicals into colour: deep water where there is no B, a shifting palette where B grows.',
          'chem: the Reaction-diffusion pass at this pixel (its Color output), stretched from ½ size to the picture.',
          'b: chemical B, the pattern itself.',
          'body: 0 in empty water, 1 inside the pattern, with a soft rim.',
          'deep: the colour of the empty water.',
          'coral: teal where B is thin (the growing rims), coral pink where it is thick, a little brighter the more B there is.',
          'result: water where B is absent, coral where it grows.',
        ],
      }),
      outNode(1620, 300, ['shade', 'result'], 'the coloured pattern. The Reaction-diffusion pass steps first each frame; this program reads it.'),
    ],
    play: playRecord([
      ctl('feed', 'feed::value', 'Feed', 0.01, 0.1, 0.0005),
      ctl('kill', 'kill::value', 'Kill', 0.04, 0.075, 0.0005),
    ], `**What it shows.** A simulation that lives in a Pass. Gray-Scott reaction-diffusion needs each pixel's neighbours from the step before, which one shader can't see; a Pass with its **Previous** output gives exactly that. The pass runs at ½ size: a quarter of the work, and bigger cells on screen.

**How it is built.** Sample (texture) reads this pixel's chemicals from the frame before (the Reaction-diffusion pass's Previous); Blur (texture) averages its neighbours. The Gray-Scott step Expression Block spreads and reacts them and adds B where the Seed is; the result goes back into the pass. Colour the coral turns chemical B into colour for the output. One step a frame: the coral spreads a little every frame, following the wandering seed.

**Try.** Feed 0.0367 / Kill 0.0649 for dots that split (mitosis); 0.078 / 0.061 for worms; 0.03 / 0.055 for waves. Set the pass to ¼ for giant cells (and less work), or 1 for fine detail. Press ↺ (start over) to clear it and watch it grow again.`),
  };

  // ── 5 · Glow only the bright parts: picture → Pass A; keep > threshold → Pass B (½) → two blurs → over A ──
  graphs.passGlowBright = {
    ...PASS_EXAMPLE_INDEX_MORE.passGlowBright,
    counter: 40,
    nodes: [
      uvNode(40, 240, 'The neon sign below is drawn at it.'),
      expr('sign', 300, 220, {
        label: 'Neon sign', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [
          ['vec2 b', 'uv * vec2(5.0, 10.0) + vec2(step(1.0, mod(floor(uv.y * 10.0), 2.0)) * 0.5, 0.0)'],
          ['float mortar', 'smoothstep(0.06, 0.1, min(fract(b.x), fract(b.y))) * smoothstep(0.06, 0.1, min(1.0 - fract(b.x), 1.0 - fract(b.y)))'],
          ['vec3 wall', 'vec3(0.07, 0.035, 0.04) * (0.35 + 0.65 * mortar) * (1.1 - 0.5 * length(uv))'],
          ['float ring', 'abs(length(uv - vec2(-0.5, 0.08)) - 0.3)'],
          ['float wave', 'abs(uv.y + 0.02 - 0.11 * sin(uv.x * 8.0 - t * 1.6)) + max(abs(uv.x - 0.42) - 0.5, 0.0)'],
          ['float flick', '0.8 + 0.2 * step(0.35, fract(sin(floor(t * 9.0) * 12.9898) * 43758.5453))'],
          ['vec3 pink', 'vec3(1.0, 0.18, 0.55) * smoothstep(0.014, 0.004, ring) * 4.0 * flick'],
          ['vec3 cyan', 'vec3(0.15, 0.8, 1.0) * smoothstep(0.014, 0.004, wave) * 4.0'],
        ],
        result: 'wall + pink + cyan',
        note: [
          'What: a neon sign on a dark brick wall: a pink ring and a cyan wave, their tubes 4 times brighter than white. The wall is dim, so only the tubes should glow.',
          't is the clock (the block reads Time itself).',
          'b: the picture scaled into bricks (5 across, 10 rows a picture height), every other row shifted half a brick.',
          'mortar: 1 on a brick\'s face, 0 in the thin mortar lines between bricks.',
          'wall: dark red-brown bricks with darker mortar, a little lighter in the middle.',
          'ring: how far this pixel is from the pink ring\'s line (0 on the tube).',
          'wave: how far it is from the cyan wave\'s line, which slides along with t; the max() cuts the wave to a stretch on the right.',
          'flick: the pink ring\'s flicker: now and then (a hash of the time, 9 times a second) it drops to 80%.',
          'pink: the pink tube: bright (4) within a hair of the ring, flickering.',
          'cyan: the cyan tube along the wave.',
          'result: the wall with both tubes over it.',
        ],
      }),
      n('pass', 'passPicture', 620, 220, { label: 'Pass A · picture',
        ...note('Pass A draws the picture into a texture first. Both the bright-parts pass and the final picture read it back, so the sign is computed once a frame. Half float keeps the tubes above 1, which is what Threshold measures.') },
        { color: ['sign', 'result'] }),
      n('constant', 'threshold', 620, 480, { value: 1, label: 'Threshold',
        ...note('Threshold: how bright a part must be to glow. 1 is white: only the neon tubes (above white) pass; 0.05 lets the bricks glow too. A constant so Play can drive it.') }),
      expr('bright', 880, 260, {
        label: 'Keep the bright parts', outputType: 'vec3',
        inputs: [['picture', 'vec3', ['passPicture', 'color']], ['threshold', 'float', ['threshold', 'value']]],
        lines: [
          ['float luma', 'dot(picture, vec3(0.299, 0.587, 0.114))'],
          ['float keep', 'smoothstep(threshold, threshold + 0.25, luma)'],
        ],
        result: 'picture * keep',
        note: [
          'What: the threshold: keeps only the parts of the picture brighter than Threshold and makes the rest black. Only these will glow.',
          'picture: Pass A at this pixel.',
          'luma: its brightness (the eye weights green most).',
          'keep: 0 below Threshold, 1 a quarter above it, a soft ramp between, so the glow doesn\'t flicker at the cut.',
          'result: the picture where it is bright, black elsewhere.',
        ],
      }),
      n('pass', 'passBright', 1140, 260, { label: 'Pass B · bright parts', scale: '0.5',
        ...note('Pass B stores only the bright parts, at ½ size. The two blurs after it read around each pixel, so they need it as a texture; at ½ they do a quarter of the work and come out softer. Turn on its eye (or Pass B\'s Color into the Output) to see what passes the threshold.') },
        { color: ['bright', 'result'] }),
      n('blurTexture', 'near', 1400, 160, { method: 'smooth', radius: 7,
        ...note('Blur (texture), narrow: a tight halo round each tube (7 picture pixels).') },
        { texture: ['passBright', 'texture'] }),
      n('pass', 'passSoft', 1400, 420, { label: 'Pass C · soft glow', scale: '0.125',
        ...note('Pass C stores the narrow halo again at ⅛ size: a 64th of the pixels. A wide blur of thin lines straight from Pass B would show its separate reads as ghost lines; read from the already-soft halo at ⅛, the same reach is a few texels and comes out smooth, for almost nothing. Passes chained like TouchDesigner TOPs.') },
        { color: ['near', 'color'] }),
      n('blurTexture', 'far', 1660, 420, { method: 'smooth', radius: 48,
        ...note('Blur (texture), wide: the soft bloom that spreads onto the wall (48 picture pixels, a smooth Gaussian), read from Pass C.') },
        { texture: ['passSoft', 'texture'] }),
      n('constant', 'glowGain', 1660, 640, { value: 1.6, label: 'Glow',
        ...note('Glow: how strong the glow is. A constant so Play can drive it.') }),
      expr('over', 1920, 260, {
        label: 'Glow over the picture', outputType: 'vec3',
        inputs: [['picture', 'vec3', ['passPicture', 'color']], ['near', 'vec3', ['near', 'color']], ['far', 'vec3', ['far', 'color']], ['gain', 'float', ['glowGain', 'value']]],
        lines: [
          ['vec3 glow', '(near * 0.6 + far * 1.8) * gain'],
          ['vec3 lit', 'picture + glow + picture * glow * 2.0'],
        ],
        result: 'lit / (1.0 + lit * 0.18)',
        note: [
          'What: adds the glow over the original picture (a composite; Blend Modes: Add or Add Colors work too).',
          'picture: Pass A at this pixel, the sharp original.',
          'near: the tight halo.',
          'far: the wide bloom, from Pass C.',
          'gain: the Glow constant.',
          'glow: both halos mixed (the wide one counts more: it is spread thinner), times Glow.',
          'lit: the picture with the glow added, plus the glow tinting the picture itself, as neon light falls on the bricks next to it.',
          'result: a soft roll-off so the tubes\' cores don\'t clip to flat white.',
        ],
      }),
      outNode(2180, 260, ['over', 'result'], 'the picture with only its bright parts glowing. Pass A, Pass B and Pass C draw first; this program reads them.'),
    ],
    play: playRecord([
      ctl('threshold', 'threshold::value', 'Threshold', 0, 3, 0.01),
      ctl('glow', 'glowGain::value', 'Glow', 0, 5, 0.05),
      ctl('wide', 'far::radius', 'Bloom width', 0, 64, 0.5),
    ], `**What it shows.** Glow only the bright parts, in the same frame: the picture goes into Pass A; an Expression Block keeps what is brighter than Threshold; Pass B (½) stores that; Blur (texture) spreads it into a tight halo, Pass C (⅛) stores the halo and a second Blur (texture) spreads that into a wide bloom; both are added back over Pass A. The older Bloom reads last frame's picture; this one is the frame you see.

**How to inspect a pass.** Every Pass is a texture you can look into:
- Turn on the **eye** on *Keep the bright parts* (or on Pass B) to see only what passes the threshold; on *far* to see the bloom alone. The eye works on any card, inside a pass or after it.
- **Select a card** to read its values at the picture's centre, even inside a pass (it is read from that pass's program).
- The **Pass card** shows its texture live, its size in pixels and its GPU time.
- **Show passes** (the layers button on the graph's toolbar) rings each card in the colour of the program it runs in: Pass A, Pass B or the picture.
- The **Performance** panel (the ms badge on the toolbar) has a row per pass (*Pass B · bright parts (½)*, *Pass C · soft glow (⅛)*) with its GPU time, and *Measure* times every node across all the programs.
- **Show passes** also stripes *near*: it runs in two programs (Pass C's and the picture's), so it is computed twice. That is fine here (it is small); for a heavy node, read it back from a Pass instead.

**Try.** Threshold 0.05 lets the bricks glow too (everything blooms, the old look); 3 keeps only the tubes' cores. Raise Bloom width for a hazy night. Set Pass C to ¼ for a tighter bloom. Swap the sign for a Texture Input (a night photo) and push Threshold until only its lights glow.`),
  };

  // ── 6 · Slime along edges: the Grow toward a picture slime, fed by a Pass's edges ──
  graphs.passSlimeEdges = {
    ...PASS_EXAMPLE_INDEX_MORE.passSlimeEdges,
    counter: 60,
    nodes: slimeEdgesNodes(),
    play: playRecord([
      ctl('strength', 'gpEdges::strength', 'Edge strength', 0, 10, 0.05),
      ctl('width', 'gpEdges::width', 'Edge width', 0.5, 6, 0.25),
    ], `**What it shows.** An Agents group sensing a Pass. The slime from *Grow toward a picture* feeds on a picture's **outlines** instead of its bright parts: the picture is drawn into a Pass, Edges (texture) reads it round each pixel, and the edges are the food. The walkers smell it through their Trail field and are born on it, so the network traces the moon's rim, the ridge and the stars.

**How it is built.** Moonlit picture (or your Texture Input) → Picture → **Pass · picture**. **Edges (texture)** reads the Pass; Food is the edges' brightness squared. Food goes into Emit's Where ƒ (walkers are born on the outlines) and, through Food to trail, into the Trail field's Add every step. Inside the group the slime rule is unchanged (Sense → Crowding → Steer → Move). The look reads the Pass back for the colours. The Pass draws before the agents step each frame.

**Try.** Raise Edge width for bolder outlines (more food, thicker veins); Edge strength 1 keeps only the sharpest ones. Load a photo into the Texture Input and set Yours to 1 on Picture: the slime draws its contours. Turn on Show passes: the Pass is blue, the agents amber, the picture green.`),
  };

  return graphs;
}

/**
 * Grow toward a picture (agentExamplesP3.ts), fed by a Pass's edges: the picture goes into a Pass,
 * Edges (texture) reads it, and Food (Emit's births and the Trail's Add) is the edges instead of
 * the picture's brightness. Every node's note says so.
 */
function slimeEdgesNodes(): GraphNode[] {
  const nodes = growPictureNodes(0, 200);
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  const set = (id: string, input: string, from: [string, string]) => {
    const nd = byId.get(id)!;
    nd.inputs = { ...nd.inputs, [input]: { ...nd.inputs[input], connection: { nodeId: from[0], outputKey: from[1] } } };
  };
  const renote = (id: string, text: string[]) => { const nd = byId.get(id)!; nd.params = { ...nd.params, ...note(text) }; };
  const pass = n('pass', 'gpPass', 1050, 860, { label: 'Pass · picture',
    ...note('Pass: the picture drawn into a texture of its own first, so Edges (texture) can read the pixels round each one. The look below reads it back too, so the picture is computed once a frame. It draws before the agents step.') },
    { color: ['gpPic', 'result'] });
  const edges = n('edgesTexture', 'gpEdges', 1260, 860, { strength: 3, width: 1.5,
    ...note('Edges (texture): a 3×3 Sobel on the Pass\'s brightness. Its Color is the picture\'s own colour kept only on the outlines: the moon\'s rim, the ridge, the stars. That is the food. Width is how far apart its reads are (picture pixels).') },
    { texture: ['gpPass', 'texture'] });
  set('gpFood', 'c', ['gpEdges', 'color']);
  set('gpLook', 'c', ['gpPass', 'color']);
  renote('gpFood', [
    'Food (an Expression Block): how much there is to eat here: the outlines Edges (texture) found in the Pass, not the whole picture.',
    'bright: the edge colour\'s brightness (0 off the outlines). Result: bright² × 2, so strong edges feed far more than faint ones.',
    'It goes into Emit\'s Where ƒ (walkers are born on the outlines) and, through Food to trail, into the Trail field.',
  ]);
  renote('gpEmit', [
    'Emit, Shape Field: every walker is born where Food (wired into Where ƒ) is above Threshold (0.15): on the picture\'s outlines, which Edges (texture) found in the Pass.',
  ]);
  renote('gpTrail', [
    'Trail field: 1024 rows; spreads (3×3) and fades (half-life 0.05 s) every step. Channel 1 is the slime\'s own marks, channel 2 the food.',
    'Add: wired from Food to trail, the outlines are painted in every step (its step program reads the Pass), so the edges always smell and the network grows along them.',
  ]);
  renote('gpLook', [
    'Veins in the picture\'s colours (an Expression Block): the slime is coloured by the picture it traces, read back from the Pass.',
    'tint: the picture\'s hue at full brightness, mixed with a warm white so dark parts still show.',
    'bright: the picture\'s brightness here. veins: the trail\'s Amount in that tint, brighter where the picture is bright.',
    'Result: the veins over a faint ghost of the picture (5%).',
  ]);
  return [...nodes, pass, edges];
}
