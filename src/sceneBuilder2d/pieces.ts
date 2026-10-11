/**
 * pieces.ts — the 2D Scene Builder's "Picture in pieces" (docs/pieces.md): a picture rebuilt from
 * pieces over the layers, built as the Pieces node with an offset field and, when it moves, an LFO
 * that scatters it and brings it home. Pure data and text: no store.
 *
 *   pieces pond count=40 shape=circle colour=flat|piece size-by=none|brightness|darkness move=noise|flow|mouse|none amount=0.35 speed=0.1 swirl=0.8
 */
import { PIECE_SHAPES, type PieceShape } from '../nodes/definitions/pieces';

export const PIECES_MOVES = ['noise', 'flow', 'mouse', 'none'] as const;
export type PiecesMove = typeof PIECES_MOVES[number];
export const PIECES_SIZE_BYS = ['none', 'brightness', 'darkness'] as const;
export type PiecesSizeBy = typeof PIECES_SIZE_BYS[number];

export interface PiecesSpec {
  /** Switched off for now (builders/mute.ts): bypassed by a live uniform, settings kept. */
  muted?: boolean;
  /** The picture (a name in the scene's textures). */
  tex: string;
  shape: PieceShape;
  /** Pieces across the frame. */
  count: number;
  /** 1 touches the neighbours. */
  size: number;
  colour: 'flat' | 'piece';
  sizeBy: PiecesSizeBy;
  /** What moves them: a noise field, a smoother flow, away from the mouse, or nothing. */
  move: PiecesMove;
  /** How far they fly (a share of the frame's height). */
  amount: number;
  /** Scatters a second (an LFO's frequency); 0: they stay scattered by Amount. */
  speed: number;
  /** The noise's size (Vector Field scale). */
  swirl: number;
}

export const PIECES_LABELS = {
  move: { noise: 'Noise', flow: 'Flow (smoother)', mouse: 'Away from the mouse', none: 'Still' } as Record<PiecesMove, string>,
  sizeBy: { none: 'Nothing', brightness: 'Brightness (halftone)', darkness: 'Darkness (ink)' } as Record<PiecesSizeBy, string>,
  shape: { circle: 'Circle', square: 'Square', hexagon: 'Hexagon', diamond: 'Diamond', glyph: 'Glyph' } as Record<PieceShape, string>,
};

export function defaultPieces(tex: string): PiecesSpec {
  return { tex, shape: 'circle', count: 40, size: 1, colour: 'flat', sizeBy: 'none', move: 'noise', amount: 0.35, speed: 0.1, swirl: 0.8 };
}

const r4 = (n: number) => String(Math.round(n * 1e4) / 1e4);

/** The recipe clause: only what differs from the defaults. */
export function printPieces(p: PiecesSpec, fmtName: (n: string) => string = n => n): string {
  const D = defaultPieces(p.tex);
  const parts = ['pieces', fmtName(p.tex)];
  if (p.count !== D.count) parts.push(`count=${r4(p.count)}`);
  if (p.shape !== D.shape) parts.push(`shape=${p.shape}`);
  if (p.size !== D.size) parts.push(`size=${r4(p.size)}`);
  if (p.colour !== D.colour) parts.push(`colour=${p.colour}`);
  if (p.sizeBy !== D.sizeBy) parts.push(`size-by=${p.sizeBy}`);
  if (p.move !== D.move) parts.push(`move=${p.move}`);
  if (p.amount !== D.amount) parts.push(`amount=${r4(p.amount)}`);
  if (p.speed !== D.speed) parts.push(`speed=${r4(p.speed)}`);
  if (p.swirl !== D.swirl) parts.push(`swirl=${r4(p.swirl)}`);
  return parts.join(' ');
}

export const PIECES_VOCABULARY = `pieces brick count=40 shape=${PIECE_SHAPES.join('|')} size=1 colour=flat|piece size-by=${PIECES_SIZE_BYS.join('|')} move=${PIECES_MOVES.join('|')} amount=0.35 speed=0.1 swirl=0.8`;
