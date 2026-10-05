/**
 * displace.js — the Displacement Map (After Effects' effect of that name),
 * shared by everything that displaces one picture by another:
 *
 *   - a layer's own Displace (kit.js): the layer is drawn alone, then its
 *     pixels are moved by a map (another layer drawn alone, hidden or not, or
 *     the picture) on a small WebGL2 canvas of the kit's own (dmCreate);
 *   - the Look's Displace effect with Push → By channels (finish.js);
 *   - Studio's Displacement Map node (nodes/definitions/passes.ts).
 *
 * The rules, as in After Effects:
 *   - Each direction reads one channel of the map at the point being drawn:
 *     red, green, blue, alpha, luminance, hue, lightness, saturation, or a
 *     fixed Full (1), Half (0.5) or Off.
 *   - Mid-grey (0.5) doesn't move anything; 1 moves by the full Max, 0 by
 *     minus Max. Max is in pixels of a 1080-pixel-tall picture, so a setup
 *     looks the same at every size. Positive Max moves the pixels right
 *     (horizontal) and up (vertical) where the map is bright; a negative Max
 *     turns that round.
 *   - The map's empty parts don't move anything: a colour channel fades to
 *     0.5 with the map's alpha (the Alpha channel reads alpha itself).
 *   - Map behaviour: Center reads the map where it lies on the picture;
 *     Stretch scales the map's visible part (its box) to cover the whole
 *     picture; Tile repeats that box across the picture.
 *   - Edges: Wrap pixels around reads from the other side of the picture;
 *     otherwise what comes from past the edge is empty (a layer) or the
 *     nearest edge pixel (the Look, a Studio texture).
 *
 * Every function here has a GLSL twin in DM_GLSL; the JS ones are the
 * reference the tests check. Part of the layer kit: exportHtml.ts inlines it
 * into web exports, so every top-level name keeps the `dm`/`DM_` prefix.
 */

/** The channels a direction can read, in the order the pickers list them. */
export const DM_CHANNELS = ['red', 'green', 'blue', 'alpha', 'luminance', 'hue', 'lightness', 'saturation', 'full', 'half', 'off'];
/** Names for the pickers. */
export const DM_CHANNEL_LABELS = { red: 'Red', green: 'Green', blue: 'Blue', alpha: 'Alpha', luminance: 'Luminance', hue: 'Hue', lightness: 'Lightness', saturation: 'Saturation', full: 'Full (1.0)', half: 'Half (0.5)', off: 'Off' };
/** How the map meets the picture. */
export const DM_BEHAVIOURS = ['center', 'stretch', 'tile'];
export const DM_BEHAVIOUR_LABELS = { center: 'Center map', stretch: 'Stretch map to fit', tile: 'Tile map' };
/** How sharp a layer's map is read: its full size, or drawn at half or a quarter of it first (cheaper; smooth maps look the same). */
export const DM_QUALITIES = ['full', 'half', 'quarter'];
export const DM_QUALITY_LABELS = { full: 'Full', half: 'Half', quarter: 'Quarter' };
/** The map's size for a quality: 1, 0.5 or 0.25 of the picture's. */
export function dmQualityScale(q) { return q === 'half' ? 0.5 : q === 'quarter' ? 0.25 : 1; }
/** Max displacement is in pixels of a picture this tall. */
export const DM_REF_HEIGHT = 1080;
/** The defaults (After Effects starts on Red and Green). */
export const DM_DEFAULTS = { h: 'red', v: 'green', behaviour: 'center', wrap: false, maxH: 50, maxV: 50 };

