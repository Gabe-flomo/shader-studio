/**
 * Patterns for a Script layer in 3D (the Patterns tab's 3D group): each is a
 * piece to insert, with a whole sketch that runs it. Settings are plain
 * `let name = number;` lines, so Make a slider works on them; sizes are
 * fractions of the picture, so a pattern looks the same in the small
 * Run preview and on the picture. The examples run in the 3D scratch preview
 * and in a test (script3d.test.ts).
 */
import type { ScriptSnippet } from './scriptSnippets';

const LIGHTS = `ambientLight(70);
directionalLight(255, 255, 255, 0.3, 0.8, -0.6);`;

const indent = (code: string) => code.replace(/\s+$/, '').split('\n').map(l => (l ? `  ${l}` : l)).join('\n');

/** A draw pattern's example: its settings on top, then a draw that orbits, adds `before`, and runs the pattern. */
function drawExample(code: string, before = ''): string {
  const [settings, ...body] = code.split('\n');
  return `${settings}\n\nfunction draw(s) {\n  orbitControl();\n${before ? `${indent(before)}\n` : ''}${indent(body.join('\n'))}\n}\n`;
}

const SPIN = `let size = 0.34, spin = 1;
normalMaterial();
push();
rotateX(s.time * spin * 0.7);
rotateY(s.time * spin);
box(size * min(width, height));
pop();
`;

const GRID = `let cells = 14, gap = 0.038, lift = 0.25;
const unit = min(width, height), g = gap * unit;   // sizes as fractions of the picture
noStroke();
push();
rotateX(-0.6);
for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
  const n = noise(i * 0.18, j * 0.18, s.time * 0.4);
  const h = unit * (0.01 + n * lift);
  push();
  translate((i - (cells - 1) / 2) * g, -h / 2, (j - (cells - 1) / 2) * g);
  fill(60 + n * 195, 140, 255 - n * 140);
  box(g * 0.8, h, g * 0.8);
  pop();
}
pop();
`;

const ORBITS = `let planets = 6, radius = 0.42, speed = 0.6;
const span = min(width, height);
ambientLight(40);
pointLight(255, 235, 200, 0, 0, 0);
noStroke();
emissiveMaterial(255, 190, 80);
sphere(span * 0.07);
for (let i = 0; i < planets; i++) {
  const a = s.time * speed * (1 + i * 0.25) + i * 1.7;
  const r = span * radius * (0.35 + (i + 1) / planets * 0.65);
  push();
  translate(cos(a) * r, sin(a * 0.7) * r * 0.15, sin(a) * r);
  fill(hsl(i * 57, 70, 60));
  specularMaterial(255);
  shininess(40);
  sphere(span * (0.016 + i * 0.005));
  pop();
}
`;

const CUBE = `let size = 0.38;
ambientLight(120);
directionalLight(255, 250, 240, -0.5, 0.6, -0.7);
texture(s.picture.texture);
push();
rotateX(s.time * 0.4);
rotateY(s.time * 0.6);
box(size * min(width, height));
pop();
`;

const PARTICLES = `let count = 400, speed = 0.12, spread = 0.4;
function moveParticles3d(s) {
  const u = min(s.width, s.height), r = spread * u, v = speed * u;
  const ps = (s.state.ps ||= []);
  const n = Math.floor(count);
  while (ps.length < n) ps.push({ x: random(-1, 1), y: random(-1, 1), z: random(-1, 1), vx: random(-1, 1), vy: random(-1, 1), vz: random(-1, 1) });
  ps.length = n;
  noStroke();
  for (const p of ps) {
    // Positions are fractions of the box (-1 to 1), so the cloud fits any picture.
    p.x += p.vx * v / r * s.dt; p.y += p.vy * v / r * s.dt; p.z += p.vz * v / r * s.dt;
    if (abs(p.x) > 1) p.vx *= -1;
    if (abs(p.y) > 1) p.vy *= -1;
    if (abs(p.z) > 1) p.vz *= -1;
    push();
    translate(p.x * r, p.y * r, p.z * r);
    sphere(u * 0.008, 10, 8);
    pop();
  }
}
`;

