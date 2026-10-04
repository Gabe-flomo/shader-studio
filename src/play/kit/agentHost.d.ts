// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export interface AhHost {
  unsupported: string | null;
  active: boolean;
  run(o: { width: number; height: number; time: number; live: boolean; frameMs?: number }): void;
  reset(): void;
  dispose(): void;
  state?(): { groups: Map<string, Any>; trails: Map<string, Any>; draws: Map<string, Any> };
}
export function ahUnsupported(gl: Any): string | null;
export function ahCreate(gl: Any, spec: Any, env: Any): AhHost;
