/**
 * Keyboard shortcut system.
 *
 * Shortcuts are stored in localStorage as a map of actionId → key combo string.
 * Key combo format: modifiers joined by '+' then the key, e.g. "cmd+s", "shift+f", "f"
 * Modifier tokens: cmd, ctrl, shift, alt  (order-normalised on save/match)
 */

import { useEffect, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShortcutAction {
  id: string;
  label: string;
  group: string;
  defaultCombo: string;
  description?: string;
}

export type ShortcutMap = Record<string, string>; // actionId → combo

// ─── Default actions ──────────────────────────────────────────────────────────

export const DEFAULT_ACTIONS: ShortcutAction[] = [
  // Graph management
  { id: 'undo',              label: 'Undo',                  group: 'Graph',      defaultCombo: 'cmd+z',       description: 'Undo last graph change' },
  { id: 'export',            label: 'Export graph',          group: 'Graph',      defaultCombo: 'cmd+s',       description: 'Export graph to file' },
  { id: 'import',            label: 'Import graph',          group: 'Graph',      defaultCombo: 'cmd+o',       description: 'Import graph from file' },
  // View
  { id: 'fitView',           label: 'Fit view',              group: 'View',       defaultCombo: 'f',           description: 'Fit all nodes in view' },
  { id: 'toggleCode',        label: 'Toggle GLSL code',      group: 'View',       defaultCombo: 'cmd+\\',      description: 'Show/hide GLSL output panel' },
  { id: 'toggleRecord',      label: 'Record video',          group: 'View',       defaultCombo: 'cmd+r',       description: 'Open the video recorder' },
  // Node graph — add nodes
  { id: 'addNode',           label: 'Open node palette',     group: 'Add Nodes',  defaultCombo: 'a',           description: 'Open the add-node palette' },
  { id: 'addUV',             label: 'Add UV node',           group: 'Add Nodes',  defaultCombo: 'u',           description: 'Instantly add a UV node' },
  { id: 'addTime',           label: 'Add Time node',         group: 'Add Nodes',  defaultCombo: 't',           description: 'Instantly add a Time node' },
  { id: 'addFloat',          label: 'Add Float node',        group: 'Add Nodes',  defaultCombo: 'shift+f',     description: 'Instantly add a Float constant node' },
  { id: 'addOutput',         label: 'Add Output node',       group: 'Add Nodes',  defaultCombo: 'o',           description: 'Instantly add an Output node' },
  { id: 'addMix',            label: 'Add Mix node',          group: 'Add Nodes',  defaultCombo: 'm',           description: 'Instantly add a Mix node' },
  { id: 'addColor',          label: 'Add Color node',        group: 'Add Nodes',  defaultCombo: 'c',           description: 'Instantly add a Color constant node' },
  // Node graph — select/filter/highlight
  { id: 'selectAll',         label: 'Show all nodes',        group: 'Filter',     defaultCombo: 'cmd+a',       description: 'Clear filter — show all nodes normally' },
  { id: 'filterFloat',       label: 'Highlight float nodes', group: 'Filter',     defaultCombo: '1',           description: 'Hold to highlight nodes that output float' },
  { id: 'filterVec2',        label: 'Highlight vec2 nodes',  group: 'Filter',     defaultCombo: '2',           description: 'Hold to highlight nodes that output vec2 (UV)' },
  { id: 'filterVec3',        label: 'Highlight vec3 nodes',  group: 'Filter',     defaultCombo: '3',           description: 'Hold to highlight nodes that output vec3 (color/pos)' },
  { id: 'filterUVInputs',    label: 'Highlight UV inputs',   group: 'Filter',     defaultCombo: 'shift+u',     description: 'Hold to highlight nodes that have a vec2 input' },
  { id: 'filterUVOutputs',   label: 'Highlight UV outputs',  group: 'Filter',     defaultCombo: 'shift+v',     description: 'Hold to highlight nodes that output vec2' },
  // Help
  { id: 'shortcuts',         label: 'Keyboard shortcuts',    group: 'Help',       defaultCombo: '?',           description: 'Show this panel' },
];

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'shader-studio:shortcuts';

export function loadShortcutMap(): ShortcutMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as ShortcutMap;
      // Merge in any new defaults that didn't exist when last saved
      const map: ShortcutMap = {};
      for (const a of DEFAULT_ACTIONS) {
        map[a.id] = stored[a.id] ?? a.defaultCombo;
      }
      return map;
    }
  } catch {}
  const map: ShortcutMap = {};
  for (const a of DEFAULT_ACTIONS) map[a.id] = a.defaultCombo;
  return map;
}

