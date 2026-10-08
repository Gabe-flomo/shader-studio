/**
 * surpriseActions.ts — the Scene Builder's Surprise me, Random shape and Randomise this
 * (docs/surprise.md), each one undo step of the builder's form, with its seed in a toast that
 * offers Reroll and Undo.
 *
 * Surprise me draws the scene once, small, on a WebGL2 canvas of its own (the same graph and
 * shaders as the preview), reads the frame back and turns it down when it is blank, blown out or
 * flat (lib/surprise degenerateReason), trying the next seed, up to four times.
 */
import { create } from 'zustand';
import { degenerateReason, frameStats, makeRng, withRetriesAsync, type FrameStats } from '../../lib/surprise';
import { useSceneBuilder } from '../../sceneBuilder/store';
import { addRandomShape, randomiseItem, surpriseScene } from '../../sceneBuilder/surprise';
import { allShapes, findItem, itemName, type SceneSpec } from '../../sceneBuilder/spec';
import { compileSpec, makeProgram } from './previewGl';
import { announceSurprise } from '../surprise/announce';
import { newSeed } from '../../lib/surprise';

/** The last seed each Scene Builder control used (shown in its seed field). */
export const useSceneSurprise = create<{ seed: number | null; busy: boolean }>(() => ({ seed: null, busy: false }));

const W = 96, H = 64;

/**
 * The frame stats of `spec` drawn at 96 × 64, `t` seconds in. Null when WebGL2 isn't there (a
 * test, an old browser): the check is skipped. A scene that doesn't compile reads as blank.
 */
export function sceneFrameStats(spec: SceneSpec, t = 0.5): FrameStats | null {
  if (typeof document === 'undefined') return null;
  const c = compileSpec(spec);
  if (c.error) return { clipped: 0, black: 1, flat: true, mean: 0, spread: 0 };
  return programFrameStats(c.vs, c.fs, c.uniforms, t);
}

/**
 * The frame stats of a compiled graph's shaders drawn at 96 × 64, `t` seconds in (the Do bar's
 * Surprise uses it too). Null without WebGL2; a shader that doesn't compile reads as blank.
 */
export function programFrameStats(vs: string, fs: string, uniforms: Record<string, number | number[]>, t = 0.5): FrameStats | null {
  const px = programPixels(vs, fs, uniforms, [t], W, H);
  if (px === null) return null;
  if (px === 'error') return { clipped: 0, black: 1, flat: true, mean: 0, spread: 0 };
  return frameStats(px[0], W, H);
}

/**
 * A compiled graph's shaders drawn at `w` × `h`, once per time in `times`, as RGBA bytes (one WebGL2
 * context for all of them). Null without WebGL2; 'error' when the shader doesn't compile.
 */
export function programPixels(vs: string, fs: string, uniforms: Record<string, number | number[]>, times: number[], w = W, h = H): Uint8Array[] | 'error' | null {
  return programFrames(vs, fs, times.map(t => ({ uniforms, t })), w, h);
}

/**
 * Frames of one compiled program, each with its own uniforms and time, drawn on one WebGL2 context
 * (Randomize's Focus renders a graph with each setting nudged this way). `stop` is asked before
 * each frame; when true the frames drawn so far are returned. Null without WebGL2; 'error' when
 * the shader doesn't compile.
 */
