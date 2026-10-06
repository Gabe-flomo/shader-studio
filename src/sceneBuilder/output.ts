/**
 * output.ts — what a built 3D scene shows (docs/scene-builder.md, "Output").
 *
 * The picture is the default. The march itself measures more for every pixel, and the March Loop
 * / GI Lit March already hand those out as sockets: how far the ray went (Distance, Depth), which
 * way the surface faces (Normal), whether it hit (Hit), where (Hit Pos), how many steps it took
 * (Iter), and in GI the AO and Shadow it lit with. An output shows one of them instead of the
 * picture, as grey (a number) or as a colour (a direction or a point), or "colours the space":
 * the number through a Palette (cosine palette presets) or a Color Ramp (stop presets).
 *
 * Pure data: the recipe language, the form, the graph builder, Describe and the Do… bar read it.
 */
import { PALETTE_PRESETS } from '../nodes/definitions/color';
import type { RenderMode } from './spec';

export type OutputShow = 'picture' | 'depth' | 'distance' | 'height' | 'normal' | 'hit' | 'position' | 'steps' | 'ao' | 'shadow';

export interface OutputSpec {
  show: OutputShow;
  /** Colour the space: the shown number through this palette (a key of PALETTES); none: grey or the raw colour. */
  palette?: string;
}

export interface OutputDef {
  show: OutputShow;
  label: string;
  /** Recipe words that name it (the first is printed). */
  words: string[];
  /** A number (shown grey, or through a palette) or a vec3 (shown as a colour). */
  value: 'float' | 'vec3';
  blurb: string;
  /** "You can … to get …". */
  use: string;
}

export const OUTPUTS: OutputDef[] = [
  { show: 'picture', label: 'Picture', words: ['picture', 'image', 'colour', 'color', 'lit'], value: 'vec3', blurb: 'The lit, finished picture (the default).', use: 'What Build normally makes.' },
  { show: 'depth', label: 'Depth', words: ['depth', 'z', 'zdepth', 'z-depth'], value: 'float', blurb: 'How far each surface is, 0 near the camera to 1 at Max distance (and the background).', use: 'Feed depth of field or fog by hand, or colour it for a topographic look.' },
  { show: 'distance', label: 'Distance', words: ['distance', 'dist', 'travel'], value: 'float', blurb: 'How far the ray travelled, in scene units, softly scaled by Range.', use: 'Like depth, but in the scene\'s own units: bands of equal distance.' },
  { show: 'height', label: 'Height', words: ['height', 'altitude', 'elevation', 'y'], value: 'float', blurb: 'How high the hit point is (its Y), scaled by Range round 0.', use: 'Colour it through a palette to get a height map: snow on top, sea below.' },
  { show: 'normal', label: 'Normal', words: ['normal', 'normals', 'facing', 'orientation'], value: 'vec3', blurb: 'Which way each surface faces, as a colour: X red, Y green, Z blue.', use: 'Check a shape\'s surface, or light it yourself. Through a palette: by how much it faces up.' },
  { show: 'hit', label: 'Hit mask', words: ['hit', 'mask', 'silhouette', 'coverage', 'alpha'], value: 'float', blurb: 'White where a ray touched a surface, black where it missed.', use: 'A mask of the shapes: cut them out or mix two pictures with it.' },
  { show: 'position', label: 'Position', words: ['position', 'positions', 'pos', 'point', 'world'], value: 'vec3', blurb: 'Where each ray stopped, as a colour (scaled by Range round the centre).', use: 'Texture the scene by place. Through a palette: by distance from the centre.' },
  { show: 'steps', label: 'Steps', words: ['steps', 'iterations', 'iter', 'cost', 'complexity'], value: 'float', blurb: 'How many march steps each pixel took, 0 to Max steps.', use: 'See what is expensive: edges and crevices glow. A cheap glow look too.' },
  { show: 'ao', label: 'AO', words: ['ao', 'occlusion', 'ambient-occlusion'], value: 'float', blurb: 'Ambient occlusion: dark in creases and corners where surfaces crowd in.', use: 'A clay-render look, or a mask for dirt in the corners.' },
  { show: 'shadow', label: 'Shadow', words: ['shadow', 'shadows', 'shade'], value: 'float', blurb: 'The sun\'s soft shadow: 1 in light, 0 in shadow.', use: 'A shadow pass to tint or blur on its own.' },
];