/** Plain-language help for every option (the "?" hints). */
export const DM_HINTS = {
  map: 'What pushes the pixels: another layer (it can be hidden and still work) or the picture under the layers.',
  h: 'Which part of the map moves pixels sideways. Mid-grey (0.5) stays put; brighter pushes right by up to Max horizontal, darker pushes left. Full always pushes the whole Max; Half and Off never push.',
  v: 'Which part of the map moves pixels up and down. Mid-grey (0.5) stays put; brighter pushes up by up to Max vertical, darker pushes down. Full always pushes the whole Max; Half and Off never push.',
  maxH: 'The furthest a pixel moves sideways, in pixels of a 1080-pixel-tall picture: where the channel is 1 it moves this far right, where it is 0 this far left. Negative turns it round.',
  maxV: 'The furthest a pixel moves up or down, in pixels of a 1080-pixel-tall picture: where the channel is 1 it moves this far up, where it is 0 this far down. Negative turns it round.',
  behaviour: 'Center reads the map where it lies on the picture. Stretch scales the map’s visible part to cover the whole picture. Tile repeats the map’s visible part across the picture. A full-picture map (the picture, a shader) looks the same in all three.',
  wrap: 'On: pixels pushed off one edge come back in from the other side (good with tiling maps). Off: what comes from past the edge is empty.',
  quality: 'How sharp the map is read. Half and Quarter draw it smaller first, which costs a fraction of the time on large pictures (most of all in Safari and the desktop app); a smooth map (waves, noise, a blurred shape) looks the same. Keep Full for a map with fine, sharp edges.',
  channels: 'Red, Green, Blue and Alpha read that channel. Luminance is how bright it looks; Hue is the colour round the wheel (red 0, green ⅓, blue ⅔); Lightness is halfway between the brightest and darkest of R, G, B; Saturation is how colourful it is.',
};

const dmClamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * One channel of a straight (not premultiplied) colour [r, g, b, a] (0..1).
 * Colour channels fade to 0.5 (no push) where the map is empty; Alpha reads
 * alpha itself. Unknown channels read 0.5.
 */
export function dmChannel(c, ch) {
  const r = c[0], g = c[1], b = c[2], a = c.length > 3 ? c[3] : 1;
  if (ch === 'alpha') return a;
  if (ch === 'full') return 1;
  if (ch === 'half' || ch === 'off') return 0.5;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let v;
  if (ch === 'red') v = r;
  else if (ch === 'green') v = g;
  else if (ch === 'blue') v = b;
  else if (ch === 'luminance') v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  else if (ch === 'lightness') v = l;
  else if (ch === 'saturation') { const d = mx - mn; v = d <= 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1) + 1e-6); }
  else if (ch === 'hue') {
    const d = mx - mn;
    if (d <= 1e-6) v = 0;
    else {
      let h = mx === r ? (g - b) / d : mx === g ? 2 + (b - r) / d : 4 + (r - g) / d;
      h /= 6; if (h < 0) h += 1;
      v = h;
    }
  } else return 0.5;
  return 0.5 + (dmClamp01(v) - 0.5) * dmClamp01(a);
}

/** The channel's index for the shaders (dmChan in DM_GLSL); unknown = off. */
export function dmChannelIndex(ch) {
  const i = DM_CHANNELS.indexOf(ch);
  return i < 0 ? DM_CHANNELS.indexOf('off') : i;
}

/**
 * How far a point moves, in picture uv (0..1 across and up): the two channel
 * values (0..1), the maxima (pixels of a 1080-tall picture) and the picture's
 * width / height. Mid-grey = 0.
 */
export function dmOffset(hVal, vVal, maxH, maxV, aspect) {
  return {
    x: (hVal - 0.5) * 2 * maxH / DM_REF_HEIGHT / Math.max(1e-6, aspect),
    y: (vVal - 0.5) * 2 * maxV / DM_REF_HEIGHT,
  };
}

/**
 * Where the map is read for the point `uv` (picture uv, y up), given the
 * map's visible box { x0, y0, x1, y1 } (uv; null = the whole picture) and the
 * behaviour. Center reads in place.
 */
export function dmMapUv(uv, box, behaviour) {
  if (!box || behaviour === 'center' || !(box.x1 > box.x0) || !(box.y1 > box.y0)) return { x: uv.x, y: uv.y };
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  if (behaviour === 'stretch') return { x: box.x0 + uv.x * w, y: box.y0 + uv.y * h };
  if (behaviour === 'tile') {
    const fx = ((uv.x - box.x0) / w) % 1, fy = ((uv.y - box.y0) / h) % 1;
    return { x: box.x0 + (fx < 0 ? fx + 1 : fx) * w, y: box.y0 + (fy < 0 ? fy + 1 : fy) * h };
  }
  return { x: uv.x, y: uv.y };
}

