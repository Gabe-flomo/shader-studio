/**
 * agentHood.ts — the Agent Builder's "Under the hood" requests (docs/agent-builder.md): the panel
 * asks, the live agent runner answers (lib/agentRunner.ts drawHood → lib/agentHoodGpu.ts).
 *
 * A request names one Agents group and says what to draw: the colour-mapped thumbnails of its
 * state textures and trail channels (an atlas, read back a few times a second), the walker to read
 * every frame (one texel of each state texture, and where it lands on the picture), and a click on
 * the picture to find the nearest walker for. Nothing is drawn or read while no request is open:
 * ShaderCanvas asks hoodWanted() before it calls the runner.
 */
import type { HoodAtlas, Rgb } from '../agentBuilder/hood';
import { wakePreview } from './previewMirror';

/** One thumbnail: which texture (0–3: A–D, 4: the trail), which channel, which colour map, its range, its colour. */
export interface HoodTileSpec { source: number; comp: number; map: number; lo: number; hi: number; colour: Rgb }

export interface HoodRequest {
  /** The Agents group's node id. */
  groupId: string;
  atlas: HoodAtlas;
  /** Per tile of `atlas.tiles`, in order. */
  specs: HoodTileSpec[];
  /** The kinds' chip colours (the species map). */
  species: Rgb[];
  /** The walker read every frame (null: none). */
  probe: number | null;
  /** A click on the picture: the nearest walker within (rx, ry) of (x, y), all in clip space. Taken by the runner. */
  pick: { x: number; y: number; rx: number; ry: number } | null;
  /** The atlas's pixels, RGBA, bottom row first (as GL reads them). */
  onAtlas: (px: Uint8Array, W: number, H: number) => void;
  /** 5 × 4 floats (hood.ts decodeProbe) for walker `index`. */
  onProbe: (f: Float32Array, index: number) => void;
  /** The walker a pick found (-1: none near). */
  onPick: (index: number) => void;
  /** Every frame: the group's state as the runner has it (its side, whether it keeps C and D, the picture's aspect), or null before it has any. */
  onState?: (s: HoodStateInfo | null) => void;
}

/** What the runner says about a group's state: the texel ↔ walker mapping comes from here. */
export interface HoodStateInfo { side: number; count: number; stateC: boolean; stateE?: boolean; d3: boolean; aspect: number; species: number; trail: boolean }

const requests = new Map<string, HoodRequest>();

/** Open a request (one per group; a second replaces the first). Returns its close. */
export function openHood(req: HoodRequest): () => void {
  requests.set(req.groupId, req);
  wakePreview();
  return () => { if (requests.get(req.groupId) === req) requests.delete(req.groupId); };
}

/** Whether any hood is open (else the runner does nothing for it). */
export function hoodWanted(): boolean { return requests.size > 0; }

export function hoodRequests(): HoodRequest[] { return [...requests.values()]; }

/** Ask for a frame now (a paused preview draws one, so a hover or a click is answered). */
export function pokeHood(): void { wakePreview(); }

/** Thumbnails are redrawn and read back at most this often (ms). */
export const HOOD_ATLAS_MS = 250;
