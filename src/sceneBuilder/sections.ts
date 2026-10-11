/**
 * sections.ts — the 3D Scene Builder's sections on the studio shell (docs/scene-builder-3d.md, "The
 * sections"): what each lets you build, in plain words, following the recipe help's sections
 * (lang/help.ts: Modes, Shapes, Combine, Warps, Settings, Camera, Colours, Output). Each has a
 * short line, a Learn more and a one-line summary of the scene for the left nav.
 *
 * Pure: the window (components/sceneBuilder/SceneStudio.tsx) draws them.
 */
import type { BuilderTab } from './store';
import { OUTPUT_BY_SHOW } from './output';
import { allShapes, itemName, opLabel, walkItems, WARP_BY_KIND, SHAPE_BY_KIND, type SceneSpec } from './spec';

export type SceneSection = 'mode' | 'shapes' | 'combine' | 'warps' | 'light' | 'camera' | 'output';

export interface SectionInfo {
  id: SceneSection;
  label: string;
  /** An icon name (components/ui/iconPaths.ts). */
  icon: string;
  /** What you can build here, in one line. */
  line: string;
  /** Learn more: a short paragraph. */
  learn: string;
}

export const SCENE_SECTIONS: SectionInfo[] = [
  { id: 'mode', label: 'Mode', icon: 'eye', line: 'How the scene is drawn: solid lit surfaces, glowing see-through gas, or glass.',
    learn: 'Surface finds where each ray lands and lights it: a sun with soft shadows, a sky from above and a bounce from below, each shape with its own colour and shine. Volumetric walks every ray right through the shapes, adding glow as it goes: neon, plasma, nebulae. Glass bends the rays through glass shapes and shows the rest through them. GI lit adds one bounce of light between nearby surfaces and a reflection, with one colour for every shape.' },
  { id: 'shapes', label: 'Shapes', icon: 'cube', line: 'What is in the scene: pick shapes, size them, place and turn them.',
    learn: 'Click a picture to add a shape. Click a shape in the viewport to pick it, then drag its arrows to move it and its ring to size it, or use the sliders. A box, box frame and ellipsoid have a width, height and depth; a cylinder, capsule and prism a radius and height. Linked keeps their proportions while you size them; Separate gives each its own slider. Modifiers (move, twist, round, hollow…) change just this shape.' },
  { id: 'combine', label: 'Combine', icon: 'layers', line: 'How shapes join: union, cut one from another, or keep the overlap, hard or melted.',
    learn: 'Every group joins what is inside it. Union keeps both (the nearer surface wins); Subtract cuts every later item out of the first; Intersect keeps only where they all overlap. The smooth ones blend the join over the blend radius k, so shapes melt together like putty. Drag rows in the tree to reorder or nest them; Wrap in… puts a new group round what you picked.' },
  { id: 'warps', label: 'Warps', icon: 'wave', line: 'Bend space: repeat, mirror, twist, bend or ripple the whole scene or one part.',
    learn: 'Warps change space before the shapes are measured, top to bottom: a Repeat makes endless copies at no extra cost, Mirror folds space onto itself, Twist turns it more the higher it goes. Warps that stretch space make the march take smaller steps (Step Scale on auto in Output), or a ray can jump through a surface.' },
  { id: 'light', label: 'Light & colour', icon: 'sun', line: 'Colours of the shapes, the sun, the sky, shadows, fog and the background.',
    learn: 'Each shape\'s colour and shine show in Surface mode. The sun shades and shadows the surfaces; the sky colours them from above and the bounce from below. Fog fades the distance into the background\'s colour (or its own). The background is what a ray that misses everything sees: one colour, or a gradient from top to bottom.' },
  { id: 'camera', label: 'Camera', icon: 'camera', line: 'Where you look from: distance, angle, height, zoom, a slow orbit and the projection.',
    learn: 'The orbit camera circles the point it looks at. Drag in the viewport to turn it round, scroll to come closer. Orbit speed turns it on its own over time. Projection is how its rays leave it: Perspective (far things smaller; Flatten blends it toward an isometric look), Orthographic (parallel rays: sizes do not change with distance, parallel edges stay parallel) or Reverse (far things bigger, like a Byzantine icon). Translate moves the camera and the point it looks at together.' },
  { id: 'output', label: 'Output', icon: 'sliders', line: 'What the scene shows (the picture, depth, normals…), the tone map and quality.',
    learn: 'Besides the lit picture, the march measures depth, distance, height, normals, where rays hit, and how many steps they took: show any of them, as grey or through a palette. Tone map squeezes bright light into screen colours. Quality: more steps reach finer detail and cost more; Step Scale below 1 keeps warped space from tearing.' },
];

