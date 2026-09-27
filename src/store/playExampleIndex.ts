/**
 * playExampleIndex.ts — names and one-line descriptions for the Play folder.
 * Kept apart from the records themselves (playExamples.ts) so the examples
 * browser can list them without loading every graph up front.
 */

// [key, title, description], in learning order. The number comes from the position.
const ROWS: Array<[string, string, string]> = [
  ['playControls', 'Controls from the graph', 'Sliders on the Play page drive live params of the graph. No mappings yet: just the panel.'],
  ['playMouse', 'Mouse moves a slider', 'The simplest mapping: the mouse position drives two controls, with smoothing.'],
  ['playCurves', 'Remap curves', 'Linear, Exp, Log and a hand-drawn curve shape how a source becomes a value.'],
  ['playLfo', 'LFOs and the clock', 'Oscillators that move controls on their own: free-running LFOs and a tempo-locked clock.'],
  ['playNoise', 'Noise: smooth, drift, random, stepped', 'Four kinds of random motion for controls.'],
  ['playCrossMod', 'Controls that drive controls', 'A control can be a source: move one slider and another follows.'],
  ['playExprKnob', 'Expression knobs', 'A slider inside an input expression, driven by an LFO like any control.'],
  ['playColour', 'Colour channels', 'Mappings on a colour control: brightness, or one channel at a time.'],
  ['playKeys', 'Keys: hold and hit', 'A held key is a gate; a trigger plays an envelope each time you press.'],
  ['playTriggerModes', 'Triggers: toggle, step, random', 'Besides envelopes, a trigger can toggle, walk through steps, or pick a random value.'],
  ['playBeat', 'Beats', 'A beat trigger fires on its own at a tempo: a metronome for envelopes, steps and actions.'],
  ['playLiveAudio', 'Live audio (mic or DAW)', 'Listen to a mic or a virtual cable: bands drive controls, and hits fire triggers.'],
  ['playMidi', 'MIDI controller', 'Knobs (CC), notes and velocity from any MIDI keyboard or controller.'],
  ['playOsc', 'OSC (Ableton, TouchOSC)', 'Open Sound Control messages from Ableton, TouchOSC or any OSC app.'],
  ['playTilt', 'Phone tilt', 'Tilt a phone to steer: device orientation as sources.'],
  ['playNull', 'Nulls: a point you drag', 'A null is a point on the picture whose position is a source.'],
  ['playSpringNull', 'Following nulls (springs)', 'Nulls that chase the mouse or each other on a spring, with lag and wobble.'],
  ['playNullDistance', 'Distance between nulls', 'A sensor: how far apart two nulls are, as a source.'],
  ['playTextMattes', 'Text: over, reveal, luma', 'Three ways text meets the picture.'],
  ['playLayersOnly', 'Picture: layers only', 'Hide the shader and show it only through the layers.'],
  ['playTextSequence', 'Text sequences', 'One line at a time, stepped by keys or a timer, with transitions.'],
  ['playImage', 'Images', 'Your own picture (PNG, JPG, SVG) as a layer, blended or matted.'],
  ['playCamera', 'Camera', 'Your webcam as a picture for glyphs, and its motion as a source.'],
  ['playBrush', 'Brush', 'Paint on the picture. Strokes fade, and can be walls for particles.'],
  ['playAudioLayer', 'Audio visualiser', 'Live sound drawn as a waveform, spectrum bars, a ring or a blob.'],
  ['playGlyphs', 'Glyphs: ASCII and halftone', 'The picture redrawn on a grid of characters or dots.'],
  ['playContours', 'Contours', 'Topographic lines through the picture\'s brightness.'],
  ['playLens', 'Lens', 'A circle that magnifies, pixelates, blurs or inverts what is under it.'],
  ['playFlow', 'Particles: flow field', 'Brightness becomes a direction: particles stream along the picture.'],
  ['playClimb', 'Particles: climb and descend', 'Uphill toward light or downhill toward dark; on flat areas, wander or settle.'],
  ['playNoiseField', 'Particles: noise field', 'A drifting flow field that ignores the picture.'],
  ['playAttractor', 'Attractors', 'Particles pulled toward the mouse: gravitate, spiral or repel.'],
  ['playEmitAbsorb', 'Emitters and absorbers', 'Particles born at one null and swallowed by another: field lines.'],
  ['playFlock', 'Flocking', 'Boids: particles steer by their neighbours.'],
  ['playBursts', 'Bursts on the beat', 'Particles that exist only when an action throws them out.'],
  ['playPlexus', 'Collisions and links', 'Particles that bump into each other, joined by lines to their neighbours.'],
  ['playLooks', 'Particle looks', 'Shapes, palettes, and size that follows a null.'],
  ['playParticleMask', 'Particles as a mask', 'Particles that show the shader through them instead of a colour.'],
  ['playWalls', 'Walls and containers', 'Shapes that particles bounce off or can\'t leave.'],
  ['playPortals', 'Portals', 'Particles that enter one shape come out of another.'],
  ['playForces', 'Wind, vortex and drag', 'Zones that push, swirl and slow particles.'],
  ['playTintZones', 'Tint and resize zones', 'Particles change colour and size while inside a shape.'],
  ['playSensors', 'Sensors: how full is the box', 'A shape measures how crowded it is, and that drives the shader.'],
  ['playShapeTriggers', 'Shape triggers', 'Click a shape, move onto it, or fill it with particles to fire actions.'],
  ['playDrawnShapes', 'Drawn shapes and trim', 'Outlines you draw, drawn on over time with Trim.'],
  ['playPictureShape', 'The picture as a shape', 'The bright parts of the shader become solid.'],
  ['playGlowText', 'Glowing text and strokes', 'The Layers node: SDF Glow on whatever the layers draw.'],
  ['scriptFirst', 'Script: a first sketch', 'A JavaScript sketch over the shader: setup and draw, with sliders it declares.'],
  ['scriptMouse', 'Script: the mouse', 'A chain of beads chases s.mouse; hold the button to swell it.'],
  ['scriptPicture', 'Script: reading the picture', 'Dots land where the shader is bright: s.picture.brightness makes a stipple.'],
  ['scriptNulls', 'Script: nulls as handles', 'A string between two nulls, plucked by a third that follows the mouse.'],
  ['scriptButtons', 'Script: buttons on keys and beats', 'Buttons a sketch declares are actions: a beat and keys fire rings.'],
  ['scriptParticles', 'Script: particles in plain JS', 'Spawn, move, draw, die: a spark fountain in forty lines.'],
  ['scriptP5', 'Script: a p5 sketch, pasted in', 'p5 vocabulary as plain names; its variables become sliders.'],
  ['scriptGlow', 'Script: the shader glows around it', 'The Layers node reads the sketch back, and SDF Glow turns its lines to neon.'],
  ['bgColourSketch', 'Background: a colour, no shader', 'Background → Colour: the graph pauses and a Script layer runs alone on a flat colour, a CPU toy.'],
  ['bgPhotoFlow', 'Background: particles over a photo', 'Background → Image: a photo instead of the shader, and a flow field of particles reading it.'],
  ['playTake', 'A recorded take', 'Ships with an 8-second performance: watch it back and Render it without playing.'],
  // Bigger pieces that put several techniques together (their graphs live in exampleGraphs.ts).
  ['particleGlow', 'Particle Glow', 'Emitter, absorber and flock, glowing through the Layers node.'],
  ['flowAroundWords', 'Flow Around Words', 'Particles over an FBM landscape part around a word that acts as a wall.'],
  ['letterDrop', 'Letter Drop', 'Physics bodies: letters slide down a funnel of drawn shapes and pile on a glowing hill.'],
];