export const OUTPUT_BY_SHOW: Record<OutputShow, OutputDef> = Object.fromEntries(OUTPUTS.map(o => [o.show, o])) as Record<OutputShow, OutputDef>;
export const OUTPUT_WORDS: Record<string, OutputShow> = Object.fromEntries(OUTPUTS.flatMap(o => o.words.map(w => [w, o.show])));

/** The palettes "colour the space" offers: Palette node presets (cosine) and Color Ramp stop sets. */
export interface PaletteDef {
  key: string;
  label: string;
  kind: 'palette' | 'ramp';
  /** Palette: the preset's index in PALETTE_PRESETS. */
  preset?: number;
  /** Ramp: its stops (2–8). */
  stops?: Array<[number, number, number]>;
}

const presetIndex = (name: string) => Math.max(0, PALETTE_PRESETS.findIndex(p => p.name === name));

export const PALETTES: PaletteDef[] = [
  { key: 'sunset', label: 'Sunset', kind: 'palette', preset: presetIndex('Sunset') },
  { key: 'rainbow', label: 'Rainbow', kind: 'palette', preset: presetIndex('IQ Rainbow') },
  { key: 'fire', label: 'Fire', kind: 'palette', preset: presetIndex('Fire') },
  { key: 'forest', label: 'Forest', kind: 'palette', preset: presetIndex('Forest') },
  { key: 'teal', label: 'Blue-teal', kind: 'palette', preset: presetIndex('IQ Blue-Teal') },
  { key: 'warm', label: 'Warm', kind: 'palette', preset: presetIndex('IQ Warm') },
  { key: 'haze', label: 'Purple haze', kind: 'palette', preset: presetIndex('Purple Haze') },
  { key: 'psychedelic', label: 'Psychedelic', kind: 'palette', preset: presetIndex('Psychedelic') },
  { key: 'mono', label: 'Black to white', kind: 'ramp', stops: [[0, 0, 0], [1, 1, 1]] },
  { key: 'heat', label: 'Heat', kind: 'ramp', stops: [[0, 0, 0], [0.6, 0.05, 0.1], [1, 0.5, 0.05], [1, 1, 0.75]] },
  { key: 'ice', label: 'Ice', kind: 'ramp', stops: [[0.02, 0.03, 0.12], [0.1, 0.45, 0.8], [0.85, 0.97, 1]] },
  { key: 'terrain', label: 'Terrain', kind: 'ramp', stops: [[0.05, 0.15, 0.45], [0.85, 0.8, 0.55], [0.25, 0.55, 0.2], [0.45, 0.35, 0.25], [1, 1, 1]] },
];

export const PALETTE_BY_KEY: Record<string, PaletteDef> = Object.fromEntries(PALETTES.map(p => [p.key, p]));
export const DEFAULT_PALETTE = 'sunset';

/** The output a spec shows (absent: the picture). */
export const outputOf = (o: OutputSpec | undefined): OutputSpec => o ?? { show: 'picture' };
export const isPicture = (o: OutputSpec | undefined) => !o || o.show === 'picture';

/** Why an output doesn't apply in a render mode (null: it does). */
export function outputProblem(mode: RenderMode, o: OutputSpec | undefined): string | null {
  if (isPicture(o)) return null;
  if (mode === 'volumetric') return o!.show === 'steps' ? null : 'Volumetric glow walks through the shapes and never stops at a surface, so it has no depth, normal or hit: only Steps (and the picture) apply. It shows the picture.';
  if (mode === 'glass') return 'Glass Scene marches inside its own node and hands out only its colour: it shows the picture.';
  return null;
}

/** "output depth" / "colour by depth palette sunset": the recipe clause (empty for the picture). */
export function outputClause(o: OutputSpec | undefined): string {
  if (isPicture(o)) return '';
  const word = OUTPUT_BY_SHOW[o!.show].words[0];
  return o!.palette ? `colour by ${word} palette ${o!.palette}` : `output ${word}`;
}
