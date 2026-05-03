import type { GraphNode } from '../types/nodeGraph';
import type { ParticleSystemData } from './types';

export const PARTICLE_PIPELINE_TYPES = new Set([
  'pInit', 'pRotate', 'pWave', 'pColorDist', 'pSize', 'pRender',
]);

function safeId(id: string): string {
  return id.replace(/[_\-]/g, 'x');
}

function uname(nodeId: string, param: string): string {
  return `u_p_${safeId(nodeId)}_${param}`;
}

/** Walk backwards from pRender through particle connections, returning the chain [pInit, ..., pRender]. */
function walkChain(renderNode: GraphNode, nodeMap: Map<string, GraphNode>): GraphNode[] {
  const chain: GraphNode[] = [];
  let current: GraphNode | undefined = renderNode;
  const visited = new Set<string>();

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.unshift(current);
    const conn = current.inputs.particles?.connection;
    if (!conn) break;
    current = nodeMap.get(conn.nodeId);
  }

  return chain;
}

function num(v: unknown, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number(v); return isNaN(n) ? fallback : n; }
  return fallback;
}

/**
 * For each pRender node in the graph, walk back to pInit and generate
 * a GPU vertex+fragment shader pair plus the initial paramUniforms.
 */
export function compileParticleChains(allNodes: GraphNode[]): { systems: ParticleSystemData[] } {
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const systems: ParticleSystemData[] = [];

  for (const node of allNodes) {
    if (node.type !== 'pRender') continue;

    const chain = walkChain(node, nodeMap);
    const initNode = chain.find(n => n.type === 'pInit');
    if (!initNode) continue;

    const rotNode   = chain.find(n => n.type === 'pRotate');
    const waveNode  = chain.find(n => n.type === 'pWave');
    const colorNode = chain.find(n => n.type === 'pColorDist');
    const sizeNode  = chain.find(n => n.type === 'pSize');

    // ── Collect all float params as uniforms ─────────────────────────────────
    const paramUniforms: Record<string, number> = {};

    paramUniforms[uname(initNode.id, 'radius')] = num(initNode.params.radius, 1.0);

    if (rotNode) {
      paramUniforms[uname(rotNode.id, 'rotSpeed')]    = num(rotNode.params.rotSpeed,    0.3);
      paramUniforms[uname(rotNode.id, 'rotVariance')] = num(rotNode.params.rotVariance, 2.0);
      paramUniforms[uname(rotNode.id, 'twirl')]       = num(rotNode.params.twirl,       0.0);
    }
    if (waveNode) {
      paramUniforms[uname(waveNode.id, 'waveAmp')]   = num(waveNode.params.waveAmp,   0.08);
      paramUniforms[uname(waveNode.id, 'waveFreq')]  = num(waveNode.params.waveFreq,  3.0);
      paramUniforms[uname(waveNode.id, 'waveSpeed')] = num(waveNode.params.waveSpeed, 2.0);
    }
    if (colorNode) {
      paramUniforms[uname(colorNode.id, 'colorCenterR')] = num(colorNode.params.colorCenterR, 0.97);
      paramUniforms[uname(colorNode.id, 'colorCenterG')] = num(colorNode.params.colorCenterG, 0.70);
      paramUniforms[uname(colorNode.id, 'colorCenterB')] = num(colorNode.params.colorCenterB, 0.45);
      paramUniforms[uname(colorNode.id, 'colorEdgeR')]   = num(colorNode.params.colorEdgeR,   0.34);
      paramUniforms[uname(colorNode.id, 'colorEdgeG')]   = num(colorNode.params.colorEdgeG,   0.53);
      paramUniforms[uname(colorNode.id, 'colorEdgeB')]   = num(colorNode.params.colorEdgeB,   0.96);
      paramUniforms[uname(colorNode.id, 'mixPow')]       = num(colorNode.params.mixPow,       0.5);
    }
    if (sizeNode) {
      paramUniforms[uname(sizeNode.id, 'sizeBase')]   = num(sizeNode.params.sizeBase,   10.0);
      paramUniforms[uname(sizeNode.id, 'sizeByDist')] = num(sizeNode.params.sizeByDist, 10.0);
    }
    paramUniforms[uname(node.id, 'opacity')]  = num(node.params.opacity,  1.0);
    paramUniforms[uname(node.id, 'softness')] = num(node.params.softness, 3.0);

    // ── Build vertex shader ───────────────────────────────────────────────────
    const v: string[] = [
      'precision highp float;',
      'uniform float u_time;',
      `uniform float ${uname(initNode.id, 'radius')};`,
    ];

    if (rotNode) {
      v.push(
        `uniform float ${uname(rotNode.id, 'rotSpeed')};`,
        `uniform float ${uname(rotNode.id, 'rotVariance')};`,
        `uniform float ${uname(rotNode.id, 'twirl')};`,
      );
    }
    if (waveNode) {
      v.push(
        `uniform float ${uname(waveNode.id, 'waveAmp')};`,
        `uniform float ${uname(waveNode.id, 'waveFreq')};`,
        `uniform float ${uname(waveNode.id, 'waveSpeed')};`,
      );
    }
    if (colorNode) {
      v.push(
        `uniform float ${uname(colorNode.id, 'colorCenterR')};`,
        `uniform float ${uname(colorNode.id, 'colorCenterG')};`,
        `uniform float ${uname(colorNode.id, 'colorCenterB')};`,
        `uniform float ${uname(colorNode.id, 'colorEdgeR')};`,
        `uniform float ${uname(colorNode.id, 'colorEdgeG')};`,
        `uniform float ${uname(colorNode.id, 'colorEdgeB')};`,
        `uniform float ${uname(colorNode.id, 'mixPow')};`,
      );
    }
    if (sizeNode) {
      v.push(
        `uniform float ${uname(sizeNode.id, 'sizeBase')};`,
        `uniform float ${uname(sizeNode.id, 'sizeByDist')};`,
      );
    }

    v.push('attribute float a_normDist;', 'varying vec3 v_color;', '');
    v.push('void main() {');
    v.push(`  vec3 p_pos = position * ${uname(initNode.id, 'radius')};`);
    v.push('  float p_normDist = clamp(a_normDist, 0.0, 1.0);');
    v.push('  vec3 p_color = vec3(1.0);');
    v.push('  float p_size = 5.0;');
    v.push('');

    // pRotate
    if (rotNode) {
      const axis = num(rotNode.params.axis, 1);
      const rs = uname(rotNode.id, 'rotSpeed');
      const rv = uname(rotNode.id, 'rotVariance');
      const tw = uname(rotNode.id, 'twirl');
      v.push('  // pRotate');
      v.push(`  float rotFactor = 1.0 + ${rv} * (1.0 - p_normDist);`);
      v.push(`  float rotAngle = u_time * ${rs} * rotFactor + ${tw} * p_normDist;`);
      v.push('  float rSin = sin(rotAngle), rCos = cos(rotAngle);');
      if (axis === 0) { // X
        v.push('  p_pos = vec3(p_pos.x, rCos*p_pos.y - rSin*p_pos.z, rSin*p_pos.y + rCos*p_pos.z);');
      } else if (axis === 2) { // Z
        v.push('  p_pos = vec3(rCos*p_pos.x - rSin*p_pos.y, rSin*p_pos.x + rCos*p_pos.y, p_pos.z);');
      } else { // Y (default)
        v.push('  p_pos = vec3(rCos*p_pos.x + rSin*p_pos.z, p_pos.y, -rSin*p_pos.x + rCos*p_pos.z);');
      }
      v.push('');
    }

    // pWave
    if (waveNode) {
      const waveAxis = num(waveNode.params.waveAxis, 0);
      const wa = uname(waveNode.id, 'waveAmp');
      const wf = uname(waveNode.id, 'waveFreq');
      const ws = uname(waveNode.id, 'waveSpeed');
      v.push('  // pWave');
      v.push(`  float waveVal = sin(u_time * ${ws} + p_normDist * ${wf}) * ${wa};`);
      if (waveAxis === 1) { // Y-Axis
        v.push('  p_pos.y += waveVal;');
      } else if (waveAxis === 2) { // Tangential
        v.push('  vec3 wRadial = normalize(p_pos + vec3(0.0001, 0.0, 0.0001));');
        v.push('  vec3 wTang = normalize(cross(wRadial, vec3(0.0, 1.0, 0.0)));');
        v.push('  p_pos += wTang * waveVal;');
      } else { // Radial (default)
        v.push('  vec3 wRadial = normalize(p_pos + vec3(0.0001, 0.0001, 0.0001));');
        v.push('  p_pos += wRadial * waveVal;');
      }
      v.push('');
    }

    // pColorDist
    if (colorNode) {
      const cr = uname(colorNode.id, 'colorCenterR');
      const cg = uname(colorNode.id, 'colorCenterG');
      const cb = uname(colorNode.id, 'colorCenterB');
      const er = uname(colorNode.id, 'colorEdgeR');
      const eg = uname(colorNode.id, 'colorEdgeG');
      const eb = uname(colorNode.id, 'colorEdgeB');
      const mp = uname(colorNode.id, 'mixPow');
      v.push('  // pColorDist');
      v.push(`  float colorT = pow(p_normDist, ${mp});`);
      v.push(`  p_color = mix(vec3(${cr}, ${cg}, ${cb}), vec3(${er}, ${eg}, ${eb}), colorT);`);
      v.push('');
    }

    // pSize
    if (sizeNode) {
      const sb = uname(sizeNode.id, 'sizeBase');
      const sd = uname(sizeNode.id, 'sizeByDist');
      v.push('  // pSize');
      v.push(`  p_size = ${sb} + ${sd} * (1.0 - p_normDist);`);
      v.push('');
    }

    v.push('  v_color = p_color;');
    v.push('  vec4 mvPos = modelViewMatrix * vec4(p_pos, 1.0);');
    v.push('  gl_Position = projectionMatrix * mvPos;');

    const doAttenuation = !sizeNode ||
      sizeNode.params.sizeAttenuation === true ||
      sizeNode.params.sizeAttenuation === 1;
    if (doAttenuation) {
      v.push('  gl_PointSize = p_size / max(-mvPos.z, 0.1);');
    } else {
      v.push('  gl_PointSize = p_size;');
    }
    v.push('}');

    const vertexShader = v.join('\n');

    // ── Build fragment shader ─────────────────────────────────────────────────
    const op = uname(node.id, 'opacity');
    const sf = uname(node.id, 'softness');
    const fragmentShader = [
      'precision highp float;',
      `uniform float ${op};`,
      `uniform float ${sf};`,
      'varying vec3 v_color;',
      'void main() {',
      '  vec2 coord = gl_PointCoord - 0.5;',
      '  float dist = length(coord) * 2.0;',
      `  float edge = 1.0 - 1.0 / max(${sf}, 0.5);`,
      '  float alpha = 1.0 - smoothstep(edge, 1.0, dist);',
      '  if (alpha < 0.01) discard;',
      `  gl_FragColor = vec4(v_color, alpha * ${op});`,
      '}',
    ].join('\n');

    systems.push({
      nodeId: node.id,
      vertexShader,
      fragmentShader,
      count: num(initNode.params.count, 3000),
      shape: num(initNode.params.shape, 0),
      paramUniforms,
    });
  }

  return { systems };
}
