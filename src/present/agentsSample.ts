/**
 * agentsSample.ts — "How Agents work", the sample presentation about the
 * Studio's Agents group (docs/agents-group.md): what makes it different from
 * a picture graph, the loop, every node outside and inside the group, how
 * settings change the result, the presets, Play, and what the code does.
 *
 * Present canvases run the web player, which doesn't run Agents groups yet
 * (docs/agents-plan.md, P5). So the live canvases here are the "by hand"
 * Script examples (store/agentSketches.ts: the same rules in plain JS, with
 * every setting a control), and the real presets show as stills rendered in
 * the app (agentStills.ts), marked as stills by the canvas itself. The GLSL
 * quoted is compiled from the presets each time the sample is built, so it is
 * always the code the app runs.
 */
import { blocks, linesBetween, presentation, sources, step } from './sampleKit';
import { compileGraph } from '../compiler/graphCompiler';
import { loadExampleGraphs } from '../store/exampleIndex';
import { migrateLoadedNodes } from '../store/useNodeGraphStore';
import { AG_TRAIL_FRAG } from '../play/kit/agentShaders.js';
import { newId, type Block, type Presentation, type Step } from '../types/presentation';

export const AGENTS_TITLE = 'How Agents work';

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
    'agentRuleSlime', 'agentRuleParticles', 'agentRuleAnts',
    'slimeMold', 'agentParticles', 'agentCurlSmoke', 'agentSoundBurst', 'agentMultiSlime', 'agentAnts', 'agentBoids', 'agentStrands', 'agentGrowPicture',
    'agentsHandBeat',
  ] as const;
  const src = await sources(keys);
  // The presets as stills: pages can't run them yet, so each carries a picture made in the app.
  const { AGENT_STILLS } = await import('./agentStills');
  for (const k of keys) if (AGENT_STILLS[k]) src[k] = { ...src[k], poster: AGENT_STILLS[k] };
  const { text, render, interactive, glsl } = blocks(src);
  const still = (k: string, caption: string, width: 'full' | 'half' | 'third' = 'full') => render(k, caption, { width, pointer: false });

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

