/**
 * recipe.ts — the Splat builder's recipe (docs/splat-builder.md, "Under the hood"): the whole scene as a few lines
 * of text, one per part, that read back into the same spec. ⌘⇧D opens it.
 *
 *   scan example=blob count=150000 max=2000000 sh=1 sort=moves res=full
 *   place at=(0,0,0) turn=(0,30,0) scale=1 up=-y size=1 opacity=1
 *   dissolve amount=0.35 scale=1.5 edgeColor=(1,0.45,0.12) animate=amount:0.08:0:1
 *   wave muted mode=wobble amplitude=0.02
 *   world on floor=on floor-y=-1 light=sunset shadows=on fog=0.02
 *   shape sphere at=(1.4,-0.6,-0.4) size=0.4 color=(0.85,0.3,0.2)
 *   background gradient color=(0.09,0.1,0.14) color2=(0.02,0.02,0.03)
 *   camera dist=3.6 angle=25 elev=12 fov=1.5 turntable=8 target=(0,0,0)
 *   look tone=aces bloom=on bloom-intensity=0.8 bloom-threshold=0.6 bloom-radius=40
 *
 * An effect line is its kind and its node's own settings (the names on the node card's sliders, in camelCase); a
 * `yours tail=<node>` line is a run of nodes you added on the card ("Your nodes"), kept in its place. A muted card's line
 * has the `muted` flag (builders/mute.ts); `off`, the older word for it, still reads. Pure.
 */
import {
  EFFECT_KINDS, LIGHTS, PROP_KINDS, TONES, effectDefaults, starterSplatScene,
  type EffectKind, type EffectSpec, type LightKind, type ParamValue, type PropKind, type SplatBuilderSpec, type Tone, type Vec3,
} from './spec';
import { MUTED_WORD } from '../builders/mute';

const fmt = (v: number) => String(Math.round(v * 1e4) / 1e4);
const vec = (v: readonly number[]) => `(${v.map(fmt).join(',')})`;
const val = (v: ParamValue): string => (typeof v === 'number' ? fmt(v) : Array.isArray(v) ? vec(v) : /\s/.test(v) ? JSON.stringify(v) : v);
const onOff = (b: boolean) => (b ? 'on' : 'off');
/** An effect line's mute: `muted` (or the older `off`). */
const isMutedFlag = (flags: string[]) => flags.some(f => f === MUTED_WORD || f === 'off');

/** The spec as recipe lines. */
export function splatRecipe(spec: SplatBuilderSpec): string {
  const S = spec.scan, P = spec.place, W = spec.world, B = spec.background, C = spec.camera, L = spec.look;
  const lines: string[] = [];
  const src = S.source.kind === 'file' ? `file=${JSON.stringify(S.source.fileName)} id=${S.source.videoId} bytes=${S.source.bytes}` : `example=${S.source.demo} count=${S.source.count}`;
  lines.push(`scan ${src} max=${S.maxSplats} sh=${S.shDegree} sort=${S.sort} res=${S.resolution}`);
  lines.push(`place at=${vec(P.position)} turn=${vec(P.rotation)} scale=${fmt(P.scale)} up=${P.up === 'y' ? '+y' : '-y'} size=${fmt(P.splatSize)} opacity=${fmt(P.opacity)}`);
  for (const e of spec.effects) {
    if (e.kind === 'custom') { lines.push(`yours${e.on ? '' : ` ${MUTED_WORD}`} tail=${e.tail}${e.label ? ` label=${JSON.stringify(e.label)}` : ''}`); continue; }
    const words = [e.kind, ...(e.on ? [] : [MUTED_WORD]), ...Object.entries(e.params).map(([k, v]) => `${k}=${val(v)}`)];
    if (e.animate) words.push(`animate=${e.animate.param}:${fmt(e.animate.speed)}:${fmt(e.animate.from)}:${fmt(e.animate.to)}`);
    lines.push(words.join(' '));
  }
  lines.push(`world ${onOff(W.on)} floor=${onOff(W.floor.on)} floor-y=${fmt(W.floor.y)} floor-color=${vec(W.floor.color)} light=${W.light} shadows=${onOff(W.shadows)} fog=${fmt(W.fog)}`);
  for (const p of W.props) lines.push(`shape ${p.kind} at=${vec(p.at)} size=${fmt(p.size)} color=${vec(p.color)}`);
  lines.push(`background ${B.kind} color=${vec(B.color)} color2=${vec(B.color2)}${B.picture ? ` picture=${val(B.picture)}` : ''}`);
  lines.push(`camera dist=${fmt(C.dist)} angle=${fmt(C.angle)} elev=${fmt(C.elev)} fov=${fmt(C.fov)} turntable=${fmt(C.turntable)} target=${vec(C.target)}`);
  lines.push(`look tone=${L.tone} bloom=${onOff(L.bloom.on)} bloom-intensity=${fmt(L.bloom.intensity)} bloom-threshold=${fmt(L.bloom.threshold)} bloom-radius=${fmt(L.bloom.radius)}`);
  return lines.join('\n');
}

