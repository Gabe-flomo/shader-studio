/**
 * agentsSample.ts — "How Agents work", the sample presentation about the
 * Studio's Agents group (docs/agents-group.md): what makes it different from
 * a picture graph, the loop, every node outside and inside the group, how
 * settings change the result, the presets, Play, and what the code does.
 *
 * The presets run live on the slides: the web player runs Agents groups
 * (kit/agentHost.js). Each source is the example as it is, with two changes
 * made here: a Play control for each setting a slide talks about (group
 * sliders are uniforms, so dragging one changes the next step without a
 * recompile). The presets run 256k walkers as they ship, light enough for
 * several canvases on one slide. The presets' stills (agentStills.ts)
 * stay as posters, shown while a canvas waits for its turn to run. The one
 * JavaScript copy left (store/agentSketches.ts) is on "The loop", for the
 * sensors of a few walkers, which the group can't draw. The GLSL quoted is
 * compiled from the presets each time the sample is built, so it is always
 * the code the app runs.
 */
import { blocks, linesBetween, presentation, sources, step } from './sampleKit';
import { snapshotFromGraph } from './snapshot';
import { compileGraph } from '../compiler/graphCompiler';
import { EXAMPLE_INDEX, loadExampleGraphs } from '../store/exampleIndex';
import { migrateLoadedNodes, migrateLoadedPlay } from '../store/useNodeGraphStore';
import { parsePlayRecord, type PlayControl } from '../types/play';
import { AG_TRAIL_FRAG } from '../play/kit/agentShaders.js';
import { newId, type Block, type Presentation, type PresentSource, type Step } from '../types/presentation';
import type { GraphNode } from '../types/nodeGraph';

export const AGENTS_TITLE = 'How Agents work';

const ctl = (id: string, target: string, label: string, min: number, max: number, step?: number): PlayControl =>
  ({ id, target, kind: 'float', label, min, max, ...(step ? { step } : {}) });

/** The Play controls each preset gets on the slides: the settings the text talks about. */
const SLIDE_CONTROLS: Record<string, PlayControl[]> = {
  slimeMold: [
    ctl('angle', 'slime::slimeSense::angle', 'Sense · Angle', 5, 90, 0.5),
    ctl('distance', 'slime::slimeSense::distance', 'Sense · Distance', 0.005, 0.15, 0.001),
    ctl('sat', 'slime::slimeCrowd::sat', 'Crowding · sat', 1, 300, 1),
    ctl('turn', 'slime::slimeSteer::turn', 'Steer · Turn', 0, 90, 0.5),
    ctl('jitter', 'slime::slimeSteer::jitter', 'Steer · Jitter', 0, 1, 0.01),
    ctl('speed', 'slime::slimeMove::speed', 'Move · Speed', 0.05, 1, 0.005),
    ctl('deposit', 'slimeDeposit::amount', 'Deposit · Amount', 0, 5, 0.05),
    ctl('halfLife', 'slimeTrail::halfLife', 'Trail · Half-life (s)', 0.005, 0.5, 0.005),
    ctl('diffuse', 'slimeTrail::diffuse', 'Trail · Diffuse', 0, 1, 0.01),
    ctl('steps', 'slime::stepsPerFrame', 'Steps per frame', 1, 8, 1),
  ],
  agentParticles: [
    ctl('curl', 'particles::ptCurl::strength', 'Curl noise · Strength', 0, 2, 0.01),
    ctl('curlSize', 'particles::ptCurl::size', 'Curl noise · Size', 0.2, 5, 0.05),
    ctl('evolve', 'particles::ptCurl::evolve', 'Curl noise · Evolve', 0, 1, 0.01),
    ctl('vortex', 'particles::ptSwirl::strength', 'Vortex · Strength', -1.5, 1.5, 0.01),
    ctl('attract', 'particles::ptMouse::strength', 'Attract (mouse) · Strength', -3, 3, 0.05),
    ctl('drag', 'particles::ptMove::drag', 'Integrate · Drag', 0, 6, 0.05),
    ctl('maxSpeed', 'particles::ptMove::maxSpeed', 'Integrate · Max speed', 0.2, 8, 0.1),
    ctl('life', 'ptEmit::life', 'Emit · Life (s)', 0.5, 12, 0.1),
  ],
  agentSoundBurst: [
    ctl('kick', 'burst::sbKick::strength', 'Sound kick · Strength', 0, 3, 0.01),
    ctl('beat', 'burst::sbKick::beat', 'Sound kick · Beat', 0, 200, 1),
    ctl('ring', 'burst::sbKick::speed', 'Sound kick · Ring speed', 0.2, 4, 0.05),
    ctl('drag', 'burst::sbMove::drag', 'Integrate · Drag', 0, 8, 0.05),
    ctl('curl', 'burst::sbCurl::strength', 'Curl noise · Strength', 0, 1.5, 0.01),
  ],
  agentAnts: [
    ctl('halfLife', 'antTrail::halfLife', 'Trail · Half-life (s)', 0.2, 10, 0.1),
    ctl('angle', 'ants::antSense::angle', 'Sense · Angle', 5, 90, 0.5),
    ctl('turn', 'ants::antSteer::turn', 'Steer · Turn', 0, 90, 0.5),
    ctl('jitter', 'ants::antSteer::jitter', 'Steer · Jitter', 0, 1, 0.01),
    ctl('steps', 'ants::stepsPerFrame', 'Steps per frame', 1, 8, 1),
  ],
};

