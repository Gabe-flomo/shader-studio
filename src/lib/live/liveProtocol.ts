/**
 * liveProtocol.ts — what the Live connector (tools/live-connector/Playfield, a Remote Script
 * inside Ableton Live) says, and what we say back: docs/live-connector-plan.md, "The messages".
 *
 * OSC over UDP on 127.0.0.1: the script listens on 11100 and sends to 11101. `LiveState`
 * applies each decoded message to a plain picture of the set (the catalogue of tracks, scenes
 * and parameters; the latest values; the transport, through the tempo follower) and returns
 * an event for the things that happen (a clip launched, a parameter clicked). Pure: liveClient
 * feeds it from the desktop app's listener or the browser bridge, tests feed it directly.
 */
import { TempoFollower } from './tempoFollower';

/** Playfield listens here for the script. */
export const LIVE_IN_PORT = 11101;
/** The script listens here for Playfield. */
export const LIVE_OUT_PORT = 11100;
/** The browser bridge's WebSocket for Live (`npm run osc-bridge -- --live`). */
export const LIVE_BRIDGE_WS_PORT = 9002;
/** The script this app ships (tools/live-connector/Playfield/__init__.py VERSION; a test keeps them equal). */
export const LIVE_CONNECTOR_VERSION = '1.1.0';
/** No hello for this long: "not heard from". */
export const LIVE_STALE_MS = 3000;

export type LiveArg = number | string | boolean;
export interface LiveMessage { address: string; args: LiveArg[] }

export interface LiveTrack { index: number; name: string; colour: number; kind: 'track' | 'return' | 'master' }
export interface LiveScene { index: number; name: string; colour: number }
export interface LiveParam {
  /** "Track / Device / Param" (racks: "Rack > Chain > Device"), the name it's saved by. */
  key: string;
  track: string;
  device: string;
  name: string;
  min: number;
  max: number;
  quantized: boolean;
  /** A switch's or chooser's item names. */
  items: string[];
  /** 'rack': a macro of the rack called "Playfield". */
  role: 'rack' | '';
}
export interface LiveValue { value: number; min: number; max: number; display: string }
export interface LiveHello { script: string; live: string; set: string; gen: number }
export type LiveClipState = 'triggered' | 'playing' | 'stopped';
/** A Playfield Send plug-in in the set (`/pf/sends`): its Pairing ID and the track it sits on. */
export interface LiveSendPair { id: number; track: string; colour: number; trackIndex: number; kind: 'track' | 'return' | 'group' | 'master' }

export type LiveEvent =
  | { type: 'hello'; hello: LiveHello; fresh: boolean }
  | { type: 'catalog'; gen: number }
  | { type: 'param'; key: string }
  | { type: 'transport' }
  | { type: 'clip'; trackIndex: number; track: string; slot: number; state: LiveClipState; clip: string; colour: number }
  | { type: 'scene'; index: number; name: string; colour: number }
  | { type: 'track'; index: number; name: string; colour: number }
  | { type: 'selectedParam'; param: LiveParam; value: LiveValue }
  | { type: 'selectedDevice'; track: string; device: string; keys: string[] }
  | { type: 'ack'; command: string; ok: boolean; detail: string }
  | { type: 'sends'; sends: LiveSendPair[] }
  | { type: 'bye' };

const num = (v: LiveArg | undefined, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : d);
const txt = (v: LiveArg | undefined): string => (typeof v === 'string' ? v : v === undefined ? '' : String(v));

export class LiveState {
  hello: LiveHello | null = null;
  /** When the last hello arrived (ms), 0 before any. */
  lastHello = 0;
  tracks: LiveTrack[] = [];
  scenes: LiveScene[] = [];
  params = new Map<string, LiveParam>();
  /** The catalogue's generation once complete; -1 before any. */
  catalogGen = -1;
  values = new Map<string, LiveValue>();
  readonly follower = new TempoFollower();
  selectedDevice: { track: string; device: string; keys: string[] } | null = null;
  /** The Playfield Send plug-ins in the set, as the script last reported them. */
  sends: LiveSendPair[] = [];
  /** A catalogue arriving in pieces. */
  private building: { gen: number; tracks: LiveTrack[]; scenes: LiveScene[]; params: Map<string, LiveParam> } | null = null;

