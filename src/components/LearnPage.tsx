import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

interface LearnPageProps {
  onNavigateToStudio: () => void;
}

// ─── Theme ───────────────────────────────────────────────────────────────────
const T = {
  bg:        '#11111b',
  surface:   '#181825',
  surface2:  '#1e1e2e',
  border:    '#313244',
  border2:   '#45475a',
  text:      '#bac2de',
  textBold:  '#cdd6f4',
  dim:       '#585b70',
  dim2:      '#45475a',
  blue:      '#89b4fa',
  green:     '#a6e3a1',
  red:       '#f38ba8',
  yellow:    '#f9e2af',
  mauve:     '#cba6f7',
  peach:     '#fab387',
} as const;

// ─── Shared style helpers ────────────────────────────────────────────────────
const S = {
  page: {
    display: 'flex',
    width: '100%',
    height: '100%',
    background: T.bg,
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } as React.CSSProperties,

  sidebar: {
    width: '196px',
    flexShrink: 0,
    background: T.surface,
    borderRight: `1px solid ${T.border}`,
    padding: '16px 0',
    overflowY: 'auto' as const,
    height: '100%',
  } as React.CSSProperties,

  content: {
    flex: 1,
    minWidth: 0,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
    padding: '32px 52px',
    maxWidth: '900px',
    userSelect: 'text' as const,
    WebkitUserSelect: 'text' as const,
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: '19px',
    fontWeight: 700,
    color: T.textBold,
    marginBottom: '4px',
    marginTop: '52px',
    letterSpacing: '-0.01em',
  } as React.CSSProperties,

  divider: {
    height: '1px',
    background: T.border,
    marginBottom: '24px',
    marginTop: '8px',
  } as React.CSSProperties,

  subTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: T.blue,
    marginBottom: '8px',
    marginTop: '28px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  } as React.CSSProperties,

  p: {
    fontSize: '13px',
    color: T.text,
    lineHeight: 1.75,
    marginBottom: '10px',
  } as React.CSSProperties,

  ul: { paddingLeft: '20px', marginBottom: '10px' } as React.CSSProperties,
  li: { fontSize: '13px', color: T.text, lineHeight: 1.7, marginBottom: '3px' } as React.CSSProperties,

  code: {
    display: 'block' as const,
    background: T.surface2,
    border: `1px solid ${T.border}`,
    borderRadius: '6px',
    padding: '12px 16px',
    fontFamily: 'monospace',
    fontSize: '12px',
    color: T.green,
    marginBottom: '14px',
    whiteSpace: 'pre' as const,
    overflowX: 'auto' as const,
    lineHeight: 1.6,
    maxWidth: '100%',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,

  codeWrapper: {
    position: 'relative' as const,
    marginBottom: '14px',
  } as React.CSSProperties,

  copyBtn: {
    position: 'absolute' as const,
    top: '6px',
    right: '8px',
    background: 'rgba(49,50,68,0.85)',
    border: `1px solid ${T.border2}`,
    borderRadius: '4px',
    color: T.dim,
    fontSize: '10px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    letterSpacing: '0.03em',
    lineHeight: 1.6,
    transition: 'color 0.15s, border-color 0.15s',
  } as React.CSSProperties,

  inlineCode: {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: T.green,
    background: T.surface2,
    borderRadius: '3px',
    padding: '1px 5px',
  } as React.CSSProperties,

  tip: {
    background: T.surface2,
    borderLeft: `3px solid ${T.blue}`,
    borderRadius: '0 6px 6px 0',
    padding: '10px 14px',
    marginBottom: '14px',
    fontSize: '12px',
    color: T.text,
    lineHeight: 1.6,
  } as React.CSSProperties,

  warn: {
    background: T.surface2,
    borderLeft: `3px solid ${T.yellow}`,
    borderRadius: '0 6px 6px 0',
    padding: '10px 14px',
    marginBottom: '14px',
    fontSize: '12px',
    color: T.text,
    lineHeight: 1.6,
  } as React.CSSProperties,

  tryBtn: {
    background: T.surface,
    border: `1px solid ${T.border2}`,
    color: T.green,
    borderRadius: '6px',
    padding: '6px 16px',
    fontSize: '11px',
    cursor: 'pointer',
    letterSpacing: '0.03em',
    marginTop: '12px',
    marginBottom: '6px',
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: '6px',
    fontFamily: 'system-ui, sans-serif',
  } as React.CSSProperties,

  tocSection: {
    display: 'block' as const,
    padding: '8px 16px 3px',
    fontSize: '10px',
    color: T.dim2,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    fontWeight: 600,
  } as React.CSSProperties,

  tocItem: {
    display: 'block' as const,
    padding: '4px 16px',
    fontSize: '11px',
    cursor: 'pointer',
    color: T.dim,
    borderLeft: '2px solid transparent',
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    width: '100%',
    textAlign: 'left' as const,
    letterSpacing: '0.02em',
    lineHeight: 1.6,
  } as React.CSSProperties,
};

// ─── Micro components ─────────────────────────────────────────────────────────

function C({ children }: { children: React.ReactNode }) {
  return <code style={S.inlineCode}>{children}</code>;
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);
  return (
    <div style={S.codeWrapper}>
      <pre style={{ ...S.code, marginBottom: 0 }}>{children}</pre>
      <button
        style={{
          ...S.copyBtn,
          color: copied ? T.green : T.dim,
          borderColor: copied ? T.green : T.border2,
        }}
        onClick={handleCopy}
        title="Copy code"
      >
        {copied ? '✓ copied' : 'copy'}
      </button>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return <div style={S.tip}>💡 {children}</div>;
}

function Warn({ children }: { children: React.ReactNode }) {
  return <div style={S.warn}>⚠ {children}</div>;
}

function TryIt({ exampleKey, label, onTry }: { exampleKey: string; label: string; onTry: (k: string) => void }) {
  return (
    <button
      style={S.tryBtn}
      onClick={() => onTry(exampleKey)}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = T.border; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = T.surface; }}
    >
      ▶ Open in Studio: {label}
    </button>
  );
}

function TocLink({ label, targetRef }: { label: string; targetRef: React.RefObject<HTMLElement | null> }) {
  return (
    <button
      style={S.tocItem}
      onClick={() => targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.color = T.textBold;
        (e.currentTarget as HTMLButtonElement).style.borderLeftColor = T.dim;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.color = T.dim;
        (e.currentTarget as HTMLButtonElement).style.borderLeftColor = 'transparent';
      }}
    >
      {label}
    </button>
  );
}

// ─── Node Graph Diagram ───────────────────────────────────────────────────────
// Renders a left-to-right visual diagram of a node pipeline

type DiagramNode = {
  label: string;
  type?: 'source' | 'transform' | 'effect' | 'color' | 'output';
  outputs?: string[];
  inputs?: string[];
};

type DiagramArrow = {
  from: number; // node index
  to: number;
  label?: string;
};

interface NodeDiagramProps {
  nodes: DiagramNode[];
  arrows?: DiagramArrow[];
  caption?: string;
}

function typeColor(type: DiagramNode['type']): string {
  switch (type) {
    case 'source':    return T.green;
    case 'transform': return T.blue;
    case 'effect':    return T.mauve;
    case 'color':     return T.peach;
    case 'output':    return T.red;
    default:          return T.border2;
  }
}

