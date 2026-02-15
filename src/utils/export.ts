// @ts-nocheck — legacy file, unused in active app
import { generateFragmentShader, VERTEX_SHADER } from '../shaders/generator';
import type { Node } from '../types/nodes';

export function exportShaderFiles(nodes: Node[]) {
  const fragmentShader = generateFragmentShader(nodes);

  // Generate p5.js sketch file
  const sketchJs = `let customShader;
let width = 800;
let height = 800;

function preload() {
  customShader = loadShader('shader.vert', 'shader.frag');
}

function setup() {
  pixelDensity(1);
  createCanvas(width, height, WEBGL);
  shader(customShader);
}

function draw() {
  background(0);

  let timeInSeconds = millis() / 1000;
  let scaledMouseX = map(mouseX, 0, width, 0, 1);
  let scaledMouseY = map(mouseY, 0, height, 1, 0);

  customShader.setUniform('u_resolution', [width, height]);
  customShader.setUniform('u_mouse', [scaledMouseX, scaledMouseY]);
  customShader.setUniform('u_time', timeInSeconds);

  rect(0, 0, width, height);
}
`;

  // Create download links
  downloadFile('shader.frag', fragmentShader);
  downloadFile('shader.vert', VERTEX_SHADER);
  downloadFile('sketch.js', sketchJs);
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