const TERRAIN = `let rows = 64, hills = 0.2, flow = 0.25;
function makeTerrain(s) {
  const { THREE, root } = s.three;
  const size = min(s.width, s.height) * 1.6;
  const geo = new THREE.PlaneGeometry(size, size, rows, rows);
  const mat = new THREE.MeshStandardMaterial({ color: 0x5fb8ff, flatShading: true, roughness: 0.85, side: THREE.DoubleSide });
  s.state.terrain = new THREE.Mesh(geo, mat);
  s.state.terrain.rotation.x = HALF_PI;   // lie flat: the plane's z is now up
  root.add(s.state.terrain);
}
function moveTerrain(s) {
  const u = min(s.width, s.height);
  const pos = s.state.terrain.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / u, y = pos.getY(i) / u;
    pos.setZ(i, noise(x * 3, y * 3 + s.time * flow) * hills * u);
  }
  pos.needsUpdate = true;
  s.state.terrain.geometry.computeVertexNormals();
}
`;

const KNOT = `let knotSize = 0.2;
function makeKnot(s) {
  const { THREE, root } = s.three;
  const r = knotSize * min(s.width, s.height);
  s.state.knot = new THREE.Mesh(new THREE.TorusKnotGeometry(r, r * 0.28, 160, 20), new THREE.MeshStandardMaterial({ color: 0xff8a5c, metalness: 0.3, roughness: 0.35 }));
  root.add(s.state.knot);
}
`;

export const SCRIPT_SNIPPETS_3D: ScriptSnippet[] = [
  { group: '3D', name: 'Spinning shape', where: 'draw', doc: 'A box turning on two axes, coloured by the way its faces point (normalMaterial needs no lights).', code: SPIN, example: drawExample(SPIN) },
  { group: '3D', name: 'Grid of boxes from noise', where: 'draw', doc: 'A field of columns whose heights follow slow noise, seen from above at an angle. Hundreds of boxes are one draw call.', code: GRID, example: drawExample(GRID, LIGHTS) },
  { group: '3D', name: 'Orbiting spheres', where: 'draw', doc: 'Planets round a glowing sun that lights them: a point light at the centre, shiny spheres on tilted circles.', code: ORBITS, example: drawExample(ORBITS, 'rotateX(-0.35);') },
  { group: '3D', name: 'The picture on a cube', where: 'draw', doc: 'A cube skinned with the live shader: s.picture.texture is the picture under the layer, this frame. Two lights shade its faces apart.', code: CUBE, example: drawExample(CUBE) },
  {
    group: '3D', name: 'Particles as spheres', where: 'top', doc: 'A cloud of small spheres drifting in a box and bouncing off its walls. Call moveParticles3d(s) in draw; every sphere is one instance, so thousands stay fast.',
    code: PARTICLES, example: `${PARTICLES}\nfunction draw(s) {\n  orbitControl();\n${indent(LIGHTS)}\n  fill(140, 210, 255);\n  moveParticles3d(s);\n}\n`,
  },
  {
    group: '3D', name: 'Terrain from noise', where: 'top', doc: 'Rolling hills: a three.js plane made once (makeTerrain in setup) whose points rise and fall with noise each frame (moveTerrain in draw). The p5 lights shade it.',
    code: TERRAIN,
    example: `${TERRAIN}\nfunction setup(s) {\n  makeTerrain(s);\n  const u = min(s.width, s.height);\n  camera(0, -0.75 * u, 0.95 * u, 0, 0, 0, 0, 1, 0);\n}\n\nfunction draw(s) {\n  orbitControl();\n  ambientLight(60);\n  directionalLight(255, 240, 220, 0.4, 1, -0.3);\n  moveTerrain(s);\n}\n`,
  },
  {
    group: '3D', name: 'A three.js object', where: 'top', doc: 'Anything three.js can make, through s.three: build it once in setup, change it in draw. This one is a torus knot with a standard material, lit by the p5 lights.',
    code: KNOT,
    example: `${KNOT}\nfunction setup(s) {\n  makeKnot(s);\n}\n\nfunction draw(s) {\n  orbitControl();\n${indent(LIGHTS)}\n  s.state.knot.rotation.x = s.time * 0.5;\n  s.state.knot.rotation.y = s.time * 0.8;\n}\n`,
  },
];