  /** Is the script talking (a hello within LIVE_STALE_MS)? */
  connected(now: number): boolean {
    return this.lastHello > 0 && now - this.lastHello < LIVE_STALE_MS;
  }

  /** The Playfield rack's macros, in catalogue order. */
  rackParams(): LiveParam[] {
    return [...this.params.values()].filter(p => p.role === 'rack');
  }

  /** A parameter's latest value as 0..1 across its range, or null before any value. */
  unit(key: string): number | null {
    const v = this.values.get(key);
    if (!v) return null;
    const span = v.max - v.min;
    return span > 0 ? Math.max(0, Math.min(1, (v.value - v.min) / span)) : 0;
  }

  trackNamed(name: string): LiveTrack | undefined {
    return this.tracks.find(t => t.name === name);
  }

  apply(m: LiveMessage, now: number): LiveEvent | null {
    const a = m.args;
    switch (m.address) {
      case '/pf/hello': {
        const hello: LiveHello = { script: txt(a[0]), live: txt(a[1]), set: txt(a[2]), gen: num(a[3], -1) };
        const fresh = !this.connected(now) || !this.hello || this.hello.set !== hello.set;
        this.hello = hello;
        this.lastHello = now;
        return { type: 'hello', hello, fresh };
      }
      case '/pf/bye':
        this.lastHello = 0;
        this.follower.reset();
        return { type: 'bye' };
      case '/pf/catalog/begin':
        this.building = { gen: num(a[0]), tracks: [], scenes: [], params: new Map() };
        return null;
      case '/pf/catalog/track': {
        const kind = a[3] === 'return' || a[3] === 'master' ? a[3] : 'track';
        this.building?.tracks.push({ index: num(a[0]), name: txt(a[1]), colour: num(a[2]), kind });
        return null;
      }
      case '/pf/catalog/scene':
        this.building?.scenes.push({ index: num(a[0]), name: txt(a[1]), colour: num(a[2]) });
        return null;
      case '/pf/catalog/param': {
        if (!this.building) return null;
        const p = parseParam(a);
        if (p) {
          this.building.params.set(p.key, p);
          // The catalogue carries each value too: a source reads at once.
          this.values.set(p.key, { value: num(a[7]), min: p.min, max: p.max, display: this.values.get(p.key)?.display ?? '' });
        }
        return null;
      }
      case '/pf/catalog/end': {
        const b = this.building;
        this.building = null;
        if (!b || b.gen !== num(a[0])) return null;
        this.tracks = b.tracks;
        this.scenes = b.scenes;
        this.params = b.params;
        this.catalogGen = b.gen;
        return { type: 'catalog', gen: b.gen };
      }
      case '/pf/param': {
        const key = txt(a[0]);
        if (!key) return null;
        this.values.set(key, { value: num(a[1]), min: num(a[2]), max: num(a[3], 1), display: txt(a[4]) });
        return { type: 'param', key };
      }
      case '/pf/transport':
        this.follower.sample(now, num(a[2]), num(a[1], 120), num(a[0]) > 0, num(a[3], 4), num(a[4], 4));
        return { type: 'transport' };
      case '/pf/clip': {
        const state = a[3] === 'playing' || a[3] === 'stopped' ? a[3] : 'triggered';
        return { type: 'clip', trackIndex: num(a[0]), track: txt(a[1]), slot: num(a[2]), state, clip: txt(a[4]), colour: num(a[5]) };
      }
      case '/pf/scene':
        return { type: 'scene', index: num(a[0]), name: txt(a[1]), colour: num(a[2]) };
      case '/pf/track': {
        const index = num(a[0]), name = txt(a[1]), colour = num(a[2]);
        const t = this.tracks.find(x => x.index === index);
        if (t) { t.name = name; t.colour = colour; }
        return { type: 'track', index, name, colour };
      }
      case '/pf/selected/param': {
        const key = txt(a[0]);
        if (!key) return null;
        const known = this.params.get(key);
        const min = num(a[5]), max = num(a[6], 1);
        const param: LiveParam = known ?? { key, track: txt(a[1]), device: txt(a[2]), name: txt(a[3]), min, max, quantized: false, items: [], role: '' };
        const value: LiveValue = { value: num(a[4]), min, max, display: txt(a[7]) };
        this.values.set(key, value);
        return { type: 'selectedParam', param, value };
      }
      case '/pf/selected/device': {
        const keys = a.slice(2).map(txt).filter(Boolean);
        this.selectedDevice = { track: txt(a[0]), device: txt(a[1]), keys };
        return { type: 'selectedDevice', ...this.selectedDevice };
      }
      case '/pf/ack':
        return { type: 'ack', command: txt(a[0]), ok: num(a[1]) > 0, detail: txt(a[2]) };
      case '/pf/sends': {
        // Five per plug-in: id, track name, colour, track index, kind.
        const sends: LiveSendPair[] = [];
        for (let i = 0; i + 4 < a.length; i += 5) {
          const kind = txt(a[i + 4]);
          sends.push({ id: Math.round(num(a[i], -1)), track: txt(a[i + 1]), colour: num(a[i + 2]), trackIndex: num(a[i + 3]), kind: kind === 'return' || kind === 'group' || kind === 'master' ? kind : 'track' });
        }
        this.sends = sends.filter(x => x.id >= 0 && x.id <= 9999);
        return { type: 'sends', sends: this.sends };
      }
      default:
        return null;
    }
  }
}

