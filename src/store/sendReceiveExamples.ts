/**
 * sendReceiveExamples.ts — Send and Receive (docs/send-receive.md): a value and a texture shared across groups
 * without wires or group ports. Every node carries a note saying what it does and why.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { group, n } from './graphBuilder';

export const SEND_RECEIVE_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  sendReceiveBeat: {
    label: 'Send & Receive · a beat and a picture, into two groups',
    description: 'One beat (an LFO) is sent as "beat" and read inside two groups; a Pass\'s picture is sent as "picture" and read inside the second. No wire crosses a group\'s edge: each Receive picks its Send by name. Select a Send to see its receivers, or click a Receive\'s "from" chip to jump to its Send.',
  },
};

export const SEND_RECEIVE_EXAMPLE_KEYS = Object.keys(SEND_RECEIVE_EXAMPLE_INDEX);

const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

/** An Expression Block: named inputs (wired as given), lines `type name = rhs`, a result; its note explains every named line. */
function expr(id: string, x: number, y: number, o: {
  label: string; outputType: 'float' | 'vec2' | 'vec3' | 'vec4';
  inputs: Array<[name: string, type: 'float' | 'vec2' | 'vec3' | 'vec4', from: [string, string]]>;
  lines: Array<[lhs: string, rhs: string]>;
  result: string; note: string[];
}): GraphNode {
  const node = n('exprNode', id, x, y, {
    label: o.label,
    inputs: o.inputs.map(([name, type]) => ({ name, type, slider: null })),
    outputType: o.outputType,
    lines: o.lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
    result: o.result, expr: o.result,
    ...note(o.note),
  });
  node.inputs = Object.fromEntries(o.inputs.map(([name, type, from]) => [name, { type, label: name, connection: { nodeId: from[0], outputKey: from[1] } }]));
  node.outputs = { result: { type: o.outputType, label: 'Result' } };
  return node;
}

/** A Receive of the Send `sendId`, typed as that Send (the store keeps it in step after loading). */
const receive = (id: string, x: number, y: number, sendId: string, name: string, type: 'float' | 'texture', text: string[]): GraphNode => {
  const r = n('receive', id, x, y, { sendId, name, ...note(text) });
  r.outputs = { value: { type, label: 'Value' } };
  return r;
};
const send = (id: string, x: number, y: number, name: string, type: 'float' | 'texture', from: [string, string], text: string[]): GraphNode => {
  const s = n('send', id, x, y, { name, ...note(text) }, { value: from });
  s.inputs.value = { ...s.inputs.value, type };
  s.outputs = { value: { type, label: 'Value' } };
  return s;
};