/**
 * Where the source is read for a point that moved by `off`: uv − off, wrapped
 * round when `wrap`, else null when it falls off the picture.
 */
export function dmSourceUv(uv, off, wrap) {
  let x = uv.x - off.x, y = uv.y - off.y;
  if (wrap) { x -= Math.floor(x); y -= Math.floor(y); return { x, y }; }
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}

/** A map's visible box from an RGBA grid (`w` × `h`, row 0 at the top): uv, y up; null when it is empty. */
export function dmBoxOf(grid, w, h, minAlpha = 6) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (grid[(j * w + i) * 4 + 3] < minAlpha) continue;
    if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
  }
  if (x1 < 0) return null;
  return { x0: x0 / w, x1: (x1 + 1) / w, y0: 1 - (y1 + 1) / h, y1: 1 - y0 / h };
}

/** A layer's or an effect's settings, checked: channels, behaviour, wrap, maxima (finite numbers). */
export function dmSettings(s) {
  const o = s || {};
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  return {
    h: DM_CHANNELS.includes(o.h) ? o.h : DM_DEFAULTS.h,
    v: DM_CHANNELS.includes(o.v) ? o.v : DM_DEFAULTS.v,
    behaviour: DM_BEHAVIOURS.includes(o.behaviour) ? o.behaviour : DM_DEFAULTS.behaviour,
    wrap: o.wrap === true,
    maxH: num(o.maxH, DM_DEFAULTS.maxH),
    maxV: num(o.maxV, DM_DEFAULTS.maxV),
  };
}

/**
 * The full effect on one point, CPU side (the reference the GPU passes follow):
 * `src(uv)` and `map(uv)` return straight [r, g, b, a] or null (empty).
 * Returns the source's colour at the displaced point, or null (empty).
 */
export function dmApplyAt(uv, src, map, s, aspect, box) {
  const st = dmSettings(s);
  const m = map(dmMapUv(uv, box || null, st.behaviour)) || [0, 0, 0, 0];
  const off = dmOffset(dmChannel(m, st.h), dmChannel(m, st.v), st.maxH, st.maxV, aspect);
  const at = dmSourceUv(uv, off, st.wrap);
  return at ? src(at) : null;
}

/**
 * The GLSL twins, valid in GLSL ES 1.00 and 3.00 (no texture reads): `dmChan`
 * picks a channel of a straight colour by index (DM_CHANNELS order), `dmMapUv`
 * applies a behaviour (0 center, 1 stretch, 2 tile) with a box (x0, y0, x1, y1).
 */
export const DM_GLSL = `float dmHue(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
  if (d <= 1e-6) return 0.0;
  float h = mx == c.r ? (c.g - c.b) / d : (mx == c.g ? 2.0 + (c.b - c.r) / d : 4.0 + (c.r - c.g) / d);
  h /= 6.0;
  return h < 0.0 ? h + 1.0 : h;
}
float dmChan(vec4 c, float k) {
  if (k > 8.5) return 0.5;
  if (k > 7.5) return 1.0;
  if (k > 2.5 && k < 3.5) return c.a;
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), l = (mx + mn) * 0.5;
  float v = k < 0.5 ? c.r : k < 1.5 ? c.g : k < 2.5 ? c.b : k < 4.5 ? dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))
    : k < 5.5 ? dmHue(c.rgb) : k < 6.5 ? l : (mx - mn <= 1e-6 ? 0.0 : (mx - mn) / (1.0 - abs(2.0 * l - 1.0) + 1e-6));
  return 0.5 + (clamp(v, 0.0, 1.0) - 0.5) * clamp(c.a, 0.0, 1.0);
}
vec2 dmMapUv(vec2 uv, vec4 box, float behaviour) {
  vec2 lo = box.xy, sz = box.zw - box.xy;
  if (behaviour < 0.5 || sz.x <= 0.0 || sz.y <= 0.0) return uv;
  if (behaviour < 1.5) return lo + uv * sz;
  return lo + fract((uv - lo) / sz) * sz;
}
vec2 dmOffset(float h, float v, vec2 maxPx, float aspect) {
  return vec2((h - 0.5) * 2.0 * maxPx.x / ${DM_REF_HEIGHT.toFixed(1)} / max(aspect, 1e-6), (v - 0.5) * 2.0 * maxPx.y / ${DM_REF_HEIGHT.toFixed(1)});
}
`;