function parseParam(a: LiveArg[]): LiveParam | null {
  const key = txt(a[0]);
  if (!key) return null;
  const min = num(a[4]), max = num(a[5], 1);
  const items = txt(a[8]);
  return {
    key, track: txt(a[1]), device: txt(a[2]), name: txt(a[3]), min, max: max === min ? min + 1 : max,
    quantized: num(a[6]) > 0, items: items ? items.split('|') : [], role: a[9] === 'rack' ? 'rack' : '',
  };
}

/** "#rrggbb" for a Live colour (0xRRGGBB). */
export function liveColour(c: number): string {
  return `#${(Math.max(0, Math.round(c)) & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** A parameter key's last part ("Frequency") and the rest ("Bass / Auto Filter"). */
export function splitLiveKey(key: string): { where: string; name: string } {
  const i = key.lastIndexOf(' / ');
  return i < 0 ? { where: '', name: key } : { where: key.slice(0, i), name: key.slice(i + 3) };
}

/** Playfield → Live: the commands the script accepts (anything else it ignores). */
export type LiveCommand =
  | { cmd: 'ping' }
  | { cmd: 'catalog' }
  | { cmd: 'watch'; keys: string[] }
  | { cmd: 'clip'; track: string; clip: string }
  | { cmd: 'scene'; scene: string }
  | { cmd: 'nextScene' }
  | { cmd: 'stopAll' }
  | { cmd: 'tap' }
  | { cmd: 'sends' };

/** A name, or a whole number typed as one ("3"), as the script wants it: an int is an index (from 1 in the app, from 0 on the wire). */
function nameOrIndex(v: string): LiveArg | { i: number } {
  const t = v.trim();
  return /^#\d{1,4}$/.test(t) ? { i: Math.max(0, parseInt(t.slice(1), 10) - 1) } : t;
}

/** The OSC message for a command (args in encodeOsc's shapes: `{ i }` for ints). */
export function commandMessage(c: LiveCommand): { address: string; args: Array<LiveArg | { i: number }> } {
  switch (c.cmd) {
    case 'ping': return { address: '/pf/ping', args: [] };
    case 'catalog': return { address: '/pf/catalog/request', args: [] };
    case 'watch': return { address: '/pf/watch', args: c.keys };
    case 'clip': return { address: '/pf/fire/clip', args: [nameOrIndex(c.track), nameOrIndex(c.clip)] };
    case 'scene': return { address: '/pf/fire/scene', args: [nameOrIndex(c.scene)] };
    case 'nextScene': return { address: '/pf/scene/next', args: [] };
    case 'stopAll': return { address: '/pf/stop/all', args: [] };
    case 'tap': return { address: '/pf/tap', args: [] };
    case 'sends': return { address: '/pf/sends/request', args: [] };
  }
}