export function buildSendReceiveExamples(): Record<string, ExampleGraph> {
  const g: Record<string, ExampleGraph> = {};

  g.sendReceiveBeat = {
    ...SEND_RECEIVE_EXAMPLE_INDEX.sendReceiveBeat,
    counter: 60,
    nodes: [
      n('lfo', 'beat', 40, 80, { waveform: 'sine', freq: 0.6, amplitude: 0.5, offset: 0.5, ...note('LFO: a slow swell between 0 and 1, the "beat" everything below moves to.') }),
      send('sendBeat', 340, 80, 'beat', 'float', ['beat', 'value'], [
        'Send "beat": shares the LFO under the name beat.',
        'Both groups read it with a Receive inside them. There is no wire into either group and no group input for it: the compile wires it for you.',
      ]),

      n('uv', 'uv', 40, 420, note('UV: this pixel\'s place in the picture.')),
      expr('stripes', 340, 420, {
        label: 'Picture', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [
          ['float bands', '0.5 + 0.5 * sin(uv.x * 18.0 + uv.y * 6.0)'],
          ['float disc', '1.0 - smoothstep(0.38, 0.4, length(uv))'],
        ],
        result: 'mix(vec3(0.1, 0.12, 0.2), vec3(0.95, 0.6, 0.25), bands) * (0.35 + 0.65 * disc)',
        note: [
          'Expression Block: a picture to send as a texture.',
          'bands: diagonal stripes, 0 to 1.',
          'disc: 1 inside a disc in the middle, so the stripes are brighter there.',
        ],
      }),
      n('pass', 'pa', 640, 420, note('Pass: draws the Picture into a texture, so other nodes can read it anywhere (and shifted), not just at this pixel.'), { color: ['stripes', 'result'] }),
      send('sendPic', 940, 420, 'picture', 'texture', ['pa', 'texture'], [
        'Send "picture": shares the Pass\'s texture.',
        'A Send carries a texture the same as a number: the Receive in the Warp group samples it.',
      ]),

      group('rings', 640, 80, {
        label: 'Rings', iterations: 1, inputs: [],
        outputs: [{ key: 'color', type: 'vec3', label: 'Color', from: ['ringLook', 'result'] }],
        nodes: [
          receive('rcvBeatA', 40, 80, 'sendBeat', 'beat', 'float', ['Receive "beat": the LFO from the top level, picked by name. No group input needed.']),
          n('uv', 'ringUv', 40, 300, note('UV: this pixel\'s place in the picture.')),
          expr('ringLook', 340, 160, {
            label: 'Rings', outputType: 'vec3',
            inputs: [['uv', 'vec2', ['ringUv', 'uv']], ['beat', 'float', ['rcvBeatA', 'value']]],
            lines: [
              ['float r', 'length(uv)'],
              ['float ring', '1.0 - smoothstep(0.0, 0.02, abs(fract(r * 4.0 - beat) - 0.5) - 0.1)'],
            ],
            result: 'ring * vec3(0.3, 0.8, 1.0) * (0.4 + 0.6 * beat)',
            note: [
              'Expression Block: rings that ride outward with the beat.',
              'r: distance from the middle.',
              'ring: thin rings every quarter unit, shifted by the beat so they move out as it rises.',
            ],
          }),
        ],
      }),

      group('warp', 1240, 300, {
        label: 'Warp', iterations: 1, inputs: [],
        outputs: [{ key: 'color', type: 'vec3', label: 'Color', from: ['samp', 'color'] }],
        nodes: [
          receive('rcvPic', 40, 60, 'sendPic', 'picture', 'texture', ['Receive "picture": the Pass\'s texture from the top level.']),
          receive('rcvBeatB', 40, 260, 'sendBeat', 'beat', 'float', ['Receive "beat": the same LFO the Rings group reads. Any number of Receives can read one Send.']),
          n('uv', 'warpUv', 40, 440, note('UV: this pixel\'s place in the picture.')),
          expr('wobble', 340, 300, {
            label: 'Wobble', outputType: 'vec2',
            inputs: [['uv', 'vec2', ['warpUv', 'uv']], ['beat', 'float', ['rcvBeatB', 'value']]],
            lines: [['vec2 swirl', 'vec2(sin(uv.y * 5.0), cos(uv.x * 5.0))']],
            result: 'uv + swirl * 0.08 * beat',
            note: [
              'Expression Block: where to read the picture from.',
              'swirl: a direction that turns across the picture.',
              'The read point moves along it by up to 0.08, as far as the beat says.',
            ],
          }),
          n('sampleTexture', 'samp', 640, 160, note('Sample (texture): reads the received picture at the wobbled place.'), { texture: ['rcvPic', 'value'], uv: ['wobble', 'result'] }),
        ],
      }),

      expr('combine', 1540, 80, {
        label: 'Combine', outputType: 'vec3',
        inputs: [['rings', 'vec3', ['rings', 'color']], ['warped', 'vec3', ['warp', 'color']]],
        lines: [],
        result: 'warped * 0.8 + rings',
        note: ['Expression Block: the warped picture with the rings on top.'],
      }),
      n('output', 'out', 1840, 80, note('Output: both groups, moving to one beat.'), { color: ['combine', 'result'] }),
    ],
  };

  return g;
}
