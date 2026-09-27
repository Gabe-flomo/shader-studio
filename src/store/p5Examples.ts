/**
 * p5Examples — three p5.js projects as they would sit on disk: an index.html
 * that loads p5 from a CDN and the sketch's own scripts, in order.
 *
 * They are written for this app (not copied from anywhere) and run in real
 * p5 as they are. The Play examples p5FlowField, p5MultiFile and p5Webgl are
 * these projects put through the importer ("Import p5.js sketch…"); the
 * result is kept in p5ExampleSketches.ts so the app does not load the parser
 * at startup, and p5Examples.test.ts checks the two never drift apart.
 */

export interface P5ExampleProject { title: string; files: { path: string; text: string }[] }

const indexHtml = (title: string, scripts: string[]) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/p5@1.11.1/lib/p5.min.js"></script>
${scripts.map(s => `  <script src="${s}"></script>`).join('\n')}
</head>
<body></body>
</html>
`;

const FLOW_FIELD = `// Flow field: particles follow the angle of a slowly changing noise field.
const HUES = { Ocean: 190, Ember: 10, Moss: 95 };
let particles = [];
let countSlider, noiseScaleSlider, trailsCheckbox, paletteSelect;

function setup() {
  createCanvas(720, 405);
  colorMode(HSB, 360, 100, 100, 100);

  countSlider = createSlider(100, 3000, 1200, 100);
  noiseScaleSlider = createSlider(0.001, 0.02, 0.006, 0.001);
  trailsCheckbox = createCheckbox('Trails', true);
  paletteSelect = createSelect();
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
`;

const PARTICLE = `// A particle: position, velocity, and a life that runs down.
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
`;

const FORCES = `// Forces and edges, shared by every particle.
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
`;

const MULTI_SKETCH = `// Fountain: click to burst particles, press C to clear.
let particles = [];
let gravitySlider;

function setup() {
  createCanvas(640, 400);
  gravitySlider = createSlider(0, 0.4, 0.12, 0.01);
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
`;

const WEBGL_SKETCH = `// Shapes in orbit: a box in the middle, four shapes circling it.
let speedSlider;
let angle = 0;

function setup() {
  createCanvas(600, 600, WEBGL);
  speedSlider = createSlider(0, 3, 1, 0.1);
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
`;

export const P5_EXAMPLE_PROJECTS: Record<string, P5ExampleProject> = {
  p5FlowField: {
    title: 'Flow field',
    files: [
      { path: 'index.html', text: indexHtml('Flow field', ['sketch.js']) },
      { path: 'sketch.js', text: FLOW_FIELD },
    ],
  },
  p5MultiFile: {
    title: 'Fountain',
    files: [
      { path: 'index.html', text: indexHtml('Fountain', ['particle.js', 'forces.js', 'sketch.js']) },
      { path: 'particle.js', text: PARTICLE },
      { path: 'forces.js', text: FORCES },
      { path: 'sketch.js', text: MULTI_SKETCH },
    ],
  },
  p5Webgl: {
    title: 'Shapes in orbit',
    files: [
      { path: 'index.html', text: indexHtml('Shapes in orbit', ['sketch.js']) },
      { path: 'sketch.js', text: WEBGL_SKETCH },
    ],
  },
};
