/**
 * RecipeOffer — the small "Set this up?" card beside a node just added (docs/starter-recipes.md):
 * its starter recipes as one-click rows, "Just the node", and "Don't ask for this node again".
 *
 * It never blocks: no scrim, no focus taken, so typing and dragging carry on. Esc, a click
 * anywhere else, or adding another node closes it and adds nothing. It follows the node as the
 * view pans and zooms, beside the card (right, else left), kept on screen. Looks like the
 * Agents group's "Add an Agents group" question (DialogHost's ChoiceDialog), at popover size.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { portalGuard } from '../ui/portalGuard';
import { closeRecipeOffer, useRecipeOffer } from '../../store/recipeOfferStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { LIGHT_SCENE_TYPES, recipesFor } from '../../nodes/recipes';
import { getNodeDefinition } from '../../nodes/definitions';
import { getCardSize } from './socketRegistry';
import type { GraphNode } from '../../types/nodeGraph';

const WIDTH = 320;
const GAP = 14;
const MARGIN = 8;
/** Presses this soon after the offer opens don't close it (the second click of a double-click add). */
const GRACE_MS = 400;

export function RecipeOffer({ nodes, canvasRef, pan, zoom }: {
  nodes: GraphNode[];
  canvasRef: RefObject<HTMLDivElement | null>;
  pan: { x: number; y: number };
  zoom: number;
}) {
  const offer = useRecipeOffer(s => s.offer);
  const inGroup = useNodeGraphStore(s => s.activeGroupPath.length > 0);
  const node = offer ? nodes.find(n => n.id === offer.nodeId) : undefined;
  // The node went (undo, delete, another graph) or the view went into a group: nothing to set up.
  useEffect(() => { if (offer && (!node || inGroup)) closeRecipeOffer(); }, [offer, node, inGroup]);
  if (!offer || !node || inGroup) return null;
  return <OfferCard key={offer.nodeId} node={node} openedAt={offer.openedAt} canvasRef={canvasRef} pan={pan} zoom={zoom} />;
}

function OfferCard({ node, openedAt, canvasRef, pan, zoom }: {
  node: GraphNode;
  openedAt: number;
  canvasRef: RefObject<HTMLDivElement | null>;
  pan: { x: number; y: number };
  zoom: number;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const [dontAsk, setDontAsk] = useState(false);
  const dontAskRef = useRef(dontAsk);
  useEffect(() => { dontAskRef.current = dontAsk; }, [dontAsk]);
  const recipes = recipesFor(node.type);
  const label = (typeof node.params.label === 'string' && node.params.label) || getNodeDefinition(node.type)?.label || node.type;
  const lighting = LIGHT_SCENE_TYPES.has(node.type);
  const title = lighting ? 'Light the scene' : `Set up ${label}?`;
  const sub = lighting ? 'Pick a look: shadows, AO, lights and tone map are added and wired. Picking again replaces it.' : 'One click adds and wires a few nodes, each with a note.';

  // Beside the card: right of it, else left, level with its top; always on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    const view = canvasRef.current?.getBoundingClientRect();
    if (!el || !view) return;
    const size = getCardSize(node.id) ?? { w: 360, h: 200 };
    const r = el.getBoundingClientRect();
    const cardLeft = view.left + pan.x + node.position.x * zoom;
    const cardRight = cardLeft + size.w * zoom;
    const cardTop = view.top + pan.y + node.position.y * zoom;
    let left = cardRight + GAP;
    if (left + r.width > window.innerWidth - MARGIN && cardLeft - GAP - r.width >= MARGIN) left = cardLeft - GAP - r.width;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - r.width - MARGIN));
    const top = Math.max(MARGIN, Math.min(cardTop, window.innerHeight - r.height - MARGIN));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });

  // Esc or a press anywhere else: just the node.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRecipeOffer(dontAskRef.current); };
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (performance.now() - openedAt < GRACE_MS) return;
      closeRecipeOffer(dontAskRef.current);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [openedAt]);

  const pick = (id: string) => {
    if (dontAsk) closeRecipeOffer(true);
    useNodeGraphStore.getState().applyStarterRecipe(node.id, id);
  };

  return createPortal(
    <div
      {...portalGuard}
      ref={ref}
      role="dialog"
      aria-label={title}
      data-recipe-offer={node.type}
      style={{
        position: 'fixed', left: -9999, top: 0, zIndex: 900, width: WIDTH, maxWidth: `calc(100vw - ${MARGIN * 2}px)`, boxSizing: 'border-box',
        background: tk.bg.panel, color: tk.text.primary, border: `1px solid ${tk.border.default}`, borderRadius: radius.lg,
        boxShadow: tk.shadow.popover, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 6px 8px 12px' }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}>
          <Icon name={lighting ? 'sun' : 'spark'} size={14} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
          <b style={{ fontSize: 13, fontWeight: 650, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</b>
          <span style={{ fontSize: 11.5, color: tk.text.muted }}>{sub}</span>
        </span>
        <IconButton icon="close" size="sm" label="Just the node" shortcut="esc" onClick={() => closeRecipeOffer(dontAsk)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px 8px' }}>
        {recipes.map(r => <RecipeRow key={r.id} label={r.label} description={r.description} onClick={() => pick(r.id)} />)}
        {lighting && node.type === 'marchLoopGroup' && (
          <RecipeRow label="Global illumination (GI Lit)" description="Turns the loop into a GI Lit March Group, which lights the scene itself: soft shadows, AO, sky light, one bounce and reflections. Slower; settings and wires kept."
            onClick={() => { if (dontAsk) closeRecipeOffer(true); useNodeGraphStore.getState().convertMarchLoop(node.id, 'giLitMarchGroup'); }} />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px 7px 12px', borderTop: `1px solid ${tk.border.subtle}` }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: tk.text.muted, cursor: 'pointer', marginRight: 'auto', minWidth: 0 }}>
          <input type="checkbox" checked={dontAsk} onChange={e => setDontAsk(e.target.checked)} style={{ margin: 0, accentColor: tk.accent.base }} />
          {lighting ? "Don't offer when I add one" : "Don't ask for this node again"}
        </label>
        <Button size="sm" variant="ghost" onClick={() => closeRecipeOffer(dontAsk)}>{lighting ? 'Not now' : 'Just the node'}</Button>
      </div>
    </div>,
    document.body,
  );
}

function RecipeRow({ label, description, onClick }: { label: string; description: string; onClick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, width: '100%', boxSizing: 'border-box',
        padding: '7px 10px', textAlign: 'left', cursor: 'pointer', borderRadius: radius.control,
        border: `1px solid ${hover ? tk.border.strong : tk.border.default}`, background: hover ? tk.bg.hover : tk.bg.panel,
        font: `12.5px ${fontFamily.ui}`, transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      <span style={{ fontWeight: 600, color: tk.text.primary }}>{label}</span>
      <span style={{ fontSize: 11.5, lineHeight: 1.4, color: tk.text.muted }}>{description}</span>
    </button>
  );
}
