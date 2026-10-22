import type { NodeDefinition } from '../types/nodeGraph';

/**
 * Everyday words people search for, per node type, beyond each definition's own `aliases` (the node audit's
 * search misses, docs/node-retirements.md "Search"). They count like aliases.
 */
export const SEARCH_WORDS: Record<string, string[]> = {
  boxSDF: ['Square', 'Rectangle', 'Rect'],
  sin: ['Sine', 'Sine wave'],
  cos: ['Cosine', 'Cosine wave'],
  select: ['If', 'Switch', 'Branch', 'Choose', 'Ternary', 'If else'],
  compare: ['If', 'Greater than', 'Less than', 'Branch', 'Condition'],
  mix: ['Lerp', 'Interpolate', 'Blend between', 'Crossfade'],
  marchLoopGroup: ['Raymarch', 'Ray march', 'Raymarcher', 'Ray marching', 'Sphere tracing', 'Render 3D'],
  marchCamera: ['3D camera', 'Camera 3D', 'Ray camera', 'Raymarch camera'],
  toneMap: ['Tonemap', 'HDR', 'Exposure', 'ACES', 'Filmic', 'Reinhard'],
  noiseFloat: ['Perlin', 'Perlin noise', 'Simplex', 'Simplex noise', 'Value noise'],
  noise: ['Noise texture', 'Blender noise', 'Gradient noise', 'Marble', 'Octaves'],
  fbm: ['Perlin noise', 'Clouds', 'Octaves'],
  voronoi: ['Worley', 'Worley noise', 'Cellular', 'Cells'],
  posterize: ['Banding', 'Colour steps'],
  dither: ['Dithering', 'Dots', 'Newspaper', 'Print'],
  normalFromHeight: ['Embossed', 'Terrain', 'Shiny'],
  advect: ['Smoke', 'Ink', 'Marbling', 'Fluid', 'Liquid', 'Flow', 'TouchDesigner feedback displace'],
  convolve: ['Sharpen', 'Emboss', 'Edge detect', 'Filter', 'Kernel', 'TouchDesigner convolve'],
  kuwahara: ['Oil paint', 'Painterly', 'Painting', 'Watercolour', 'Watercolor', 'Brush', 'Cartoon', 'Smooth edges', 'Filter'],
  sdfBevel: ['Bevel', 'Emboss', '3D button', 'Raised', 'Engraved', 'Inset', 'Drop shadow'],
  glitch: ['VHS'],
  crtScreen: ['CRT', 'Old TV'],
  scanlines: ['CRT', 'VHS', 'TV lines'],
  hsv: ['HSL', 'Hue saturation'],
  textureInput: ['Photo'],
  text: ['Font', 'Letters', 'Words', 'Typography', 'Type'],
  gridPattern: ['Checker', 'Checkerboard', 'Tiles'],
  waveTexture: ['Stripes', 'Bands'],
  rippleSpace: ['Water', 'Ripples', 'Waves'],
  turbulence: ['Fire', 'Flames', 'Water'],
  gpuParticles: ['Fire'],
  constant: ['Slider', 'Number', 'Value'],
  cache: ['Record', 'Freeze', 'Delay buffer'],
  sampleHold: ['Freeze', 'Hold', 'Latch'],
  segment: ['People', 'Person', 'Face', 'Cutout', 'Background removal'],
  blobTrack: ['Track', 'Tracking', 'Follow', 'Face track'],
  ease: ['Bounce', 'Elastic', 'Spring', 'Ease out back', 'Animate from to'],
};

/** Search words the node is the default answer for, beyond its own `leadsFor`. */
export const SEARCH_LEADS: Record<string, string[]> = {
  boxSDF: ['square', 'rectangle'],
  sin: ['sine'],
  cos: ['cosine'],
  // Shape SDF draws these (its Shape options); other nodes only mention them.
  shapeSDF: ['heart', 'star', 'hexagon', 'pentagon', 'octagon', 'polygon', 'triangle', 'moon', 'cross', 'arrow'],
  toneMap: ['tonemap', 'tone map'],
  // Ease plays the named motion curves (Shaper has Golan Levin's maths ones).
  ease: ['easing', 'tween', 'ease in', 'ease out'],
  transform: ['translate 3d', 'rotate 3d', 'scale 3d', 'move 3d', 'translate 4d', 'rotate 4d', 'scale 4d', 'translate 2d', 'rotate 2d'],
};

/** The labels of a node's select options that count in search (Shape SDF's shapes: "heart" finds it). */
function optionLabels(def: NodeDefinition): string[] {
  return (def.searchOptions ?? []).flatMap(k => def.paramDefs?.[k]?.options?.map(o => o.label.toLowerCase()) ?? []);
}

/**
 * Search score for a node definition (0 = no match). Substring/prefix only, no fuzzy scatter.
 * Old names (`aliases`) rank just under the current label, so "Make Light" still finds
 * SDF Glow after a rename; an alias that is the whole query ranks above a label that only starts with it
 * ("if" is Select's word, not the start of "IFS").
 */
export function scoreNodeDef(def: NodeDefinition, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const label = def.label.toLowerCase();
  // The default node for a word (Transform for "move", "translate"…) comes first, the specific ones after it.
  const leads = [...(def.leadsFor ?? []), ...(SEARCH_LEADS[def.type] ?? [])];
  if (q.length >= 3 && leads.some(w => w.startsWith(q))) return 130;
  if (label === q) return 120;
  const aliases = [...(def.aliases ?? []), ...(SEARCH_WORDS[def.type] ?? [])].map(a => a.toLowerCase());
  if (aliases.some(a => a === q)) return 105;
  if (label.startsWith(q)) return 100;
  if (aliases.some(a => a.startsWith(q))) return 90;
  // A select option's label (Shape SDF's Heart, Star, Hexagon…).
  const options = optionLabels(def);
  if (options.some(o => o === q || o.startsWith(q))) return 85;
  if (label.includes(q)) return 80;
  if (aliases.some(a => a.includes(q))) return 70;
  if (options.some(o => o.includes(q))) return 65;
  if (def.type.toLowerCase().includes(q)) return 60;
  // Category word starts with the query (word boundary, so "sign" won't match "design")
  const cat = (def.category ?? '').toLowerCase();
  if (cat.split(/[\s/,]+/).some(w => w.startsWith(q))) return 40;
  // Description contains the query as a whole word
  const rawDesc = def.description as string | string[] | undefined;
  const desc = (Array.isArray(rawDesc) ? rawDesc.join(' ') : (rawDesc ?? '')).toLowerCase();
  if (desc.split(/\W+/).some(w => w === q)) return 20;
  return 0;
}
