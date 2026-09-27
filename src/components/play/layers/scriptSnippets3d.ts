/**
 * Patterns for a Script layer in 3D (the Patterns tab's 3D group): each is a
 * piece to insert, with a whole sketch that runs it. Settings are plain
 * `let name = number;` lines, so Make a slider works on them. The examples run
 * in the 3D scratch preview and in a test (script3d.test.ts).
 */
import type { ScriptSnippet } from './scriptSnippets';

const LIGHTS = `  ambientLight(70);
  directionalLight(255, 255, 255, 0.3, 0.8, -0.6);`;

export const SCRIPT_SNIPPETS_3D: ScriptSnippet[] = [
  {
    group: '3D', name: 'Spinning shape', where: 'draw', doc: 'A box turning on two axes, coloured by the way its faces point (normalMaterial needs no lights).',
    code: `let size = 160, spin = 1;
normalMaterial();
push();
rotateX(s.time * spin * 0.7);
rotateY(s.time * spin);
box(size);
pop();
`,
    example: `let size = 160, spin = 1;

function draw(s) {
  orbitControl();
  normalMaterial();
  push();
  rotateX(s.time * spin * 0.7);
  rotateY(s.time * spin);
  box(size);
  pop();
}
`,
  },
  {
    group: '3D', name: 'Grid of boxes from noise', where: 'draw', doc: 'A field of columns whose heights follow slow noise, seen from above at an angle. Hundreds of boxes are one draw call.',
    code: `let cells = 14, gap = 36, lift = 160;
noStroke();
push();
rotateX(-0.7);
for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
  const n = noise(i * 0.18, j * 0.18, s.time * 0.4);
  const h = 8 + n * lift;
  push();
  translate((i - (cells - 1) / 2) * gap, -h / 2, (j - (cells - 1) / 2) * gap);
  fill(60 + n * 195, 140, 255 - n * 140);
  box(gap * 0.8, h, gap * 0.8);
  pop();
}
pop();
`,
    example: `let cells = 14, gap = 36, lift = 160;

function draw(s) {
  orbitControl();
${LIGHTS}
  noStroke();
  push();
  rotateX(-0.7);
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    const n = noise(i * 0.18, j * 0.18, s.time * 0.4);
    const h = 8 + n * lift;
    push();
    translate((i - (cells - 1) / 2) * gap, -h / 2, (j - (cells - 1) / 2) * gap);
    fill(60 + n * 195, 140, 255 - n * 140);
    box(gap * 0.8, h, gap * 0.8);
    pop();
  }
  pop();
}
`,
  },
  {
    group: '3D', name: 'Orbiting spheres', where: 'draw', doc: 'Planets round a glowing sun that lights them: a point light at the centre, shiny spheres on tilted circles.',
    code: `let planets = 6, radius = 260, speed = 0.6;
ambientLight(40);
pointLight(255, 235, 200, 0, 0, 0);
noStroke();
emissiveMaterial(255, 190, 80);
sphere(44);
for (let i = 0; i < planets; i++) {
  const a = s.time * speed * (1 + i * 0.25) + i * 1.7;
  const r = radius * (0.35 + (i + 1) / planets * 0.65);
  push();
  translate(cos(a) * r, sin(a * 0.7) * r * 0.15, sin(a) * r);
  fill(hsl(i * 57, 70, 60));
  specularMaterial(255);
  shininess(40);
  sphere(10 + i * 3);
  pop();
}
`,
    example: `let planets = 6, radius = 260, speed = 0.6;

function draw(s) {
  orbitControl();
  rotateX(-0.35);
  ambientLight(40);
  pointLight(255, 235, 200, 0, 0, 0);
  noStroke();
  emissiveMaterial(255, 190, 80);
  sphere(44);
  for (let i = 0; i < planets; i++) {
    const a = s.time * speed * (1 + i * 0.25) + i * 1.7;
    const r = radius * (0.35 + (i + 1) / planets * 0.65);
    push();
    translate(cos(a) * r, sin(a * 0.7) * r * 0.15, sin(a) * r);
    fill(hsl(i * 57, 70, 60));
    specularMaterial(255);
    shininess(40);
    sphere(10 + i * 3);
    pop();
  }
}
`,
  },
  {
    group: '3D', name: 'The picture on a cube', where: 'draw', doc: 'A cube skinned with the live shader: s.picture.texture is the picture under the layer, this frame.',
    code: `let size = 240;
texture(s.picture.texture);
push();
rotateX(s.time * 0.4);
rotateY(s.time * 0.6);
box(size);
pop();
`,
    example: `let size = 240;

function draw(s) {
  orbitControl();
  texture(s.picture.texture);
  push();
  rotateX(s.time * 0.4);
  rotateY(s.time * 0.6);
  box(size);
  pop();
}
`,
  },
  {
    group: '3D', name: 'Particles as spheres', where: 'top', doc: 'A cloud of small spheres drifting in a box and bouncing off its walls. Call moveParticles3d(s) in draw; every sphere is one instance, so thousands stay fast.',
    code: `let count = 400, speed = 60, spread = 260;
function moveParticles3d(s) {
  const ps = (s.state.ps ||= []);
  const n = Math.floor(count);
  while (ps.length < n) ps.push({ x: random(-spread, spread), y: random(-spread, spread), z: random(-spread, spread), vx: random(-1, 1), vy: random(-1, 1), vz: random(-1, 1) });
  ps.length = n;
  noStroke();
  for (const p of ps) {
    p.x += p.vx * speed * s.dt; p.y += p.vy * speed * s.dt; p.z += p.vz * speed * s.dt;
    if (abs(p.x) > spread) p.vx *= -1;
    if (abs(p.y) > spread) p.vy *= -1;
    if (abs(p.z) > spread) p.vz *= -1;
    push();
    translate(p.x, p.y, p.z);
    sphere(5, 10, 8);
    pop();
  }
}
`,
    example: `let count = 400, speed = 60, spread = 260;
function moveParticles3d(s) {
  const ps = (s.state.ps ||= []);
  const n = Math.floor(count);
  while (ps.length < n) ps.push({ x: random(-spread, spread), y: random(-spread, spread), z: random(-spread, spread), vx: random(-1, 1), vy: random(-1, 1), vz: random(-1, 1) });
  ps.length = n;
  noStroke();
  for (const p of ps) {
    p.x += p.vx * speed * s.dt; p.y += p.vy * speed * s.dt; p.z += p.vz * speed * s.dt;
    if (abs(p.x) > spread) p.vx *= -1;
    if (abs(p.y) > spread) p.vy *= -1;
    if (abs(p.z) > spread) p.vz *= -1;
    push();
    translate(p.x, p.y, p.z);
    sphere(5, 10, 8);
    pop();
  }
}

function draw(s) {
  orbitControl();
${LIGHTS}
  fill(140, 210, 255);
  moveParticles3d(s);
}
`,
  },
  {
    group: '3D', name: 'Terrain from noise', where: 'top', doc: 'Rolling hills: a three.js plane made once (makeTerrain in setup) whose points rise and fall with noise each frame (moveTerrain in draw). The p5 lights shade it.',
    code: `let rows = 64, cellSize = 14, hills = 110, flow = 0.25;
function makeTerrain(s) {
  const { THREE, root } = s.three;
  const geo = new THREE.PlaneGeometry(rows * cellSize, rows * cellSize, rows, rows);
  const mat = new THREE.MeshStandardMaterial({ color: 0x5fb8ff, flatShading: true, roughness: 0.85, side: THREE.DoubleSide });
  s.state.terrain = new THREE.Mesh(geo, mat);
  s.state.terrain.rotation.x = HALF_PI;
  root.add(s.state.terrain);
}
function moveTerrain(s) {
  const pos = s.state.terrain.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, noise(x * 0.008, y * 0.008 + s.time * flow) * hills);
  }
  pos.needsUpdate = true;
  s.state.terrain.geometry.computeVertexNormals();
}
`,
    example: `let rows = 64, cellSize = 14, hills = 110, flow = 0.25;
function makeTerrain(s) {
  const { THREE, root } = s.three;
  const geo = new THREE.PlaneGeometry(rows * cellSize, rows * cellSize, rows, rows);
  const mat = new THREE.MeshStandardMaterial({ color: 0x5fb8ff, flatShading: true, roughness: 0.85, side: THREE.DoubleSide });
  s.state.terrain = new THREE.Mesh(geo, mat);
  s.state.terrain.rotation.x = HALF_PI;
  root.add(s.state.terrain);
}
function moveTerrain(s) {
  const pos = s.state.terrain.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, noise(x * 0.008, y * 0.008 + s.time * flow) * hills);
  }
  pos.needsUpdate = true;
  s.state.terrain.geometry.computeVertexNormals();
}

function setup(s) {
  makeTerrain(s);
  camera(0, -420, 620, 0, 0, 0, 0, 1, 0);
}

function draw(s) {
  orbitControl();
  ambientLight(60);
  directionalLight(255, 240, 220, 0.4, 1, -0.3);
  moveTerrain(s);
}
`,
  },
  {
    group: '3D', name: 'A three.js object', where: 'top', doc: 'Anything three.js can make, through s.three: build it once in setup, change it in draw. This one is a torus knot with a standard material.',
    code: `let knotSize = 110;
function makeKnot(s) {
  const { THREE, root } = s.three;
  s.state.knot = new THREE.Mesh(new THREE.TorusKnotGeometry(knotSize, knotSize * 0.28, 160, 20), new THREE.MeshStandardMaterial({ color: 0xff8a5c, metalness: 0.3, roughness: 0.35 }));
  root.add(s.state.knot);
}
`,
    example: `let knotSize = 110;
function makeKnot(s) {
  const { THREE, root } = s.three;
  s.state.knot = new THREE.Mesh(new THREE.TorusKnotGeometry(knotSize, knotSize * 0.28, 160, 20), new THREE.MeshStandardMaterial({ color: 0xff8a5c, metalness: 0.3, roughness: 0.35 }));
  root.add(s.state.knot);
}

function setup(s) {
  makeKnot(s);
}

function draw(s) {
  orbitControl();
${LIGHTS}
  s.state.knot.rotation.x = s.time * 0.5;
  s.state.knot.rotation.y = s.time * 0.8;
}
`,
  },
];
