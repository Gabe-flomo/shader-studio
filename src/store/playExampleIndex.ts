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
  ['playAudioReaders', 'Audio readers', 'Dots on the live spectrum: a kick drives a pulse, hi-hats fire sparks, a voice shifts the colour.'],
  ['playMidi', 'MIDI controller', 'Knobs (CC), notes and velocity from any MIDI keyboard or controller.'],
  ['playPadGrid', 'Pad grid (Push, Launchpad)', 'A grid controller\'s pads light and grow the matching cells of a grid shader; click them without one.'],
  ['playOsc', 'OSC (Ableton, TouchOSC)', 'Open Sound Control messages from Ableton, TouchOSC or any OSC app.'],
  ['playTilt', 'Phone tilt', 'Tilt a phone to steer: device orientation as sources.'],
  ['playNull', 'Nulls: a point you drag', 'A null is a point on the picture whose position is a source.'],
  ['playSpringNull', 'Following nulls (springs)', 'Nulls that chase the mouse or each other on a spring, with lag and wobble.'],
  ['playNullDistance', 'Distance between nulls', 'A sensor: how far apart two nulls are, as a source.'],
  ['playProximity', 'Proximity: fire when close', 'Two nulls come close: a burst once, then a trail of sparks every 3 frames while they stay.'],
  ['playConditions', 'Conditions and signals', 'When a distance or a slider crosses a line, send a signal; a chain of signals bursts particles and steps the words.'],
  ['playPairs', 'Pairs, XY pads and axis swap', 'Two controls as one: an XY pad, an LFO that walks X then Y with an axis swap, and a pair with a per-axis condition.'],
  ['playIncrement', 'Increments: move in steps', 'Controls that step instead of following: on the beat with a growing step, on a signal with a bounce, on a threshold with a wrap.'],
  ['playTextMattes', 'Text: over, reveal, luma', 'Three ways text meets the picture.'],
  ['playLayersOnly', 'Picture: layers only', 'Hide the shader and show it only through the layers.'],
  ['playTextSequence', 'Text sequences', 'One line at a time, stepped by keys or a timer, with transitions.'],
  ['playImage', 'Images', 'Your own picture (PNG, JPG, SVG) as a layer, blended or matted.'],
  ['playCamera', 'Camera', 'Your webcam as a picture for glyphs, and its motion as a source.'],
  ['playVideoSound', 'Video with sound', 'Pick a video: its lows pulse the glow and its highs fire sparks, through audio readers on its sound.'],
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
  ['playMultiply', 'Multiply', 'One particle buds into two hundred as goo; pairs annihilate, and the colony grows again.'],
  ['playWalls','Walls and containers', 'Shapes that particles bounce off or can\'t leave.'],
  ['playPortals', 'Portals', 'Particles that enter one shape come out of another.'],
  ['playForces', 'Wind, vortex and drag', 'Zones that push, swirl and slow particles.'],
  ['playTintZones', 'Tint and resize zones', 'Particles change colour and size while inside a shape.'],
  ['playSensors', 'Sensors: how full is the box', 'A shape measures how crowded it is, and that drives the shader.'],
  ['playChase', 'Relationship: a chase', 'A null hunts a circle that flees; out of sight it wanders. A catch flashes the glow and bursts particles.'],
  ['playOrbit', 'Relationship: orbits and the picture', 'Three shapes orbit a heavy sun (attract with overshoot) and drift toward the bright glow; closing speed drives the brightness.'],
  ['playBoids', 'Agents: boids', 'Three hundred agents flock by three rules (align, cohere, separate); the mouse parts the flock.'],
  ['playPredatorPrey', 'Agents: predators and prey', 'Two groups: prey flock and flee, predators hunt, catch and starve; every catch flashes the glow.'],
  ['playShapeTriggers', 'Shape triggers', 'Click a shape, move onto it, or fill it with particles to fire actions.'],
  ['playDrawnShapes', 'Drawn shapes and trim', 'Outlines you draw, drawn on over time with Trim.'],
  ['playPictureShape', 'The picture as a shape', 'The bright parts of the shader become solid.'],
  ['playGlowText', 'Glowing text and strokes', 'The Layers node: SDF Glow on whatever the layers draw.'],
  ['scriptFirst', 'Script: a first sketch', 'A JavaScript sketch over the shader: setup and draw, with sliders it declares.'],
  ['script3D', 'Script: 3D on a 2D canvas', 'A lit torus, ball or cube turning over SDF Glow, projected and sorted in plain JavaScript.'],
  ['script3DShapes', '3D Script: shapes over the shader', 'Lit boxes, spheres and rings in WebGL over SDF Glow, with p5’s 3D names. Drag to orbit.'],
  ['script3DTexture', '3D Script: the shader on a cube', 'A cube skinned with the live picture through s.picture.texture.'],
  ['scriptMouse', 'Script: the mouse', 'A chain of beads chases s.mouse; hold the button to swell it.'],
  ['scriptPicture', 'Script: reading the picture', 'Dots land where the shader is bright: s.picture.brightness makes a stipple.'],
  ['scriptNulls', 'Script: nulls as handles', 'A string between two nulls, plucked by a third that follows the mouse.'],
  ['scriptButtons', 'Script: buttons on keys and beats', 'Buttons a sketch declares are actions: a beat and keys fire rings.'],
  ['scriptParticles', 'Script: particles in plain JS', 'Spawn, move, draw, die: a spark fountain in forty lines.'],
  ['scriptP5', 'Script: a p5 sketch, pasted in', 'p5 vocabulary as plain names; its variables become sliders.'],
  ['p5FlowField', 'p5: an imported flow field', 'A p5.js project imported as it is: its sliders, checkbox and select become the layer’s controls.'],
  ['p5MultiFile', 'p5: a sketch in three files', 'A class, some helpers and a sketch, as three tabs in one scope. Click to burst particles.'],
  ['p5Webgl', 'p5: a WEBGL sketch in 3D', 'createCanvas(…, WEBGL) runs on the 3D Script mode: lit shapes in orbit.'],
  ['scriptGlow', 'Script: the shader glows around it', 'The Layers node reads the sketch back, and SDF Glow turns its lines to neon.'],
  ['bgColourSketch', 'Background: a colour, no shader', 'Background → Colour: the graph pauses and a Script layer runs alone on a flat colour, a CPU toy.'],
  ['bgPhotoFlow', 'Background: particles over a photo', 'Background → Image: a photo instead of the shader, and a flow field of particles reading it.'],
  ['bgQueue', 'Background queue', 'Two graphs and a photo in a Background layer: keys 1, 2, 3 and a beat step through them, crossfading, with fireflies reading the picture.'],
  ['matteParticles', 'Matte: a photo through particles', 'A track matte: the photo shows only where a hidden particles layer (and its trails) is.'],
  ['maskReveal', 'Masks: text through a moving window', 'Text matted by a hidden circle that sweeps across, over ASCII cut by a feathered mask of its own.'],
  ['motionReveal', 'Motion: reveal and trigger where it moves', 'A Motion layer watches the picture (or your camera, or a video): its matte reveals a photo, sparks are born in it, a readout follows it, and rules fire when movement starts, gets big and stops.'],
  ['handFingertips', 'Hands: fingertips move particles', 'Nulls follow your fingertips: particles flow from your index finger into your thumb.'],
  ['handPinch', 'Hands: pinch, point and fist', 'Pinch drives a slider, a fist fires a burst, pointing toggles a setting.'],
  ['handTwoHands', 'Hands: two at once', 'How far apart your hands are zooms the picture; their heights mix the colour.'],
  ['handProximity', 'Hands: touch a shape', 'A fingertip near a circle steps the text to its next line and flashes the glow.'],
  ['handPaths', 'Hand paths', 'A shape between four fingertips: a window through ASCII that moves with your hands, strung with a web. Works without a camera too.'],
  ['playTake', 'A recorded take', 'Ships with an 8-second performance: watch it back and Render it without playing.'],
  ['finishGrade', 'Finish: grade and lens', 'A grade, lens distortion, chromatic aberration and a vignette over the shader and a layer; the mouse sets the white balance.'],
  ['finishLooks', 'Finish: looks and split toning', 'Teal & orange as a starting point: split toning, colour wheels and curves you can keep changing.'],
  ['finishScreen', 'Finish: CRT, bloom, grain and shake', 'A curved CRT with its shadow mask and glow, bloom, grain and flicker; Space shakes the camera.'],
  ['finishHalation', 'Finish: halation', 'Film’s thin red bleed on a test scene: bright edges and lamps bleed red onto the dark beside them; teal doesn’t.'],
  ['finishTime', 'Finish: time displacement', 'Slit-scan: the top of the picture is 30 frames behind the bottom, over a drifting shader and a comet layer.'],
  ['finishPixelSort', 'Finish: pixel sort and light leaks', 'A photo whose bright runs drip into sorted streaks, with warm light leaking in from the edges; two LFOs keep the streaks moving.'],
  ['finishPrint', 'Finish: comic print', 'Posterize, Ink outline Edges and a CMYK Halftone turn a drifting landscape and a title into a comic-book page.'],
  ['finishTerminal', 'Finish: ASCII terminal', 'Breathing rings with ghost trails, redrawn as green characters on a slightly curved, blooming screen.'],
  ['finishKaleidoscope', 'Finish: presets into a mandala', 'Feedback (Tunnel), Mirror (Mandala) and Edges (Neon), each from its preset, fold a drifting noise into a moving neon mandala.'],
  ['finishDatamoshEcho', 'Finish: datamosh and layer echo', 'A moving shape leaves sharp echoes of itself and drags the picture behind it in datamoshed blocks until a keyframe heals it; hold M to mosh.'],
  ['finishMotionExtract', 'Finish: motion extract', 'Only what moves shows: an orbiting glow and a sliding word as neon outlines, cyan where they arrive and magenta where they leave.'],
  ['drumPads', 'Drum pads', 'A 4 × 4 sampler of generated drums: hit pads with keys, clicks or MIDI; the kick pulses the glow and the hats throw sparks. Silent until you play.'],
  ['granulator', 'Granulator', 'A cloud of grains from the generated pad chord: the mouse scans the sample and sets the grain size, a reader swells the glow, and three grains ride nulls; then particles inside a drifting ring play it as chimes. Click first to hear it.'],
  ['audioEffects', 'Audio effects', 'A filter swept by the mouse and a ping-pong echo on the master bus, with a reader hearing the result. Press Play test loop.'],
  ['pianoRollScale', 'Piano roll: a clip in a scale', 'A four-bar riff on the tape in A minor pentatonic, with the tape\'s Scale on and Snap to scale on the rack; double-click the clip for the piano roll.'],
  ['granulatorSpectral', 'Granulator: Spectral, emitted grains', 'A Granulator in Spectral mode playing frequency bands of the pad chord, its grains emitted and travelling; four nulls show where and which band.'],
  ['particlesEngineTrack', 'Particles: hear an engine track', 'A Particles node in the graph listening to the Audio engine\'s Kick track: every kick on the tape fires a shockwave through the field.'],
  // Bigger pieces that put several techniques together (most of their graphs live in exampleGraphs.ts).
  ['particleGlow', 'Particle Glow', 'Emitter, absorber and flock, glowing through the Layers node.'],
  ['flowAroundWords', 'Flow Around Words', 'Particles over an FBM landscape part around a word that acts as a wall.'],
  ['letterDrop', 'Letter Drop', 'Physics bodies: letters slide down a funnel of drawn shapes and pile on a glowing hill.'],
  // Look effects you build (after the bigger pieces, so the numbers before it stay as they were).
  ['lookBuilt', 'Look: effects from nodes and code', 'A duotone built from four Studio nodes and a tape wobble written in GLSL, both effects in the Look stack; the mouse fades the duotone in.'],
  // Last, so the examples before it keep their numbers.
  ['finishWater', 'Water: a wake, rain and splashes', 'A simulated water surface over a pool\'s floor: a toy boat drags a wake, a light rain dimples it, and a click splashes; the waves bend the tiles and catch the light.'],
  // Agents P4: the Studio's Agents group played from here (after the rest, so their numbers stay).
  ['agentsHandBeat', 'Agents: a hand and a beat', 'A million particles from a Studio Agents group: your hand (or the pointer) pulls and stirs them, a fist pushes them away, and the Audio engine\'s kick track blasts shockwaves through them.'],
  // The Water layer (after the rest, so their numbers stay).
  ['waterLayer', 'Water layer: a boat and its wake', 'A drawn boat sails above a Water layer: it drags a V-shaped wake and rocks on the waves without wobbling in them, a light rain falls, and a click splashes.'],
  // The Displacement Map (after the rest, so their numbers stay).
  ['displaceText', 'Displace: text rippling through a map', 'A word displaced by a hidden layer of waves: its red pushes the letters sideways, its alpha up and down, as After Effects’ Displacement Map.'],
  ['displaceParticles', 'Displace: particles by the shader, the picture by a word', 'Particles displaced by the shader’s red and green as they drift, and the whole picture bent by a hidden word in the Look’s Displace, By channels.'],
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
  ['Conditions and pairs', 'playConditions'],
  ['Layers', 'playTextMattes'],
  ['Particles', 'playFlow'],
  ['Shapes and zones', 'playWalls'],
  ['Scripts', 'scriptFirst'],
  ['Backgrounds', 'bgColourSketch'],
  ['Mattes & masks', 'matteParticles'],
  ['Hands', 'handFingertips'],
  ['Recording', 'playTake'],
  ['Finish', 'finishGrade'],
  ['Bigger pieces', 'particleGlow'],
  ['Build your own Look', 'lookBuilt'],
  ['Agents in Play', 'agentsHandBeat'],
  ['Displacement maps', 'displaceText'],
];
export const PLAY_EXAMPLE_GROUPS: Array<{ label: string; keys: string[] }> = GROUP_STARTS.map(([label, first], i) => {
  const from = PLAY_EXAMPLE_KEYS.indexOf(first);
  const next = GROUP_STARTS[i + 1];
  const to = next ? PLAY_EXAMPLE_KEYS.indexOf(next[1]) : PLAY_EXAMPLE_KEYS.length;
  return { label, keys: PLAY_EXAMPLE_KEYS.slice(from, to) };
});
