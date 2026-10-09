/**
 * The Agent Builder's start page pictures (agentBuilder/miniSim.ts): each kind's motion, moving
 * while the page is open. The presets' thumbnails are in presetThumbs.ts.
 */
import { useEffect, useRef } from 'react';
import type { StartKind } from '../../agentBuilder/kinds';
import { TrailSim, dotsFor, miniRandom, stepFlock, stepOrbit, stepParticles, walkersFor, type Dot } from '../../agentBuilder/miniSim';

const BG: [number, number, number] = [13, 13, 18];

// ── Start page: a moving picture per kind ───────────────────────────────────

/** A start-page card's picture, moving while it is on screen. */
export function KindPicture({ kind, width = 240, height = 136, accent = '#ffcf7a' }: { kind: StartKind; width?: number; height?: number; accent?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let raf = 0;
    let alive = true;
    const W = c.width, H = c.height;
    if (kind === 'trail') {
      const gw = 220, gh = Math.round(220 * H / W);
      const sim = new TrailSim(gw, gh, walkersFor(gw, gh), {
        edges: 'wrap', halfLife: 0.06, diffuse: 1,
        species: [{ distance: 0.035, angle: 22.5, turn: 45, away: false, wobble: 7, speed: 0.22, smell: 0, lay: 0, deposit: 1, colour: [1, 0.82, 0.48] }],
      }, 5);
      for (let i = 0; i < 60; i++) sim.step();
      const img = ctx.createImageData(gw, gh);
      const off = document.createElement('canvas');
      off.width = gw; off.height = gh;
      const octx = off.getContext('2d')!;
      const frame = () => {
        if (!alive) return;
        {
          sim.step(); sim.step();
          sim.draw(img.data, BG);
          octx.putImageData(img, 0, 0);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(off, 0, 0, W, H);
        }
        raf = requestAnimationFrame(frame);
      };
      frame();
    } else {
      const rand = miniRandom(11);
      const n = kind === 'particles' ? 220 : kind === 'flock' ? 70 : 260;
      const dots: Dot[] = dotsFor(kind, n);
      // Run a little first, so the very first frame already shows the motion's shape.
      for (let i = 0; i < 90; i++) {
        if (kind === 'particles') stepParticles(dots, 1 / 60, rand);
        else if (kind === 'flock') stepFlock(dots, 1 / 60);
      }
      const frame = () => {
        if (!alive) return;
        {
          const dt = 1 / 60;
          if (kind === 'particles') stepParticles(dots, dt, rand);
          else if (kind === 'flock') stepFlock(dots, dt);
          else stepOrbit(dots, dt);
          ctx.fillStyle = kind === 'orbit' ? 'rgba(13,13,18,0.16)' : 'rgb(13,13,18)';
          ctx.fillRect(0, 0, W, H);
          // Particles and orbiters in a square space centred in the card; the flock wraps round the whole card.
          const ox = (W - H) / 2, k = W / 240;
          for (const d of dots) {
            const x = kind === 'flock' ? d.x * W : ox + d.x * H, y = H - d.y * H;
            if (kind === 'flock') {
              const a = Math.atan2(-d.vy, d.vx);
              ctx.save(); ctx.translate(x, y); ctx.rotate(a);
              ctx.fillStyle = accent; ctx.beginPath(); ctx.scale(k, k); ctx.moveTo(5, 0); ctx.lineTo(-4, 3); ctx.lineTo(-2, 0); ctx.lineTo(-4, -3); ctx.closePath(); ctx.fill();
              ctx.restore();
            } else {
              const life = kind === 'particles' ? Math.max(0, 1 - d.age / 2) : 1;
              ctx.fillStyle = kind === 'particles' ? `rgba(255,${Math.round(150 + 90 * life)},${Math.round(80 * life)},${life})` : accent;
              ctx.beginPath(); ctx.arc(x, y, (kind === 'particles' ? 2.4 : 1.6) * k, 0, Math.PI * 2); ctx.fill();
            }
          }
        }
        raf = requestAnimationFrame(frame);
      };
      frame();
    }
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [kind, accent]);
  return <canvas ref={ref} width={width * 2} height={height * 2} data-kind-picture={kind} style={{ width: '100%', height: 'auto', aspectRatio: `${width} / ${height}`, display: 'block', borderRadius: 10, background: 'rgb(13,13,18)' }} />;
}