/** Words of a line: spaces split them, except inside (…) or "…". */
function words(line: string): string[] {
  const out: string[] = [];
  let cur = '', depth = 0, quote = false;
  for (const ch of line) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === '(') depth++;
    if (!quote && ch === ')') depth = Math.max(0, depth - 1);
    if (!quote && depth === 0 && /\s/.test(ch)) { if (cur) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function parseValue(raw: string): ParamValue | null {
  if (raw.startsWith('"')) { try { return JSON.parse(raw) as string; } catch { return raw.replace(/"/g, ''); } }
  if (raw.startsWith('(')) {
    const parts = raw.replace(/[()]/g, '').split(',').map(Number);
    return parts.length === 3 && parts.every(Number.isFinite) ? parts as Vec3 : null;
  }
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) ? n : raw;
}

export interface RecipeRead { spec: SplatBuilderSpec; errors: string[] }

/**
 * The recipe read back into a spec. `base` gives what the text leaves out (and the scan's file when only its name
 * is typed). Lines it can't read are listed in `errors` (with their line number); the rest still applies.
 */
export function readSplatRecipe(text: string, base: SplatBuilderSpec = starterSplatScene()): RecipeRead {
  const spec = structuredClone(base);
  const errors: string[] = [];
  spec.effects = [];
  spec.world.props = [];
  // Each effect line takes the id of the base's next effect of its kind (its nodes stay the same nodes), else a new one.
  const unused = [...base.effects];
  const taken = new Set<string>();
  const idFor = (kind: EffectKind) => {
    const at = unused.findIndex(e => e.kind === kind);
    if (at >= 0) { const id = unused.splice(at, 1)[0].id; taken.add(id); return id; }
    for (let k = 1; ; k++) if (!taken.has(`e${k}`) && !unused.some(e => e.id === `e${k}`)) { taken.add(`e${k}`); return `e${k}`; }
  };
  const lines = text.split('\n');
  lines.forEach((line0, i) => {
    const line = line0.replace(/#.*$/, '').trim();
    if (!line) return;
    const [head, ...rest] = words(line);
    const flags = rest.filter(w => !w.includes('='));
    const kv = new Map<string, ParamValue>();
    for (const w of rest) {
      const at = w.indexOf('=');
      if (at <= 0) continue;
      const v = parseValue(w.slice(at + 1));
      if (v === null) { errors.push(`Line ${i + 1}: “${w}” isn't a value I can read.`); continue; }
      kv.set(w.slice(0, at), v);
    }
    const num = (k: string, d: number) => (typeof kv.get(k) === 'number' ? kv.get(k) as number : d);
    const v3 = (k: string, d: Vec3): Vec3 => (Array.isArray(kv.get(k)) ? [...kv.get(k) as Vec3] : d);
    const word = (k: string, d: string) => (typeof kv.get(k) === 'string' ? kv.get(k) as string : typeof kv.get(k) === 'number' ? String(kv.get(k)) : d);
    const bool = (k: string, d: boolean) => (kv.has(k) ? word(k, '') === 'on' || word(k, '') === 'yes' || kv.get(k) === 1 : d);
    switch (head) {
      case 'scan': {
        if (kv.has('file')) {
          const name = word('file', '');
          const id = word('id', base.scan.source.kind === 'file' && base.scan.source.fileName === name ? base.scan.source.videoId : '');
          if (!id) errors.push(`Line ${i + 1}: the scan “${name}” isn't loaded here: load it in the Scan section.`);
          else spec.scan.source = { kind: 'file', videoId: id, fileName: name, bytes: num('bytes', base.scan.source.kind === 'file' ? base.scan.source.bytes : 0) };
        } else if (kv.has('example')) {
          spec.scan.source = { kind: 'demo', demo: word('example', 'blob') === 'rings' ? 'rings' : 'blob', count: Math.round(num('count', 150000)) };
        }
        spec.scan.maxSplats = Math.round(num('max', spec.scan.maxSplats));
        spec.scan.shDegree = Math.max(0, Math.min(3, Math.round(num('sh', spec.scan.shDegree))));
        spec.scan.sort = word('sort', spec.scan.sort) === 'frame' ? 'frame' : 'moves';
        spec.scan.resolution = word('res', spec.scan.resolution) === 'half' ? 'half' : 'full';
        return;
      }
      case 'place':
        spec.place = { position: v3('at', spec.place.position), rotation: v3('turn', spec.place.rotation), scale: num('scale', spec.place.scale), up: word('up', spec.place.up === 'y' ? '+y' : '-y') === '+y' ? 'y' : 'minusY', splatSize: num('size', spec.place.splatSize), opacity: num('opacity', spec.place.opacity) };
        return;
      case 'world':
        spec.world = {
          ...spec.world, on: !flags.includes('off'),
          floor: { on: bool('floor', spec.world.floor.on), y: num('floor-y', spec.world.floor.y), color: v3('floor-color', spec.world.floor.color) },
          light: (LIGHTS as readonly string[]).includes(word('light', '')) ? word('light', '') as LightKind : spec.world.light,
          shadows: bool('shadows', spec.world.shadows), fog: num('fog', spec.world.fog),
        };
        return;
      case 'shape': {
        const kind = flags[0] as PropKind;
        if (!(PROP_KINDS as readonly string[]).includes(kind)) { errors.push(`Line ${i + 1}: “${flags[0] ?? ''}” isn't a shape (${PROP_KINDS.join(', ')}).`); return; }
        spec.world.props.push({ id: `p${spec.world.props.length + 1}`, kind, at: v3('at', [0, 0, 0]), size: num('size', 0.4), color: v3('color', [0.8, 0.8, 0.8]) });
        return;
      }
      case 'background': {
        const kind = flags[0] === 'solid' || flags[0] === 'picture' ? flags[0] : 'gradient';
        spec.background = { kind, color: v3('color', spec.background.color), color2: v3('color2', spec.background.color2), picture: kv.has('picture') ? word('picture', '') : kind === 'picture' ? spec.background.picture : null };
        // A picture named here that the scene has no source for (a recipe from another project): a source by that
        // name, so Build makes an empty Texture node for it (builders/textures.ts ensureSources).
        const pic = spec.background.picture;
        if (kind === 'picture' && pic && !(spec.textures ?? []).some(s => s.name === pic)) spec.textures = [...(spec.textures ?? []), { name: pic }];
        return;
      }
      case 'camera':
        spec.camera = { dist: num('dist', spec.camera.dist), angle: num('angle', spec.camera.angle), elev: num('elev', spec.camera.elev), fov: num('fov', spec.camera.fov), turntable: num('turntable', spec.camera.turntable), target: v3('target', spec.camera.target) };
        return;
      case 'look':
        spec.look = {
          tone: (TONES as readonly string[]).includes(word('tone', '')) ? word('tone', '') as Tone : spec.look.tone,
          bloom: { on: bool('bloom', spec.look.bloom.on), intensity: num('bloom-intensity', spec.look.bloom.intensity), threshold: num('bloom-threshold', spec.look.bloom.threshold), radius: num('bloom-radius', spec.look.bloom.radius) },
        };
        return;
      case 'yours': {
        // Your nodes: a run you added on the card, by the node that ends it.
        const tail = word('tail', '');
        const had = base.effects.find(e => e.kind === 'custom' && e.tail === tail);
        if (!had) { errors.push(`Line ${i + 1}: there are no nodes of yours ending in “${tail}” (add them on the Splat Scene card).`); return; }
        spec.effects.push({ ...structuredClone(had), on: !isMutedFlag(flags), ...(kv.has('label') ? { label: word('label', '') } : {}) });
        return;
      }
      default: {
        if (!(EFFECT_KINDS as readonly string[]).includes(head)) { errors.push(`Line ${i + 1}: “${head}” isn't a part I know (scan, place, an effect: ${EFFECT_KINDS.join(', ')}, world, shape, background, camera, look).`); return; }
        const kind = head as EffectKind;
        const defaults = effectDefaults(kind);
        const params: Record<string, ParamValue> = { ...defaults };
        for (const [k, v] of kv) {
          if (k === 'animate') continue;
          if (!(k in defaults)) { errors.push(`Line ${i + 1}: ${kind} has no setting “${k}”.`); continue; }
          params[k] = v;
        }
        const e: EffectSpec = { id: idFor(kind), kind, on: !isMutedFlag(flags), params, animate: null };
        const an = kv.get('animate');
        if (typeof an === 'string') {
          const [param, speed, from, to] = an.split(':');
          if (!(param in defaults)) errors.push(`Line ${i + 1}: ${kind} can't animate “${param}”.`);
          else e.animate = { param, speed: Number(speed) || 0.1, from: Number(from) || 0, to: Number.isFinite(Number(to)) && to !== undefined ? Number(to) : 1 };
        }
        spec.effects.push(e);
      }
    }
  });
  return { spec, errors };
}