function NodeDiagram({ nodes, arrows, caption }: NodeDiagramProps) {
  // Simple horizontal layout — each node is a box, connected by arrows
  return (
    <div style={{ marginBottom: '16px', marginTop: '8px', maxWidth: '100%' }}>
      <div
        style={{
          background: T.surface2,
          border: `1px solid ${T.border}`,
          borderRadius: '8px',
          padding: '16px 20px',
          overflowX: 'auto',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'nowrap', minWidth: 'max-content' }}>
          {nodes.map((node, i) => {
            const color = typeColor(node.type);
            const isLast = i === nodes.length - 1;
            // Check if this node has an explicit arrow to next, or auto-chain
            const hasArrow = !isLast;
            const arrow = arrows?.find(a => a.from === i);

            return (
              <React.Fragment key={i}>
                {/* Node box */}
                <div
                  style={{
                    background: T.surface,
                    border: `1px solid ${color}44`,
                    borderTop: `2px solid ${color}`,
                    borderRadius: '6px',
                    padding: '8px 12px',
                    minWidth: '90px',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 600, color: color, marginBottom: node.inputs || node.outputs ? '6px' : '0', fontFamily: 'monospace' }}>
                    {node.label}
                  </div>
                  {node.inputs && node.inputs.length > 0 && (
                    <div style={{ marginBottom: '4px' }}>
                      {node.inputs.map((inp, j) => (
                        <div key={j} style={{ fontSize: '10px', color: T.dim, lineHeight: 1.4 }}>
                          <span style={{ color: T.dim2 }}>↳ </span>{inp}
                        </div>
                      ))}
                    </div>
                  )}
                  {node.outputs && node.outputs.length > 0 && (
                    <div>
                      {node.outputs.map((out, j) => (
                        <div key={j} style={{ fontSize: '10px', color: T.dim, lineHeight: 1.4 }}>
                          <span style={{ color: color + '99' }}>◆ </span>{out}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Arrow between nodes */}
                {hasArrow && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, color: T.dim2 }}>
                    <div style={{ fontSize: '10px', color: T.dim2, marginBottom: '2px', whiteSpace: 'nowrap' }}>
                      {arrow?.label ?? ''}
                    </div>
                    <div style={{ fontSize: '16px', lineHeight: 1 }}>→</div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      {caption && (
        <div style={{ fontSize: '11px', color: T.dim, marginTop: '5px', paddingLeft: '4px', fontStyle: 'italic' }}>
          {caption}
        </div>
      )}
    </div>
  );
}

// ─── Step-by-step builder diagram ────────────────────────────────────────────
// Shows how a graph builds up step by step with +1 node each step

interface BuildStep {
  title: string;
  description: React.ReactNode;
  nodes: DiagramNode[];
}

function StepBuilder({ steps }: { steps: BuildStep[] }) {
  return (
    <div style={{ marginBottom: '20px', maxWidth: '100%' }}>
      {steps.map((step, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '12px',
            alignItems: 'flex-start',
            minWidth: 0,
          }}
        >
          {/* Step number */}
          <div
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: T.blue + '33',
              border: `1px solid ${T.blue}66`,
              color: T.blue,
              fontSize: '11px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: '2px',
            }}
          >
            {i + 1}
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: T.textBold, marginBottom: '4px' }}>
              {step.title}
            </div>
            <div style={{ fontSize: '12px', color: T.text, lineHeight: 1.6, marginBottom: '6px' }}>
              {step.description}
            </div>
            <NodeDiagram nodes={step.nodes} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Type badge ───────────────────────────────────────────────────────────────
function TypeBadge({ type, label }: { type: string; label?: string }) {
  const color = type === 'float' ? T.yellow : type === 'vec2' ? T.blue : type === 'vec3' ? T.peach : T.green;
  return (
    <span style={{
      fontFamily: 'monospace',
      fontSize: '11px',
      color,
      background: color + '22',
      border: `1px solid ${color}44`,
      borderRadius: '4px',
      padding: '1px 6px',
      marginRight: '3px',
    }}>
      {label ?? type}
    </span>
  );
}

// ─── Data flow table ──────────────────────────────────────────────────────────
function DataTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: '14px', maxWidth: '100%' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
        <thead>
          <tr>
            {['Type', 'Means', 'Example'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([type, means, ex], i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
              <td style={{ padding: '6px 10px' }}><TypeBadge type={type} /></td>
              <td style={{ padding: '6px 10px', color: T.text }}>{means}</td>
              <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px' }}>{ex}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export function LearnPage({ onNavigateToStudio }: LearnPageProps) {
  const { loadExampleGraph } = useNodeGraphStore();
  const isMobile = useIsMobile();

  const sec0Ref = useRef<HTMLDivElement>(null);
  const sec1Ref = useRef<HTMLDivElement>(null);
  const sec2Ref = useRef<HTMLDivElement>(null);
  const sec3Ref = useRef<HTMLDivElement>(null);
  const sec4Ref = useRef<HTMLDivElement>(null);
  const sec5Ref = useRef<HTMLDivElement>(null);
  const sec6Ref = useRef<HTMLDivElement>(null);
  const sec7Ref = useRef<HTMLDivElement>(null);
  const sec8Ref = useRef<HTMLDivElement>(null);
  const sec9Ref = useRef<HTMLDivElement>(null);
  const sec10Ref = useRef<HTMLDivElement>(null);
  const sec11Ref = useRef<HTMLDivElement>(null);
  const sec12Ref = useRef<HTMLDivElement>(null);
  const sec13Ref = useRef<HTMLDivElement>(null);
  const sec14Ref = useRef<HTMLDivElement>(null);
  const sec15Ref = useRef<HTMLDivElement>(null);
  const sec16Ref = useRef<HTMLDivElement>(null);
  const sec17Ref = useRef<HTMLDivElement>(null);
  const sec3dRef = useRef<HTMLDivElement>(null);
  const secParticlesRef = useRef<HTMLDivElement>(null);
  const secBlurRef = useRef<HTMLDivElement>(null);
  const secAppRef = useRef<HTMLDivElement>(null);
  const secExprRef = useRef<HTMLDivElement>(null);
  const secFnBuilderRef = useRef<HTMLDivElement>(null);
  const secCoolRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);

  function tryExample(key: string) {
    loadExampleGraph(key);
    onNavigateToStudio();
  }

  return (
    <div style={S.page}>
      {/* ── Mobile sidebar backdrop ── */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 99,
            background: 'rgba(0,0,0,0.5)',
          }}
        />
      )}

      {/* ── Sidebar TOC ── */}
      <nav style={{
        ...S.sidebar,
        width: sidebarOpen ? '196px' : (isMobile ? '0px' : '32px'),
        transition: 'width 0.2s ease',
        overflow: 'hidden',
        position: isMobile ? 'absolute' : 'relative',
        zIndex: isMobile ? 100 : undefined,
        height: '100%',
        boxShadow: isMobile && sidebarOpen ? '4px 0 20px rgba(0,0,0,0.5)' : 'none',
      }}>
        {/* Toggle button — only shown on desktop when sidebar is open */}
        {!isMobile && (
          <button
            onClick={() => setSidebarOpen(v => !v)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            style={{
              position: sidebarOpen ? 'absolute' : 'static',
              top: sidebarOpen ? '12px' : undefined,
              right: sidebarOpen ? '8px' : undefined,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '20px',
              height: '20px',
              background: 'none',
              border: 'none',
              color: '#585b70',
              cursor: 'pointer',
              fontSize: '12px',
              borderRadius: '3px',
              flexShrink: 0,
              margin: sidebarOpen ? undefined : '8px auto',
              padding: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#cdd6f4')}
            onMouseLeave={e => (e.currentTarget.style.color = '#585b70')}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        )}

        {/* TOC content — hidden when collapsed */}
        {sidebarOpen && <>
        <span style={{ ...S.tocSection, paddingTop: isMobile ? '12px' : '2px' }}>Shader Studio</span>

        <span style={S.tocSection}>Getting Started</span>
        <TocLink label="Introduction" targetRef={sec0Ref} />
        <TocLink label="Interface" targetRef={sec1Ref} />
        <TocLink label="First Shader" targetRef={sec2Ref} />

        <span style={S.tocSection}>Core Concepts</span>
        <TocLink label="Data & Types" targetRef={sec3Ref} />
        <TocLink label="SDFs" targetRef={sec4Ref} />
        <TocLink label="Sources" targetRef={sec5Ref} />
        <TocLink label="Transforms" targetRef={sec6Ref} />
        <TocLink label="Groups" targetRef={sec7Ref} />
        <TocLink label="Noise" targetRef={sec9Ref} />
        <TocLink label="Color" targetRef={sec10Ref} />
        <TocLink label="Math" targetRef={sec11Ref} />

        <span style={S.tocSection}>Advanced</span>
        <TocLink label="Animation" targetRef={sec12Ref} />
        <TocLink label="Effects" targetRef={sec13Ref} />
        <TocLink label="Blur & Lens" targetRef={secBlurRef} />
        <TocLink label="Fractals" targetRef={sec14Ref} />
        <TocLink label="Particles & Fields" targetRef={secParticlesRef} />
        <TocLink label="3D / Raymarch" targetRef={sec15Ref} />
        <TocLink label="3D Composable" targetRef={sec3dRef} />
        <TocLink label="Import / Export" targetRef={sec16Ref} />

        <TocLink label="Expr Blocks" targetRef={secExprRef} />
        <TocLink label="Function Builder" targetRef={secFnBuilderRef} />
        <TocLink label="Cool Tricks" targetRef={secCoolRef} />

        <span style={S.tocSection}>Reference</span>
        <TocLink label="Examples" targetRef={sec17Ref} />
        <TocLink label="Node Reference" targetRef={secAppRef} />
        </>}
      </nav>

      {/* ── Scrollable content ── */}
      <main style={{ ...S.content, padding: isMobile ? '20px 16px' : '32px 52px' }}>
        {/* Header */}
        <div style={{ marginBottom: '8px' }}>
          {/* Mobile TOC toggle */}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(v => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: T.surface,
                border: `1px solid ${T.border}`,
                borderRadius: '6px',
                color: T.dim,
                fontSize: '11px',
                padding: '5px 10px',
                cursor: 'pointer',
                marginBottom: '16px',
                fontFamily: 'system-ui, sans-serif',
                letterSpacing: '0.03em',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = T.textBold)}
              onMouseLeave={e => (e.currentTarget.style.color = T.dim)}
            >
              ☰ Contents
            </button>
          )}
          <h1 style={{ fontSize: isMobile ? '18px' : '22px', fontWeight: 700, color: T.textBold, marginBottom: '6px', letterSpacing: '-0.02em' }}>
            Shader Studio Guide
          </h1>
          <p style={{ ...S.p, color: T.dim, marginBottom: 0 }}>
            A comprehensive guide to building GLSL shaders with the node graph — from first UV to animated fractals and volumetric rendering.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 0 — WHAT IS A SHADER
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec0Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>What is a Shader?</h2>
          <div style={S.divider} />

          <p style={S.p}>
            A <strong style={{ color: T.textBold }}>fragment shader</strong> is a program that runs once per pixel, simultaneously, on every core of your GPU. The GPU might have thousands of cores running in parallel — each one answering the same question for a different pixel: <em>"given my screen coordinate, what color am I?"</em>
          </p>
          <p style={S.p}>
            This is fundamentally different from CPU code. A CPU executes instructions sequentially — loop over pixels one by one. The GPU executes the same program on all pixels at the same time. There is no loop. Every pixel is independent.
          </p>
          <p style={S.p}>
            That constraint — no shared state, no communication between pixels — is also what makes shaders so fast. And it's why shader programs are built from pure math functions rather than imperative logic.
          </p>

          <h3 style={S.subTitle}>CPU vs GPU</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>CPU</strong> — few fast cores, sequential execution, general purpose. Bad at "do the same thing to a million things."</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>GPU</strong> — thousands of simple cores, massively parallel, specialized. Optimal for "run this function independently on every pixel."</li>
          </ul>
          <p style={S.p}>
            A 1920×1080 canvas has over two million pixels. A GPU renders all of them in a single frame — roughly 16ms.
          </p>

          <h3 style={S.subTitle}>Shader Studio</h3>
          <p style={S.p}>
            Shader Studio lets you build fragment shaders visually, without writing GLSL directly. You wire together nodes — each node is a math operation — and the system compiles your graph into a real GLSL program that runs on your GPU. Every change you make recompiles and rerenders in real time.
          </p>
          <Tip>You don't need to write any GLSL. But the more you understand the math underneath each node, the more interesting things you can build. This guide explains both layers.</Tip>

          <p style={S.p}>
            If you've never written a shader before, the mental shift to learn is: there's no loop. You write one function. The GPU calls it for every pixel simultaneously.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 1 — THE INTERFACE
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec1Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>The Interface</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>The Layout</h3>
          <pre style={S.code}>{`┌─────────────────────────────────────────────────────┐
│                    Top Nav Bar                      │
├──────────┬────────────────────────┬─────────────────┤
│          │                        │                 │
│  Node    │    Node Graph Canvas   │   Shader        │
│  Palette │                        │   Preview       │
│          │   (drag, connect,      │                 │
│  (click  │    build your graph)   │   (live GPU     │
│   to add │                        │    output)      │
│   nodes) │                        │                 │
│          ├────────────────────────┤                 │
│          │     Code Panel         │                 │
│          │   (generated GLSL)     │                 │
└──────────┴────────────────────────┴─────────────────┘`}</pre>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Top Nav</strong> — file operations, view toggles, recording controls</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Node Palette</strong> — categorized list of all available nodes; click to add</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Node Graph Canvas</strong> — drag nodes, draw wires between sockets, build your shader</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Shader Preview</strong> — live GPU-rendered output of your graph</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Code Panel</strong> — the generated GLSL source; toggle with <C>Cmd+\</C></li>
          </ul>

          <h3 style={S.subTitle}>Node Anatomy</h3>
          <pre style={S.code}>{`        ┌──────────────────────┐
        │   Node Title         │
        ├──────────────────────┤
  ● ──▶ │  input_a    output ──▶ ○
  ● ──▶ │  input_b             │
        ├──────────────────────┤
        │  [param: 0.50]       │
        │  [dropdown: mode]    │
        ├──────────────────────┤
        │  ┌────────────────┐  │
        │  │  inline preview│  │
        │  └────────────────┘  │
        └──────────────────────┘

  ● = input socket (left, filled)
  ○ = output socket (right, open)`}</pre>
          <p style={S.p}>
            Socket colors indicate data type: <span style={{ color: '#bac2de' }}>float = gray/white</span>, <span style={{ color: T.blue }}>vec2 = blue</span>, <span style={{ color: T.green }}>vec3 = green</span>, <span style={{ color: T.mauve }}>vec4 = purple</span>. You can only connect matching types.
          </p>

          <h3 style={S.subTitle}>Keyboard Shortcuts Quick Reference</h3>
          <div style={{ overflowX: 'auto', marginBottom: '14px', maxWidth: '100%' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Action</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Shortcut</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['Open palette', 'A'],
                ['Add UV', 'U'],
                ['Add Time', 'T'],
                ['Add Output', 'O'],
                ['Add Mix', 'M'],
                ['Add Float constant', 'Shift+F'],
                ['Add Color', 'C'],
                ['Fit view', 'F'],
                ['Toggle GLSL', 'Cmd+\\'],
                ['Undo', 'Cmd+Z'],
                ['Export graph', 'Cmd+S'],
                ['Import graph', 'Cmd+O'],
                ['Group selected', 'Cmd+G'],
                ['Wrap in loop', 'Cmd+L'],
                ['Record video', 'Cmd+R'],
                ['Show shortcuts', '?'],
              ] as [string, string][]).map(([action, shortcut], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                  <td style={{ padding: '6px 10px', color: T.text }}>{action}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px' }}>{shortcut}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Tip>Hold <C>1</C>, <C>2</C>, or <C>3</C> to highlight nodes by type — useful for finding specific nodes in a complex graph.</Tip>

          <p style={S.p}>
            A few practical things to know when you're getting oriented: if the preview canvas is blank, the most likely cause is that your Output node has nothing wired into it — check that at least one wire is connected to the Output's color input. If you see a red overlay on the canvas, that's a GLSL compile error; open the Code Panel (<C>Cmd+\</C>) and look at the bottom for the exact error line. If the graph has drifted off screen, press <C>F</C> to fit everything back into view.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 2 — YOUR FIRST SHADER
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec2Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Your First Shader</h2>
          <div style={S.divider} />

          <StepBuilder steps={[
            {
              title: 'Drop a UV node',
              description: 'Press U or right-click the canvas and search "UV". The UV node outputs the normalized screen coordinate as a vec2 — (0,0) at center, ±0.5 vertically, scaled by aspect ratio horizontally.',
              nodes: [{ label: 'UV', type: 'source', outputs: ['uv: vec2'] }],
            },
            {
              title: 'Wire UV into Output',
              description: <>Press <C>O</C> to add an Output node. Drag from the UV output dot to the Output input dot. The preview immediately shows a gradient — you're looking at raw UV coordinates mapped to color.</>,
              nodes: [
                { label: 'UV', type: 'source', outputs: ['uv: vec2'] },
                { label: 'Output', type: 'output', inputs: ['color'] },
              ],
            },
            {
              title: 'Add a Sin node',
              description: <>Add a <strong style={{ color: T.textBold }}>Sin</strong> node and wire <C>UV → Sin → Output</C>. Now add a <strong style={{ color: T.textBold }}>Time</strong> node and wire it into the Sin input alongside UV. The gradient starts animating — every pixel is computing <C>sin(uv + time)</C> in parallel.</>,
              nodes: [
                { label: 'UV', type: 'source' },
                { label: 'Time', type: 'source' },
                { label: 'Sin', type: 'transform' },
                { label: 'Output', type: 'output' },
              ],
            },
            {
              title: 'Add IQ Palette to colorize it',
              description: <>Add an <strong style={{ color: T.textBold }}>IQ Palette</strong> node. Wire the Sin output into Palette's <C>t</C> input, then Palette into Output. The cosine palette formula maps the oscillating float to a smooth color gradient. Adjust the a/b/c/d vec3 parameters to change the color scheme.</>,
              nodes: [
                { label: 'Sin', type: 'transform', outputs: ['float'] },
                { label: 'IQ Palette', type: 'color', inputs: ['t: float'], outputs: ['color: vec3'] },
                { label: 'Output', type: 'output' },
              ],
            },
          ]} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 3 — DATA TYPES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec3Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Data Types</h2>
          <div style={S.divider} />

          <p style={S.p}>Every wire in Shader Studio carries a typed value. Port colors reflect the type — you can only connect matching types. When you try to wire mismatched types, the connection will simply refuse to snap. That's not a bug — it's the type system telling you something needs converting first.</p>

          <DataTable rows={[
            ['float', 'Single number', '0.5, sin(time), length(uv)'],
            ['vec2', 'Two numbers (x, y)', 'UV coords, mouse position'],
            ['vec3', 'Three numbers (r, g, b)', 'Color, 3D position, normal'],
            ['vec4', 'Four channels (r, g, b, a)', 'Texture sample, RGBA color'],
            ['bool', 'True or false', 'step() result, comparisons'],
          ]} />

          <p style={S.p}>
            <strong style={{ color: T.textBold }}>The most common situation:</strong> you have a <C>float</C> (like noise or an SDF distance) and need a <C>vec3</C> color to wire into Output. Use <C>FloatToVec3</C> to broadcast it to all three channels, or pipe it through an <C>IQ Palette</C> node to turn it into a real color.
          </p>

          <h3 style={S.subTitle}>Swizzling</h3>
          <p style={S.p}>
            GLSL lets you re-order or repeat components of any vector using dot notation. You can use either positional (<C>.xyzw</C>) or color (<C>.rgba</C>) aliases — they refer to the same components.
          </p>
          <CodeBlock>{`vec3 color = vec3(0.8, 0.3, 0.1);

color.xy      // → vec2(0.8, 0.3)   — first two channels
color.rgb     // → vec3(0.8, 0.3, 0.1) — all three (same thing)
color.bgr     // → vec3(0.1, 0.3, 0.8) — reversed
color.xxxx    // → vec4(0.8, 0.8, 0.8, 0.8) — repeat x four times
color.zy      // → vec2(0.1, 0.3)   — z then y`}</CodeBlock>

          <p style={S.p}>The <C>Swizzle</C> node in Shader Studio does exactly this — pick which components to extract or rearrange.</p>

          <p style={S.p}>
            You'll use swizzling constantly. The most common cases: extracting <C>.xy</C> from a vec3 color to get a vec2 for UV math, broadcasting a single channel with <C>.xxx</C> to make a grayscale vec3.
          </p>

          <h3 style={S.subTitle}>Port Colors</h3>
          <ul style={S.ul}>
            <li style={S.li}><TypeBadge type="float" /> Gray/white — single scalar</li>
            <li style={S.li}><TypeBadge type="vec2" /> Blue — two-component vector</li>
            <li style={S.li}><TypeBadge type="vec3" /> Peach/orange — three-component vector (most colors)</li>
            <li style={S.li}><TypeBadge type="vec4" /> Purple — four-component vector (textures, RGBA)</li>
          </ul>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 4 — 2D SIGNED DISTANCE FIELDS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec4Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>2D Signed Distance Fields</h2>
          <div style={S.divider} />

          <p style={S.p}>
            A Signed Distance Field is a function <C>{'f(p) → float'}</C> where the return value is the signed distance from point <C>p</C> to the nearest surface: <strong style={{ color: T.textBold }}>negative inside</strong>, <strong style={{ color: T.textBold }}>zero on the edge</strong>, <strong style={{ color: T.textBold }}>positive outside</strong>.
          </p>
          <p style={S.p}>The circle SDF is the simplest example:</p>
          <CodeBlock>{`float sdCircle(vec2 p, float r) {
    return length(p) - r;
}`}</CodeBlock>

          <h3 style={S.subTitle}>Rendering the Distance Field</h3>
          <p style={S.p}>To fill a shape, threshold the distance with <C>step</C>:</p>
          <CodeBlock>{`float fill = step(0.0, -d);   // 1.0 inside, 0.0 outside`}</CodeBlock>
          <p style={S.p}>For smooth antialiased edges, use <C>smoothstep</C>:</p>
          <CodeBlock>{`float fill = smoothstep(0.01, -0.01, d);`}</CodeBlock>
          <p style={S.p}>For a glow effect — brightest at the boundary, falling off with distance:</p>
          <CodeBlock>{`float glow = 0.02 / abs(d);`}</CodeBlock>

          <h3 style={S.subTitle}>2D SDF Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>sdCircle</C>, <C>sdBox</C>, <C>sdSegment</C>, <C>sdEllipse</C>, <C>sdEquilateral</C></li>
            <li style={S.li}><C>sdPentagon</C>, <C>sdHexagon</C>, <C>sdStar</C>, <C>sdArc</C>, <C>sdCross</C></li>
            <li style={S.li}><C>sdRoundedBox</C>, <C>sdPie</C>, <C>sdVesica</C></li>
          </ul>

          <h3 style={S.subTitle}>Boolean Operations</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Union</strong> — <C>min(d1, d2)</C> — merge shapes</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Subtract</strong> — <C>max(-d1, d2)</C> — cut d1 from d2</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Intersect</strong> — <C>max(d1, d2)</C> — keep only overlap</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Smooth Union</strong> — <C>smin(d1, d2, k)</C> — blend with soft radius k</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Round</strong> — <C>d - r</C> — expand shape outward by r</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Onion</strong> — <C>abs(d) - r</C> — hollow shell of thickness r</li>
          </ul>

          <p style={S.p}>
            Think of SDF booleans like cookie cutters on clay. Union merges two shapes as if they were one piece. Subtract cuts one shape out of another. SmoothUnion is the most visually interesting — it melts shapes together with a soft blend at the boundary, controlled by the k parameter. Higher k = more melting.
          </p>

          <h3 style={S.subTitle}>Repetition</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>opRepeat</C> — infinite tiling via <C>mod</C> — use before any SDF to create a grid</li>
            <li style={S.li}><C>opRepeatPolar</C> — N-fold radial symmetry — rotates the shape around the origin N times</li>
          </ul>

          <TryIt exampleKey="circle-sdf" label="Circle SDF" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 5 — SOURCES & INPUTS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec5Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Sources & Inputs</h2>
          <div style={S.divider} />

          <ul style={S.ul}>
            <li style={S.li}><C>UV</C> <TypeBadge type="vec2" /> — normalized screen coordinate that is centered at (0,0) and aspect-corrected, so circles look round rather than elliptical. Every shader starts here — it's the position input that flows into every SDF and transform in your graph.</li>
            <li style={S.li}><C>PixelUV</C> <TypeBadge type="vec2" /> — raw screen pixel coordinate in pixels, <C>(0,0)</C> at bottom-left. Useful when you need exact pixel-level math, but most shaders use UV instead.</li>
            <li style={S.li}><C>Time</C> <TypeBadge type="float" /> — elapsed seconds that just counts up forever as the shader runs. To oscillate it back and forth, pipe it through a Sin or Cos node; to loop it on a fixed period, use Fract.</li>
            <li style={S.li}><C>Mouse</C> <TypeBadge type="vec2" /> — normalized cursor position in the exact same coordinate space as UV, so (0,0) is center of screen. Subtract <C>Mouse</C> from <C>UV</C> to get a direction vector pointing from the cursor to each pixel — feed that into an SDF to make shapes track the cursor.</li>
            <li style={S.li}><C>Constant</C> — any type, fixed value. Use for colors, scales, offsets, or any static parameter you want to tweak without wiring.</li>
            <li style={S.li}><C>PrevFrame</C> <TypeBadge type="vec4" /> — the full rendered output from the previous frame, fed back as an input. This creates a feedback loop: the output of frame N becomes an input to frame N+1, enabling trails, motion blur, paint accumulation, and cellular automata.</li>
            <li style={S.li}><C>TextureInput</C> <TypeBadge type="vec4" /> — sample from an uploaded image. Use UV as the sample coordinate to reference photos or patterns in your shader.</li>
            <li style={S.li}><C>AudioInput</C> <TypeBadge type="float" /> — microphone amplitude 0→1, updated every frame. You need to grant microphone permission the first time you use it; after that the browser remembers.</li>
          </ul>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 6 — TRANSFORMS & UV SPACE
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec6Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Transforms & UV Space</h2>
          <div style={S.divider} />

          <p style={S.p}>
            UV transforms happen <em>before</em> SDFs — you move the coordinate space, not the shape. Instead of translating the circle, you translate the entire plane and the circle naturally appears in a different position.
          </p>

          <ul style={S.ul}>
            <li style={S.li}><C>Fract</C> — tile: <C>fract(uv)</C> repeats every 1 unit — infinite grid from a single SDF</li>
            <li style={S.li}><C>Rotate2D</C> — rotate UV around the center by an angle in radians</li>
            <li style={S.li}><C>Displace</C> — noise-based UV offset — feeds an FBM or noise into position to break regularity</li>
            <li style={S.li}><C>Jitter</C> — per-tile random offset — each cell in the tiled grid shifts slightly</li>
            <li style={S.li}><C>Smooth</C> — bilinear smoothing across tile boundaries</li>
            <li style={S.li}><C>Curl</C> — divergence-free curl noise warp — creates smoke/fluid flow patterns that never compress space</li>
            <li style={S.li}><C>Swirl</C> — distance-dependent rotational warp around origin</li>
          </ul>

          <p style={S.p}>Chain example: transform UV before the SDF to stack effects:</p>
          <NodeDiagram
            nodes={[
              { label: 'UV', type: 'source' },
              { label: 'Fract', type: 'transform' },
              { label: 'Rotate2D', type: 'transform' },
              { label: 'sdCircle', type: 'effect' },
            ]}
            caption="UV → Fract (tile) → Rotate2D → sdCircle — a rotating grid of circles"
          />

          <p style={S.p}>
            The key mental shift with transforms: you never move a shape. You move the coordinate space the shape lives in. Moving UV to the right by 0.2 is the same as moving every shape to the left by 0.2. This is why transforms go before SDFs in the chain.
          </p>
          <Tip>Stack Fract + Rotate2D before an SDF for a rotating tiled grid. The Fract tiles first, then the rotation applies inside each tile.</Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 7 — GROUPS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec7Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Groups</h2>
          <div style={S.divider} />

          <Warn>Groups are not just folders — SDF Boolean Groups and Scene Groups change how outputs are computed, not just how nodes are displayed.</Warn>

          <p style={S.p}>
            Groups become important once your graph gets complex. The most commonly used are Regular Group (just tidying up) and SDF Boolean Group (when you have multiple SDFs that should behave as one shape).
          </p>

          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Regular Group</strong> — visual organization only. Select nodes, press <C>Cmd+G</C>. Collapses into a single node for cleanliness; functionally identical to having the nodes inline.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>SDF Boolean Group</strong> — computes <C>min</C>/<C>max</C> across all SDF children automatically. Use this when you have multiple SDF nodes that you want unioned/subtracted into one combined field. Required for multi-shape 2D scenes.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Scene Group (3D)</strong> — encapsulates a 3D SDF subgraph. Outputs a <C>scene3d</C> wire that feeds into a <C>RayMarch</C> or <C>RayMarchLit</C> node.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>SpaceWarpGroup</strong> — encapsulates a 3D coordinate transform. Takes <C>ScenePos</C>, applies 3D transforms, outputs a warped <C>vec3</C> that can feed into another Scene Group to warp its sampling space.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>March Loop Group</strong> — wraps a raymarch loop for accumulation effects like volumetric fog or glow along the ray.</li>
          </ul>

          <Warn>If your SDF boolean operations aren't working as expected, check that the SDF nodes are inside an SDF Boolean Group. Putting them in a Regular Group won't combine their distance fields.</Warn>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 9 — NOISE
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec9Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Noise</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>FBM — Fractal Brownian Motion</h3>
          <p style={S.p}>
            Summed octaves of Perlin noise at increasing frequencies. Each octave adds finer detail. Parameters: <C>octaves</C> (4–6 typical), <C>lacunarity</C> (frequency multiplier per octave, usually 2.0), <C>gain</C> (amplitude falloff per octave, usually 0.5). Output: <TypeBadge type="float" />. Start with 4 octaves. If you want fine detail add more, but be aware each octave doubles the computation cost.
          </p>

          <h3 style={S.subTitle}>Voronoi</h3>
          <p style={S.p}>
            Cell-based distance noise. Outputs <TypeBadge type="vec2" /> — <C>.x</C> is the distance to the nearest cell center (f1), <C>.y</C> is the distance to the nearest cell edge (f2 - f1). The edge value <C>.y</C> makes great vein and crack patterns — use it instead of <C>.x</C> when you want sharp veins. The most underused output is <C>.y</C> (edge distance) — try <C>smoothstep(0.0, 0.05, voronoi.y)</C> to get clean cell borders.
          </p>

          <h3 style={S.subTitle}>Domain Warp</h3>
          <p style={S.p}>
            Feeds FBM derivatives back as UV offsets, applied iteratively. Apply 2–3 levels for organic lava/storm/marble flow. Each warp pass sends the coordinate through noise and displaces it by the result, creating recursive turbulence. To wire it: connect UV into DomainWarp's position input, connect Time into its time input, then feed DomainWarp's warped vec2 output into an FBM or SDF in place of bare UV.
          </p>

          <h3 style={S.subTitle}>Flow Field</h3>
          <p style={S.p}>
            Curl-noise velocity field — divergence-free, so it creates rotational flow without sinks or sources. Wire into a UV offset over time for particle-streak and fluid-ribbon effects. Good for anything that should look like it's moving through a fluid — smoke, ink in water, aurora.
          </p>

          <Tip>Wire Time at different speeds into each noise layer for parallax — slower base, faster detail. The visual separation reads as depth.</Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 10 — COLOR
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec10Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Color</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>IQ Cosine Palette</h3>
          <p style={S.p}>The palette formula maps any float <C>t</C> to a smooth color:</p>
          <CodeBlock>{`vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
}
// a = DC offset (center color)
// b = amplitude (range around center)
// c = frequency (how fast it cycles)
// d = phase offset (which colors appear at t=0)`}</CodeBlock>
          <p style={S.p}>Start with <C>a = b = vec3(0.5)</C> for a full-range cycle. Adjust <C>c</C> per-channel to shift red/green/blue independently.</p>

          <p style={S.p}>
            A good starting point for any palette: set <C>a=b=vec3(0.5)</C> for a full-range cycle, <C>c=vec3(1.0)</C> for one full cycle per unit of t, <C>d=vec3(0.0, 0.33, 0.67)</C> for evenly spaced phase shifts across RGB. This gives a rainbow that cycles smoothly.
          </p>
          <Tip>If your output looks too dark or washed out, the first thing to check is whether your t input is in the 0→1 range. Values outside that range still work but cycle through the palette multiple times.</Tip>

          <h3 style={S.subTitle}>Other Color Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>HSV ↔ RGB</C> — convert between color spaces. Wire Time into Hue for a cycling rainbow.</li>
            <li style={S.li}><C>Mix</C> — lerp between two colors by a float <C>t</C></li>
            <li style={S.li}><C>Clamp</C> — constrain each channel to [0, 1]</li>
            <li style={S.li}><C>Posterize</C> — quantize to N discrete steps for cel-shaded look</li>
            <li style={S.li}><C>Invert</C> — <C>1.0 - color</C> per channel</li>
            <li style={S.li}><C>Gamma</C> — apply gamma correction (2.2 for sRGB linearization)</li>
            <li style={S.li}><C>ToneMap</C> — 8 modes: Reinhard, ACES, Filmic, Uncharted2, Exposure, Logarithmic, Drago, HableFilmic. Always tonemap before output when using HDR accumulation (e.g. additive glow loops).</li>
          </ul>

          <TryIt exampleKey="color-palette" label="Color Palette" onTry={tryExample} />
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 11 — MATH NODES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec11Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Math Nodes</h2>
          <div style={S.divider} />

          <p style={S.p}>
            You'll use math nodes constantly — they're the glue between sources, noise, and color. The most-reached-for nodes in practice: Multiply (scale anything), Mix (blend between two things), Smoothstep (create soft edges and masks), and Abs (fold negative values to positive, useful for symmetric patterns).
          </p>

          <h3 style={S.subTitle}>Arithmetic</h3>
          <p style={S.p}>
            <C>Add</C>, <C>Subtract</C>, <C>Multiply</C>, <C>Divide</C>, <C>Negate</C>, <C>Abs</C> — all work componentwise on any type. Multiply a color by a float to dim/brighten it. Add to a UV to translate a shape.
          </p>

          <h3 style={S.subTitle}>Trigonometry</h3>
          <p style={S.p}>
            <C>Sin</C> / <C>Cos</C> — period is 2pi. Connect Time to get smooth oscillation between -1 and 1. <C>Atan2</C> — returns the angle of a vec2, useful for polar conversions.
          </p>

          <h3 style={S.subTitle}>Exponents & Powers</h3>
          <p style={S.p}>
            <C>Pow</C> — raises to a power (use for gamma correction or shaping falloff curves). <C>Sqrt</C> — square root. <C>Exp</C> — natural exponential.
          </p>

          <h3 style={S.subTitle}>Range / Interpolation</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Mix</strong> — linear interpolation: <C>mix(a, b, t)</C>. t=0 returns a, t=1 returns b. The workhorse of blending.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Smoothstep</strong> — S-curve ramp: <C>smoothstep(edge0, edge1, x)</C>. Returns a smooth 0→1 transition. Essential for anti-aliased SDF edges.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Remap</strong> — remaps a value from one range to another.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Clamp</strong> — restricts a value to a min/max range.</li>
          </ul>

          <h3 style={S.subTitle}>Min / Max</h3>
          <p style={S.p}>
            <C>Min</C> / <C>Max</C> — component-wise minimum/maximum (note: different from SDF union/intersection which use these on distance values). Also: <C>Floor</C>, <C>Ceil</C>, <C>Round</C>, <C>Fract Raw</C> (fractional part), <C>Mod</C> (modulo).
          </p>

          <h3 style={S.subTitle}>Vectors</h3>
          <p style={S.p}>
            <C>Length</C> — magnitude of a vector. <C>Dot</C> — dot product. <C>Normalize</C> — unit vector. <C>MakeVec2</C> — combine two floats. <C>ExtractX</C> / <C>ExtractY</C> — split a vec2. <C>MakeVec3</C> / <C>FloatToVec3</C> — build vec3. <C>AddVec2</C> / <C>MultiplyVec2</C>, <C>AddVec3</C> / <C>MultiplyVec3</C> — typed vector arithmetic. <C>Tanh</C> — hyperbolic tangent (smooth clamping).
          </p>
          <p style={S.p}>
            A common pattern: <C>length(uv)</C> gives you the distance from center as a float — feed it into noise, sin, or a palette to get radially symmetric patterns.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 12 — ANIMATION
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec12Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Animation</h2>
          <div style={S.divider} />

          <p style={S.p}>
            Animation in Shader Studio is almost always driven by the Time source node. The LFO nodes wrap Time in a waveform so you don't have to do the math manually.
          </p>

          <h3 style={S.subTitle}>LFO Nodes</h3>
          <p style={S.p}>
            Low-Frequency Oscillators generate repeating waveforms. All share the same parameters: Frequency, Amplitude, and Offset.
          </p>
          <div style={{ overflowX: 'auto', marginBottom: '14px', maxWidth: '100%' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Node</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Shape</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Range</th>
                <th style={{ textAlign: 'left', padding: '5px 10px', color: T.dim, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>Use</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['SineLFO', 'Smooth sine wave', '-1 to 1', 'Organic motion, breathing'],
                ['SquareLFO', 'On/off toggle', '-1 or 1', 'Blinking, strobing'],
                ['SawtoothLFO', 'Linear ramp up', '-1 to 1', 'Scrolling, phase drives'],
                ['TriangleLFO', 'Linear up-down', '-1 to 1', 'Ping-pong motion'],
              ] as [string, string, string, string][]).map(([node, shape, range, use], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.green, fontSize: '11px' }}>{node}</td>
                  <td style={{ padding: '6px 10px', color: T.text }}>{shape}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: T.text, fontSize: '11px' }}>{range}</td>
                  <td style={{ padding: '6px 10px', color: T.text }}>{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p style={S.p}>
            Example: breathing circle — <C>SineLFO → Remap(-1, 1 to 0.1, 0.4) → CircleSDF.radius</C>. The radius oscillates smoothly between 0.1 and 0.4.
          </p>

          <h3 style={S.subTitle}>BPM Sync</h3>
          <p style={S.p}>
            Locks animation to a musical tempo. Outputs a beat phase from 0→1 that resets each beat. Use beat divisions to sync to different note values: multiply by 1 for quarter notes, 0.5 for half notes, 4 for sixteenth notes.
          </p>
          <p style={S.p}>
            The simplest animation pattern: UV + sin(time) * amplitude. This shifts the entire UV space back and forth, making everything appear to sway. Change the multiplier on UV inside the sin to add spatial frequency — different parts of the canvas sway at different phases.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 13 — EFFECTS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec13Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Effects</h2>
          <div style={S.divider} />

          <p style={S.p}>
            Effect nodes are applied after your main shader output — they post-process the color before it reaches the screen. Chain them in order: lighting → tonemapping → lens effects → grain.
          </p>

          <h3 style={S.subTitle}>MakeLight</h3>
          <p style={S.p}>
            Point light in 2D. Inputs: <C>position</C> (vec2), <C>color</C> (vec3), <C>intensity</C> (float), <C>falloff</C> (float). Computes a glow at the boundary of any SDF — wire the distance field into it. MakeLight outputs a color contribution that you wire additively — connect multiple MakeLight outputs into a chain of Add nodes before your Output to build multi-light scenes.
          </p>

          <h3 style={S.subTitle}>ToneMap</h3>
          <p style={S.p}>
            8 modes: <C>Reinhard</C>, <C>ACES</C>, <C>Filmic</C>, <C>Uncharted2</C>, <C>Exposure</C>, <C>Logarithmic</C>, <C>Drago</C>, <C>HableFilmic</C>. Reinhard and ACES are most useful. Always tonemap before the Output node when using HDR accumulation.
          </p>

          <h3 style={S.subTitle}>Grain</h3>
          <p style={S.p}>Film grain overlay. Intensity parameter controls strength. Adds noise that reads as film texture rather than digital artifacts.</p>

          <h3 style={S.subTitle}>ChromaticAberration</h3>
          <p style={S.p}>Offsets the R, G, and B channels by slightly different amounts with a radial falloff from center. Creates lens-fringe rainbow banding at high contrast edges. The effect is strongest at the edges of the canvas and zero at center — start with a small offset (0.005–0.02), it gets intense quickly.</p>

          <h3 style={S.subTitle}>GravitationalLens</h3>
          <p style={S.p}>UV distortion imitating gravitational lensing — pixels curve around a center point as if space itself were bent. Wire the lensed UV into any downstream node's coordinate input.</p>

          <Tip>Grain + ChromaticAberration together create a convincing analog/VHS look. Add a very subtle RadialBlur for the full effect.</Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION — BLUR & LENS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secBlurRef as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Blur &amp; Lens Effects</h2>
          <div style={S.divider} />

          <p style={S.p}>
            Blur nodes take the current rendered output as input and sample it multiple times with offsets. They're expensive — GaussianBlur at high radius can drop frame rate significantly. Use BoxBlur for real-time interactive work, GaussianBlur for export/recording.
          </p>

          <ul style={S.ul}>
            <li style={S.li}><C>BoxBlur</C> — fast, uniform, cheap. Good for real-time blurring where quality is secondary — pairs well with PrevFrame feedback to create smooth motion trails.</li>
            <li style={S.li}><C>GaussianBlur</C> — high quality, separable, two passes internally. Best quality for photography-style soft focus — lower the radius first if frame rate drops.</li>
            <li style={S.li}><C>RadialBlur</C> — streaks from a center point. Good for speed, explosion, or zoom-lens effects — try animating the center with Mouse for interactive zoom streaks.</li>
            <li style={S.li}><C>MotionBlur</C> — directional blur along a vec2. Simulate camera shake or fast panning — wire an LFO into the direction vec2 for shaky-cam motion.</li>
            <li style={S.li}><C>DepthOfField</C> — requires a depth map input. Blurs based on distance from a focal plane — use a distance field or noise as the depth source for a pseudo-3D look.</li>
            <li style={S.li}><C>BokehBlur</C> — hexagonal aperture shape. Most realistic but most expensive — use sparingly, best for cinematic stills or slow-moving scenes where the bokeh disc shape is noticeable.</li>
          </ul>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION — PARTICLE-LIKE EFFECTS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secParticlesRef as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Particle-Like Effects</h2>
          <div style={S.divider} />

          <p style={S.p}>
            Shader Studio doesn't have a native particle system, but you can fake convincing particle motion using noise and flow fields. The key insight: instead of tracking individual particles over time, you reverse the question — for each pixel, ask <em>"is there a particle near me right now?"</em>
          </p>

          <h3 style={S.subTitle}>Flow Field Streams</h3>
          <p style={S.p}>
            The easiest approach. Drop a <C>Flow Field</C> node, wire its <TypeBadge type="vec2" /> output into a <C>Displace</C> node's offset, and feed Time into the flow field. The curl-noise velocity field pushes UV around frame to frame — anything you render at that displaced UV appears to streak and flow. Add a <C>PrevFrame</C> blend (mix current with 0.95 of last frame) for persistence trails.
          </p>

          <h3 style={S.subTitle}>Voronoi "Cells as Particles"</h3>
          <p style={S.p}>
            Drop a <C>Voronoi</C> node. Each cell has a center — that center is your "particle." The <C>.x</C> output is the distance to the nearest cell center, so <C>0.005 / max(voronoi.x, 0.0001)</C> gives a glow at every cell center simultaneously. Animate the Voronoi scale or offset with Time to make the particles drift.
          </p>
          <CodeBlock>{`// Voronoi particle glow pattern:
// voronoi.x = distance to nearest cell center
float glow = 0.003 / max(voronoi.x, 0.0001);
// color each particle by cell ID:
vec3 col = palette(voronoi.y) * glow;`}</CodeBlock>

          <h3 style={S.subTitle}>FBM-Displaced Dot Grid</h3>
          <p style={S.p}>
            Tile UV with <C>Fract</C> to make a grid. Inside each tile, compute the distance to a point that's offset by FBM noise — each tile's "particle" is in a different random position. Render a glowing dot at that position. Feed Time into the FBM to animate.
          </p>

          <Tip>Combine Flow Field streaks with a PrevFrame blend at 0.92–0.96 persistence. The slight decay prevents total saturation while the motion blur accumulates into streak trails.</Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 14 — FRACTALS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec14Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Fractals</h2>
          <div style={S.divider} />

          <p style={S.p}>
            Fractal nodes are self-contained — drop one, wire UV in, wire the float output into IQ Palette, wire that into Output. You'll have something interesting in under a minute.
          </p>

          <ul style={S.ul}>
            <li style={S.li}><C>Mandelbrot</C> — classic escape-time fractal. Parameters: iteration count, max iterations, zoom, center. Output: float (iteration ratio 0→1). Start by adjusting zoom to find an interesting boundary region — the most detail lives at the edge of the set.</li>
            <li style={S.li}><C>Julia</C> — same iteration as Mandelbrot but with a fixed complex seed <C>c</C> you parameterize. Wire Mouse into <C>c</C> for interactive morphing — slowly moving the cursor reveals wildly different fractal structures.</li>
            <li style={S.li}><C>BurningShip</C> — Mandelbrot variant with <C>abs()</C> applied to real and imaginary parts before squaring. Visually distinctive for its flame-like, asymmetric boundaries — zoom into the bottom of the set to see the eponymous ship shape.</li>
            <li style={S.li}><C>Apollonian</C> — gasket fractal via iterated circle inversions. Fills the plane with mutually tangent circles recursively — increase iterations for finer detail, but 5–6 is usually enough before the circles become sub-pixel.</li>
            <li style={S.li}><C>IFS</C> — Iterated Function System: define up to 4 affine transform matrices, iterate N times. Classic use: Sierpinski triangle, Barnsley fern — the first parameter to tweak is the probability weighting for each transform.</li>
            <li style={S.li}><C>KochSnowflake</C> — 2D IFS producing the Koch curve. Each iteration replaces segments with a triangle bump — at 4–5 iterations the snowflake shape is fully recognizable and good for combining with SDF booleans.</li>
            <li style={S.li}><C>MengerSponge</C> — 3D SDF produced by iterated box folds. Use inside a Scene Group for a raymarched Menger sponge — crank up iteration count for more holes, but each iteration multiplies raymarch cost significantly.</li>
          </ul>

          <Tip>Feed the iteration output (float 0→1) into IQ Palette for classic fractal coloring — different palette phases reveal different structure in the boundary regions.</Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 15 — 3D / RAYMARCH
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec15Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>3D / Raymarch</h2>
          <div style={S.divider} />

          <p style={S.p}>
            Instead of rasterizing triangles, raymarching shoots a ray per pixel and steps along it until hitting a surface defined by an SDF. The SDF value at each step tells you the minimum safe step size — you can advance that far without missing any geometry.
          </p>

          <h3 style={S.subTitle}>Pipeline</h3>
          <ol style={{ ...S.ul, listStyleType: 'decimal' }}>
            <li style={S.li}><C>ScenePos</C> — injects the current 3D sample point into the Scene Group</li>
            <li style={S.li}>3D SDF nodes inside the Scene Group define the geometry</li>
            <li style={S.li}>3D transforms (Translate, Rotate, Scale, Twist, Bend, Fold, Repeat, Sin Warp, Spiral Warp, Displace) position and deform shapes</li>
            <li style={S.li}><C>SceneGroup</C> aggregates everything into a <C>scene3d</C> wire</li>
            <li style={S.li}><C>MarchCamera</C> — sets up ray origin + direction from camera params</li>
            <li style={S.li}><C>RayMarch</C> — marches the rays, outputs: <C>dist</C>, <C>normal</C> (vec3), <C>hit</C> (float 0/1), <C>depth</C></li>
            <li style={S.li}><C>RayMarchLit</C> — same but with built-in AO, soft shadows, PBR diffuse</li>
          </ol>

          <h3 style={S.subTitle}>3D SDF Nodes</h3>
          <p style={S.p}><C>sdSphere</C>, <C>sdBox</C>, <C>sdCylinder</C>, <C>sdCone</C>, <C>sdTorus</C>, <C>sdCapsule</C>, <C>sdPlane</C>. All 2D boolean ops (min/max/smin) work in 3D too.</p>

          <h3 style={S.subTitle}>Manual Shading from RayMarch Outputs</h3>
          <CodeBlock>{`vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
float diffuse = max(dot(normal, lightDir), 0.0);
vec3 color = hit > 0.5 ? vec3(diffuse) : skyColor;`}</CodeBlock>

          <TryIt exampleKey="3d-sphere" label="3D Sphere" onTry={tryExample} />
        </div>

        {/* sec16Ref placeholder — kept for TOC link compatibility */}
        <div ref={sec16Ref as React.RefObject<HTMLDivElement>} />

        {/* ══════════════════════════════════════════════════════════════════════
            APPENDIX — NODE REFERENCE
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secAppRef as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Node Reference</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Sources</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>UV</C> vec2 — centered, aspect-corrected screen coordinate</li>
            <li style={S.li}><C>PixelUV</C> vec2 — raw pixel coordinate (0,0) at bottom-left</li>
            <li style={S.li}><C>Time</C> float — elapsed seconds, increments every frame</li>
            <li style={S.li}><C>Mouse</C> vec2 — normalized cursor position, same space as UV</li>
            <li style={S.li}><C>Constant</C> any — fixed typed value</li>
            <li style={S.li}><C>PrevFrame</C> vec4 — last frame's rendered output for feedback loops</li>
            <li style={S.li}><C>TextureInput</C> vec4 — sample from an uploaded image</li>
            <li style={S.li}><C>AudioInput</C> float — microphone amplitude 0→1</li>
          </ul>

          <h3 style={S.subTitle}>2D SDFs</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>sdCircle</C> — <C>length(p) - r</C></li>
            <li style={S.li}><C>sdBox</C> — axis-aligned rectangle</li>
            <li style={S.li}><C>sdSegment</C> — line segment with thickness</li>
            <li style={S.li}><C>sdEllipse</C> — ellipse with x/y radii</li>
            <li style={S.li}><C>sdEquilateral</C> — equilateral triangle</li>
            <li style={S.li}><C>sdPentagon</C>, <C>sdHexagon</C>, <C>sdStar</C>, <C>sdArc</C>, <C>sdCross</C></li>
            <li style={S.li}><C>sdRoundedBox</C> — rectangle with rounded corners</li>
            <li style={S.li}><C>sdPie</C> — wedge slice of a circle</li>
            <li style={S.li}><C>sdVesica</C> — lens shape (intersection of two circles)</li>
          </ul>

          <h3 style={S.subTitle}>Boolean Operations</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>Union</C> — <C>min(d1, d2)</C></li>
            <li style={S.li}><C>Subtract</C> — <C>max(-d1, d2)</C></li>
            <li style={S.li}><C>Intersect</C> — <C>max(d1, d2)</C></li>
            <li style={S.li}><C>SmoothUnion</C> — <C>smin(d1, d2, k)</C> — blended merge with radius k</li>
            <li style={S.li}><C>opRepeat</C> — infinite tiling (mod-based)</li>
            <li style={S.li}><C>opRepeatPolar</C> — N-fold radial symmetry</li>
          </ul>

          <h3 style={S.subTitle}>Transforms (2D UV)</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>Fract</C> — tile UV every 1 unit</li>
            <li style={S.li}><C>Rotate2D</C> — rotate UV around origin</li>
            <li style={S.li}><C>Displace</C> — noise-based UV offset</li>
            <li style={S.li}><C>Jitter</C> — per-tile random offset</li>
            <li style={S.li}><C>Smooth</C> — bilinear smoothing across tiles</li>
            <li style={S.li}><C>Curl</C> — divergence-free curl noise warp</li>
            <li style={S.li}><C>Swirl</C> — rotational warp around origin</li>
          </ul>

          <h3 style={S.subTitle}>Noise</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>FBM</C> — fractal Brownian motion, float output, octaves/lacunarity/gain params</li>
            <li style={S.li}><C>Voronoi</C> — vec2 output: .x = cell distance (f1), .y = edge distance (f2-f1)</li>
            <li style={S.li}><C>DomainWarp</C> — recursive FBM warping, 2–3 levels for organic flow</li>
            <li style={S.li}><C>FlowField</C> — curl-noise velocity field (divergence-free)</li>
          </ul>

          <h3 style={S.subTitle}>Color</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>IQPalette</C> — <C>a + b*cos(2π*(c*t+d))</C>, four vec3 params</li>
            <li style={S.li}><C>HSV</C> — hue/saturation/value to RGB conversion</li>
            <li style={S.li}><C>Mix</C> — lerp between two colors</li>
            <li style={S.li}><C>Clamp</C> — clamp each channel to [0,1]</li>
            <li style={S.li}><C>Posterize</C> — quantize to N discrete steps</li>
            <li style={S.li}><C>Invert</C> — <C>1.0 - color</C></li>
            <li style={S.li}><C>Gamma</C> — apply gamma correction</li>
            <li style={S.li}><C>ToneMap</C> — 8 modes including Reinhard and ACES</li>
          </ul>

          <h3 style={S.subTitle}>Animation / LFOs</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>SineLFO</C> — smooth sine wave oscillating between min/max</li>
            <li style={S.li}><C>SquareLFO</C> — instant toggle at frequency</li>
            <li style={S.li}><C>SawtoothLFO</C> — linear ramp then reset</li>
            <li style={S.li}><C>TriangleLFO</C> — symmetric up/down ramp</li>
            <li style={S.li}><C>BPMSync</C> — lock animation to a BPM value</li>
          </ul>

          <h3 style={S.subTitle}>Effects</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>MakeLight</C> — point glow from SDF distance: position, color, intensity, falloff</li>
            <li style={S.li}><C>Grain</C> — film grain overlay</li>
            <li style={S.li}><C>ChromaticAberration</C> — RGB channel offset with radial falloff</li>
            <li style={S.li}><C>GravitationalLens</C> — UV distortion imitating gravitational lensing</li>
            <li style={S.li}><C>BoxBlur</C>, <C>GaussianBlur</C>, <C>RadialBlur</C>, <C>MotionBlur</C>, <C>DepthOfField</C>, <C>BokehBlur</C></li>
          </ul>

          <h3 style={S.subTitle}>Fractals</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>Mandelbrot</C> — escape-time, float output (iteration ratio)</li>
            <li style={S.li}><C>Julia</C> — fixed complex seed variant</li>
            <li style={S.li}><C>BurningShip</C> — abs-before-squaring variant</li>
            <li style={S.li}><C>Apollonian</C> — iterated circle inversions</li>
            <li style={S.li}><C>IFS</C> — up to 4 affine transforms, N iterations</li>
            <li style={S.li}><C>KochSnowflake</C> — 2D IFS Koch curve</li>
            <li style={S.li}><C>MengerSponge</C> — 3D SDF box-fold fractal</li>
          </ul>

          <h3 style={S.subTitle}>3D Scene Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>ScenePos</C> — injects current 3D sample point into Scene Group</li>
            <li style={S.li}><C>SceneGroup</C> — aggregates 3D SDFs into a scene3d wire</li>
            <li style={S.li}><C>MarchCamera</C> — sets up ray origin and direction</li>
            <li style={S.li}><C>RayMarch</C> — marches rays, outputs dist/normal/hit/depth</li>
            <li style={S.li}><C>RayMarchLit</C> — same with built-in AO and PBR diffuse</li>
            <li style={S.li}><C>sdSphere</C>, <C>sdBox</C>, <C>sdCylinder</C>, <C>sdCone</C>, <C>sdTorus</C>, <C>sdCapsule</C>, <C>sdPlane</C></li>
          </ul>

          <h3 style={S.subTitle}>Math Nodes</h3>
          <ul style={S.ul}>
            <li style={S.li}><C>Add</C>, <C>Sub</C>, <C>Mul</C>, <C>Div</C> — arithmetic, all vector types</li>
            <li style={S.li}><C>Dot</C>, <C>Cross</C>, <C>Length</C>, <C>Normalize</C> — vector ops</li>
            <li style={S.li}><C>Sin</C>, <C>Cos</C>, <C>Tan</C> — trig in radians</li>
            <li style={S.li}><C>Step</C> — hard threshold; <C>Smoothstep</C> — hermite curve; <C>Mix</C> — lerp; <C>Clamp</C></li>
            <li style={S.li}><C>Abs</C>, <C>Floor</C>, <C>Ceil</C>, <C>Fract</C>, <C>Mod</C>, <C>Sign</C>, <C>Pow</C>, <C>Sqrt</C></li>
            <li style={S.li}><C>Remap</C>, <C>Min</C>, <C>Max</C>, <C>Swizzle</C>, <C>Split</C>, <C>Join</C></li>
          </ul>
        </div>


        {/* ══════════════════════════════════════════════════════════════════════
            SECTION — 3D COMPOSABLE
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec3dRef as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>3D Composable</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>SpaceWarpGroup</h3>
          <p style={S.p}>
            A SpaceWarpGroup builds a reusable 3D coordinate transform — not a distance field. It takes <C>ScenePos</C> as input, applies any chain of 3D transform nodes, and outputs a warped <C>vec3</C>. Feed that warped vec3 into another Scene Group as its ScenePos to warp the entire scene's sampling space.
          </p>
          <p style={S.p}>
            This is how you apply a twist, bend, or curl to an entire scene without affecting the SDF math directly.
          </p>

          <h3 style={S.subTitle}>March Loop Group</h3>
          <p style={S.p}>
            Wraps the march step in a LoopStart/LoopEnd for accumulation along the ray. Instead of stopping when a surface is hit, each step accumulates a contribution — enabling volumetric effects like fog, glow along the ray, or density accumulation.
          </p>
          <p style={S.p}>Use cases: volumetric fog, light shafts, aurora-like emission along the ray path.</p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION — EXPRESSION BLOCKS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secExprRef as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Expression Blocks</h2>
          <div style={S.divider} />

          <p style={S.p}>
            An <strong>ExprBlock</strong> is a general-purpose GLSL node you define entirely from the modal. You give it named input sockets, an optional sequence of intermediate calculations (warp lines), and a return expression. The system compiles it into a GLSL function that plugs into the rest of your graph like any other node.
          </p>
          <p style={S.p}>
            Think of it as a custom function node with a structured editor: instead of writing a raw GLSL body, you work with named fields that make the data flow explicit.
          </p>

          <p style={S.subTitle}>Anatomy of an ExprBlock</p>
          <p style={S.p}>
            Every ExprBlock has three regions:
          </p>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Inputs</strong> — named sockets of type <C>float</C>, <C>vec2</C>, or <C>vec3</C>. Each becomes a variable available throughout the block. Wire upstream nodes into these sockets to pass data in.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Warp lines</strong> — optional intermediate assignments. Each line has a left-hand side (a typed variable declaration, e.g. <C>float d</C> or <C>vec3 col</C>), an operator (<C>=</C>), and a right-hand side GLSL expression. Use these for multi-step calculations.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Result</strong> — the expression whose value becomes the node's output. References any input name or warp-line variable.</li>
          </ul>

          <p style={S.p}>Here's what the compiled GLSL looks like for a simple ExprBlock:</p>
          <CodeBlock>{`// Inputs: uv (vec2), speed (float)
// Warp lines:
//   vec2 p  = uv * 3.0
//   float d = length(p) - sin(t * speed)
// Result: d

// Compiles to:
float t = u_time;
vec2 p  = uv * 3.0;
float d = length(p) - sin(t * speed);
// output = d`}</CodeBlock>

          <p style={S.subTitle}>Input sockets</p>
          <p style={S.p}>
            Click <strong>+ Add Input</strong> in the modal to create a new socket. You can name it anything — that name becomes the GLSL variable. The type (<C>float</C> / <C>vec2</C> / <C>vec3</C>) controls what wire color can connect to it and how GLSL treats it.
          </p>
          <p style={S.p}>
            Optional <strong>sliders</strong> give an input a fallback value when nothing is wired in. A slider range (min / max) appears on the node itself and in the parameter panel. Without a slider, an unconnected socket defaults to zero.
          </p>
          <Tip>
            Keep input names short and meaningful — they appear on the node port labels and in the warp-line editor's auto-complete. <C>uv</C>, <C>t</C>, <C>d</C>, <C>col</C> are common choices.
          </Tip>

          <p style={S.subTitle}>Warp lines: multi-step math</p>
          <p style={S.p}>
            Warp lines are executed top to bottom, exactly like variable declarations in a GLSL function body. Each line can reference any input and any previously declared warp-line variable.
          </p>
          <CodeBlock>{`// Three warp lines building up a polar ripple:
vec2  polar = vec2(length(uv), atan(uv.y, uv.x))
float wave  = sin(polar.x * freq - t * speed)
float mask  = smoothstep(0.0, 0.02, abs(wave) - 0.5)
// result: mask`}</CodeBlock>
          <p style={S.p}>
            The LHS type annotation (<C>vec2</C>, <C>float</C>, <C>vec3</C>) matters — it tells GLSL what kind of value is being stored. If the RHS produces a <C>vec2</C> but you declare the LHS as <C>float</C>, the shader will fail to compile. The error overlay on the canvas shows the exact GLSL error message.
          </p>

          <p style={S.subTitle}>The <C>t</C> variable</p>
          <p style={S.p}>
            Every ExprBlock automatically receives <C>float t = u_time</C> as a built-in. You don't need to add a Time input socket — just write <C>t</C> in any expression and it will animate.
          </p>

          <p style={S.subTitle}>GLSL Functions field</p>
          <p style={S.p}>
            The <strong>GLSL Functions</strong> area (below the warp lines in the modal) lets you inject complete helper functions that run before the block's body. Write full GLSL function definitions here — they're compiled once, globally, and can be called from any warp line or the result field.
          </p>
          <CodeBlock>{`// In the GLSL Functions field:
float sineRipple(vec2 p, float freq, float t) {
    return sin(length(p) * freq - t);
}

// Then in a warp line:
float r = sineRipple(uv, 8.0, t)`}</CodeBlock>
          <Tip>
            This is the same slot the <strong>Function Builder</strong> writes into when you save a session to an ExprBlock. If you open an ExprBlock that was created from the builder, you'll see all the named functions here.
          </Tip>

          <p style={S.subTitle}>Output type</p>
          <p style={S.p}>
            The dropdown at the top of the modal sets what type the result expression must produce. It controls the wire color leaving the node and how downstream nodes interpret the value. Changing the output type doesn't modify your expressions — it's your responsibility to ensure the result matches.
          </p>

          <p style={S.subTitle}>Edit in Function Builder</p>
          <p style={S.p}>
            Any ExprBlock that was created from (or is linked to) the <strong>Function Builder</strong> shows an <strong>Edit in Builder ↗</strong> button in the modal. Clicking it loads the original named functions back into the builder, opens the live preview graph, and links the builder back to that node. When you're done editing, hitting <strong>Update ExprBlock</strong> writes the changes back — sockets, GLSL functions, and result expression all update in place, with any connected wires preserved.
          </p>
          <Warn>
            If you manually edit the warp lines of an ExprBlock that was created by the Function Builder and then click <strong>Edit in Builder</strong>, the manual edits will be overwritten by the stored function definitions. The builder is the source of truth for these nodes.
          </Warn>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION — FUNCTION BUILDER
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secFnBuilderRef as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Function Builder</h2>
          <div style={S.divider} />

          <p style={S.p}>
            The <strong>Function Builder</strong> is a dedicated environment for writing and iterating on named GLSL functions. You write function bodies in a syntax-highlighted editor, and the preview canvas plots or renders the result live — a 2D graph for <C>float</C> functions, a full-color preview for <C>vec3</C> functions. When the function is ready, one click saves it as an <strong>ExprBlock</strong> node in your graph.
          </p>
          <p style={S.p}>
            It's the closest thing in Shader Studio to writing raw GLSL — but with immediate visual feedback and a clean round-trip path back to the node graph.
          </p>

          <p style={S.subTitle}>Return types and what they preview</p>
          <p style={S.p}>
            Each function has a return type. The type determines what the preview canvas shows:
          </p>
          <ul style={S.ul}>
            <li style={S.li}><TypeBadge type="float" /> — plotted as a 2D graph. The horizontal axis is <C>x</C>, the vertical axis is the function value. A white curve traces <C>f(x, t)</C> over the current view range. Zoom and pan with scroll and drag.</li>
            <li style={S.li}><TypeBadge type="vec2" /> — rendered as a color field where the x and y components map to red and green respectively.</li>
            <li style={S.li}><TypeBadge type="vec3" /> — rendered as a full-color fragment shader. The entire canvas becomes your output, giving you the same feedback as the main studio canvas.</li>
          </ul>

          <p style={S.subTitle}>Available variables</p>
          <p style={S.p}>
            Inside every function body, two variables are always in scope:
          </p>
          <ul style={S.ul}>
            <li style={S.li}><C>x</C> — a <C>float</C>. For float functions, this is the horizontal position being evaluated. For vec2/vec3 functions it's still available but less meaningful.</li>
            <li style={S.li}><C>t</C> — <C>u_time</C> in seconds. Anything that references <C>t</C> will animate.</li>
          </ul>
          <p style={S.p}>
            For <C>vec2</C> and <C>vec3</C> return types, <C>uv</C> is also in scope — the centered, aspect-corrected screen coordinate, exactly as it arrives from the UV node.
          </p>
          <CodeBlock>{`// float function — graphs y = f(x)
sin(x * 3.0) * 0.5 + cos(t)

// vec3 function — renders as a color field
vec3(uv.x * 0.5 + 0.5, uv.y * 0.5 + 0.5, 0.5 + 0.5 * sin(t))

// float calling another function defined in the same session
f1(x, t) * 2.0 - 1.0`}</CodeBlock>

          <p style={S.subTitle}>Multiple functions in one session</p>
          <p style={S.p}>
            A session can hold any number of named functions simultaneously. Use the <strong>+ Add Function</strong> button (or the <strong>+</strong> button in the header) to create additional functions. All functions are compiled together — earlier functions can call later ones and vice versa, as long as there are no circular dependencies.
          </p>
          <p style={S.p}>
            The <strong>Visualize</strong> dropdown in the toolbar lets you choose which function the preview canvas displays. Only one function is shown at a time, but all of them are compiled into the ExprBlock when you save.
          </p>
          <Tip>
            Name helper functions <C>f2</C>, <C>f3</C>, etc. and your main function <C>f1</C>. Keep the main function selected in the Visualize dropdown so you're always watching the final output.
          </Tip>

          <p style={S.subTitle}>Tabs and saved sessions</p>
          <p style={S.p}>
            The tab bar at the top of the function list lets you maintain multiple independent sets of functions. Tabs are ephemeral — they live as long as the page is open. For long-term storage, use <strong>Save Group</strong> in the toolbar to write the current tabs to <C>localStorage</C> under a name. Load them back at any time from the <strong>Sessions</strong> dropdown.
          </p>
          <p style={S.p}>
            Each tab also remembers its own zoom / pan state for the preview canvas. Switching tabs restores the exact view you left.
          </p>

          <p style={S.subTitle}>The function library</p>
          <p style={S.p}>
            The <strong>↓ lib</strong> button on any function card saves that function to a persistent library stored in <C>localStorage</C>. Library functions appear as pills in the <strong>Helpers</strong> panel at the bottom of the function list. Clicking a pill does two things simultaneously:
          </p>
          <ul style={S.ul}>
            <li style={S.li}>Loads the full function body into the current session (so it compiles without "undefined function" errors).</li>
            <li style={S.li}>Inserts the call expression — e.g. <C>f1(x, t)</C> — at the cursor position in whichever function body you're editing.</li>
          </ul>
          <p style={S.p}>
            This makes it easy to compose complex shaders from reusable building blocks without rewriting the same noise or SDF helpers every time.
          </p>

          <p style={S.subTitle}>Saving to the node graph</p>
          <p style={S.p}>
            The <strong>Save to ExprBlock</strong> button in the toolbar creates a new ExprBlock node in the Studio with:
          </p>
          <ul style={S.ul}>
            <li style={S.li}>One input socket — <C>x</C> (float) for float functions, <C>uv</C> (vec2) for vec2/vec3 functions.</li>
            <li style={S.li}>All compiled function definitions injected into the GLSL Functions field.</li>
            <li style={S.li}>A result expression that calls the active function: <C>f1(x, t)</C>.</li>
            <li style={S.li}>The original function definitions stored in a <C>fnBuilderFns</C> metadata field so the round-trip edit path works.</li>
          </ul>
          <p style={S.p}>
            If you navigated to the builder by clicking <strong>Edit in Builder</strong> on an existing ExprBlock, the button label becomes <strong>Update ExprBlock</strong>. Clicking it writes all changes back to that specific node and returns you to the Studio.
          </p>

          <p style={S.subTitle}>Compile errors</p>
          <p style={S.p}>
            GLSL errors appear as a centered overlay on the preview canvas — the raw WebGL error message with the <C>ERROR: 0:N:</C> prefix stripped. The canvas goes dark while errors are present. Fix the expression and the preview resumes automatically; there's no explicit recompile step.
          </p>
          <Warn>
            The Function Builder uses WebGL 1 (GLSL ES 1.00) to match the main canvas. Some GLSL ES 3.00 features are unavailable: no integer overloads for <C>min</C>/<C>max</C>, no <C>uint</C>, no <C>in</C>/<C>out</C> on loop variables. If you get unexpected type errors, check that all numeric literals are floats (<C>1.0</C> not <C>1</C>).
          </Warn>

          <p style={S.subTitle}>Workflow: function → graph</p>
          <p style={S.p}>
            A typical workflow looks like this:
          </p>
          <ol style={{ ...S.ul, listStyleType: 'decimal' }}>
            <li style={S.li}>Open <strong>Function Builder</strong> from the top nav.</li>
            <li style={S.li}>Write a float function, e.g. <C>abs(sin(x * 4.0 + t)) * 0.5</C>. Watch it graph in real time.</li>
            <li style={S.li}>Add a second function that calls the first and applies color logic, change its return type to <C>vec3</C>.</li>
            <li style={S.li}>Switch the Visualize dropdown to the vec3 function. Confirm the color output looks right.</li>
            <li style={S.li}>Click <strong>Save to ExprBlock</strong>. The Studio opens with a new ExprBlock node pre-wired and ready to connect.</li>
            <li style={S.li}>Wire a <strong>UV</strong> node into the ExprBlock's <C>uv</C> input and connect the output to <strong>Output</strong>. Done.</li>
          </ol>
          <Tip>
            You can also open the Function Builder <em>from</em> an ExprBlock — click <strong>Edit in Builder ↗</strong> in the modal. The builder loads the node's existing functions, you refine them, and <strong>Update ExprBlock</strong> writes the changes back without breaking any connections.
          </Tip>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION — COOL TRICKS
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={secCoolRef as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Cool Tricks</h2>
          <div style={S.divider} />

          <h3 style={S.subTitle}>Polar Mandalas</h3>
          <p style={S.p}>
            Convert UV to polar coordinates, divide the angle by <C>2π/N</C> and take the fractional part to get N-fold rotational symmetry. Mirror across the half-angle boundary for true mandala reflections. Combine with an SDF evaluated at the mirrored coordinate for radially symmetric shapes.
          </p>
          <CodeBlock>{`vec2 polar(vec2 uv) {
    return vec2(length(uv), atan(uv.y, uv.x));
}
// N-fold symmetry + mirror:
float a = mod(polar(uv).y, 2.0*PI/N);
if (a > PI/N) a = 2.0*PI/N - a;
vec2 p = vec2(cos(a), sin(a)) * polar(uv).x;`}</CodeBlock>

          <h3 style={S.subTitle}>SDF Glow</h3>
          <p style={S.p}>
            After computing a signed distance <C>d</C>, apply <C>exp(-abs(d) * sharpness)</C> to get a smooth halo that falls off exponentially with distance. Multiply by a color to tint it. This produces far more naturalistic bloom than a step-based fill.
          </p>
          <CodeBlock>{`float glow = exp(-abs(d) * 12.0);
vec3 col = glow * vec3(0.2, 0.6, 1.0);`}</CodeBlock>

          <h3 style={S.subTitle}>Fake 3D Normals from a 2D SDF</h3>
          <p style={S.p}>
            Sample the SDF at four offset positions and use the differences as a normal estimate. Feed that normal into a dot product with a light direction to get cheap diffuse shading on 2D shapes — no ray marching required.
          </p>
          <CodeBlock>{`float e = 0.001;
vec3 n = normalize(vec3(
    sdf(uv + vec2(e,0.0)) - sdf(uv - vec2(e,0.0)),
    sdf(uv + vec2(0.0,e)) - sdf(uv - vec2(0.0,e)),
    0.001
));
float diff = max(dot(n, normalize(vec3(1.0,1.0,0.5))), 0.0);`}</CodeBlock>

          <h3 style={S.subTitle}>Truchet Tiling</h3>
          <p style={S.p}>
            Split UV into a grid, use a hash of the cell index to randomly choose one of two tile orientations (e.g. arc going NW→SE vs NE→SW). Evaluate the SDF of the chosen arc within the cell. The random flips create surprisingly complex, connected-looking patterns from a single primitive.
          </p>

          <h3 style={S.subTitle}>Domain Repetition with Offset Rows</h3>
          <p style={S.p}>
            Use <C>fract(uv * N)</C> for basic tiling, then offset every other row by half a cell: add <C>0.5</C> to <C>uv.x</C> before <C>fract</C> if <C>floor(uv.y * N)</C> is odd. This gives a brick or hexagonal layout with no extra nodes.
          </p>

          <h3 style={S.subTitle}>Smooth Color Bands with IQ Palette</h3>
          <p style={S.p}>
            The IQ cosine palette (<C>a + b * cos(2π(c*t + d))</C>) produces smooth, cyclically varying colors from just four <C>vec3</C> parameters. Pump an SDF distance or a noise value into <C>t</C> to get continuous, band-free color gradients that loop perfectly.
          </p>

          <h3 style={S.subTitle}>Time-Offset Layers</h3>
          <p style={S.p}>
            Run the same expression multiple times with slightly different time offsets and blend the results. Because the offsets are constant, the layers animate at the same speed but stay out of phase — creating the illusion of depth and complexity from a single formula.
          </p>

          <h3 style={S.subTitle}>FBM Warp</h3>
          <p style={S.p}>
            Feed FBM noise into a second FBM call: <C>fbm(uv + fbm(uv + t))</C>. The inner call displaces the domain, the outer call evaluates there. The result is organic, cloud-like swirling that is surprisingly cheap to compute.
          </p>

          <h3 style={S.subTitle}>Scroll Speed from Mouse</h3>
          <p style={S.p}>
            Wire a Mouse node into a UV Displace node. The mouse position becomes an animated pan offset. Hold a constant multiplier in an Multiply node to scale sensitivity. This gives interactive parallax scrolling with no code.
          </p>

          <h3 style={S.subTitle}>Audio-Reactive Bass Pulse</h3>
          <p style={S.p}>
            Connect an AudioInput node (set to "bass" band) to the radius parameter of an sdCircle or to a scale transform. The low-frequency amplitude expands and contracts the shape in sync with the music.
          </p>

          <h3 style={S.subTitle}>PrevFrame Feedback</h3>
          <p style={S.p}>
            Connect a PrevFrame node into a color mix or UV displace: each frame is blended slightly with the last. Apply a tiny inward UV warp (multiply UV by 0.995) before sampling PrevFrame to create a zoom-tunnel feedback loop that never blows up.
          </p>

          <h3 style={S.subTitle}>Boolean SDF Animation</h3>
          <p style={S.p}>
            Animate the parameters of two SDFs independently, then combine with SmoothUnion. As the shapes drift toward and away from each other, the smooth union creates a natural-looking merge/split that would be impossible with hard boolean ops.
          </p>

          <h3 style={S.subTitle}>Cheap Ambient Occlusion</h3>
          <p style={S.p}>
            For 2D scenes, sample the SDF at several radii outward from each pixel and sum the occlusion. Points inside many nearby shapes receive less ambient light. Even 4–5 samples at increasing radii give convincing soft shadows without ray marching.
          </p>

          <h3 style={S.subTitle}>Kaleidoscope</h3>
          <p style={S.p}>
            Apply the N-fold polar mirror from the Polar Mandala trick, then run any arbitrary shader on the mirrored UV. Any design — noise, SDF, texture — instantly becomes a symmetric mandala. Stack two different rotational symmetries at different scales for quasi-crystalline patterns.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION — EXAMPLES
        ══════════════════════════════════════════════════════════════════════ */}
        <div ref={sec17Ref as React.RefObject<HTMLDivElement>} style={{ scrollMarginTop: '20px' }}>
          <h2 style={S.sectionTitle}>Examples</h2>
          <div style={S.divider} />

          <p style={S.p}>
            The fastest way to learn is to open something that already works and pull it apart. Below are example shaders organized by difficulty. Each one opens directly in the Studio — all nodes wired, all parameters exposed, ready to tweak.
          </p>

          <h3 style={S.subTitle}>Beginner</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>UV Gradient</strong> — wire UV directly to Output and explore what the raw coordinates look like as color.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Animated Circle</strong> — sdCircle with a time-driven radius. Introduction to SDF rendering.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>IQ Palette Demo</strong> — IQPalette node fed by a Sin node. Shows all four parameter knobs and how they shift the color cycle.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Grid Tiles</strong> — Fract transform to tile UV, then any SDF evaluated in the tiled space.</li>
          </ul>

          <h3 style={S.subTitle}>Intermediate</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Mandala</strong> — polar mirror trick inside an ExprBlock, combined with SmoothUnion of several SDFs.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>FBM Lava</strong> — FBM noise domain-warped by a second FBM call, colored with IQ Palette. Classic organic look.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Particle Loop</strong> — LoopStart/LoopEnd accumulating 20 point lights, each offset by Voronoi coordinates.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Audio Equalizer</strong> — AudioInput with multiple frequency bands driving bar heights in a SDF boolean composition.</li>
          </ul>

          <h3 style={S.subTitle}>Advanced</h3>
          <ul style={S.ul}>
            <li style={S.li}><strong style={{ color: T.textBold }}>Raymarched Torus</strong> — full Scene Group with three 3D SDFs, MarchCamera, and RayMarchLit. Demonstrates all the 3D pipeline steps.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Feedback Zoom Tunnel</strong> — PrevFrame with 0.995× UV scale feeding back into itself. AudioInput drives the blend factor.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Julia Set Explorer</strong> — Julia fractal node with mouse-controlled <C>c</C> parameter and IQ Palette iteration coloring.</li>
            <li style={S.li}><strong style={{ color: T.textBold }}>Volumetric March Loop</strong> — SpaceWarpGroup inside a March Loop Group for volumetric fog accumulation along each ray.</li>
          </ul>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '16px' }}>
            <TryIt exampleKey="uv-gradient" label="UV Gradient" onTry={tryExample} />
            <TryIt exampleKey="animated-circle" label="Animated Circle" onTry={tryExample} />
            <TryIt exampleKey="iq-palette-demo" label="IQ Palette Demo" onTry={tryExample} />
            <TryIt exampleKey="mandala" label="Mandala" onTry={tryExample} />
            <TryIt exampleKey="fbm-lava" label="FBM Lava" onTry={tryExample} />
            <TryIt exampleKey="3d-torus" label="Raymarched Torus" onTry={tryExample} />
            <TryIt exampleKey="feedback-tunnel" label="Feedback Zoom Tunnel" onTry={tryExample} />
            <TryIt exampleKey="julia-set" label="Julia Set Explorer" onTry={tryExample} />
          </div>
        </div>

        {/* Bottom padding */}
        <div style={{ height: '80px' }} />
      </main>
    </div>
  );
}
