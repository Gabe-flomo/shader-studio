/**
 * Where learned parameter roles live: this browser's localStorage, one JSON
 * object (see `LearnedRole` in roles.ts). Changing it fires
 * `learned-roles-changed` so every open discovery view re-guesses.
 */
import { useSyncExternalStore } from 'react';
import { forgetRole, learnRole, type RoleMemory, type ValueRole } from './roles';
import type { DiscoveredFn } from './discover';

export const ROLE_MEMORY_KEY = 'shader-studio:discover:learned-roles';
const EVENT = 'learned-roles-changed';

let cached: { raw: string | null; memory: RoleMemory } = { raw: null, memory: {} };

/** The learned roles (the same object until they change, so it is safe as a React snapshot). */
export function getRoleMemory(): RoleMemory {
  let raw: string | null = null;
  try { raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(ROLE_MEMORY_KEY); } catch { raw = null; }
  if (raw === cached.raw) return cached.memory;
  let memory: RoleMemory = {};
  try { const v = raw ? JSON.parse(raw) : {}; if (v && typeof v === 'object' && !Array.isArray(v)) memory = v as RoleMemory; } catch { memory = {}; }
  cached = { raw, memory };
  return memory;
}

function write(memory: RoleMemory): void {
  try {
    if (Object.keys(memory).length) localStorage.setItem(ROLE_MEMORY_KEY, JSON.stringify(memory));
    else localStorage.removeItem(ROLE_MEMORY_KEY);
  } catch { /* storage full or blocked: the choice still applies until the page closes */ }
  cached = { raw: null, memory };
  try { cached.raw = localStorage.getItem(ROLE_MEMORY_KEY); } catch { /* keep the in-memory copy */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Remember that the person picked `chosen` for a parameter the app guessed was `guess`. */
export function rememberRole(fn: DiscoveredFn, paramIndex: number, guess: ValueRole, chosen: ValueRole): void {
  write(learnRole(getRoleMemory(), fn, paramIndex, guess, chosen));
}

/** Forget one learned role, or all of them. */
export function forgetLearnedRole(key?: string): void {
  write(forgetRole(getRoleMemory(), key));
}

const subscribe = (cb: () => void) => {
  const onStorage = (e: StorageEvent) => { if (e.key === ROLE_MEMORY_KEY) cb(); };
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', onStorage); };
};

/** The learned roles, re-rendering when they change (here or in another tab). */
export function useRoleMemory(): RoleMemory {
  return useSyncExternalStore(subscribe, getRoleMemory, getRoleMemory);
}