/**
 * An example as a source for the slides, as it ships (256k walkers), with SLIDE_CONTROLS added to
 * its Play setup. It stays an example source, so Refresh takes the preset as it is (its own Play setup).
 */
async function slideSource(key: string): Promise<PresentSource> {
  const g = (await loadExampleGraphs())[key];
  if (!g) throw new Error(`agentsSample: no example ${key}`);
  const nodes: GraphNode[] = migrateLoadedNodes(g.nodes);
  const play = migrateLoadedPlay(parsePlayRecord(g.play ?? null), g.nodes);
  const extra = SLIDE_CONTROLS[key] ?? [];
  const r = snapshotFromGraph(nodes, { ...play, controls: [...play.controls, ...extra] }, { title: EXAMPLE_INDEX[key]?.label ?? g.label, from: { kind: 'example', key }, datasets: g.datasets });
  if (!r.ok) throw new Error(`${key}: ${r.error}`);
  return r.source;
}

/** A group's update shader, compiled from an example as the app compiles it: main() without the node notes. */
async function updateShader(key: string): Promise<{ lines: string[]; slugOf: (nodeId: string) => string }> {
  const all = await loadExampleGraphs();
  const g = all[key];
  if (!g) throw new Error(`agentsSample: no example ${key}`);
  const r = compileGraph({ nodes: migrateLoadedNodes(g.nodes) });
  const group = r.agents?.groups[0];
  if (!r.success || !group) throw new Error(`agentsSample: ${key} has no Agents group program`);
  const all_ = group.fragmentShader.split('\n');
  const start = all_.findIndex(l => l.startsWith('void main()'));
  const lines = all_.slice(start).filter(l => !/^\s*\/\//.test(l));
  const slugs = new Map(r.nodeSlugMap ?? []);
  return {
    lines,
    slugOf: id => { const s = slugs.get(id); if (!s) throw new Error(`agentsSample: ${key} has no node ${id}`); return s; },
  };
}

/** The lines from the first containing `from` to the first after it containing `to`. */
function cut(lines: string[], from: string, to: string): string[] {
  const a = lines.findIndex(l => l.includes(from));
  const b = lines.findIndex((l, i) => i > a && l.includes(to));
  if (a < 0 || b < 0) throw new Error(`agentsSample: no lines “${from}” … “${to}”`);
  return lines.slice(a, b + 1);
}

/** 1-based [first, last] of the lines that write a node's variables (`vec2 <slug>_p = …`, `<slug>_v *= …`). */
function rangeOf(lines: string[], slug: string): [number, number] {
  const writes = new RegExp(`^\\s*(?:(?:float|int|bool|vec[234]|mat[234]|uint)\\s+)?${slug}_\\w+\\s*(?:[-+*/]?=|,|;)`);
  const hits = lines.map((l, i) => (writes.test(l) ? i + 1 : 0)).filter(Boolean);
  if (!hits.length) throw new Error(`agentsSample: no lines for ${slug}`);
  return [hits[0], hits[hits.length - 1]];
}

const dedent = (lines: string[]) => {
  const pad = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)![0].length));
  return lines.map(l => l.slice(pad)).join('\n');
};

