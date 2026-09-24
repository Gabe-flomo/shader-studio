import React, { useRef, useEffect, useCallback } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { ctp } from '../../theme/palette';
import { getView, subscribeView, type Pt } from './socketRegistry';

const NODE_W = 240;
const NODE_H = 120;
const PAD    = 200;
const MAP_W  = 180;
const MAP_H  = 120;

interface MinimapProps {
  nodes: GraphNode[];
  viewportWidth: number;
  viewportHeight: number;
  onPanTo: (worldX: number, worldY: number) => void;
}

/** World-rect → minimap mapping shared by the draw and the click handler. */
function mapping(nodes: GraphNode[]) {
  const minX = Math.min(...nodes.map(n => n.position.x)) - PAD;
  const minY = Math.min(...nodes.map(n => n.position.y)) - PAD;
  const maxX = Math.max(...nodes.map(n => n.position.x + NODE_W)) + PAD;
  const maxY = Math.max(...nodes.map(n => n.position.y + NODE_H)) + PAD;
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  const scale  = Math.min(MAP_W / worldW, MAP_H / worldH);
  const offsetX = (MAP_W - worldW * scale) / 2;
  const offsetY = (MAP_H - worldH * scale) / 2;
  return { minX, minY, scale, offsetX, offsetY };
}

/**
 * Minimap: node rects plus the viewport. The viewport follows pan/zoom
 * through the layout registry's view publisher — imperatively, one rAF at a
 * time — rather than through props, so a pan gesture doesn't re-render this
 * component (or its parent) on every mousemove.
 */
export const Minimap = React.memo(function Minimap({ nodes, viewportWidth, viewportHeight, onPanTo }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback((view: { pan: Pt; zoom: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, MAP_W, MAP_H);
    if (nodes.length === 0) return;
    const { minX, minY, scale, offsetX, offsetY } = mapping(nodes);
    const toMapX = (wx: number) => (wx - minX) * scale + offsetX;
    const toMapY = (wy: number) => (wy - minY) * scale + offsetY;

    // Draw node rects
    ctx.fillStyle = ctp.surface2;
    for (const node of nodes) {
      ctx.fillRect(toMapX(node.position.x), toMapY(node.position.y), Math.max(2, NODE_W * scale), Math.max(2, NODE_H * scale));
    }

    // Draw viewport rect — invert the pan/zoom to get world-space viewport
    const { pan, zoom } = view;
    const vx = toMapX(-pan.x / zoom);
    const vy = toMapY(-pan.y / zoom);
    const vw = (viewportWidth  / zoom) * scale;
    const vh = (viewportHeight / zoom) * scale;

    ctx.strokeStyle = ctp.mauve;
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw, vh);
    // Subtle tint inside viewport
    ctx.fillStyle = 'rgba(203, 166, 247, 0.08)';
    ctx.fillRect(vx, vy, vw, vh);
  }, [nodes, viewportWidth, viewportHeight]);

  // Redraw when nodes / viewport size change, and follow the live view.
  useEffect(() => { draw(getView()); }, [draw]);
  useEffect(() => {
    let raf: number | null = null;
    const unsub = subscribeView(v => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => { raf = null; draw(v); });
    });
    return () => { unsub(); if (raf !== null) cancelAnimationFrame(raf); };
  }, [draw]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { minX, minY, scale, offsetX, offsetY } = mapping(nodes);
    // Invert the mapping to get the clicked world position
    onPanTo((mx - offsetX) / scale + minX, (my - offsetY) / scale + minY);
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        zIndex: 10,
        background: 'rgba(17,17,27,0.85)',
        border: `1px solid ${ctp.surface1}`,
        borderRadius: '6px',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
      }}
    >
      <canvas
        ref={canvasRef}
        width={MAP_W}
        height={MAP_H}
        onClick={handleClick}
        style={{ display: 'block', cursor: 'crosshair' }}
      />
    </div>
  );
});
