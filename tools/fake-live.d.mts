/** Types for tools/fake-live.mjs (tests import FakeLive). */
export class FakeLive {
  constructor(o?: { tempo?: number; jitterMs?: number; loss?: number; rand?: () => number; playing?: boolean; transportMs?: number; learnEveryMs?: number });
  tempo: number;
  playing: boolean;
  gen: number;
  watched: Set<string>;
  sent: Array<{ address: string; args: unknown[] }>;
  set: { name: string; tracks: Array<{ name: string; colour: number; kind: string; clips: string[] }>; scenes: Array<{ name: string; colour: number }> };
  beatsAt(now: number): number;
  setPlaying(on: boolean, now: number): Uint8Array[];
  setTempo(bpm: number, now: number): Uint8Array[];
  jump(beats: number, now: number): Uint8Array[];
  hello(): Uint8Array;
  transport(now: number): Uint8Array;
  catalog(now: number): Uint8Array[];
  tick(now: number): Uint8Array[];
  handle(packet: Uint8Array, now: number): Uint8Array[];
}
