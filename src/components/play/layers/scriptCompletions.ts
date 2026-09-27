/**
 * What the Script editor's autocomplete knows: the sketch helpers and frame
 * fields from the reference, the canvas context and Math after a dot, the
 * sketch's own variables and functions, and JavaScript keywords.
 */
import type { Completion } from '../../code/glslReference';
import type { MemberCompletions } from '../../code/useCompletion';
import { referenceFor, refSignature, type RefItem } from './scriptReference';
import { declaredParams } from './scriptTools';

const KEYWORDS = ['const', 'let', 'function', 'return', 'if', 'else', 'for', 'while', 'break', 'continue', 'true', 'false', 'null', 'undefined', 'new', 'typeof', 'of', 'in'];

const CTX: Array<[string, string, string?]> = [
  ['fillStyle', 'Colour, gradient or pattern used by fill.'], ['strokeStyle', 'Colour used by stroke.'], ['lineWidth', 'Stroke width in pixels.'],
  ['lineCap', "'butt' | 'round' | 'square'."], ['lineJoin', "'miter' | 'round' | 'bevel'."], ['globalAlpha', 'Opacity for everything drawn next, 0–1.'],
  ['globalCompositeOperation', "Blend mode: 'source-over', 'lighter', 'multiply', 'screen', 'destination-out'…"], ['font', "CSS font, e.g. '16px sans-serif'."],
  ['textAlign', "'left' | 'center' | 'right'."], ['textBaseline', "'top' | 'middle' | 'alphabetic' | 'bottom'."],
  ['shadowBlur', 'Blur radius of the shadow.'], ['shadowColor', 'Colour of the shadow.'],
  ['beginPath', 'Start a new path.', 'beginPath()'], ['closePath', 'Close the current path.', 'closePath()'], ['moveTo', 'Move the pen without drawing.', 'moveTo(x, y)'],
  ['lineTo', 'Line to a point.', 'lineTo(x, y)'], ['arc', 'Arc around (x, y): radius, start and end angles.', 'arc(x, y, r, 0, Math.PI * 2)'],
  ['ellipse', 'Ellipse: radii, rotation, angles.', 'ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)'], ['rect', 'Rectangle path.', 'rect(x, y, w, h)'],
  ['roundRect', 'Rounded rectangle path.', 'roundRect(x, y, w, h, r)'], ['bezierCurveTo', 'Cubic curve to a point.', 'bezierCurveTo(c1x, c1y, c2x, c2y, x, y)'],
  ['quadraticCurveTo', 'Quadratic curve to a point.', 'quadraticCurveTo(cx, cy, x, y)'], ['fill', 'Fill the current path.', 'fill()'], ['stroke', 'Stroke the current path.', 'stroke()'],
  ['clip', 'Clip what comes next to the current path.', 'clip()'], ['fillRect', 'Filled rectangle.', 'fillRect(x, y, w, h)'], ['strokeRect', 'Outlined rectangle.', 'strokeRect(x, y, w, h)'],
  ['clearRect', 'Erase a rectangle.', 'clearRect(x, y, w, h)'], ['fillText', 'Draw text.', 'fillText(text, x, y)'], ['strokeText', 'Outline text.', 'strokeText(text, x, y)'],
  ['measureText', 'Width of a string in the current font.', 'measureText(text).width'], ['save', 'Push the state (transform, styles).', 'save()'], ['restore', 'Pop the state.', 'restore()'],
  ['translate', 'Move the origin.', 'translate(x, y)'], ['rotate', 'Rotate the axes (radians).', 'rotate(angle)'], ['scale', 'Scale the axes.', 'scale(sx, sy)'],
  ['setTransform', 'Replace the transform (1,0,0,1,0,0 resets).', 'setTransform(1, 0, 0, 1, 0, 0)'], ['drawImage', 'Draw an image or canvas.', 'drawImage(img, x, y, w, h)'],
  ['createLinearGradient', 'A gradient between two points; addColorStop to fill it.', 'createLinearGradient(x0, y0, x1, y1)'], ['createRadialGradient', 'A gradient between two circles.', 'createRadialGradient(x, y, 0, x, y, r)'],
];
const MATH = ['abs', 'sin', 'cos', 'tan', 'atan2', 'sqrt', 'pow', 'hypot', 'floor', 'ceil', 'round', 'min', 'max', 'random', 'sign', 'exp', 'log', 'PI'];

/** A reference entry as a completion: signature, return type, parameters and example go to the popup's description. */
export function refToCompletion(it: RefItem, name = it.name): Completion {
  const more = { doc: it.doc, args: it.args, returns: it.returns, example: it.example };
  if (!it.args) return { kind: 'const', name, type: it.type, insert: name, ...more };
  // An entry's own one-line insert (`circle(x, y, 20)`), else empty parens; blocks (setup, push/pop) are the Reference tab's.
  const insert = it.insert && !it.insert.includes('\n') ? it.insert.slice(it.name.length - name.length) : `${name}()`;
  return { kind: 'fn', name, detail: refSignature(it), type: it.type === 'nothing' ? undefined : it.type, insert, ...more };
}

const cachedStatic: Partial<Record<'2d' | '3d', { all: Completion[]; members: MemberCompletions }>> = {};
function staticCompletions(mode: '2d' | '3d') {
  const hit = cachedStatic[mode];
  if (hit) return hit;
  const all: Completion[] = [];
  const sMembers: Completion[] = [];
  for (const g of referenceFor(mode)) for (const it of g.items) {
    if (it.name.startsWith('s.')) sMembers.push(refToCompletion(it, it.name.slice(2)));
    else all.push(refToCompletion(it));
  }
  for (const k of KEYWORDS) all.push({ kind: 'keyword', name: k, insert: k });
  const ctx: Completion[] = CTX.map(([name, doc, insert]) => (insert ? { kind: 'fn', name, detail: insert.slice(name.length), doc, insert } : { kind: 'const', name, doc, insert: name }));
  const math: Completion[] = MATH.map(n => (n === 'PI' ? { kind: 'const', name: n, doc: 'π.', insert: n } : { kind: 'fn', name: n, detail: '()', doc: `Math.${n}.`, insert: `${n}()` }));
  // 3D has no 2D context: no ctx. members.
  const members: MemberCompletions = mode === '3d' ? { s: sMembers, Math: math, math } : { s: sMembers, ctx, Math: math, math };
  const made = { all, members };
  cachedStatic[mode] = made;
  return made;
}

/** Completions for a sketch: the built-ins for its mode plus the identifiers the code declares. */
export function scriptCompletions(code: string, mode: '2d' | '3d' = '2d'): { all: Completion[]; members: MemberCompletions } {
  const base = staticCompletions(mode);
  const own = new Map<string, Completion>();
  const re = /\b(?:let|const|var|function)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) if (!own.has(m[1])) own.set(m[1], { kind: 'var', name: m[1], doc: `Declared in this sketch.`, insert: m[1] });
  const params: Completion[] = declaredParams(code).map(k => ({ kind: 'var', name: k, doc: `A param this sketch declares.`, insert: k }));
  return { all: [...own.values(), ...base.all], members: { ...base.members, params, ...(params.length ? { s: base.members.s } : {}) } };
}