export function programFrames(vs: string, fs: string, frames: Array<{ uniforms: Record<string, number | number[]>; t: number }>, w = W, h = H, stop?: () => boolean): Uint8Array[] | 'error' | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  try {
    const prog = makeProgram(gl, vs, fs);
    if (typeof prog === 'string') return 'error';
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 0, 1, -1, 0, 1, 0, -1, 1, 0, 0, 1, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posLoc = gl.getAttribLocation(prog, 'position'), uvLoc = gl.getAttribLocation(prog, 'uv');
    if (posLoc >= 0) { gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 20, 0); }
    if (uvLoc >= 0) { gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 20, 12); }
    gl.useProgram(prog);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_resolution'), w, h);
    gl.viewport(0, 0, w, h);
    const out: Uint8Array[] = [];
    for (const f of frames) {
      if (stop?.()) break;
      for (const [name, v] of Object.entries(f.uniforms)) {
        const loc = gl.getUniformLocation(prog, name);
        if (!loc) continue;
        if (typeof v === 'number') gl.uniform1f(loc, v);
        else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
        else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
      }
      gl.uniform1f(gl.getUniformLocation(prog, 'u_time'), f.t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push(px);
    }
    gl.deleteProgram(prog); gl.deleteBuffer(buf); gl.deleteVertexArray(vao);
    return out;
  } catch {
    return null;
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Why a scene isn't worth showing (blank, blown out, flat), or null. The test stand-in: no GPU, no check. */
export function sceneJudge(spec: SceneSpec): string | null {
  const s = sceneFrameStats(spec);
  // The background alone is flat; most of a frame of background is fine as long as something shows.
  return s ? degenerateReason(s, { minSpread: 0.015 }) : null;
}

/** Surprise me: a whole random scene from `seed` (retried while degenerate), one undo step. */
export async function surpriseSceneAction(seed: number): Promise<void> {
  useSceneSurprise.setState({ busy: true });
  // Let the button show it is busy before the first compile.
  await new Promise(r => setTimeout(r, 0));
  try {
    const res = await withRetriesAsync({ seed, tries: 4, make: rng => surpriseScene(rng), judge: spec => sceneJudge(spec) });
    const sb = useSceneBuilder.getState();
    sb.replace(res.value);
    useSceneBuilder.getState().select(res.value.root.children[0]?.id ?? null);
    useSceneSurprise.setState({ seed: res.seed });
    const after = useSceneBuilder.getState().spec;
    const shapes = allShapes(res.value).length;
    announceSurprise({
      title: 'Surprise scene', seed: res.seed,
      message: `${shapes} shape${shapes === 1 ? '' : 's'}, ${res.value.look.mode === 'gi' ? 'GI lit' : res.value.look.mode}${res.rejected.length ? ` · skipped ${res.rejected.length} (${res.rejected.map(r => r.why).join(', ')})` : ''}. Type the seed to make it again.`,
      stillCurrent: () => useSceneBuilder.getState().spec === after,
      undo: () => useSceneBuilder.getState().undo(),
      reroll: () => { useSceneBuilder.getState().undo(); void surpriseSceneAction(newSeed()); },
    });
  } finally {
    useSceneSurprise.setState({ busy: false });
  }
}

/** Random shape: one random shape beside the selection, one undo step. */
export function randomShapeAction(seed = newSeed()): void {
  const sb = useSceneBuilder.getState();
  let id = '';
  sb.edit(d => { id = addRandomShape(d, sb.selectedId, makeRng(seed)); });
  useSceneBuilder.getState().select(id);
  useSceneSurprise.setState({ seed });
  const after = useSceneBuilder.getState().spec;
  const hit = findItem(after, id);
  announceSurprise({
    title: `Random ${hit ? itemName(after, hit.item) : 'shape'}`, seed,
    stillCurrent: () => useSceneBuilder.getState().spec === after,
    undo: () => useSceneBuilder.getState().undo(),
    reroll: () => { useSceneBuilder.getState().undo(); randomShapeAction(newSeed()); },
  });
}

/** Randomise this: new settings for the selected item (the whole scene: look and camera), one undo step. */
export function randomiseThisAction(itemId: string, seed = newSeed()): void {
  const sb = useSceneBuilder.getState();
  const hit = findItem(sb.spec, itemId);
  if (!hit) return;
  sb.edit(d => { randomiseItem(d, itemId, makeRng(seed)); });
  useSceneSurprise.setState({ seed });
  const after = useSceneBuilder.getState().spec;
  announceSurprise({
    title: `Randomised ${itemName(after, hit.item)}`, seed,
    stillCurrent: () => useSceneBuilder.getState().spec === after,
    undo: () => useSceneBuilder.getState().undo(),
    reroll: () => { useSceneBuilder.getState().undo(); randomiseThisAction(itemId, newSeed()); },
  });
}
