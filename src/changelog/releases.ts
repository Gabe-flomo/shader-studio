/**
 * Release notes: what's new in each update, newest first. Shown in the History panel's
 * What's new view; the newest id is also the app's version (package.json and
 * src-tauri/tauri.conf.json), which a test checks. How to add one: docs/release-notes.md.
 *
 * Ids are calendar versions, `YEAR.MONTH.N`: the Nth release of that month (2026.9.7 is the
 * seventh in September 2026). They are valid semver with no leading zeros, so the desktop
 * build accepts them, and they sort as numbers, part by part.
 *
 * Write for the person using the app, not the commit log: one line per highlight, what they
 * can do now, in their words.
 */
import type { Page } from '../components/page';

export type ReleaseArea = 'Studio' | 'Play' | 'Present' | 'Learn' | 'Files' | 'Desktop' | 'Phone' | 'Account';

export type ReleaseLink =
  /** A bundled example (a key of EXAMPLE_INDEX); `page: 'play'` opens it on the Play page. */
  | { kind: 'example'; key: string; page?: 'studio' | 'play'; label?: string }
  /** One of the app's pages. */
  | { kind: 'page'; page: Page; label?: string }
  /** A doc in the repository's docs/ folder, opened on GitHub. */
  | { kind: 'doc'; path: string; label?: string };

export interface ReleaseHighlight {
  area: ReleaseArea;
  text: string;
  link?: ReleaseLink;
}

export interface Release {
  /** `YEAR.MONTH.N`, see above. */
  id: string;
  /** ISO date, `2026-09-27`. */
  date: string;
  title: string;
  highlights: ReleaseHighlight[];
}