const GATE_TS = `// compiler/graphCompiler.ts: the one branch
export function compileGraph(graph) {
  if (hasPassNode(graph.nodes) || hasAgentsNode(graph.nodes))
    return compilePassGraph(graph);   // programs: passes, agents, the picture
  // …everything after this line is the compiler as it always was
}`;

export async function buildAgentsPresentation(now = Date.now()): Promise<Presentation> {
  const keys = [
    'agentRuleSlime',
    'slimeMold', 'agentParticles', 'agentCurlSmoke', 'agentSoundBurst', 'agentMultiSlime', 'agentAnts', 'agentBoids', 'agentStrands', 'agentGrowPicture',
    'agentsHandBeat',
  ] as const;
  // The sketch as it is; the presets at slide size, with their settings as controls.
  const src: Record<string, PresentSource> = await sources(['agentRuleSlime']);
  for (const k of keys) if (!src[k]) src[k] = await slideSource(k);
  // The stills made in the app, as posters: what a canvas shows until it runs.
  const { AGENT_STILLS } = await import('./agentStills');
  for (const k of keys) if (AGENT_STILLS[k]) src[k] = { ...src[k], poster: AGENT_STILLS[k] };
  const { text, render, interactive, glsl } = blocks(src);
  const live = (k: string, caption: string, width: 'full' | 'half' | 'third' = 'full') => render(k, caption, { width });

  // The real update shaders, compiled now from the presets.
  const slime = await updateShader('slimeMold');
  const slimeRule = cut(slime.lines, `${slime.slugOf('slimeSense')}_p =`, 'agentstepo_0_alive');
  const slimeMarks = ['slimeSense', 'slimeSteer', 'slimeMove'].map(id => rangeOf(slimeRule, slime.slugOf(id)));
  const parts = await updateShader('agentParticles');
  const partsRule = cut(parts.lines, `${parts.slugOf('ptCurl')}_q =`, `${parts.slugOf('ptMove')}_p = a_pos`);
  const partsMarks = ['ptCurl', 'ptSwirl', 'ptMouse', 'ptMove'].map(id => rangeOf(partsRule, parts.slugOf(id)));
  const preludeText = dedent(cut(slime.lines, 'void main()', 'vec2 g_uv = a_pos;'));
  const prelude = {
    text: preludeText,
    marks: [...linesBetween(preludeText, 'ivec2 a_tex', 'a_sB = texelFetch'), ...linesBetween(preludeText, 'a_pos = a_sA.xy', 'a_vel = a_sB.xy'), ...linesBetween(preludeText, 'vec2 g_uv = a_pos')],
  };
  const trailMain = AG_TRAIL_FRAG.slice(AG_TRAIL_FRAG.indexOf('void main()'));
  const js = (code: string, caption: string): Block => ({ type: 'code', id: newId('b'), language: 'js', code, caption });

  const steps: Step[] = [
    // 1 ─────────────────────────────────────────────────────────────────────
    step('A picture that remembers', [
      text(`Everywhere else in the Studio, a graph is a **picture rule**: it runs once for every pixel, every frame, and forgets. Nothing a pixel worked out is still there on the next frame.

The **Agents group** is a **simulation**. Inside it is a rule that runs once for every *walker*, every *step*, for up to four million walkers. Each walker keeps where it is, which way it faces and how old it is from one step to the next (and, when the rule asks, its kind, a little memory and its own colour). Walkers also leave a **trail** that stays, spreads and fades, so they can follow each other.

That's why it looks different on the canvas: the group has an inside you open (double-click it, or **Open rule ↗**), it has wire colours of its own, and one wire goes *backwards*: the trail feeds the walkers that made it.

**On these slides** the real presets run live, on the GPU, as they do in the Studio and on an exported page. They run 256k walkers, as the presets ship (raise Count for more), so several can run at once, and their settings are sliders: dragging one changes the next step, with no restart. Open any of them from **Examples → Simulation**.`),
      live('slimeMold', 'Slime mold, running: 262,144 walkers. Examples → Simulation → Slime mold'),
    ], 2),

    // 2 ─────────────────────────────────────────────────────────────────────
    step('The loop', [
      interactive('agentRuleSlime', `Every step, every walker does four things:

1. **Sense**: sniff the trail at three points ahead, left, centre and right.
2. **Steer**: turn toward the strongest smell.
3. **Move**: one step forward.
4. **Deposit**: drop a little trail where it stands.

Then the whole trail **spreads and fades**, and on the next step the walkers sense it again. More walkers on a path leave more trail, which pulls in more walkers: that feedback builds the veins.

This canvas is the same rule written out in a few dozen lines of JavaScript, on fewer walkers, because it can draw what the group can't: set [[control:sensors]] to 10 to see what ten walkers smell (the bright sensor won). [[control:steps]] is how many steps run each frame: the simulation's speed. Shorten [[control:halfLife]] and the veins thin out and wander.`, [
        ['sensors', 'Show the sensors of'], ['steps', 'Steps per frame'], ['halfLife', 'Trail half-life (s)'],
      ]),
      text(`**In the Studio** the loop is a wire: the Trail field's **Image** goes back into the Agents group (over the top of the cards between). It carries a small **↺ last step** chip, because inside the group the trail is always as it was one step before: every walker reads the same trail, then they all deposit at once.

Anywhere else (a Palette, a Glow, a Pass) the trail is as of this frame.`),
    ]),

    // 3 ─────────────────────────────────────────────────────────────────────
    step('Outside the group', [
      text(`Five nodes sit on the top level of the graph, around the group:

| Node | What it does | Settings that matter |
|---|---|---|
| **Agents** | The group. Its inside is the rule one walker follows every step. | Count (64k to 4M), Species, Steps per frame, Seed, Pre-roll; **Open rule ↗**, **↺ Start over** |
| **Emit** | Where walkers are born. | **Fill** (everyone at once), **Rate** (a stream), **Keep full** (born again when they die). Point, ring, disc, box, whole picture, **Picture**, **Field**. Facing, Speed ±, Spread, **Burst**, Species |
| **Deposit** | Each walker leaves trail where it stands, every step. | Amount. **What: Velocity** leaves its motion instead, so the trail becomes a flow field (Boids) |
| **Trail field** | The shared smell: it spreads (Diffuse) and fades (Half-life). | Resolution (½, ¼, full, or a fixed 512 / 1024 / 2048 rows), Spread 3×3 or 5×5, **Add** (food) and **Block** (walls). **Amount** colours the picture; **Image** goes back in |
| **Draw agents** | Draws the walkers themselves over a picture. | Points, Glow, Streaks, Ink; colour by species, speed, heading, age or **Agent**; Lights; Brightness of the crowd |

Slime colours the **trail** (Trail → Palette → Output). Particles draw the **walkers** (Draw agents → Output) and need no trail at all.`),
      live('agentGrowPicture', 'Grow toward a picture: Trail field Add paints food from a picture, Emit Field gives birth on it', 'half'),
    ]),

    // 4 ─────────────────────────────────────────────────────────────────────
    step('Inside: the slime rule', [
      interactive('slimeMold', `Double-click the group: this runs once for every walker, every step, left to right. The canvas is the Slime mold preset; its sliders are the nodes' own.

- **Agent Inputs** / **Agent Output**: the walker at the start and the end of the step. Agent Inputs lists **This walker** (its own values) and **From outside the group** (inputs you add, which are sockets on the Agents card: here the Trail). Anything unwired on Output stays "unchanged", so an empty group stands still.
- **Sense**: three points [[control:distance]] ahead, [[control:angle]] to each side. It reads a texture (the trail) and/or any chain of nodes wired into **Field ƒ**.
- **Crowding**: an ordinary Expression Block, $r\\,e^{-r/\\text{sat}}$ with sat = [[control:sat]]: trail that is very crowded smells *less* good.
- **Steer**, **Jones** mode: straight on if the centre wins, a random side if both sides beat it, otherwise [[control:turn]] toward the stronger side, plus a little [[control:jitter]]. (**Smooth** turns in proportion; **Away** runs from the strongest.)
- **Move**: one step at [[control:speed]]; Wrap, Bounce or Slide at the edges, and **Obstacle ƒ** to turn back from a shape.
- **By species**: one of four numbers, by the walker's kind.`, [
        ['distance', 'Sense · Distance'], ['angle', 'Sense · Angle'], ['sat', 'Crowding · sat'], ['turn', 'Steer · Turn'], ['jitter', 'Steer · Jitter'], ['speed', 'Move · Speed'],
      ]),
      glsl(dedent(slimeRule), 'The Slime mold preset’s rule, as the app compiles it: Sense, Steer and Move marked', slimeMarks),
      text(`**Unwired means this walker.** A socket left empty reads the walker's own position, heading or age, and the card says so in faint type ("← this walker's position"). And any ordinary node that would read the pixel's position reads the walker's instead, so noise, a shape's distance, Time, Audio or an Expression Block can join the rule (Crowding is one).

**What can't go inside**, and the card says why: nodes that read the previous frame (Echo, Previous Frame, the blurs, Bloom), since a walker is not a pixel; programs of their own (Pass, another Agents group, Trail, Deposit, Emit, Draw agents, the Particles node, the Output); ray marches (Scene Group, March Loop, GI March, Space Warp), too costly per walker; and anything that reads screen derivatives or gl_FragCoord.`),
    ], 2),

    // 5 ─────────────────────────────────────────────────────────────────────
    step('Particles: forces that add up', [
      interactive('agentParticles', `Particles use the same group with different nodes inside. Each **force** has a **+ Another force** input: wire them in a row and they add up, so the order doesn't matter, only which forces are in the chain. Then **Integrate** turns the total into motion and **Age / Life** ends each particle; Emit's **Keep full** gives it a new life on the ring.

Move over the picture: the mouse pulls and stirs. Try [[control:curl]] at 0 (only the swirl is left), a bigger [[control:curlSize]] for small tight eddies, [[control:vortex]] the other way, or [[control:attract]] below 0 to blow them away from the mouse. Raise [[control:drag]] for syrup, lower it for long loose flights.`, [
        ['curl', 'Curl noise · Strength'], ['curlSize', 'Curl noise · Size'], ['evolve', 'Curl noise · Evolve'], ['vortex', 'Vortex'], ['attract', 'Attract (mouse)'], ['drag', 'Integrate · Drag'], ['maxSpeed', 'Integrate · Max speed'], ['life', 'Emit · Life (s)'],
      ]),
      glsl(dedent(partsRule), 'The Particles preset’s chain as compiled: Curl noise, Vortex, Attract (each adding the one before), then Integrate', partsMarks),
      text(`**The forces:** Gravity, Wind (with gusts), Curl noise (currents that never bunch up), Attract / Repel (the mouse, a point, a hand or a null wired into Target), Vortex, Flow (up or round any field), Sound kick (Shockwave, Wave, Vibrate, Shake).

**Integrate:** velocity gains force × one step, Drag bleeds it, Max speed caps it, Mass divides the force; edges Free, Wrap, Bounce, Slide or Die.

**After Integrate:** **Collide** keeps walkers out of a shape (they slide round it); **Chladni** gathers them on a vibrating plate's still lines.

**Sound:** Sound kick and Chladni listen to **Sound from**: the Level slider (map audio to it in Play), the Mic, the Audio engine or one of its tracks, set on each node or once on the group for all of them. **Beat** is a silent stand-in kick that is part of the simulation, so a recording matches the preview.`),
      interactive('agentSoundBurst', `**Sound burst** is a Sound kick in the chain, on its silent [[control:beat]] (120 a minute): every beat a ring of pressure leaves the middle at [[control:ring]] and pushes the particles out as it passes, and a "Spring back" Expression Block pulls them home. Raise [[control:kick]] for harder blasts, [[control:drag]] to settle each one fast; set the beat to 0 and only the [[control:curl]] currents move them.`, [
        ['kick', 'Sound kick · Strength'], ['beat', 'Sound kick · Beat'], ['ring', 'Sound kick · Ring speed'], ['drag', 'Integrate · Drag'], ['curl', 'Curl noise · Strength'],
      ]),
    ], 2),

    // 6 ─────────────────────────────────────────────────────────────────────
    step('Each walker can remember', [
      interactive('agentAnts', `A walker can carry state of its own from step to step. Ants need one thing: **am I carrying food?** That's Agent Output's **Memory**.

Searching ants follow the food smell and lay the home smell; carrying ants follow the home smell and lay the food smell. Each one's **Deposit** is its own, weaker the longer it has walked, so short roads get the freshest smell and win. The rocks are Move's **Obstacle ƒ** (turn back) and the Trail's **Block** (no smell inside).

Roads are there from the start (the group's **Pre-roll** runs 20 seconds before the first frame), and they keep changing. Shorten [[control:halfLife]] to 0.1 and old detours fade sooner: the roads straighten and find the far pile. Lengthen it and old loops linger. Raise [[control:jitter]] for wider, busier roads; try [[control:angle]] and [[control:turn]] for how sharply ants follow a smell, and [[control:steps]] to speed it all up.`, [
        ['halfLife', 'Smell half-life (s)'], ['angle', 'Sense · Angle'], ['turn', 'Steer · Turn'], ['jitter', 'Steer · Jitter'], ['steps', 'Steps per frame'],
      ]),
      text(`**What a walker can keep:**

- **Species** (1 to 4), from Emit's Species setting, kept for life. Sense's Channels default to +1 for its own kind's trail and −0.5 for the others'.
- **Memory**: two numbers it sets and reads back next step (the ants' "carrying" and "seconds walked").
- **Deposit**: how much trail it leaves in each channel, so a rule can decide who marks what.
- **Colour**: its own colour, shown by Draw agents' **Colour by Agent**.

A group only gets this extra state when its rule uses it; otherwise it compiles exactly as before.`),
    ], 2),

    // 7 ─────────────────────────────────────────────────────────────────────
    step('Same rule, different results', [
      interactive('slimeMold', `Rules of thumb to try here (they are tendencies, not laws: the system is chaotic):

- [[control:distance]] sets the **scale**: further sensors, bigger cells.
- [[control:angle]] against [[control:turn]]: a sensor angle smaller than the turn keeps veins restless and looping; equal or wider gives calmer, rounder cells.
- [[control:jitter]] adds **wander**: more branching, less crisp lines.
- [[control:halfLife]] and [[control:diffuse]] decide how **long paths last** and how **thick** veins are.
- [[control:deposit]] is how loud each walker is; it works with Crowding's [[control:sat]]. With sat at 300 crowding hardly bites and the network **coarsens** into a few thick loops; lower, it keeps a living size.
- [[control:steps]] is **speed**.

**Count** (density) and **Species** are on the group card, not sliders: they size the simulation's textures, so changing one starts it again.`, [
        ['distance', 'Sense · Distance'], ['angle', 'Sense · Angle'], ['turn', 'Steer · Turn'], ['jitter', 'Steer · Jitter'], ['halfLife', 'Trail · Half-life'], ['diffuse', 'Trail · Diffuse'], ['deposit', 'Deposit · Amount'], ['sat', 'Crowding · sat'], ['steps', 'Steps per frame'],
      ]),
      text(`**For particles:** Curl noise's **Size** sets the eddies (bigger number, smaller swirls) and **Evolve** how fast the currents change; **Drag** decides between long loose flights and syrup; **Max speed** caps a blast. The chain's order never matters (forces add), but which forces you add does.

**Strands** is slime with far, narrow sensors and a small turn. **Multi-species slime** is slime with Species 3: three colonies that follow their own trail and avoid the others' carve the picture into **territories**. Same nodes, different numbers.`),
      live('agentMultiSlime', 'Multi-species slime: three colonies, each following its own trail'),
      live('agentStrands', 'Strands: sensors far and narrow, a small turn, ink on paper'),
    ], 2),

    // 8 ─────────────────────────────────────────────────────────────────────
    step('Recipes, and playing them', [
      text(`Every preset is in the node browser under **Generators → Simulation** (and in **Examples → Simulation**); each node it adds has a note on its card saying what it does and what to try.

| Preset | Recipe |
|---|---|
| **Slime mold** | Sense (trail) → Crowding → Steer (Jones) → Move (wrap); Fill from a disc facing out; trail → amber palette |
| **Particles** | Curl → Vortex → Attract (mouse) → Integrate; Keep full on a ring; Glow, Ember by age, four orbiting lights |
| **Curl smoke** | a “Rising heat” force that cools with age → Curl → Wind → Integrate; Ink streaks on paper |
| **Sound burst** | a “Spring back” force → Sound kick (Shockwave, Beat 120) → Curl → Integrate (bounce); Streaks by speed |
| **Multi-species slime** | three Emits (one per kind), By species speeds, one Deposit into a 3-channel trail |
| **Ants** | Memory (carrying), Deposit per ant, “Which smell” picks Sense’s channel, rocks as Obstacle ƒ and Block |
| **Boids** | Deposit Velocity into a soft 5×5 trail; Sample + a “Flock” block → Integrate; Streaks by heading |
| **Strands** | far, narrow sensors (0.06, 15°), Turn 12°, a slow curl drift into Move; Ink on warm paper |
| **Grow toward a picture** | food = brightness² added to the trail, Emit Field, Sense smells both channels |

**On the Play page** a group is an instrument like any graph:

- **Every slider inside is a Play control**: Map to…, MIDI learn, LFOs, nulls. Nothing recompiles.
- **Pin to the group card** puts an inner slider on the card, under a live thumbnail of the walkers.
- **Sound from** on the group: the Mic, the Audio engine or an engine track, for every Sound kick and Chladni inside.
- **Hands**: Attract's Target, Vortex's Centre and Emit's At take **A hand or null**; right-click Hand X → **Follow a hand in Play**.
- **Start over** and Emit's **Burst** are triggers, so a key or a beat can press them.
- **Motion (texture)** brings a Motion layer in: born where people move, or food that grows the slime toward them.

Try **Play → Agents in Play → Agents: a hand and a beat** (last picture).`),
      live('agentCurlSmoke', 'Curl smoke: warm air that cools as it rises, folded by curl noise and leaned over by a gusty wind'),
      live('agentBoids', 'Boids: every bird leaves its velocity in a flow field and matches the flow around it'),
      live('agentsHandBeat', 'Agents: a hand and a beat (Play): the pointer (or your hand, in the app) pulls the particles; in the app the engine’s kick track blasts them'),
    ], 2),

    // 9 ─────────────────────────────────────────────────────────────────────
    step('What the code does', [
      text(`**1. One branch.** \`compileGraph\` sends a graph with any Agents node to the multi-program path (the one Pass nodes use). Every other graph compiles exactly as before; the golden shader snapshots prove it.

**2. One shader per group.** The group's inside is compiled by the ordinary compiler into **one update shader**, drawn as a full-screen quad over the walkers' **state texture**: one fragment per walker.`),
      js(GATE_TS, 'The gate: nothing else in compileGraph changed'),
      text(`**3. State textures** (RGBA32F, ping-pong): **A** = position, heading, age; **B** = velocity, speed, life (≤ 0 is dead). That is the Particles engine's layout, so its drawing is reused. Positions are the picture's centred coordinates, so a noise or shape node inside reads the same place the picture shows. Groups that use species, memory, deposit or colour get **C** and **D** too.`),
      glsl(prelude.text, 'Start of the Slime mold update shader: one fragment is one walker, its state read from A and B', prelude.marks),
      text(`**4. A step** = every group's update (reading the trail as it was) → Deposit draws one point per walker, added into the trail → the trail spreads and fades. **A frame** = K steps → Draw agents → the picture.

**5. The clock.** A step is 1/60 s and the state depends only on the step number and the Seed, so a render matches the preview. When the GPU can't keep up, fewer steps run and the simulation falls behind; walkers are never dropped. The presets ship at 256k; a million slime walkers take about 5.8 ms a frame with a ½-size trail, a million particles about 7 ms, mostly drawing (M3 Pro).

**6. Sliders are uniforms.** Every slider on the Agents nodes is a uniform (\`u_p_<node>_<setting>\`, such as \`u_p_agentsteerx0_turn\` on step 4), so dragging it changes the next step without a recompile and the simulation keeps going. It can be a Play control or a mapping like any other slider.

**7. On a web page.** An exported page (and these slides) carries the same update shaders and runs them in its own WebGL2 (\`kit/agentHost.js\`, no three.js), with the schedule, Burst, Start over, what Sound kick hears and how Draw agents looks shared with the app's runner (\`kit/agentPlan.js\`), so the page steps the simulation the way the Studio does.

**8. Back from the GPU.** "Open as nodes" on a Particles node builds the same particles as a group; and a group reads like a layer in Play: how many are alive, where the crowd is, how spread out and fast, summed on the GPU only while something reads it, a frame or two late.

**Coming next:** 3D.`),
      glsl(trailMain, 'The trail’s step (fixed engine code): spread toward the 3×3 (or 5×5) mean, then fade by 2^(−dt / half-life)', linesBetween(trailMain, 'vec4 t = mix(')),
    ], 2),
  ];
  return presentation(AGENTS_TITLE, keys, src, steps, now);
}