**On these slides** the moving pictures are small JavaScript copies of the rules, so you can change them live: pages like this one don't run Agents groups yet. Pictures of the real presets are stills; open them from **Examples → Simulation**.`),
      still('slimeMold', 'Slime mold: a million walkers on the GPU (still). Examples → Simulation → Slime mold'),
    ], 2),

    // 2 ─────────────────────────────────────────────────────────────────────
    step('The loop', [
      interactive('agentRuleSlime', `Every step, every walker does four things:

1. **Sense**: sniff the trail at three points ahead, left, centre and right.
2. **Steer**: turn toward the strongest smell.
3. **Move**: one step forward.
4. **Deposit**: drop a little trail where it stands.

Then the whole trail **spreads and fades**, and on the next step the walkers sense it again. More walkers on a path leave more trail, which pulls in more walkers: that feedback builds the veins.

Set [[control:sensors]] to 10 to see what ten walkers smell (the bright sensor won). [[control:steps]] is how many steps run each frame: the simulation's speed. Shorten [[control:halfLife]] and the veins thin out and wander.`, [
        ['sensors', 'Show the sensors of'], ['steps', 'Steps per frame'], ['halfLife', 'Trail half-life (s)'],
      ]),
      text(`**In the Studio** the loop is a wire: the Trail field's **Texture** goes back into the Agents group. It carries a small **↺ last step** chip, because inside the group the trail is always as it was one step before: every walker reads the same trail, then they all deposit at once.

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
| **Trail field** | The shared smell: it spreads (Diffuse) and fades (Half-life). | Resolution (½, ¼, full, or a fixed 512 / 1024 / 2048 rows), Spread 3×3 or 5×5, **Add** (food) and **Block** (walls). **Amount** colours the picture; **Texture** goes back in |
| **Draw agents** | Draws the walkers themselves over a picture. | Points, Glow, Streaks, Ink; colour by species, speed, heading, age or **Agent**; Lights; Brightness of the crowd |

Slime colours the **trail** (Trail → Palette → Output). Particles draw the **walkers** (Draw agents → Output) and need no trail at all.`),
      still('agentGrowPicture', 'Grow toward a picture: Trail field Add paints food from a picture, Emit Field gives birth on it (still)', 'half'),
    ]),

    // 4 ─────────────────────────────────────────────────────────────────────
    step('Inside: the slime rule', [
      interactive('agentRuleSlime', `Double-click the group: this runs once for every walker, every step, left to right.

- **Agent Inputs** / **Agent Output**: the walker at the start and the end of the step. Anything unwired on Output keeps its value, so an empty group stands still.
- **Sense**: three points [[control:distance]] ahead, [[control:angle]] to each side. It reads a texture (the trail) and/or any chain of nodes wired into **Field ƒ**.
- **Crowding**: an ordinary Expression Block, $r\\,e^{-r/\\text{sat}}$ with sat = [[control:sat]]: trail that is very crowded smells *less* good.
- **Steer**, **Jones** mode: straight on if the centre wins, a random side if both sides beat it, otherwise [[control:turn]] toward the stronger side, plus a little [[control:jitter]]. (**Smooth** turns in proportion; **Away** runs from the strongest.)
- **Move**: one step at [[control:speed]]; Wrap, Bounce or Slide at the edges, and **Obstacle ƒ** to turn back from a shape.
- **By species**: one of four numbers, by the walker's kind.`, [
        ['distance', 'Sense · Distance'], ['angle', 'Sense · Angle'], ['sat', 'Crowding · sat'], ['turn', 'Steer · Turn'], ['jitter', 'Steer · Jitter'], ['speed', 'Move · Speed'],
      ]),
      glsl(dedent(slimeRule), 'The Slime mold preset’s rule, as the app compiles it: Sense, Steer and Move marked', slimeMarks),
      text(`**Unwired means this walker.** A socket left empty reads the walker's own position, heading or age. And any ordinary node that would read the pixel's position reads the walker's instead, so noise, a shape's distance, Time, Audio or an Expression Block can join the rule (Crowding is one).

**What can't go inside**, and the card says why: nodes that read the previous frame (Echo, Previous Frame, the blurs, Bloom), since a walker is not a pixel; programs of their own (Pass, another Agents group, Trail, Deposit, Emit, Draw agents, the Particles node, the Output); ray marches (Scene Group, March Loop, GI March, Space Warp), too costly per walker; and anything that reads screen derivatives or gl_FragCoord.`),
    ], 2),

    // 5 ─────────────────────────────────────────────────────────────────────
    step('Particles: forces that add up', [
      interactive('agentRuleParticles', `Particles use the same group with different nodes inside. Each **force** has an **Also** input: wire them in a row and they add up, so the order doesn't matter, only which forces are in the chain. Then **Integrate** turns the total into motion and **Age / Life** ends each particle; Emit's **Keep full** gives it a new life on the ring.

Try [[control:curl]] at 0 (only the swirl is left), a bigger [[control:curlSize]] for small tight eddies, [[control:vortex]] the other way, or [[control:attract]] below 0 to blow them away from the mouse. [[control:shock]] is a **Sound kick** on a silent [[control:beat]]; raise [[control:drag]] to settle each blast fast.`, [
        ['curl', 'Curl noise · Strength'], ['curlSize', 'Curl noise · Size'], ['vortex', 'Vortex'], ['attract', 'Attract (mouse)'], ['shock', 'Sound kick'], ['beat', 'Beat'], ['drag', 'Integrate · Drag'], ['gravity', 'Gravity'],
      ]),
      glsl(dedent(partsRule), 'The Particles preset’s chain as compiled: Curl noise, Vortex, Attract (each adding the one before), then Integrate', partsMarks),
      text(`**The forces:** Gravity, Wind (with gusts), Curl noise (currents that never bunch up), Attract / Repel (the mouse, a point, a hand or a null wired into Target), Vortex, Flow (up or round any field), Sound kick (Shockwave, Wave, Vibrate, Shake).

**Integrate:** velocity gains force × one step, Drag bleeds it, Max speed caps it, Mass divides the force; edges Free, Wrap, Bounce, Slide or Die.

**After Integrate:** **Collide** keeps walkers out of a shape (they slide round it); **Chladni** gathers them on a vibrating plate's still lines.

**Sound:** Sound kick and Chladni listen to **Sound from**: the Level slider (map audio to it in Play), the Mic, the Audio engine or one of its tracks, set on each node or once on the group for all of them. **Beat** is a silent stand-in kick that is part of the simulation, so a recording matches the preview.`),
    ], 2),

    // 6 ─────────────────────────────────────────────────────────────────────
    step('Each walker can remember', [
      interactive('agentRuleAnts', `A walker can carry state of its own from step to step. Ants need one thing: **am I carrying food?** That's Agent Output's **Memory**.

Searching ants follow the food smell and lay the home smell; carrying ants follow the home smell and lay the food smell. Each one's **Deposit** is its own, weaker the longer it has walked ([[control:fade]]), so short roads get the freshest smell and win. The rock is Move's **Obstacle ƒ** (turn back) and the Trail's **Block** (no smell inside).

Wait about 20 seconds for a road. Then set [[control:rock]] to 0 and watch it straighten, or shorten [[control:halfLife]] until the smell fades before a road can form.`, [
        ['rock', 'Obstacle · Rock size'], ['halfLife', 'Smell half-life (s)'], ['fade', 'Deposit · Weakens over (s)'], ['jitter', 'Steer · Jitter'],
      ]),
      text(`**What a walker can keep:**

- **Species** (1 to 4), from Emit's Species setting, kept for life. Sense's Channels default to +1 for its own kind's trail and −0.5 for the others'.
- **Memory**: two numbers it sets and reads back next step (the ants' "carrying" and "seconds walked").
- **Deposit**: how much trail it leaves in each channel, so a rule can decide who marks what.
- **Colour**: its own colour, shown by Draw agents' **Colour by Agent**.

A group only gets this extra state when its rule uses it; otherwise it compiles exactly as before.`),
      still('agentAnts', 'The Ants preset: 256k ants, roads from the nest to three piles, round the rocks (still)'),
    ], 2),

    // 7 ─────────────────────────────────────────────────────────────────────
    step('Same rule, different results', [
      interactive('agentRuleSlime', `Rules of thumb to try here (they are tendencies, not laws: the system is chaotic):

- [[control:distance]] sets the **scale**: further sensors, bigger cells.
- [[control:angle]] against [[control:turn]]: a sensor angle smaller than the turn keeps veins restless and looping; equal or wider gives calmer, rounder cells.
- [[control:jitter]] adds **wander**: more branching, less crisp lines.
- [[control:halfLife]] and [[control:diffuse]] decide how **long paths last** and how **thick** veins are.
- [[control:deposit]] is how loud each walker is; it works with Crowding's [[control:sat]]. With sat at 0 the network **coarsens** into a few thick loops; with it on, it keeps a living size.
- [[control:steps]] is **speed**, [[control:walkers]] is **density**.
- [[control:species]] 3: three colonies that follow their own trail and avoid the others' carve the picture into **territories**.`, [
        ['distance', 'Sense · Distance'], ['angle', 'Sense · Angle'], ['turn', 'Steer · Turn'], ['jitter', 'Steer · Jitter'], ['halfLife', 'Trail · Half-life'], ['diffuse', 'Trail · Diffuse'], ['deposit', 'Deposit · Amount'], ['sat', 'Crowding · sat'], ['steps', 'Steps per frame'], ['walkers', 'Walkers'], ['species', 'Species'],
      ]),
      text(`**For particles:** Curl noise's **Size** sets the eddies (bigger number, smaller swirls) and **Evolve** how fast the currents change; **Drag** decides between long loose flights and syrup; **Max speed** caps a blast. The chain's order never matters (forces add), but which forces you add does.

**Strands** is slime with far, narrow sensors and a small turn. **Multi-species slime** is slime with three kinds. Same nodes, different numbers.`),
      still('agentMultiSlime', 'Multi-species slime: three colonies, each following its own trail (still)'),
      still('agentStrands', 'Strands: sensors far and narrow, a small turn, ink on paper (still)'),
    ], 2),

    // 8 ─────────────────────────────────────────────────────────────────────
    step('Recipes, and playing them', [
      text(`Every preset is in the node browser under **Generators → Simulation** (and in **Examples → Simulation**); each node it adds has a note on its card saying what it does and what to try.

**On the Play page** a group is an instrument like any graph:

- **Every slider inside is a Play control**: Map to…, MIDI learn, LFOs, nulls. Nothing recompiles.
- **Pin to the group card** puts an inner slider on the card, under a live thumbnail of the walkers.
- **Sound from** on the group: the Mic, the Audio engine or an engine track, for every Sound kick and Chladni inside.
- **Hands**: Attract's Target, Vortex's Centre and Emit's At take **A hand or null**; right-click Hand X → **Follow a hand in Play**.
- **Start over** and Emit's **Burst** are triggers, so a key or a beat can press them.
- **Motion (texture)** brings a Motion layer in: born where people move, or food that grows the slime toward them.

Try **Play → Agents in Play → Agents: a hand and a beat** (last picture).`),
      still('slimeMold', 'Slime mold: Sense (trail) → Crowding → Steer (Jones) → Move (wrap); Fill from a disc facing out; trail 1024 rows → amber palette'),
      still('agentParticles', 'Particles: Curl → Vortex → Attract (mouse) → Integrate; Keep full on a ring; Glow, Ember by age, four orbiting lights'),
      still('agentCurlSmoke', 'Curl smoke: a “Rising heat” force that cools with age → Curl → Wind → Integrate; Ink streaks on paper'),
      still('agentSoundBurst', 'Sound burst: a “Spring back” force → Sound kick (Shockwave, Beat 120) → Curl → Integrate (bounce); Streaks by speed'),
      still('agentMultiSlime', 'Multi-species slime: three Emits (one per kind), By species speeds, one Deposit into a 3-channel trail'),
      still('agentAnts', 'Ants: Memory (carrying), Deposit per ant, “Which smell” picks Sense’s channel, rocks as Obstacle ƒ and Block'),
      still('agentBoids', 'Boids: Deposit Velocity into a soft 5×5 trail; Sample + a “Flock” block → Integrate; Streaks by heading'),
      still('agentStrands', 'Strands: far, narrow sensors (0.06, 15°), Turn 12°, a slow curl drift into Move; Ink on warm paper'),
      still('agentGrowPicture', 'Grow toward a picture: food = brightness² added to the trail, Emit Field, Sense smells both channels'),
      still('agentsHandBeat', 'Agents: a hand and a beat (Play): your hand or the pointer pulls a million particles, a fist pushes, the engine’s kick track blasts them'),
    ], 2),

    // 9 ─────────────────────────────────────────────────────────────────────
    step('What the code does', [
      text(`**1. One branch.** \`compileGraph\` sends a graph with any Agents node to the multi-program path (the one Pass nodes use). Every other graph compiles exactly as before; the golden shader snapshots prove it.

**2. One shader per group.** The group's inside is compiled by the ordinary compiler into **one update shader**, drawn as a full-screen quad over the walkers' **state texture**: one fragment per walker.`),
      js(GATE_TS, 'The gate: nothing else in compileGraph changed'),
      text(`**3. State textures** (RGBA32F, ping-pong): **A** = position, heading, age; **B** = velocity, speed, life (≤ 0 is dead). That is the Particles engine's layout, so its drawing is reused. Positions are the picture's centred coordinates, so a noise or shape node inside reads the same place the picture shows. Groups that use species, memory, deposit or colour get **C** and **D** too.`),
      glsl(prelude.text, 'Start of the Slime mold update shader: one fragment is one walker, its state read from A and B', prelude.marks),
      text(`**4. A step** = every group's update (reading the trail as it was) → Deposit draws one point per walker, added into the trail → the trail spreads and fades. **A frame** = K steps → Draw agents → the picture.

**5. The clock.** A step is 1/60 s and the state depends only on the step number and the Seed, so a render matches the preview. When the GPU can't keep up, fewer steps run and the simulation falls behind; walkers are never dropped. A million slime walkers take about 5.8 ms a frame with a ½-size trail, a million particles about 7 ms, mostly drawing (M3 Pro).

**6. Sliders are uniforms.** Every slider on the Agents nodes is a uniform (\`u_p_<node>_<setting>\`, such as \`u_p_agentsteerx0_turn\` on step 4), so dragging it changes the next step without a recompile and the simulation keeps going. It can be a Play control or a mapping like any other slider.

**Coming next:** website export (after the Pass node's website phase), "Open as nodes" for the Particles node, readings (how many are alive, where the crowd is) back into Play, and 3D.`),
      glsl(trailMain, 'The trail’s step (fixed engine code): spread toward the 3×3 (or 5×5) mean, then fade by 2^(−dt / half-life)', linesBetween(trailMain, 'vec4 t = mix(')),
    ], 2),
  ];
  return presentation(AGENTS_TITLE, keys, src, steps, now);
}
