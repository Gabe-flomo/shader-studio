import { useRef, useEffect } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { alpha, radius } from '../../theme/tokens';

const NODE_W = 360;
const NODE_H = 160;
const PAD    = 200;
const MAP_W  = 180;
const MAP_H  = 120;

interface MinimapProps {
  nodes: GraphNode[];
  pan: { x: number; y: number };
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
  onPanTo: (worldX: number, worldY: number) => void;
}

export function Minimap({ nodes, pan, zoom, viewportWidth, viewportHeight, onPanTo }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tk = useTokens();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, MAP_W, MAP_H);

    // Compute world bounding box of all nodes (padded)
    if (nodes.length === 0) return;
    const minX = Math.min(...nodes.map(n => n.position.x)) - PAD;
    const minY = Math.min(...nodes.map(n => n.position.y)) - PAD;
    const maxX = Math.max(...nodes.map(n => n.position.x + NODE_W)) + PAD;
    const maxY = Math.max(...nodes.map(n => n.position.y + NODE_H)) + PAD;
    const worldW = maxX - minX;
    const worldH = maxY - minY;

    // Scale to fit minimap preserving aspect ratio
    const scaleX = MAP_W / worldW;
    const scaleY = MAP_H / worldH;
    const scale  = Math.min(scaleX, scaleY);
    // Center the world rect in the minimap
    const offsetX = (MAP_W - worldW * scale) / 2;
    const offsetY = (MAP_H - worldH * scale) / 2;

    const toMapX = (wx: number) => (wx - minX) * scale + offsetX;
    const toMapY = (wy: number) => (wy - minY) * scale + offsetY;

    // Draw node rects
    ctx.fillStyle = tk.border.strong;
    for (const node of nodes) {
      const x = toMapX(node.position.x);
      const y = toMapY(node.position.y);
      const w = Math.max(2, NODE_W * scale);
      const h = Math.max(2, NODE_H * scale);
      ctx.fillRect(x, y, w, h);
    }

    // Draw viewport rect — invert the pan/zoom to get world-space viewport
    const vpWorldX = -pan.x / zoom;
    const vpWorldY = -pan.y / zoom;
    const vpWorldW = viewportWidth  / zoom;
    const vpWorldH = viewportHeight / zoom;

    const vx = toMapX(vpWorldX);
    const vy = toMapY(vpWorldY);
    const vw = vpWorldW * scale;
    const vh = vpWorldH * scale;

    ctx.strokeStyle = tk.accent.base;
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw, vh);
    // Subtle tint inside viewport
    ctx.fillStyle = alpha(tk.accent.base, 0.08);
    ctx.fillRect(vx, vy, vw, vh);
  }, [nodes, pan, zoom, viewportWidth, viewportHeight, tk]);

  const panToPointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    // Recompute the same mapping as in the draw effect
    const minX = Math.min(...nodes.map(n => n.position.x)) - PAD;
    const minY = Math.min(...nodes.map(n => n.position.y)) - PAD;
    const maxX = Math.max(...nodes.map(n => n.position.x + NODE_W)) + PAD;
    const maxY = Math.max(...nodes.map(n => n.position.y + NODE_H)) + PAD;
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    const scale  = Math.min(MAP_W / worldW, MAP_H / worldH);
    const offsetX = (MAP_W - worldW * scale) / 2;
    const offsetY = (MAP_H - worldH * scale) / 2;

    const worldX = (mx - offsetX) / scale + minX;
    const worldY = (my - offsetY) / scale + minY;
    onPanTo(worldX, worldY);
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        zIndex: 10,
        background: tk.bg.panel,
        borderRadius: radius.lg - 2,
        overflow: 'hidden',
        boxShadow: tk.shadow.float,
      }}
    >
      <canvas
        ref={canvasRef}
        width={MAP_W}
        height={MAP_H}
        // Press and drag to scrub the view. The press must not reach the graph canvas underneath,
        // which would start a box-selection instead.
        onMouseDown={e => e.stopPropagation()}
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          panToPointer(e.clientX, e.clientY);
        }}
        onPointerMove={e => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) panToPointer(e.clientX, e.clientY);
        }}
        style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
      />
    </div>
  );
}