const num = (i: number) => String(i + 1).padStart(2, '0');

export const PLAY_EXAMPLE_KEYS: string[] = ROWS.map(r => r[0]);

export const PLAY_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = Object.fromEntries(
  ROWS.map(([key, title, description], i) => [key, { label: `${num(i)} · ${title}`, description, play: true as const }]),
);

/** The Play folder in topics, for browsers that show it in subfolders. Every key lands in exactly one. */
const GROUP_STARTS: Array<[string, string]> = [
  ['Controls and mappings', 'playControls'],
  ['Inputs', 'playKeys'],
  ['Nulls', 'playNull'],
  ['Layers', 'playTextMattes'],
  ['Particles', 'playFlow'],
  ['Shapes and zones', 'playWalls'],
  ['Scripts', 'scriptFirst'],
  ['Backgrounds', 'bgColourSketch'],
  ['Recording', 'playTake'],
  ['Bigger pieces', 'particleGlow'],
];
export const PLAY_EXAMPLE_GROUPS: Array<{ label: string; keys: string[] }> = GROUP_STARTS.map(([label, first], i) => {
  const from = PLAY_EXAMPLE_KEYS.indexOf(first);
  const next = GROUP_STARTS[i + 1];
  const to = next ? PLAY_EXAMPLE_KEYS.indexOf(next[1]) : PLAY_EXAMPLE_KEYS.length;
  return { label, keys: PLAY_EXAMPLE_KEYS.slice(from, to) };
});