export function saveShortcutMap(map: ShortcutMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function resetShortcutMap(): ShortcutMap {
  const map: ShortcutMap = {};
  for (const a of DEFAULT_ACTIONS) map[a.id] = a.defaultCombo;
  saveShortcutMap(map);
  return map;
}

// ─── Combo helpers ────────────────────────────────────────────────────────────

const MODS = new Set(['cmd', 'ctrl', 'shift', 'alt', 'meta']);

/** Normalise a combo string: lowercase, sorted modifiers, '+' separated */
export function normaliseCombo(raw: string): string {
  const parts = raw.toLowerCase().split('+').map(p => p.trim()).filter(Boolean);
  const mods  = parts.filter(p => MODS.has(p)).sort();
  const key   = parts.find(p => !MODS.has(p)) ?? '';
  return [...mods, key].join('+');
}

/** Build a combo string from a KeyboardEvent */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey)  parts.push('cmd');
  if (e.ctrlKey)  parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey)   parts.push('alt');
  let key = e.key.toLowerCase();
  if (key === ' ')            key = 'space';
  if (key === '\\')           key = '\\';
  if (key === '?')            key = '?';
  if (key.startsWith('arrow')) key = key.slice(5); // arrowup → up
  parts.push(key);
  return parts.join('+');
}

/** Human-readable display for a combo, e.g. "cmd+s" → "⌘S" */
export function displayCombo(combo: string): string {
  if (!combo) return '—';
  return combo
    .split('+')
    .map(p => {
      switch (p) {
        case 'cmd':   return '⌘';
        case 'ctrl':  return '⌃';
        case 'shift': return '⇧';
        case 'alt':   return '⌥';
        case 'space': return '␣';
        default:      return p.toUpperCase();
      }
    })
    .join('');
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

type ActionHandlers = Partial<Record<string, () => void>>;

/**
 * Listen for keyboard shortcuts and fire the matching handler.
 *
 * `holdHandlers` — actions in this set are "hold to activate": the handler fires
 * on keydown, and `onHoldRelease` fires when the same key is released.
 * Used for highlight filters (hold key = highlight, release = clear).
 */
export function useShortcuts(
  handlers: ActionHandlers,
  holdHandlers?: { ids: Set<string>; onRelease: () => void },
) {
  const handlersRef    = useRef(handlers);
  const holdHandlerRef = useRef(holdHandlers);
  useEffect(() => { handlersRef.current    = handlers;    }, [handlers]);
  useEffect(() => { holdHandlerRef.current = holdHandlers; }, [holdHandlers]);

  // Track which key combo is currently held for a hold-action (so keyup matches)
  const heldComboRef = useRef<string | null>(null);

  const dispatch = useCallback((actionId: string) => {
    handlersRef.current[actionId]?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Suppress key-repeat for hold actions (don't re-fire on every repeat tick)
      if (e.repeat) return;

      const tag      = (e.target as HTMLElement)?.tagName;
      const editable = (e.target as HTMLElement)?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;

      const combo = comboFromEvent(e);
      const map   = loadShortcutMap();

      for (const [actionId, bound] of Object.entries(map)) {
        if (normaliseCombo(bound) === normaliseCombo(combo)) {
          e.preventDefault();
          dispatch(actionId);
          // If this is a hold action, remember the combo so keyup can match it
          if (holdHandlerRef.current?.ids.has(actionId)) {
            heldComboRef.current = normaliseCombo(combo);
          }
          return;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!heldComboRef.current) return;
      const combo = comboFromEvent(e);
      // keyup combo may drop modifiers; match on just the bare key too
      const bareKey = e.key.toLowerCase();
      const held    = heldComboRef.current;
      if (normaliseCombo(combo) === held || held.endsWith(bareKey)) {
        heldComboRef.current = null;
        holdHandlerRef.current?.onRelease();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
    };
  }, [dispatch]);
}
