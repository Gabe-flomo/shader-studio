import { useState, useEffect, useRef, useCallback } from 'react';
import { useFunctionBuilder } from './useFunctionBuilder';
import { buildShader } from './glslCompiler';
import { FunctionList } from './FunctionList';
import { PreviewCanvas } from './PreviewCanvas';
import { Toolbar } from './Toolbar';

const DEBOUNCE_MS = 150;

export function FunctionBuilder() {
  const { functions, activeId, xRange, yRange } = useFunctionBuilder();
  const [shaderSource, setShaderSource] = useState('');
  const [glslErrors, setGlslErrors]     = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rebuild shader on any function change (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const { source } = buildShader(functions, activeId, xRange, yRange);
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

  const hasErrors = glslErrors.length > 0;

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
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <PreviewCanvas
            shaderSource={shaderSource}
            xRange={xRange}
            yRange={yRange}
            onError={handlePreviewError}
          />

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
      <Toolbar hasErrors={hasErrors} />
    </div>
  );
}
