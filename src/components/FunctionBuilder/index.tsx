import { useState, useEffect, useRef, useCallback } from 'react';
import { useFunctionBuilder } from './useFunctionBuilder';
import { buildShader } from './glslCompiler';
import { FunctionList } from './FunctionList';
import { PreviewCanvas } from './PreviewCanvas';
import { Toolbar } from './Toolbar';

const DEBOUNCE_MS = 150;

// ── Axis label overlay ────────────────────────────────────────────────────────

function niceInterval(span: number): number {
  // Power-of-2 interval targeting ~4–8 ticks
  const raw = span / 6;
  const exp = Math.round(Math.log2(raw));
  return Math.pow(2, exp);
}

function formatTick(v: number): string {
  if (v === 0) return '0';
  if (Number.isInteger(v)) return String(v);
  // Show up to 3 sig figs, strip trailing zeros
  return parseFloat(v.toPrecision(3)).toString();
}

function AxisLabels({ xRange, yRange }: { xRange: [number, number]; yRange: [number, number] }) {
  const divRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const xSpan = xRange[1] - xRange[0];
  const ySpan = yRange[1] - yRange[0];
  const xStep = niceInterval(xSpan);
  const yStep = niceInterval(ySpan);

  const xTicks: { v: number; px: number }[] = [];
  const xStart = Math.ceil(xRange[0] / xStep) * xStep;
  for (let v = xStart; v <= xRange[1] + xStep * 0.001; v += xStep) {
    const px = ((v - xRange[0]) / xSpan) * w;
    xTicks.push({ v: parseFloat(v.toPrecision(10)), px });
  }

  const yTicks: { v: number; py: number }[] = [];
  const yStart = Math.ceil(yRange[0] / yStep) * yStep;
  for (let v = yStart; v <= yRange[1] + yStep * 0.001; v += yStep) {
    const py = (1 - (v - yRange[0]) / ySpan) * h;
    yTicks.push({ v: parseFloat(v.toPrecision(10)), py });
  }

  const labelColor = 'rgba(205,214,244,0.32)';
  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    fontSize: '9px',
    color: labelColor,
    fontFamily: 'monospace',
    userSelect: 'none',
    pointerEvents: 'none',
    lineHeight: 1,
  };

  return (
    <div ref={divRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {xTicks.map(({ v, px }) => (
        <div key={v} style={{ ...labelStyle, left: px, bottom: 6, transform: 'translateX(-50%)' }}>
          {formatTick(v)}
        </div>
      ))}
      {yTicks.map(({ v, py }) => (
        <div key={v} style={{ ...labelStyle, left: 6, top: py, transform: 'translateY(-50%)' }}>
          {formatTick(v)}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onNavigateToStudio?: () => void;
}

export function FunctionBuilder({ onNavigateToStudio }: Props) {
  const { functions, activeId, xRange, yRange, savedFunctionDefs } = useFunctionBuilder();
  const [shaderSource, setShaderSource] = useState('');
  const [glslErrors, setGlslErrors]     = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rebuild shader on any function change (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const { source } = buildShader(functions, activeId, xRange, yRange, savedFunctionDefs);
      setShaderSource(source);
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [functions, activeId, xRange, yRange]);

  const handlePreviewError = useCallback((errors: string[]) => {
    setGlslErrors(prev => {
      if (prev.length === 0 && errors.length === 0) return prev;
      if (prev.length === errors.length && prev.every((e, i) => e === errors[i])) return prev;
      return errors;
    });
  }, []);

  // ── Zoom via wheel (non-passive to prevent browser default zoom) ─────────────
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / rect.width;
      const cy = 1 - (e.clientY - rect.top) / rect.height;
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      const { xRange: xr, yRange: yr } = useFunctionBuilder.getState();
      const xC = xr[0] + cx * (xr[1] - xr[0]);
      const yC = yr[0] + cy * (yr[1] - yr[0]);
      useFunctionBuilder.getState().setXRange([xC + (xr[0] - xC) * factor, xC + (xr[1] - xC) * factor]);
      useFunctionBuilder.getState().setYRange([yC + (yr[0] - yC) * factor, yC + (yr[1] - yC) * factor]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Mouse pan ───────────────────────────────────────────────────────────────
  const isDragging = useRef(false);
  const dragAnchor = useRef<{ mx: number; my: number; xRange: [number,number]; yRange: [number,number] } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    const { xRange: xr, yRange: yr } = useFunctionBuilder.getState();
    dragAnchor.current = { mx: e.clientX, my: e.clientY, xRange: [...xr] as [number,number], yRange: [...yr] as [number,number] };
    (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || !dragAnchor.current) return;
    const rect = canvasWrapRef.current!.getBoundingClientRect();
    const { mx, my, xRange: xr0, yRange: yr0 } = dragAnchor.current;
    const panX = -((e.clientX - mx) / rect.width)  * (xr0[1] - xr0[0]);
    const panY =  ((e.clientY - my) / rect.height) * (yr0[1] - yr0[0]);
    useFunctionBuilder.getState().setXRange([xr0[0] + panX, xr0[1] + panX]);
    useFunctionBuilder.getState().setYRange([yr0[0] + panY, yr0[1] + panY]);
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    isDragging.current = false;
    dragAnchor.current = null;
    (e.currentTarget as HTMLElement).style.cursor = 'default';
  }, []);

  const handleDoubleClick = useCallback(() => {
    useFunctionBuilder.getState().setXRange([-2, 2]);
    useFunctionBuilder.getState().setYRange([-2, 2]);
  }, []);

  // ── Pinch-to-zoom + 1-finger pan ────────────────────────────────────────────
  const pinchDist    = useRef<number | null>(null);
  const pinchCenter  = useRef<{ x: number; y: number } | null>(null);
  const panTouch     = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      panTouch.current = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDist.current = Math.sqrt(dx * dx + dy * dy);
      pinchCenter.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    } else if (e.touches.length === 1) {
      pinchDist.current = null;
      panTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const rect = canvasWrapRef.current!.getBoundingClientRect();

    if (e.touches.length === 2 && pinchDist.current !== null && pinchCenter.current) {
      // Pinch zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const factor = pinchDist.current / dist;
      pinchDist.current = dist;
      const c = pinchCenter.current;
      const cx = (c.x - rect.left) / rect.width;
      const cy = 1 - (c.y - rect.top) / rect.height;
      const { xRange: xr, yRange: yr } = useFunctionBuilder.getState();
      const xC = xr[0] + cx * (xr[1] - xr[0]);
      const yC = yr[0] + cy * (yr[1] - yr[0]);
      useFunctionBuilder.getState().setXRange([xC + (xr[0] - xC) * factor, xC + (xr[1] - xC) * factor]);
      useFunctionBuilder.getState().setYRange([yC + (yr[0] - yC) * factor, yC + (yr[1] - yC) * factor]);
    } else if (e.touches.length === 1 && panTouch.current) {
      // Single-finger pan
      const tx = e.touches[0].clientX;
      const ty = e.touches[0].clientY;
      const { xRange: xr, yRange: yr } = useFunctionBuilder.getState();
      const panX = -((tx - panTouch.current.x) / rect.width)  * (xr[1] - xr[0]);
      const panY =  ((ty - panTouch.current.y) / rect.height) * (yr[1] - yr[0]);
      panTouch.current = { x: tx, y: ty };
      useFunctionBuilder.getState().setXRange([xr[0] + panX, xr[1] + panX]);
      useFunctionBuilder.getState().setYRange([yr[0] + panY, yr[1] + panY]);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    pinchDist.current   = null;
    pinchCenter.current = null;
    panTouch.current    = null;
  }, []);

  const hasErrors = glslErrors.length > 0;
  const activeFn = functions.find(f => f.id === activeId) ?? functions[0];
  const isFloat = activeFn?.returnType === 'float';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#11111b',
      color: '#cdd6f4',
      fontFamily: 'system-ui, sans-serif',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        height: '36px',
        flexShrink: 0,
        background: '#1e1e2e',
        borderBottom: '1px solid #313244',
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        gap: '10px',
      }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Function Builder
        </span>
        <span style={{ fontSize: '10px', color: '#45475a' }}>
          — write named GLSL functions and see them plotted live
        </span>
      </div>

      {/* Main body: left panel + right canvas */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Left: function list */}
        <div style={{
          width: '340px',
          minWidth: '240px',
          maxWidth: '480px',
          flexShrink: 0,
          borderRight: '1px solid #313244',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Vars hint */}
          <div style={{
            padding: '6px 10px',
            borderBottom: '1px solid #1e1e2e',
            fontSize: '10px',
            color: '#45475a',
            fontFamily: 'monospace',
            flexShrink: 0,
          }}>
            float: <span style={{ color: '#6c7086' }}>x, t</span>
            {'  '}vec3: <span style={{ color: '#6c7086' }}>uv, t</span>
          </div>

          <FunctionList glslErrors={glslErrors} />
        </div>

        {/* Right: preview canvas */}
        <div
          ref={canvasWrapRef}
          style={{ flex: 1, position: 'relative', minWidth: 0, cursor: 'default' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <PreviewCanvas
            shaderSource={shaderSource}
            xRange={xRange}
            yRange={yRange}
            onError={handlePreviewError}
          />

          {/* Axis labels — only in float (2D plot) mode */}
          {isFloat && <AxisLabels xRange={xRange} yRange={yRange} />}

          {/* Error overlay */}
          {hasErrors && (
            <div style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              background: 'rgba(30, 5, 5, 0.92)',
              borderTop: '1px solid #5a1a1a',
              padding: '6px 10px',
              maxHeight: '120px',
              overflowY: 'auto',
            }}>
              {glslErrors.slice(0, 6).map((e, i) => (
                <div key={i} style={{ fontSize: '10px', color: '#f38ba8', fontFamily: 'monospace', lineHeight: 1.6 }}>
                  {e}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom toolbar */}
      <Toolbar hasErrors={hasErrors} onNavigateToStudio={onNavigateToStudio} />
    </div>
  );
}