/** One channel of a straight vec4 GLSL expression `c`, as an expression (a channel known when compiling). */
export function dmChannelGlsl(ch, c) {
  if (ch === 'full') return '1.0';
  if (ch === 'half' || ch === 'off' || !DM_CHANNELS.includes(ch)) return '0.5';
  return `dmChan(${c}, ${dmChannelIndex(ch).toFixed(1)})`;
}

// ── The kit's pass: a layer's pixels moved by a map, on the GPU ─────────────

const DM_VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// The source and the map arrive one of two ways (dmCreate's upload modes): a canvas uploaded
// flipped (the source premultiplied, the map straight), or a canvas's bytes (getImageData:
// straight, rows top down). A straight source is premultiplied texel by texel before it is
// filtered, so both ways read the same picture.
const DM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc, uMap;
uniform float uHasMap, uH, uV, uBehaviour, uWrap, uAspect, uSrcBytes, uMapBytes;
uniform vec2 uMax;
uniform vec4 uBox;
${DM_GLSL}
vec4 dmPm(vec4 c) { return vec4(c.rgb * c.a, c.a); }
vec4 dmSrcAt(vec2 q) {
  if (uSrcBytes < 0.5) return texture(uSrc, q);
  ivec2 n = textureSize(uSrc, 0), hi = n - 1;
  vec2 p = vec2(q.x, 1.0 - q.y) * vec2(n) - 0.5, f = p - floor(p);
  ivec2 i = ivec2(floor(p));
  vec4 a = dmPm(texelFetch(uSrc, clamp(i, ivec2(0), hi), 0));
  vec4 b = dmPm(texelFetch(uSrc, clamp(i + ivec2(1, 0), ivec2(0), hi), 0));
  vec4 c = dmPm(texelFetch(uSrc, clamp(i + ivec2(0, 1), ivec2(0), hi), 0));
  vec4 d = dmPm(texelFetch(uSrc, clamp(i + ivec2(1, 1), ivec2(0), hi), 0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  // No map (it is missing, or loops back here): mid-grey everywhere, nothing moves.
  vec2 mq = dmMapUv(vUv, uBox, uBehaviour);
  if (uMapBytes > 0.5) mq.y = 1.0 - mq.y;
  vec4 m = uHasMap > 0.5 ? texture(uMap, mq) : vec4(0.5);
  vec2 d = dmOffset(dmChan(m, uH), dmChan(m, uV), uMax, uAspect);
  vec2 q = vUv - d;
  if (uWrap > 0.5) q = fract(q);
  else if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { o = vec4(0.0); return; }
  o = dmSrcAt(q);
}`;

/**
 * How a 2D canvas reaches the GPU in this browser (see dmCreate): 'pixels' (its
 * bytes, getImageData) in WebKit (Safari, the desktop app's web view, every
 * iOS browser), where texImage2D(canvas) reads the canvas back and converts it
 * on the CPU; 'canvas' elsewhere, where that upload is a copy on the GPU and a
 * getImageData would stall it.
 */
export function dmUploadModeFor(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  return /AppleWebKit\//.test(ua) && !/(Chrome|Chromium)\//.test(ua) ? 'pixels' : 'canvas';
}

/**
 * A GPU displacer with a WebGL2 canvas of its own (made on first use). Each
 * `apply` draws `src` (a canvas) moved by `map` (a canvas or null: nothing
 * moves) at W × H and returns the GL canvas to draw from at once, or null
 * without WebGL2 (the layer then draws unmoved).
 * opts: { h, v, behaviour, wrap, maxH, maxV, box }.
 *
 * Getting a 2D canvas into a texture is most of the cost, and browsers differ:
 * texImage2D(canvas) is a GPU copy in Chrome, but WebKit (Safari, the desktop
 * app) reads the canvas back and converts it on the CPU (about 6 ms for a
 * 1500 × 1300 layer, twice a frame: the layer and its map). There, its
 * getImageData and an upload of the bytes take about a third of that, so the
 * mode follows the browser (dmUploadModeFor). Timing both on the first frames
 * was tried: those frames are too noisy (shader compiles, fonts) to choose by.
 */
export function dmCreate() {
  let canvas = null, gl = null, prog = null, failed = false;
  let srcTex = null, mapTex = null, buf = null;
  let mode = dmUploadModeFor(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  let scratch = null; // a 2D canvas a non-2D map (the picture's WebGL canvas) is copied into, in 'pixels' mode
  const locs = {};
  function init() {
    if (gl || failed) return !!gl;
    try {
      canvas = typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false });
    } catch (e) { gl = null; }
    if (!gl) { failed = true; return false; }
    const sh = (type, code) => { const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const vs = sh(gl.VERTEX_SHADER, DM_VERT), fs = sh(gl.FRAGMENT_SHADER, DM_FRAG);
    if (!vs || !fs) { failed = true; gl = null; return false; }
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { failed = true; gl = null; return false; }
    for (const n of ['uSrc', 'uMap', 'uHasMap', 'uH', 'uV', 'uBehaviour', 'uWrap', 'uAspect', 'uMax', 'uBox', 'uSrcBytes', 'uMapBytes']) locs[n] = gl.getUniformLocation(prog, n);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const tex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    srcTex = tex(); mapTex = tex();
    return true;
  }
  // 'canvas' mode: the canvas itself, flipped (and the source premultiplied) as it is uploaded.
  function upload(tex, img, premultiply) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }
  // 'pixels' mode: the canvas's bytes (straight, rows top down), as they are. A canvas without a
  // 2D context (the picture's WebGL canvas, an image) is copied into a 2D canvas of our own first.
  function uploadBytes(tex, img) {
    let x = null;
    try { x = typeof img.getContext === 'function' ? img.getContext('2d') : null; } catch (e) { x = null; }
    const w = img.width, h = img.height;
    if (!x) {
      if (!scratch) scratch = typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
      x = scratch.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'copy';
      x.drawImage(img, 0, 0);
      x.globalCompositeOperation = 'source-over';
    }
    const data = x.getImageData(0, 0, w, h).data;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }
  return {
    apply(src, map, opts, W, H) {
      if (!init()) return null;
      const s = dmSettings(opts);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      gl.viewport(0, 0, W, H);
      gl.useProgram(prog);
      const m = mode;
      gl.activeTexture(gl.TEXTURE0);
      if (m === 'pixels') uploadBytes(srcTex, src); else upload(srcTex, src, true);
      gl.activeTexture(gl.TEXTURE1);
      if (!map) gl.bindTexture(gl.TEXTURE_2D, mapTex);
      else if (m === 'pixels') uploadBytes(mapTex, map); else upload(mapTex, map, false);
      gl.uniform1i(locs.uSrc, 0); gl.uniform1i(locs.uMap, 1);
      gl.uniform1f(locs.uSrcBytes, m === 'pixels' ? 1 : 0);
      gl.uniform1f(locs.uMapBytes, m === 'pixels' && map ? 1 : 0);
      gl.uniform1f(locs.uHasMap, map ? 1 : 0);
      gl.uniform1f(locs.uH, dmChannelIndex(s.h)); gl.uniform1f(locs.uV, dmChannelIndex(s.v));
      gl.uniform1f(locs.uBehaviour, DM_BEHAVIOURS.indexOf(s.behaviour));
      gl.uniform1f(locs.uWrap, s.wrap ? 1 : 0);
      gl.uniform1f(locs.uAspect, W / Math.max(1, H));
      gl.uniform2f(locs.uMax, s.maxH, s.maxV);
      const b = opts && opts.box;
      gl.uniform4f(locs.uBox, b ? b.x0 : 0, b ? b.y0 : 0, b ? b.x1 : 1, b ? b.y1 : 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return canvas;
    },
    /** The upload mode in use: 'canvas' or 'pixels'. */
    get mode() { return mode; },
    /** Use one upload mode from now on (a parity check); anything else goes back to the browser's. */
    setMode(next) { mode = next === 'canvas' || next === 'pixels' ? next : dmUploadModeFor(typeof navigator !== 'undefined' ? navigator.userAgent : ''); },
    dispose() {
      if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
      gl = null; canvas = null; failed = false; scratch = null;
    },
  };
}