export const SECTION_BY_ID = Object.fromEntries(SCENE_SECTIONS.map(s => [s.id, s])) as Record<SceneSection, SectionInfo>;

/** The section that holds an older tab (the window used to have Look, Quality, Recipe and Templates tabs). */
export function sectionOfTab(tab: BuilderTab): SceneSection | 'describe' {
  switch (tab) {
    case 'look': return 'light';
    case 'quality': return 'output';
    case 'recipe': case 'templates': return 'shapes';
    default: return tab;
  }
}

const MODE_WORD = { surface: 'Surface', volumetric: 'Volumetric glow', glass: 'Glass', gi: 'GI lit' } as const;
const r = (v: number) => String(Math.round(v * 100) / 100);

/** One line about the scene for a section's row in the nav. */
export function sectionSummary(spec: SceneSpec, id: SceneSection): string {
  const L = spec.look, C = spec.camera;
  switch (id) {
    case 'mode': return MODE_WORD[L.mode];
    case 'shapes': {
      const shapes = allShapes(spec);
      if (!shapes.length) return 'none yet';
      const names = shapes.slice(0, 3).map(s => (s.kind === 'custom' ? 'custom' : SHAPE_BY_KIND[s.kind]?.label.toLowerCase() ?? s.kind));
      return `${shapes.length}: ${names.join(', ')}${shapes.length > 3 ? '…' : ''}`;
    }
    case 'combine': {
      const groups: string[] = [];
      walkItems(spec.root, it => { if (it.type === 'group' && (it.id !== spec.root.id || it.children.length > 1)) groups.push(`${opLabel(it).toLowerCase()}${it.k > 0 ? ` k ${r(it.k)}` : ''}`); });
      return groups.length ? groups.slice(0, 2).join(', ') + (groups.length > 2 ? '…' : '') : 'one shape';
    }
    case 'warps': {
      const ws: string[] = [];
      walkItems(spec.root, it => { for (const w of it.warps) ws.push(`${WARP_BY_KIND[w.kind]?.label.toLowerCase() ?? 'custom'}${it.id === spec.root.id ? '' : ` on ${itemName(spec, it)}`}`); });
      return ws.length ? ws.slice(0, 2).join(', ') + (ws.length > 2 ? '…' : '') : 'space unbent';
    }
    case 'light': {
      if (L.mode === 'volumetric') return `glow tint, ${L.bg2 ? 'gradient' : 'solid'} background`;
      const bits = [L.mode === 'surface' ? (L.shadows ? 'shadows' : 'no shadows') : null, L.fog > 0 ? `fog ${r(L.fog)}` : null, L.bg2 ? 'sky gradient' : null].filter(Boolean);
      return bits.length ? `sun, ${bits.join(', ')}` : 'sun and sky';
    }
    case 'camera': return `${r(C.dist)} away, ${r(C.angle)}° round${C.orbit ? `, orbit ${r(C.orbit)}°/s` : ''}${C.projection === 'orthographic' ? ', orthographic' : C.projection === 'reverse' ? ', reverse' : ''}`;
    case 'output': {
      const o = spec.output;
      const show = o && o.show !== 'picture' ? `${OUTPUT_BY_SHOW[o.show].label.toLowerCase()}${o.palette ? ` · ${o.palette}` : ''}` : 'the picture';
      return `${show} · ${L.tone === 'none' ? 'no tone map' : L.tone.toUpperCase()} · ${spec.quality.steps} steps`;
    }
  }
}