export const RELEASES: Release[] = [
  {
    id: '2026.10.48',
    date: '2026-10-06',
    title: 'Scene Builder and Agent Rules',
    highlights: [
      { area: 'Studio', text: '3D Scene Builder: describe shapes, how they combine, space warps, look and camera in a form; Build makes a real, readable node graph.', link: { kind: 'doc', path: 'docs/scene-builder.md' } },
      { area: 'Studio', text: 'Scenes round-trip as recipe text, e.g. "volumetric · smooth-union(sphere, cone) k=0.3 · twist 0.5"; Describe reads hand-made 3D graphs.' },
      { area: 'Studio', text: 'Agent Rules: write agent behaviour as When … Do … lines with named states; Open as nodes shows the same rule as ordinary nodes.', link: { kind: 'doc', path: 'docs/agent-rules.md' } },
      { area: 'Studio', text: 'New folders: 3D: Scene Builder (six scenes) and Agents: rules (slime, ants, boids, predators, infection, termites, fireflies, coral).' },
    ],
  },
  {
    id: '2026.10.47',
    date: '2026-10-06',
    title: 'Whole-picture previews',
    highlights: [
      { area: 'Studio', text: 'Previews now keep the picture\'s real shape and fit it in the panel, so nothing is cropped or stretched; Slice gets its own strip below.' },
    ],
  },
  {
    id: '2026.10.46',
    date: '2026-10-06',
    title: 'Agent simulations',
    highlights: [
      { area: 'Studio', text: 'Simulations: agents: predators and prey, coral growth, sand dunes, crowd lanes, painter bots, termites, fireflies and infection, each a hand-written rule.', link: { kind: 'doc', path: 'docs/simulations-agents.md' } },
      { area: 'Studio', text: 'Every rule is built from Agent Inputs, Compare and Expression Blocks with a note on each node, so you can copy the pattern for your own.' },
    ],
  },
  {
    id: '2026.10.45',
    date: '2026-10-06',
    title: 'See each line',
    highlights: [
      { area: 'Studio', text: 'Expression Block editor: \u25b6 on any input, line or Return previews that value (Range, Slice, Grid, Arrows, colour); \u2191\u2193 step through the lines.', link: { kind: 'doc', path: 'docs/node-previews.md' } },
      { area: 'Studio', text: 'Custom Functions can preview any local variable from a dropdown. Previews never change the saved graph.' },
    ],
  },
  {
    id: '2026.10.44',
    date: '2026-10-06',
    title: 'Grid simulations and one clip editor',
    highlights: [
      { area: 'Studio', text: 'Simulations: grids: Game of Life, Life-like rules, Brian\'s Brain, caves, water ripples, heat, forest fire, falling sand and Wireworld, all from existing nodes.', link: { kind: 'doc', path: 'docs/simulations-grids.md' } },
      { area: 'Studio', text: 'The clip editor now opens for Video Input, Video layers, Baked clips, background videos and the Library, with trim, segments, speed, loop and crop.', link: { kind: 'doc', path: 'docs/clip-editor.md' } },
      { area: 'Studio', text: 'Source / Result playback shows exactly the frames or playlist you will get. Video Input files now survive a reload.' },
    ],
  },
  {
    id: '2026.10.43',
    date: '2026-10-06',
    title: 'Roomier code editors',
    highlights: [
      { area: 'Studio', text: 'Expression and Custom Function cards: airier code lines, and a Preview page (Range, Grid, colour…) in place of the signature.' },
      { area: 'Studio', text: 'Their editors fold the Functions panel (closed by default, \u0192 Functions or \u2318]) and the Inputs panel (\u2318[) so the code gets the room.' },
    ],
  },
  {
    id: '2026.10.42',
    date: '2026-10-06',
    title: 'Code on the card',
    highlights: [
      { area: 'Studio', text: 'Expression Blocks and Custom Functions show pages on the card: the code (read-only, coloured), a function signature from the wiring, your note and description.' },
      { area: 'Studio', text: 'Flip pages with the dots or arrows; double-click or Edit opens the full editor, where line editing now lives.' },
    ],
  },
  {
    id: '2026.10.41',
    date: '2026-10-05',
    title: 'A preview for every node',
    highlights: [
      { area: 'Studio', text: 'Preview controls live on the node card; the top banner just says what is previewed, with Exit.' },
      { area: 'Studio', text: 'No more empty or "no preview" boxes: texture and colour nodes show their real output, agent nodes show live trails, diagrams or stats.' },
    ],
  },
  {
    id: '2026.10.40',
    date: '2026-10-05',
    title: 'Smooth blurs and glows',
    highlights: [
      { area: 'Studio', text: 'Blur and Glow (texture) no longer show ghost copies or rings: new Smooth (true Gaussian) and Bloom chain methods, with Fast kept for cheap previews.', link: { kind: 'doc', path: 'docs/blur-and-glow.md' } },
      { area: 'Play', text: 'Look bloom, halation, CRT and edge glow, particle glows, and layers sent into the shader now use the same smooth blur.' },
    ],
  },
  {
    id: '2026.10.39',
    date: '2026-10-05',
    title: 'Agents in 3D',
    highlights: [
      { area: 'Studio', text: 'Agents groups can run in 3D: Space 3D gives walkers depth, a volume trail to sense, and forces with z.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'Draw agents gets an orbit camera with the same controls as Time Cube and Frame Stack, plus drift and depth of field, or a 3D scene\'s camera.' },
      { area: 'Studio', text: 'Collide (3D scene) lets walkers bounce off ray-marched shapes. Five 3D examples: slime, flock, torus swarm, galaxy, fireflies.' },
    ],
  },
  {
    id: '2026.10.38',
    date: '2026-10-05',
    title: 'Edit the clip',
    highlights: [
      { area: 'Studio', text: 'Time Cube: Edit clip… opens a trimmer with a filmstrip, In/Out handles and ticks showing exactly which frames are sampled.', link: { kind: 'doc', path: 'docs/time-cube.md' } },
      { area: 'Studio', text: 'Keep several segments (reorder, reverse), share frames by length or equally, add a speed ramp, crop, rotate and flip.' },
    ],
  },
  {
    id: '2026.10.37',
    date: '2026-10-05',
    title: 'Preview detail',
    highlights: [
      { area: 'Studio', text: 'Preview arrows now scale with strength: the strongest is a full arrow, weak ones are short or a dot. A Detail setting makes Grid and Arrows finer.' },
    ],
  },
  {
    id: '2026.10.36',
    date: '2026-10-05',
    title: 'Previews that explain',
    highlights: [
      { area: 'Studio', text: 'Node previews have Show as: vec2 values as a warped Grid, Arrows or a colour Wheel, so you can see how space moves.', link: { kind: 'doc', path: 'docs/node-previews.md' } },
      { area: 'Studio', text: 'Numbers auto-range with a key (no more white squares), a Slice plot shows input vs output, and constants read "= 3.0 everywhere".' },
    ],
  },
  {
    id: '2026.10.35',
    date: '2026-10-05',
    title: 'Texture tools',
    highlights: [
      { area: 'Studio', text: 'Texture tools: Mask, Levels, Flow, Neighbours, Change, Outline, Fade and Read turn any texture into masks, directions and glows.', link: { kind: 'doc', path: 'docs/texture-tools.md' } },
      { area: 'Studio', text: 'They work on Passes, images, video, Baked and agent trails; Mask and Levels also shape plain numbers. Seven new examples.' },
    ],
  },
  {
    id: '2026.10.34',
    date: '2026-10-05',
    title: 'Fewer nodes',
    highlights: [
      { area: 'Studio', text: 'Removed ten rarely used nodes: Glow Falloff, the 3D Fractals, Chladni 3D and its particles, the orbital nodes, and Print Float / Text.' },
      { area: 'Studio', text: 'Graphs that used them still open, with a removed card that says what to use instead.' },
    ],
  },
  {
    id: '2026.10.33',
    date: '2026-10-05',
    title: 'Time cube feather and camera',
    highlights: [
      { area: 'Studio', text: 'Time Cube View: Feather fades the frames around the slice over a span, with side and curve. Opacity sliders now respond evenly from 0 to 1.', link: { kind: 'doc', path: 'docs/time-cube.md' } },
      { area: 'Play', text: 'Camera Translate X / Y / Z fly the time cube camera through space; all camera sliders map on Play. New fly-through example.' },
      { area: 'Studio', text: 'Removed from Time Cube View: Swing, Lightning, Focus and Frame effects. Saved graphs still open.' },
    ],
  },
  {
    id: '2026.10.32',
    date: '2026-10-04',
    title: 'Cleaner time cubes',
    highlights: [
      { area: 'Studio', text: 'Time Cube View: clean slice and highlight edges, no stray sheets or hatching, and a smooth depth of field with Fast / Smooth quality.' },
      { area: 'Studio', text: 'Colour key regrouped, with a live "keeps about 4%" readout and one-click swatches from the slice. Lightning now clearly flashes.' },
      { area: 'Studio', text: 'Time Cube source: 16-bit precision for averaged and median frames.' },
    ],
  },
  {
    id: '2026.10.31',
    date: '2026-10-04',
    title: 'No more march banding',
    highlights: [
      { area: 'Studio', text: 'New March Loops start rays at an even, jittered depth, so volumetric glows lose their contour rings. Animate jitter is optional.' },
      { area: 'Studio', text: 'Volume Glow and SDF Glow have Per distance: Passthrough now changes smoothness, not brightness. Saved scenes are unchanged.' },
      { area: 'Play', text: 'Play, Present, the Output window and web exports now render in high precision with dither, so gradients stop banding.' },
    ],
  },
  {
    id: '2026.10.30',
    date: '2026-10-04',
    title: 'Clearer node sections',
    highlights: [
      { area: 'Studio', text: 'Folded sections now read "4 controls · 1 changed", or Off / On for sections with a switch, counting only what you will see.' },
      { area: 'Studio', text: 'Fixed: switching on Highlights, Frame motion or Frame effects now shows their sliders, and Passthrough shows again on Ray March nodes.' },
    ],
  },
  {
    id: '2026.10.29',
    date: '2026-10-04',
    title: 'Softer time cubes',
    highlights: [
      { area: 'Studio', text: 'Time Cube View: rounded soft edges, rim glow, side tints and shadow; outline off by default. Isometric camera and depth of field.', link: { kind: 'doc', path: 'docs/time-cube.md' } },
      { area: 'Studio', text: 'Highlighted frames that loop with the scan, frames that lift and scale as it passes, and Flow mode where the clip streams through the box.' },
      { area: 'Play', text: 'Animate the key colour, pulse it through the cube in bands, or flash it like lightning, all mappable on the Play page.' },
      { area: 'Studio', text: 'Time Cube source: long exposure, brightest, darkest, motion and median frames; reorder by shuffle, brightness, hue or motion.' },
    ],
  },
  {
    id: '2026.10.28',
    date: '2026-10-04',
    title: 'Frame Stack',
    highlights: [
      { area: 'Studio', text: 'Frame Stack turns a Time Cube\'s frames into cards: stack, fan, ring, torus, helix or grid, and morph between them.', link: { kind: 'doc', path: 'docs/frame-stack.md' } },
      { area: 'Studio', text: 'Scatter and drift cards apart and back, pop out the scan card, loop highlighted frames, shuffle, and add depth of field.' },
    ],
  },
  {
    id: '2026.10.27',
    date: '2026-10-04',
    title: 'Lighter Displacement Map',
    highlights: [
      { area: 'Play', text: 'Displacement Map has a Map quality setting (Full, Half, Quarter); the Ripple example now runs several times faster in the desktop app.' },
      { area: 'Studio', text: 'Octaves on FBM and Domain Warp are live sliders now, so dragging them no longer recompiles.' },
    ],
  },
  {
    id: '2026.10.26',
    date: '2026-10-04',
    title: 'Time cube',
    highlights: [
      { area: 'Studio', text: 'Time Cube stacks a video\'s frames into a box of time; Time Cube View draws it in 3D with a sliding see-through offset.', link: { kind: 'doc', path: 'docs/time-cube.md' } },
      { area: 'Studio', text: 'Key a colour to leave a solid trail through time, or use Time Slice for 2D slit-scan cuts. Three examples included.' },
    ],
  },
  {
    id: '2026.10.25',
    date: '2026-10-04',
    title: 'Bake: render and replace',
    highlights: [
      { area: 'Studio', text: 'Bake… renders a node or the whole picture to a video and puts it back as a Baked node, so heavy 3D and agents play back for almost nothing.', link: { kind: 'doc', path: 'docs/bake.md' } },
      { area: 'Studio', text: 'Unbake brings back the live nodes exactly; Re-bake renders again; baked videos live in the Library and work in Play and on web pages.' },
    ],
  },
  {
    id: '2026.10.24',
    date: '2026-10-04',
    title: 'Switch a node in place',
    highlights: [
      { area: 'Studio', text: 'Switch on a node card (or right-click → Switch to…) turns it into a similar node, keeping its wires: Union to Intersect, Sphere to Cone, sin to cos.' },
      { area: 'Studio', text: 'Settings carry over by name and meaning, and Play controls, keyframes and comments stay with the node; one undo step.' },
    ],
  },
  {
    id: '2026.10.23',
    date: '2026-10-04',
    title: 'Displacement Map, passes in groups',
    highlights: [
      { area: 'Play', text: 'Displacement Map, as in After Effects: any layer pushed by another layer or the picture, by red, green, blue, alpha, luminance, hue, lightness or saturation.', link: { kind: 'doc', path: 'docs/displacement-map.md' } },
      { area: 'Play', text: 'Layers have a Displace button next to Matte and Mask; Look’s Displace gains By channels; Studio gets a Displacement Map node.' },
      { area: 'Studio', text: 'A Pass can live inside a plain group, and texture wires can cross groups: build a blur group once and reuse it.', link: { kind: 'doc', path: 'docs/pass-node-plan.md' } },
      { area: 'Studio', text: 'Repeat on a Pass runs it up to 64 times a frame, for wide blurs, distance fields and faster simulations; a Jump flood node turns a shape into a distance field.' },
      { area: 'Studio', text: 'Texture Input and Video have a Texture output, so Edges, Blur and Particles can read a picture directly, with no copy Pass.' },
    ],
  },
  {
    id: '2026.10.22',
    date: '2026-10-04',
    title: 'Drag nodes in, a Water layer',
    highlights: [
      { area: 'Studio', text: 'Drag nodes from the browser onto the graph. Drop on a wire to insert the node into it; double-click and Enter still work.' },
      { area: 'Play', text: 'A Water layer: a whole-picture or pond-shaped surface that bends only the layers below it, so a boat above it stays sharp in its own wake.', link: { kind: 'doc', path: 'docs/water-layer.md' } },
      { area: 'Play', text: 'Water readings (wave height, energy, area) drive mappings and rules, and a Waves matte shows other layers only where the water moves.' },
      { area: 'Play', text: 'The Water effect’s card has Move to a layer, which keeps its settings, controls and Splash rules.' },
    ],
  },
  {
    id: '2026.10.21',
    date: '2026-10-04',
    title: 'Starter recipes, 3D that just works',
    highlights: [
      { area: 'Studio', text: 'Starter recipes: add a Grid, a noise, an SDF, a Pass and more, and a small card offers one-click setups. Just the node, Esc or Don’t ask again skip it.', link: { kind: 'doc', path: 'docs/starter-recipes.md' } },
      { area: 'Studio', text: 'Every node a recipe adds has a note on what it does and why, and the whole recipe is one undo step.' },
      { area: 'Studio', text: 'Any 3D shape you add lands in your scene, joined and placed beside what is there. A scene, camera and loop are built only when there is none.' },
      { area: 'Studio', text: 'The Volumetric switch builds its glow: Scene Distance, Volume Glow and Glow to Color, wired and explained; off removes them again.' },
    ],
  },
  {
    id: '2026.10.20',
    date: '2026-10-04',
    title: 'Passes you can inspect, sharper desktop zoom',
    highlights: [
      { area: 'Studio', text: 'Passes: probes, scopes and the eye now work on nodes inside a pass, and Performance has a row per pass. Data and Particles nodes work before a Pass.', link: { kind: 'doc', path: 'docs/pass-node-plan.md' } },
      { area: 'Studio', text: 'Particles can be born from a Pass: wire it into Emit from and they appear where the pass is bright, such as along edges.' },
      { area: 'Studio', text: 'New Passes examples: particles born on edges, feedback trails, reaction-diffusion, glow only the bright parts, and slime along edges.' },
      { area: 'Studio', text: 'Desktop zoom: text stays in place and fits its cards when you zoom out, and sliders and wires redraw sharp after you zoom in.' },
    ],
  },
  {
    id: '2026.10.19',
    date: '2026-10-04',
    title: 'Agents with shaders, a friendlier Agents group',
    highlights: [
      { area: 'Studio', text: 'New examples folder, Agents with shaders: eight graphs that plug the Agents group into ordinary nodes and your own shaders, every node explained.', link: { kind: 'example', key: 'agentShaderOutlines' } },
      { area: 'Studio', text: 'A new Agents group asks Particles, Slime or Empty and builds a working starter; Next steps adds Emit, Draw, Trail or Output in one click.' },
      { area: 'Studio', text: 'Inside a group, Agent Inputs shows “This walker” and “From outside the group”, settings use plainer names, and each one has a “?”.' },
      { area: 'Studio', text: 'Agents presets and examples start at 256k walkers with the same trail strength, and land in free space with their cards untangled.' },
      { area: 'Studio', text: 'Recordings and video exports now match the preview when agents read a Pass: traced outlines sit on the picture instead of stretching.' },
    ],
  },
  {
    id: '2026.10.18',
    date: '2026-10-04',
    title: 'Open as nodes, agent readings, galaxies',
    highlights: [
      { area: 'Studio', text: 'Open as nodes on the Particles card builds an editable Agents-group copy of its settings next to it; the original stays as it was.' },
      { area: 'Play', text: 'An Agents group reads like a layer: Alive, Speed, Spread, Centre X / Y and each species’ share, for mappings and rules.' },
      { area: 'Studio', text: 'New presets: Galaxy (spiral arms from orbiting stars), Mycelium (a branching mould colony) and Sand on a plate.' },
      { area: 'Present', text: 'How Agents work now runs the real presets on its slides, with sliders tied to their own settings.' },
    ],
  },
  {
    id: '2026.10.17',
    date: '2026-10-04',
    title: 'Agents and passes on the web',
    highlights: [
      { area: 'Studio', text: 'Exported web pages now run Pass node graphs and Agents groups, matching the app frame for frame. Export no longer warns about them.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'On a page, agents hear Level and Beat, the mic after the visitor allows it, and the page’s Granulator tracks; hands follow its tracker or the pointer.' },
      { area: 'Present', text: 'Presentations keep the agents and passes of the examples they show, so they still run after the presentation is reopened.' },
    ],
  },
  {
    id: '2026.10.16',
    date: '2026-10-04',
    title: 'How Agents work',
    highlights: [
      { area: 'Present', text: 'A new sample presentation, How Agents work: the loop, every node, how settings change the result, and what the code does, with live sketches you can tweak.' },
      { area: 'Studio', text: 'Expression Block sliders now really move their value: dragging Crowding’s sat inside the Slime mold changes it live, with no recompile.' },
    ],
  },
  {
    id: '2026.10.15',
    date: '2026-10-04',
    title: 'Agents in Play: hands, sound and motion',
    highlights: [
      { area: 'Studio', text: 'Every slider inside an Agents group is a Play control: map MIDI, LFOs, readers or a null to it, or pin it to the group card. The card shows the walkers live.' },
      { area: 'Studio', text: 'Sound from on the Agents group: the mic, the Audio engine or one of its tracks drives every Sound kick and Chladni inside.' },
      { area: 'Studio', text: 'Walkers follow a hand: set Attract to a hand or null, then Follow a hand in Play. Motion (texture) lets them be born or fed where things move.' },
      { area: 'Play', text: 'Example: Agents in Play, a million particles following your hand and a beat.' },
    ],
  },
  {
    id: '2026.10.14',
    date: '2026-10-04',
    title: 'Agents: species, food and walls',
    highlights: [
      { area: 'Studio', text: 'Walkers can belong to up to four species, each with its own trail, and keep their own memory, deposit and colour.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'Trail field gains Add (food) and Block (walls); Move steers around obstacles; Emit can start walkers from a picture or a field.' },
      { area: 'Studio', text: 'New presets: Multi-species slime, Ants (roads from nest to food), Boids, Strands, and slime that grows toward a picture.' },
      { area: 'Studio', text: 'Look inside: the eye preview shows what a walker standing there would see, and Show passes colours each node by the program it runs in.' },
    ],
  },
  {
    id: '2026.10.13',
    date: '2026-10-04',
    title: 'Live Expression sliders',
    highlights: [
      { area: 'Studio', text: 'Dragging an Expression Block’s slider no longer recompiles the shader, and inside an Agents group it no longer restarts the simulation.' },
    ],
  },
  {
    id: '2026.10.12',
    date: '2026-10-04',
    title: 'Agents: particles from nodes',
    highlights: [
      { area: 'Studio', text: 'Force nodes for the Agents group: Gravity, Wind, Curl noise, Attract / Repel, Vortex, Flow, Collide, Sound kick and Chladni. Chain them and they add up.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'Integrate (drag, speed, edges) and Age / Life, and Draw agents gains Streaks, Ink and Lights.' },
      { area: 'Studio', text: 'Presets: Particles, Curl smoke and Sound burst, built from nodes you can open and rewire. Every node is explained.' },
    ],
  },
  {
    id: '2026.10.11',
    date: '2026-10-03',
    title: 'Agents: slime mold, built from nodes',
    highlights: [
      { area: 'Studio', text: 'A new Agents group in Simulation: wire the rule one agent follows (Sense, Steer, Move) and it runs for up to a million agents on the GPU.', link: { kind: 'doc', path: 'docs/agents-group.md' } },
      { area: 'Studio', text: 'Emit, Deposit, Trail field and Draw agents go around it. The trail is an ordinary image you can colour, blur or glow.' },
      { area: 'Studio', text: 'A Slime mold preset grows branching veins that keep reorganising, with every node explained.' },
    ],
  },
  {
    id: '2026.10.10',
    date: '2026-10-03',
    title: 'Tidier cards',
    highlights: [
      { area: 'Play', text: 'Rows of options turn into a dropdown when a card is too narrow for them, instead of running off its edge.' },
      { area: 'Play', text: 'Mapping cards fit narrow panels: the source name shortens, Change…, Lock and Follow wrap onto their own lines, and the rest goes in the ⋯ menu.' },
      { area: 'Play', text: 'Layer, control, rule and Look cards wrap their buttons too, so nothing is cut off at any panel width.' },
    ],
  },
  {
    id: '2026.10.9',
    date: '2026-10-03',
    title: 'Water, Chladni sand and your own effects',
    highlights: [
      { area: 'Play', text: 'Water: a real wave surface in Look. Drag a wake with the pointer or any layer, add rain, or splash from a rule; the waves bend the picture and catch the light.', link: { kind: 'example', key: 'finishWater', page: 'play' } },
      { area: 'Play', text: 'Any node that takes a colour and gives one is now a Look effect, with its settings as sliders. Build your own from nodes or GLSL and save it to Your effects.', link: { kind: 'example', key: 'lookBuilt', page: 'play' } },
      { area: 'Studio', text: 'Particles can be sand on a Chladni plate, square or round: the sound picks the figure, and several modes add up to lacy patterns.', link: { kind: 'example', key: 'particleChladniSand' } },
      { area: 'Studio', text: 'New particle examples shaped by fields: a star outline, currents filling a heart, and cymatics in 3D.' },
    ],
  },
  {
    id: '2026.10.8',
    date: '2026-10-03',
    title: 'Motion layer, piano roll window, livelier looks',
    highlights: [
      { area: 'Play', text: 'A Motion layer: how much moves, where and which way, as readings for mappings and rules; a matte that shows a layer only where it moves; particles born there.', link: { kind: 'doc', path: 'docs/motion-layer.md' } },
      { area: 'Play', text: 'Double-click a MIDI clip to edit it in a big piano roll window, with the clip’s key, Highlight scale and Snap to scale in its side panel.', link: { kind: 'doc', path: 'docs/piano-roll.md' } },
      { area: 'Play', text: 'Pixel sort moves on its own: Flow, Drip, Breathe, Wander, Turbulence and Trail, with Melt, Rain and Glitch drift presets.' },
      { area: 'Play', text: 'ASCII takes your own characters, the ASCII layer’s sets, or emoji in their own colours.' },
      { area: 'Play', text: 'Rules can now fire Look effects: Mosh for a few seconds, Reset mosh, or pulse or set any effect’s setting.' },
      { area: 'Files', text: 'Linked folders stay linked, however many and wherever you link them from. A missing folder shows as Not found, with Relocate.', link: { kind: 'doc', path: 'docs/linked-folders.md' } },
    ],
  },
  {
    id: '2026.10.7',
    date: '2026-10-03',
    title: 'The Pass node',
    highlights: [
      { area: 'Studio', text: 'A Pass node renders everything before it into an image, so nodes after it can read that image anywhere: blur it, find its edges, glow it.' },
      { area: 'Studio', text: 'New texture nodes after a Pass: Sample, Edges, Blur, Glow and Displace. A Pass’s Previous output feeds the last frame back in for trails.', link: { kind: 'doc', path: 'docs/pass-node-plan.md' } },
      { area: 'Studio', text: 'Graphs without a Pass node compile and render exactly as before.' },
      { area: 'Studio', text: 'Example: Passes 1 · Edge glow, with every node explained.' },
    ],
  },
  {
    id: '2026.10.6',
    date: '2026-10-03',
    title: 'Smoother sound pages, scattered particles',
    highlights: [
      { area: 'Play', text: 'The Sound rail, Arrangement and Granulator no longer redraw the whole page while controls move: about half the work per frame, and less CPU.' },
      { area: 'Studio', text: 'Particles on a picture spawn at random spots instead of a line sweeping up the image, both at first and after Release.' },
      { area: 'Studio', text: 'Particle glow is gentler by default and in the presets, so bright scenes stop clipping to white.' },
      { area: 'Play', text: 'Datamosh: Refresh now heals at a rate you can see, and Reset mosh snaps back to the live picture (also mappable to a key or a rule’s signal).' },
    ],
  },
  {
    id: '2026.10.5',
    date: '2026-10-03',
    title: 'Particles, piano roll and new looks',
    highlights: [
      { area: 'Studio', text: 'A new Particles node: up to 4 million GPU particles as glowing light or ink in water, in 2D or 3D with depth of field. Presets, and any setting can be wired in.', link: { kind: 'example', key: 'inkInWater' } },
      { area: 'Studio', text: 'Particles can hold a picture and blow away, flow round shapes, stand in a 3D scene, follow your hands and react to sound, an Audio engine track included.', link: { kind: 'example', key: 'particleImageDissolve' } },
      { area: 'Studio', text: 'The old particle nodes (Particle Emitter, the P: chain, Particle System) are gone: their examples use Particles, and old saves say what replaced them.' },
      { area: 'Play', text: 'Piano roll: double-click a MIDI clip on the tape to edit its notes. Snap to scale puts the notes you play into the tape’s scale.', link: { kind: 'example', key: 'pianoRollScale', page: 'play' } },
      { area: 'Play', text: 'The Granulator’s Spectral mode can emit its grains from Position or spread them in time.', link: { kind: 'example', key: 'granulatorSpectral', page: 'play' } },
      { area: 'Play', text: 'New Finish looks: Pixel sort, Halftone, ASCII and Light leaks, and presets on Feedback, Mirror, Edges, Posterize and more.', link: { kind: 'example', key: 'finishPrint', page: 'play' } },
      { area: 'Play', text: 'Datamosh, Motion extract and Echo. Feedback is fixed: no haze left behind, trails stay where things were, and a Source picks what leaves them.', link: { kind: 'example', key: 'finishDatamoshEcho', page: 'play' } },
      { area: 'Studio', text: 'Preview resolution: run the preview at Full, Half, Third or Quarter size to keep heavy graphs smooth; exports stay full size.' },
    ],
  },
  {
    id: '2026.10.4',
    date: '2026-10-03',
    title: 'Effects that know where',
    highlights: [
      { area: 'Play', text: 'Every Finish effect has a Where: everywhere, only where a layer is, on the bright parts, or where the camera sees movement, and Invert.', link: { kind: 'doc', path: 'docs/finish-stack.md' } },
      { area: 'Play', text: 'Nine new Finish effects: Glitch, Ripple, Displace, Mosaic, Mirror, Gradient map, Posterize, Edges and Feedback trails.' },
      { area: 'Play', text: 'Particles can be born where the camera sees movement, or on the bright parts of the picture.' },
      { area: 'Play', text: 'On the Inputs board: drag a source onto a control to drive it, see each mapped slider’s swing as a ring, and find sources grouped by kind with search.' },
      { area: 'Play', text: 'Open a detail window from a layer’s property row, and Keep open to leave it floating while you work.', link: { kind: 'doc', path: 'docs/detail-windows.md' } },
      { area: 'Play', text: 'A Graph view on the Rules page draws sources, controls and rules as one picture; click any node for its details.', link: { kind: 'doc', path: 'docs/graph-view.md' } },
    ],
  },
  {
    id: '2026.10.3',
    date: '2026-10-02',
    title: 'Input names',
    highlights: [
      { area: 'Studio', text: 'Name any node’s inputs in your own words and say what each is for (the pencil on a node card); the code stays the same.' },
      { area: 'Studio', text: 'Publishing a node starts the Node Builder from those names, with each description as the input’s docstring.' },
    ],
  },
  {
    id: '2026.10.2',
    date: '2026-10-02',
    title: 'Sharp zoom',
    highlights: [
      { area: 'Desktop', text: 'Zoomed-in nodes are sharp in the desktop app: cards, text and wires redraw at full resolution once the zoom settles.' },
      { area: 'Studio', text: 'Switch an Expression Block line off without deleting it: the // button, or ⌘/ in the line. It stays, dimmed, as a comment.' },
      { area: 'Studio', text: 'Swipe sideways with two fingers over a long expression to read it; the canvas stays put.' },
    ],
  },
  {
    id: '2026.10.1',
    date: '2026-10-02',
    title: 'Rules and the Inputs board',
    highlights: [
      { area: 'Play', text: 'Signals and actions are Rules: When something happens, Do this. Quick rule: press + Rule, do the thing (a key, a pinch, a note, a sound), pick what happens.', link: { kind: 'doc', path: 'docs/conditions-and-signals.md' } },
      { area: 'Play', text: 'Inputs puts the controls beside the sources that drive them. Map a source onto any number of sliders: Set, or Add around where the slider is.', link: { kind: 'doc', path: 'docs/sources-and-routes.md' } },
      { area: 'Play', text: 'A detail window for any control, source or rule: what drives it, what it drives, the rules on it, with back and forward.', link: { kind: 'doc', path: 'docs/detail-windows.md' } },
      { area: 'Play', text: 'Behaviours: ready-made rules (Pinch to burst, Pulse to the beat, Bass shakes it…), and Save as behaviour for your own.' },
      { area: 'Play', text: 'Play notes: a rule plays a chord, a strum, an arpeggio or a random note on a rack, snapped to a scale.' },
      { area: 'Play', text: 'A Text layer can show a live value; new Bell and Biased random sources; rules show where they sit in a chain or loop.' },
      { area: 'Studio', text: 'A group’s Iterations goes to 128, and on the Play panel it turns without recompiling.' },
    ],
  },
  {
    id: '2026.9.22',
    date: '2026-09-30',
    title: 'Signals, simplified',
    highlights: [
      { area: 'Play', text: 'Signals has its own page (⌘5): each signal shows what makes it true, what sends it and what it sets off.', link: { kind: 'doc', path: 'docs/conditions-and-signals.md' } },
      { area: 'Play', text: 'Any slider’s + can create a signal from it; signals can watch a layer’s readings, the picture’s brightness and positions.' },
      { area: 'Play', text: 'New conditions: between, outside, is not, never reached, rising, falling, steady, every Nth, N within T, and % of range.' },
      { area: 'Play', text: 'Signals combine (All of, Any of, None of) and follow a key or condition while it holds: hover AND click.' },
      { area: 'Play', text: 'A signal can capture a value or a position; Set and Move a layer here make shapes jump to it (a pinch point, a click, a particle collision).' },
      { area: 'Play', text: 'Hold for, Linger, Delay and Chance on signals; Delay on mappings; Shake, Wander, Hop and Chaos in the + menu.' },
      { area: 'Play', text: 'Link signals into chains and loops, with Run/Stop, Speed and Laps.' },
      { area: 'Studio', text: 'The Performance panel shows what Play costs each frame, per stage and per layer.' },
    ],
  },
  {
    id: '2026.9.21',
    date: '2026-09-29',
    title: 'Tabs on every layer editor',
    highlights: [
      { area: 'Play', text: 'Edit notes on the tape: drag to move, drag the end to lengthen, ⌥-drag for velocity, double-click to add, Delete to remove.' },
      { area: 'Play', text: 'Tape clips show their MIDI notes again; a track can show as Audio instead (⋯ → Show the tape as).' },
      { area: 'Play', text: 'Layer editors work in tabs: one section at a time, remembered per layer, with Show all to stack them again.', link: { kind: 'doc', path: 'docs/editor-layout.md' } },
    ],
  },
  {
    id: '2026.9.20',
    date: '2026-09-28',
    title: 'Halation, measured',
    highlights: [
      { area: 'Studio', text: 'The Layers node builds its distance field on the GPU: SDF Glow on layers is as smooth as on a shape.', link: { kind: 'example', key: 'particleGlow' } },
      { area: 'Play', text: 'Halation is bounded: a clipped white or a bright paper bleeds no more than a glint, so the rim stays thin and red-orange.' },
      { area: 'Play', text: 'Granulator grains draw as straight pills along the sample (length = grain size, each at its own height), and nulls from grains follow the same layout.' },
      { area: 'Desktop', text: 'Audio Unit effects after a Granulator are heard and open their windows: its sound is sent into the engine like Sound in.', link: { kind: 'doc', path: 'docs/granulator.md' } },
      { area: 'Play', text: 'The Granulator and the Sample player pick sounds from linked folders too.' },
      { area: 'Play', text: 'Empty Layers and Mappings pages offer Add layer, Layer sets, Add control and Add mapping right there.' },
      { area: 'Play', text: 'Halation now matches a real film-emulation grade: a thin red bleed hugging bright edges and glints, landing on the darker picture beside them.', link: { kind: 'example', key: 'finishHalation', page: 'play' } },
      { area: 'Play', text: 'Halation has a Conserve slider (the bright part gives up what it bleeds), and its presets and defaults follow the measurement.', link: { kind: 'doc', path: 'docs/finish-stack.md' } },
    ],
  },
  {
    id: '2026.9.19',
    date: '2026-09-28',
    title: 'Spread, sample index, Remap ranges',
    highlights: [
      { area: 'Play', text: 'Spread: put sliders in an order and one Amount offsets them along a curve; Shift rotates it, Reset starts from each minimum.', link: { kind: 'doc', path: 'docs/spread-control.md' } },
      { area: 'Play', text: 'Drum pads have a Sample index: step it from a beat or a signal and the same pad walks through every sound, or picks at random.' },
      { area: 'Play', text: 'The Audio engine’s Sample player has a Sample index too: shift which zone each note plays (pitched zones keep their pitch), mappable, and recorded in takes.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Studio', text: 'Remap has a Clamp output toggle and shows its ranges as two range rows.' },
    ],
  },
  {
    id: '2026.9.18',
    date: '2026-09-28',
    title: 'Granulator: Emit and Spectral',
    highlights: [
      { area: 'Play', text: 'Trackers say what they are doing (downloading, loading, tracking), keep their models on this device, and can warm up when the app opens.' },
      { area: 'Play', text: 'Track hands in an uploaded video: analyse the clip once and nulls, sources and gestures follow it exactly, in takes and on websites too.', link: { kind: 'doc', path: 'docs/tracking.md' } },
      { area: 'Play', text: 'Face and body tracking join Hands: mouth, smile, blinks, brows and head turns, plus 33 body points, on the camera or a video.' },
      { area: 'Play', text: 'Racks get 8 macro knobs, as in Ableton: each turns many parameters through its own range and curve, and is what you map MIDI or an LFO onto.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Play', text: 'Granulator Emit mode: grains shoot from spawn points that travel through the sample, forwards, backwards or both, and wrap, bounce or jump at the ends.', link: { kind: 'doc', path: 'docs/granulator.md' } },
      { area: 'Play', text: 'Granulator Spectral mode: grains play frequency bands, not slices; drag the band on the spectrogram, and each grain\'s band and energy can drive the picture.', link: { kind: 'doc', path: 'docs/granulator.md' } },
      { area: 'Play', text: 'Grains → nulls puts the nulls in their own folder, and layers you add later stay out of it.' },
      { area: 'Play', text: 'The granulator\'s generated samples are down to the pad chord; setups that used the others play the pad chord.' },
    ],
  },
  {
    id: '2026.9.17',
    date: '2026-09-28',
    title: 'Plug-ins that talk back, quick links, one Controls tab',
    highlights: [
      { area: 'Play', text: 'The + beside any slider opens a mini mapper: pick MIDI, hands, audio, a layer, a generator or another control, and it is wired on the spot.' },
      { area: 'Files', text: 'Save a set of layers with their mappings, controls and actions, and racks as presets; both load back from Add layer, Add track or Files.', link: { kind: 'doc', path: 'docs/presets.md' } },
      { area: 'Play', text: 'Matte the picture with any layer (a shape, a path, a hand path), with Invert and a soft edge. Start over clears Play in one undoable step.' },
      { area: 'Play', text: 'Arrangement: Play/Pause runs the picture too, the timeline scrubs (|◀ ◀◀ ▶▶ ▶|, Home/End, editable bar.beat), and devices fold to a header.' },
      { area: 'Desktop', text: 'Move a rack control and the plug-in\'s own knob follows; A–K keep playing notes while the plug-in window is in front.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Play', text: 'Quick link: ⌘-click one control, then another, and pick the direction to map them — an audio reader onto a radius in two clicks.' },
      { area: 'Play', text: 'Controls and Mappings share one rail category with tabs; ⌘1–4 jump to Controls, Layers, Finish and Engine.', link: { kind: 'doc', path: 'docs/split-view.md' } },
      { area: 'Play', text: 'The script editor keeps the caret where you click after scrolling; the Keyboard and Hands pills no longer cover the top bar.' },
    ],
  },
  {
    id: '2026.9.16',
    date: '2026-09-28',
    title: 'Signals from every particle, rail tabs, recovery',
    highlights: [
      { area: 'Play', text: 'The Audio engine is one Arrangement view, laid out like Ableton: tracks with audio-style clips, a device chain per track, listeners as devices, one Play/Pause.', link: { kind: 'doc', path: 'docs/arrangement.md' } },
      { area: 'Play', text: 'Every particles layer and Agents can send a Born and a Died signal, and reads how many were born or died this step.', link: { kind: 'doc', path: 'docs/particles-multiply.md' } },
      { area: 'Play', text: 'Rail categories open straight to their pages, shown as tabs in the panel header; ⌘⇧M jumps to Mappings from anywhere.', link: { kind: 'doc', path: 'docs/split-view.md' } },
      { area: 'Files', text: 'Autosave: the open project is saved aside every 5 minutes (or every minute, or on every change) in Files → App settings.', link: { kind: 'doc', path: 'docs/crash-recovery.md' } },
      { area: 'Files', text: 'If Playfield closes unexpectedly, the next launch offers to recover what you hadn\'t saved, untitled or not.', link: { kind: 'doc', path: 'docs/crash-recovery.md' } },
      { area: 'Desktop', text: 'Plug-ins load in their own process where macOS allows, so a crashing one takes itself down, not Playfield.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Desktop', text: 'A new or updated plug-in is tried out safely first; one that crashes is switched off with a Try again button instead of crashing the app.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
    ],
  },
  {
    id: '2026.9.15',
    date: '2026-09-28',
    title: 'Agents',
    highlights: [
      { area: 'Play', text: 'Pausing time (Space) now freezes the layers too — agents, particles and relationships hold still until you play again.' },
      { area: 'Play', text: 'The Layers page has a draggable divider between the list and the editor.' },
      { area: 'Desktop', text: 'Configure by touch: turn a knob in the plug-in\'s own window and it becomes a rack control, like Ableton. The full list is still a click away.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Play', text: 'The Signals page now shows which layers send a signal (Multiply, Relationship, Increment) and who listens.' },
      { area: 'Play', text: 'A Function source: type a formula of t (seconds) and b (beats) — sin(t*2)*0.5+0.5, fract(b/4), noise(t) — and map it like any source.' },
      { area: 'Play', text: 'Goo edges are sharp at any size, and Agents gravity is ten times gentler so the whole slider is usable.' },
      { area: 'Studio', text: 'The preview bar follows the theme in light mode.' },
      { area: 'Play', text: 'An Agents layer: a crowd of entities steered by a stack of rules (seek, flee, flock, orbit, gravity, springs, fields), with Boids and Predator-prey presets.', link: { kind: 'example', key: 'playBoids', page: 'play' } },
    ],
  },
  {
    id: '2026.9.14',
    date: '2026-09-28',
    title: 'Less on screen at once',
    highlights: [
      { area: 'Play', text: 'Editors open collapsed: one main section, the rest folded to a one-line summary. Expand all or fold all; each section remembers.' },
      { area: 'Files', text: 'Sample browsers audition like Splice: arrow down plays the next sound, left restarts, right skips 3 s, Enter picks. Auto-preview can be turned off.' },
      { area: 'Play', text: 'Multiply particles that annihilate now just meet and vanish, with no burst.', link: { kind: 'doc', path: 'docs/particles-multiply.md' } },
      { area: 'Studio', text: 'The top bar fits narrower windows: labels drop first, rarely used buttons fold into a ··· menu, and nothing runs off the edge.' },
      { area: 'Play', text: 'Increment mappings: move a control in steps on a beat, a signal or a threshold; steps can compound, glide, wrap back, and each step sends a signal.', link: { kind: 'example', key: 'playIncrement', page: 'play' } },
      { area: 'Play', text: 'The Play page opens in the split view with the icon rail.' },
      { area: 'Studio', text: 'Sliders no longer recompile the shader: whole-number sliders and sliders inside scene groups and march loops update live.' },
      { area: 'Play', text: 'Multiply particles: a Fullness control sets how much of the colony is alive; Multiply and Cull actions; split, full, annihilate and cleared signals.' },
    ],
  },
  {
    id: '2026.9.13',
    date: '2026-09-28',
    title: 'The Granulator',
    highlights: [
      { area: 'Play', text: 'A Granulator instrument in the Audio engine, modelled on Granulator III: Classic, Flux and Cloud modes, up to 64 grains, playable from MIDI or the keyboard.', link: { kind: 'example', key: 'granulator', page: 'play' } },
      { area: 'Play', text: 'Grains drive visuals (count, position, spread as sources; grains onto nulls), and a layer can drive grains: particles inside a boundary shape become grains.' },
      { area: 'Play', text: 'Big layer editors in the split view share one layout: a section strip to jump around, tidier rows, and labels that wrap instead of overflowing.' },
      { area: 'Desktop', text: 'Plug-in windows open at the plug-in\'s own size, resize only where the plug-in allows, and remember where you left them.' },
      { area: 'Files', text: 'Linked folders: point the app at folders on your disk, and every picker (pads, video, images, fonts, songs) reads from them without copying.', link: { kind: 'doc', path: 'docs/linked-folders.md' } },
      { area: 'Play', text: 'The Audio engine has a tape: record each rack on its own track, overdub, punch in with a count-in, up to 60 s, and render it. One lead rack takes the MIDI.', link: { kind: 'doc', path: 'docs/arrangement.md' } },
      { area: 'Play', text: 'Split view: fold the sidebar into an icon rail, pages take the full width, and Controls show live graphs grouped by rack, layer or reader.', link: { kind: 'doc', path: 'docs/split-view.md' } },
      { area: 'Play', text: 'A relationship\'s members nest under it in the Layers list, with role chips.' },
    ],
  },
  {
    id: '2026.9.12',
    date: '2026-09-28',
    title: 'A Files home, readers as controls, a private file format',
    highlights: [
      { area: 'Files', text: 'Files opens on a home: activity for the week with a calendar, a carousel of your recent work as pictures, and what you use most.', link: { kind: 'doc', path: 'docs/files-page.md' } },
      { area: 'Files', text: 'Item and node pages: code folded small, a live preview with sliders, where it\'s used, and Insert into the graph.' },
      { area: 'Play', text: 'Every audio reader is now a control in an "Audio readers" group, with live meters on the rack, video and drum pad cards, and names by band (Lows, High mids…).', link: { kind: 'doc', path: 'docs/audio-readers.md' } },
      { area: 'Files', text: '.playfile is a Playfield-only file now: not a ZIP anyone can open; tampered files are refused; old files still open.', link: { kind: 'doc', path: 'docs/playfile-format.md' } },
      { area: 'Studio', text: 'The Convert and GLSL pages show the full canvas with its toolbar, with a Source / Converted / Split wipe on Convert.' },
      { area: 'Desktop', text: 'The projection editor\'s preview draws live, and corner handles stay reachable off the edge.' },
      { area: 'Play', text: 'Relationship layer: make layers chase, flee, repel or attract each other, climb or avoid bright areas, and read back distance and closing speed.' },
      { area: 'Play', text: 'Particles can Multiply: one buds into many, with an optional Goo look and annihilate-and-regrow loops.', link: { kind: 'example', key: 'playMultiply', page: 'play' } },
    ],
  },
  {
    id: '2026.9.11',
    date: '2026-09-28',
    title: 'MIDI that just works, undo on Play, and sound in renders',
    highlights: [
      { area: 'Play', text: 'A new knob mapping learns the first knob you turn; Lock ties it to one device. Velocity and gate rows can learn a note.', link: { kind: 'doc', path: 'docs/midi.md' } },
      { area: 'Desktop', text: 'Controllers like the Akai MPK mini now work: a rewritten MIDI bridge, plus a Monitor that shows every device and what it sends.' },
      { area: 'Desktop', text: 'Audio engine racks can take the computer keyboard (a toggle on the rack, Esc gives it back).', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Desktop', text: 'The Audio engine\'s sound is in recordings and rendered takes, and a web sound can be sent through Audio Unit effects.' },
      { area: 'Play', text: 'Undo and redo on the Play page (⌘Z, ⌘⇧Z), with every edit in History → Changes.' },
      { area: 'Present', text: 'Present, Stage and exported websites recover when the browser drops the graphics context.' },
      { area: 'Studio', text: 'Sliders: type a number past the end and the range grows to it; right-click is back to the Play and knob menu.' },
    ],
  },
  {
    id: '2026.9.10',
    date: '2026-09-28',
    title: 'Projectors, Audio Units, and a better phone',
    highlights: [
      { area: 'Desktop', text: 'An output window for a projector or second display, with projection mapping: corner pins, mesh warps, masks, edge blends and test patterns.', link: { kind: 'doc', path: 'docs/projection.md' } },
      { area: 'Desktop', text: 'The Audio engine: Audio Unit synths and effects on a Mac, played from MIDI or the keyboard, with reader dots on each rack\'s spectrum, and a Plugins setting.', link: { kind: 'doc', path: 'docs/audio-engine.md' } },
      { area: 'Desktop', text: 'MIDI controllers work in the desktop app through a native bridge; knob lock, note ranges and pad grids come along.', link: { kind: 'doc', path: 'docs/midi.md' } },
      { area: 'Phone', text: 'Turning the phone sideways keeps the phone layout, with a full-screen picture on Play; turning back restores it inside the safe area.' },
      { area: 'Phone', text: 'Audio pickers open Files (not the video picker), the drum pads open in the split view or a sheet, and the Record dialog fits the screen.' },
      { area: 'Play', text: 'Drum pads: save and load kits, Stop only while a sound plays, tap an empty pad to add a sound; a storage limit with a meter on Files.', link: { kind: 'example', key: 'drumPads', page: 'play' } },
      { area: 'Present', text: 'Capture a background: the time slider responds at once and settles when you let go.' },
      { area: 'Studio', text: 'The Palette node edits its stops on a gradient bar, like the Present picker, so the card stays one bar tall.' },
    ],
  },
  {
    id: '2026.9.9',
    date: '2026-09-27',
    title: 'p5 sketches, conditions, MIDI grids and sound effects',
    highlights: [
      { area: 'Play', text: 'Import p5.js sketches (paste, files or a folder) into Script layers, with tabs, a Console and "Make it a control".', link: { kind: 'example', key: 'p5MultiFile', page: 'play' } },
      { area: 'Play', text: 'Conditions and signals: act when any value crosses a threshold, and chain actions with named signals.', link: { kind: 'example', key: 'playConditions', page: 'play' } },
      { area: 'Play', text: 'Pair two controls into one (an XY pad for positions), affect X, Y or both, and swap axes at a threshold.', link: { kind: 'example', key: 'playPairs', page: 'play' } },
      { area: 'Play', text: 'MIDI: lock a mapping to one knob, set a note range from two keys, and map Push or Launchpad pads to grid cells.', link: { kind: 'example', key: 'playPadGrid', page: 'play' } },
      { area: 'Play', text: 'Sound effects: filter, echo, reverb, distortion and compressor chains on any sound, mappable and in renders.', link: { kind: 'example', key: 'audioEffects', page: 'play' } },
      { area: 'Play', text: 'Finish: an animatable before/after wipe, stack presets, and your own effects written as code.' },
      { area: 'Present', text: 'Add code from your own GLSL, a function, a node or a shader, with live plots and previews; full screen for slides and the canvas.' },
      { area: 'Files', text: 'A Notes section with every note and comment, readable App settings, a pop-out node pack builder, and History as cards.' },
    ],
  },
  {
    id: '2026.9.8',
    date: '2026-09-27',
    title: 'Finishing, one file format, and linked lessons',
    highlights: [
      { area: 'Play', text: 'Finish stack: grade the whole picture (curves, colour wheels, split tone, looks) with lens, CRT, grain and bloom.', link: { kind: 'example', key: 'finishGrade', page: 'play' } },
      { area: 'Play', text: 'Halation that behaves like film: lamps glow red to white and grow, white paper stays clean.', link: { kind: 'example', key: 'finishHalation', page: 'play' } },
      { area: 'Play', text: 'Time displacement: parts of the picture show older frames, as a slit-scan, by brightness or through a shape.', link: { kind: 'example', key: 'finishTime', page: 'play' } },
      { area: 'Files', text: 'One file format, .playfile: every download offers it, and it brings along the nodes, functions and images it needs.', link: { kind: 'doc', path: 'docs/playfile-format.md' } },
      { area: 'Files', text: 'Node packs can be signed by their maker and sealed so their code stays hidden.' },
      { area: 'Present', text: 'Link a graph to its presentation: loading one offers the other.' },
      { area: 'Play', text: 'Videos in the Library, drag-and-drop images and videos onto Play, and video sound in rendered takes.' },
    ],
  },
  {
    id: '2026.9.7',
    date: '2026-09-27',
    title: 'Sign-in, plans, and video with sound',
    highlights: [
      { area: 'Account', text: 'Sign in to Playfield. Free and Pro plans, with Pro features marked where you meet them.' },
      { area: 'Play', text: 'Video layer: drop in a video and its sound feeds the audio readers.', link: { kind: 'example', key: 'playVideoSound', page: 'play' } },
      { area: 'Play', text: 'Audio readers: place dots on a live spectrum; each one is a source and a trigger.', link: { kind: 'example', key: 'playAudioReaders', page: 'play' } },
      { area: 'Play', text: 'Hand paths: shapes whose corners follow your fingertips.', link: { kind: 'example', key: 'handPaths', page: 'play' } },
      { area: 'Play', text: 'Blend modes like Multiply and Difference now mix with the shader, not only with other layers.' },
      { area: 'Play', text: 'Split view (⌘⇧L): a big Controls, Layers or Mappings panel beside the picture, and a grouped, searchable Source picker.' },
      { area: 'Present', text: 'Themes (Classic, Landing, Article, Portfolio) you can tweak and save, and Google Fonts by pasting a link.', link: { kind: 'page', page: 'present' } },
      { area: 'Studio', text: 'Turning a slider off freezes it at the value it has right now.' },
    ],
  },
  {
    id: '2026.9.6',
    date: '2026-09-27',
    title: 'Files, data, and mattes',
    highlights: [
      { area: 'Files', text: 'The Files page: see, clean up, download and install everything you’ve saved.', link: { kind: 'page', page: 'files' } },
      { area: 'Files', text: 'Workspace folder: keep your work as real files, shared by the desktop app and the browser.', link: { kind: 'doc', path: 'docs/workspace-folder.md' } },
      { area: 'Play', text: 'Data layer: draw a dataset as points, paths, bars, pies or lines, and step through it.', link: { kind: 'example', key: 'dataCityBars', page: 'play' } },
      { area: 'Studio', text: 'Datasets can be typed in, fetched from a link or Kaggle, or streamed live, and read by the Data node.', link: { kind: 'example', key: 'dataWeatherYear' } },
      { area: 'Play', text: 'Track mattes and masks for every layer, After Effects style.', link: { kind: 'example', key: 'maskReveal', page: 'play' } },
      { area: 'Play', text: 'Layer groups in the Layers list (⌘G), like group tracks.' },
      { area: 'Play', text: 'Choose your camera (built-in, iPhone, capture card) and its resolution; steadier hands and a Hands light in the top bar.' },
      { area: 'Present', text: 'Backgrounds per step (colour, gradient, image or a capture from a graph), legibility blur and Google Fonts.' },
    ],
  },
  {
    id: '2026.9.5',
    date: '2026-09-27',
    title: 'Hand tracking and the Background layer',
    highlights: [
      { area: 'Play', text: 'Hand tracking: fingertips, pinches and gestures drive anything, all on your device.', link: { kind: 'example', key: 'handFingertips', page: 'play' } },
      { area: 'Play', text: 'Background layer: a queue of shaders, sketches, images and videos under every layer.', link: { kind: 'example', key: 'bgQueue', page: 'play' } },
      { area: 'Play', text: '3D Script layers: p5-style boxes, spheres and lights on three.js.', link: { kind: 'example', key: 'script3DShapes', page: 'play' } },
      { area: 'Play', text: 'Proximity triggers fire when two things come close; triggers can fire once, continuously, every N or on release.', link: { kind: 'example', key: 'playProximity', page: 'play' } },
      { area: 'Play', text: 'Add layer is a grouped, searchable menu, with folders for your own layer kinds.' },
      { area: 'Studio', text: 'History: every change named, with Restore to here, and every notice kept in Activity.' },
      { area: 'Studio', text: 'Rebuild (⌘⇧↵) recompiles and resets the GPU; the preview recovers from a lost GPU on its own.' },
      { area: 'Desktop', text: 'The desktop app can use the microphone for Live audio.' },
    ],
  },
  {
    id: '2026.9.4',
    date: '2026-09-27',
    title: 'Learn with The Book of Shaders',
    highlights: [
      { area: 'Learn', text: 'Learn follows The Book of Shaders chapter by chapter: 42 short lessons, each credited to its section.', link: { kind: 'example', key: 'learnColour' } },
      { area: 'Present', text: 'Sample presentations that teach the app: getting started, your first Play, field sockets and more.', link: { kind: 'page', page: 'present' } },
      { area: 'Present', text: 'Presentations are files: an Open list, a save state, download and import.' },
      { area: 'Play', text: 'Save a Script sketch as your own layer kind, plus eight new Script examples.', link: { kind: 'example', key: 'scriptFirst', page: 'play' } },
      { area: 'Studio', text: 'Expression knobs: a new name in an input expression becomes a slider.', link: { kind: 'example', key: 'playExprKnob', page: 'play' } },
      { area: 'Studio', text: 'Field sockets work inside groups.', link: { kind: 'doc', path: 'docs/field-sockets.md' } },
      { area: 'Studio', text: 'Convert handles vec4, swizzles, rotations and discard, and turns uniforms into Play controls.' },
      { area: 'Studio', text: 'Grid and Grid Pattern: Columns now counts the columns you see (old graphs keep their look).' },
    ],
  },
  {
    id: '2026.9.3',
    date: '2026-09-26',
    title: 'The Present page and recorded performances',
    highlights: [
      { area: 'Present', text: 'The Present page: teach with Plays in steps (text and maths, live canvases, code) as slides or a scroll, and export a web page.', link: { kind: 'doc', path: 'docs/present-guide.md' } },
      { area: 'Present', text: 'Live script blocks, camera and sound on steps, and the Stage from any step.' },
      { area: 'Play', text: 'Record a performance: play live for up to a minute, watch it back, render it.', link: { kind: 'example', key: 'playTake', page: 'play' } },
      { area: 'Play', text: 'Rendered takes match what you played: feedback, echo and particles included.' },
      { area: 'Play', text: 'Exported web pages run feedback, echo, GPU particles and image, video and audio inputs.' },
      { area: 'Studio', text: 'A Grid tour: eight numbered Grid examples.', link: { kind: 'example', key: 'gridTourBuiltIn' } },
    ],
  },
  {
    id: '2026.9.2',
    date: '2026-09-25',
    title: 'Examples, palettes, and MIDI',
    highlights: [
      { area: 'Play', text: 'MIDI Input node: play the shader from a controller, or from the computer keyboard.', link: { kind: 'example', key: 'midiGlowKeys' } },
      { area: 'Studio', text: 'Node Builder: publish groups, graphs and GLSL as your own node types.' },
      { area: 'Studio', text: 'The examples, pruned and filed in folders, with new pattern nodes and a preview that explains itself.' },
      { area: 'Studio', text: 'Palette tools: paste, presets, up to 32 stops and a Curve blend; new Colorize and Stops Palette nodes.', link: { kind: 'example', key: 'colorStopsCycle' } },
      { area: 'Studio', text: 'Voxelize, SDF Fill and smart connect; an outline view and a performance panel.', link: { kind: 'example', key: 'voxelTerrain' } },
      { area: 'Studio', text: 'Audio Input reaches the shader again.' },
      { area: 'Studio', text: 'Thin, translucent scrollbars.' },
    ],
  },
  {
    id: '2026.9.1',
    date: '2026-09-24',
    title: 'A new look',
    highlights: [
      { area: 'Studio', text: 'Redesigned throughout: light and dark themes, new node cards, pages and dialogs.' },
      { area: 'Phone', text: 'Phones get a keyframe editor, a node browser and numbers you can type.' },
      { area: 'Studio', text: 'Faster: sliders update live without recompiling, and pages load when you open them.' },
      { area: 'Studio', text: 'Hover a socket to trace its wires; a group card’s name jumps into the group.' },
      { area: 'Studio', text: 'Deep Glow and Bloom nodes, and keyframes inside nested groups.' },
      { area: 'Studio', text: '2× and 4× video exports render at real high resolution.' },
      { area: 'Studio', text: 'Problems with files, storage, media or the GPU are reported instead of failing silently.' },
      { area: 'Desktop', text: 'A trackpad swipe no longer navigates away from the app.' },
    ],
  },
];
