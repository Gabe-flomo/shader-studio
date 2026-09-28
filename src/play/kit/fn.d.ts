export const FN_VAR_NAMES: readonly string[];
export const FN_FUNC_NAMES: readonly string[];
export interface FnVars { t: number; b: number }
export function fnCompile(expr: string): { fn: (vars: FnVars) => number; error: string | null };
export function fnEval(expr: string, vars: FnVars): { value: number; error: string | null };
