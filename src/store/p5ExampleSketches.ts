/**
 * GENERATED from p5Examples.ts by the p5 importer (projectFromEntries →
 * analyzeProject → mapDomControls → buildP5Layer). Do not edit by hand:
 * change the project in p5Examples.ts and paste the importer's new output
 * here. p5Examples.test.ts fails when the two drift apart.
 *
 * Kept as plain strings so the app does not load the parser at startup.
 */

export interface P5ExampleSketch {
  label: string;
  /** sketch.js, with its DOM controls rewritten as control('key') and params. */
  code: string;
  /** The other tabs, run before sketch.js in this order. */
  files: { name: string; code: string }[];
  mode: '2d' | '3d';
  p5: true;
  /** Where each control starts: numbers as they are, toggles 0 / 1, choices the option's index. */
  startAt: Record<string, number>;
}

export const P5_EXAMPLE_SKETCHES: Record<string, P5ExampleSketch> = {
  p5FlowField: {
    label: 'Flow field',
    mode: '2d',
    p5: true,
    startAt: { count: 1200, noiseScale: 0.006, trails: 1, palette: 0 },
    files: [],
    code: `const params = {
  count: { value: 1200, min: 100, max: 3000, step: 100, label: 'Count', restart: true },
  noiseScale: { value: 0.006, min: 0.001, max: 0.02, step: 0.001, label: 'Noise scale' },
  trails: { kind: 'toggle', value: true, label: 'Trails' },
  palette: { kind: 'choice', options: ['Ocean', 'Ember', 'Moss'], value: 'Ocean', label: 'Palette' },
};

// Flow field: particles follow the angle of a slowly changing noise field.
const HUES = { Ocean: 190, Ember: 10, Moss: 95 };
let particles = [];
let countSlider, noiseScaleSlider, trailsCheckbox, paletteSelect;

function setup() {
  createCanvas(720, 405);
  colorMode(HSB, 360, 100, 100, 100);

  countSlider = control('count');
  noiseScaleSlider = control('noiseScale');
  trailsCheckbox = control('trails');
  paletteSelect = control('palette');
  paletteSelect.option('Ocean');
  paletteSelect.option('Ember');
  paletteSelect.option('Moss');
  paletteSelect.selected('Ocean');

  // The count is only read here, so the particles are made once.
  for (let i = 0; i < countSlider.value(); i++) {
    const pos = createVector(random(width), random(height));
    particles.push({ pos, prev: pos.copy(), hue: random(-25, 25) });
  }
  background(230, 30, 8);
}

function draw() {
  // A see-through background fades old steps into trails.
  background(230, 30, 8, trailsCheckbox.checked() ? 6 : 100);
  const scl = noiseScaleSlider.value();
  const base = HUES[paletteSelect.value()] ?? 190;
  const z = frameCount * 0.002;
  strokeWeight(1.4);
  for (const p of particles) {
    const angle = noise(p.pos.x * scl, p.pos.y * scl, z) * TWO_PI * 2;
    p.prev.set(p.pos);
    p.pos.add(p5.Vector.fromAngle(angle, 1.6));
    // Off an edge: come back on the other side, without a line across.
    if (p.pos.x < 0 || p.pos.x > width || p.pos.y < 0 || p.pos.y > height) {
      p.pos.set(random(width), random(height));
      p.prev.set(p.pos);
    }
    stroke((base + p.hue + 360) % 360, 70, 95, 50);
    line(p.prev.x, p.prev.y, p.pos.x, p.pos.y);
  }
}
`,
  },
  p5MultiFile: {
    label: 'Fountain',
    mode: '2d',
    p5: true,
    startAt: { gravity: 0.12 },
    files: [
      { name: 'particle.js', code: `// A particle: position, velocity, and a life that runs down.
class Particle {
  constructor(x, y) {
    this.pos = createVector(x, y);
    this.vel = p5.Vector.random2D().mult(random(0.5, 3));
    this.acc = createVector(0, 0);
    this.life = 255;
    this.size = random(4, 12);
  }

  applyForce(force) {
    this.acc.add(force);
  }

  update() {
    this.vel.add(this.acc);
    this.vel.limit(8);
    this.pos.add(this.vel);
    this.acc.mult(0);
    this.life -= 1.5;
  }

  show() {
    noStroke();
    fill(255, 160 + this.size * 6, 90, this.life);
    circle(this.pos.x, this.pos.y, this.size);
  }

  isDead() {
    return this.life <= 0;
  }
}
` },
      { name: 'forces.js', code: `// Forces and edges, shared by every particle.
function gravityForce(strength) {
  return createVector(0, strength);
}

// A push away from a point, strongest close to it.
function repel(p, from, radius) {
  const away = p5.Vector.sub(p.pos, from);
  const d = away.mag();
  if (d > radius || d < 1) return createVector(0, 0);
  return away.setMag(map(d, 0, radius, 1.5, 0));
}

// Bounce off the floor and the walls, losing some speed.
function bounce(p) {
  if (p.pos.y > height) { p.pos.y = height; p.vel.y *= -0.6; }
  if (p.pos.x < 0 || p.pos.x > width) { p.pos.x = constrain(p.pos.x, 0, width); p.vel.x *= -0.8; }
}
` },
    ],
    code: `const params = {
  gravity: { value: 0.12, min: 0, max: 0.4, step: 0.01, label: 'Gravity' },
};

// Fountain: click to burst particles, press C to clear.
let particles = [];
let gravitySlider;

function setup() {
  createCanvas(640, 400);
  gravitySlider = control('gravity');
}

function draw() {
  background(18, 20, 32);
  // A slow trickle from the top keeps something on screen.
  if (frameCount % 3 === 0) particles.push(new Particle(random(width), 0));

  const g = gravityForce(gravitySlider.value());
  const mouse = createVector(mouseX, mouseY);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.applyForce(g);
    p.applyForce(repel(p, mouse, 80));
    p.update();
    bounce(p);
    p.show();
    if (p.isDead()) particles.splice(i, 1);
  }

  fill(255);
  textSize(14);
  text(particles.length + ' particles', 12, 22);
}

function mousePressed() {
  for (let i = 0; i < 40; i++) particles.push(new Particle(mouseX, mouseY));
}

function keyPressed() {
  if (key === 'c' || key === 'C') particles = [];
}
`,
  },
  p5Webgl: {
    label: 'Shapes in orbit',
    mode: '3d',
    p5: true,
    startAt: { speed: 1 },
    files: [],
    code: `const params = {
  speed: { value: 1, min: 0, max: 3, step: 0.1, label: 'Speed' },
};

// Shapes in orbit: a box in the middle, four shapes circling it.
let speedSlider;
let angle = 0;

function setup() {
  createCanvas(600, 600, WEBGL);
  speedSlider = control('speed');
}

function draw() {
  background(12, 14, 24);
  orbitControl();
  angle += 0.01 * speedSlider.value();

  ambientLight(50);
  directionalLight(255, 255, 255, 0.3, 0.6, -1);
  pointLight(255, 140, 60, 0, -200, 200);

  // The middle: coloured by its normals, so every face differs.
  push();
  rotateX(angle);
  rotateY(angle * 1.3);
  normalMaterial();
  box(110);
  pop();

  // The ring: lit shapes on a turning circle.
  for (let i = 0; i < 4; i++) {
    push();
    rotateY(angle * 0.6 + (i * TWO_PI) / 4);
    translate(210, 0, 0);
    rotateZ(angle * 2);
    rotateX(angle);
    noStroke();
    specularMaterial(90 + i * 40, 160, 255 - i * 40);
    shininess(30);
    if (i === 0) torus(40, 14);
    else if (i === 1) sphere(42);
    else if (i === 2) cone(36, 80);
    else cylinder(30, 80);
    pop();
  }
}
`,
  },
};
