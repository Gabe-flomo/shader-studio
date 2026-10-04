export interface PhPass {
  slug: string;
  label?: string;
  fragmentShader: string;
  scale: number;
  format: string;
  filter: string;
  wrap: string;
  previous: boolean;
  live: boolean;
  afterAgents?: boolean;
  beforeParticles?: boolean;
  repeat?: number;
  u: { tex: string; prev: string; iter?: string };
}
export interface PhEnv<P = unknown, T = unknown> {
  link(fragmentShader: string): P;
  use(program: P, w: number, h: number): void;
  done(): void;
  quad(): void;
  textures: Map<string, T | null>;
  vec2s: Map<string, number[]>;
  halfFloat: boolean;
}
export interface PhHost {
  hasPrevious: boolean;
  splitsForParticles: boolean;
  run(w: number, h: number, stage?: 'pre' | 'post', part?: 'particles' | 'rest'): void;
  clearPrevious(): void;
  dispose(): void;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function phCreate(gl: any, passes: readonly PhPass[], env: PhEnv<any, any>): PhHost;
