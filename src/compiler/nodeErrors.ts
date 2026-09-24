/**
 * Maps compile problems back to the nodes that caused them, so a card can show its own error
 * instead of the message living only in the global error panel.
 *
 * Two sources:
 * - Graph validation (validate.ts): `Node <id> [source:<id>]: …`, naming the input for type
 *   mismatches.
 * - GLSL compile logs: `ERROR: 0:<line>: …`. The line is looked up in the shader source that
 *   failed. A node's variables are named after its slug (`circ_3_dist`), so the owning node is the
 *   first slug found on that line or the lines above it. That covers a Custom Fn body, which is
 *   inlined after its `<slug>_result` declaration.
 *
 * Only nodes at the level being shown are in the slug map; an error inside a group is reported on
 * the group itself, whose slug prefixes everything compiled for it.
 */

export interface NodeError {
  message: string;
  /** Input socket key to paint red, when the error is about one input */
  socket?: string;
}

/** How far above an error line to look for the node that owns it */
const SCAN_UP_LINES = 60;

const TYPE_MISMATCH = /^type mismatch on input "([^"]+)"\. Expected (\w+), got (\w+)/;

function push(map: Map<string, NodeError[]>, nodeId: string, err: NodeError) {
  const list = map.get(nodeId);
  if (!list) { map.set(nodeId, [err]); return; }
  if (!list.some(e => e.message === err.message && e.socket === err.socket)) list.push(err);
}

/** "ERROR: 0:123: 'foo' : undeclared identifier" → { line: 123, text: "'foo' : undeclared identifier" } */
function parseGlslError(raw: string): { line: number; text: string } | null {
  const m = raw.match(/^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/);
  if (!m) return null;
  return { line: Number(m[1]), text: m[2].trim() };
}

/** Plain-language version of a driver message, keeping the offending token */
function friendlyGlsl(text: string): string {
  const m = text.match(/^'([^']*)'\s*:\s*(.*)$/);
  if (!m) return text;
  const [, token, what] = m;
  if (/undeclared identifier/i.test(what)) return `“${token}” isn't defined`;
  // Drivers report both a misspelled function and wrong argument types this way
  if (/no matching overloaded function/i.test(what)) return `${token}() isn't a function that takes these arguments (check the name and types)`;
  if (/syntax error/i.test(what)) return token ? `Syntax error near “${token}”` : 'Syntax error';
  if (/cannot convert|wrong operand types|dimension mismatch/i.test(what)) return `Type mismatch at “${token}”: ${what}`;
  return token ? `${token}: ${what}` : what;
}

export function buildNodeErrors(opts: {
  compilationErrors: readonly string[];
  glslErrors: readonly string[];
  /** The fragment source the GLSL errors were reported against */
  glslSource: string | null;
  /** node id → compiled slug, for the nodes being displayed */
  slugs: ReadonlyMap<string, string>;
}): Map<string, NodeError[]> {
  const out = new Map<string, NodeError[]>();

  for (const err of opts.compilationErrors) {
    const m = err.match(/^Node (\S+?)(?:\s+\[source:(\S+?)\])?:\s*(.*)$/);
    if (!m) continue;
    const [, nodeId, sourceId, rest] = m;
    const mismatch = rest.match(TYPE_MISMATCH);
    if (mismatch) {
      const [, input, expected, got] = mismatch;
      push(out, nodeId, { message: `Expects ${expected} here but the wire brings ${got}`, socket: input });
      if (sourceId) push(out, sourceId, { message: `Its ${got} output is wired into a ${expected} input` });
    } else {
      push(out, nodeId, { message: rest.charAt(0).toUpperCase() + rest.slice(1) });
    }
  }

  if (opts.glslErrors.length > 0 && opts.glslSource && opts.slugs.size > 0) {
    const lines = opts.glslSource.split('\n');
    // Longest slug first, so `pattern_13_g_u_n_5` wins over `pattern_13` style prefixes
    const bySlug = [...opts.slugs.entries()]
      .map(([id, slug]) => ({ id, re: new RegExp(`\\b${slug.replace(/[^A-Za-z0-9_]/g, '')}_\\w`), len: slug.length }))
      .sort((a, b) => b.len - a.len);
    const ownerOf = (lineNo: number): string | null => {
      for (let i = lineNo - 1; i >= 0 && i >= lineNo - 1 - SCAN_UP_LINES; i--) {
        const text = lines[i];
        if (text === undefined) continue;
        const hit = bySlug.find(s => s.re.test(text));
        if (hit) return hit.id;
      }
      return null;
    };
    for (const raw of opts.glslErrors) {
      const parsed = parseGlslError(raw);
      if (!parsed) continue;
      const owner = ownerOf(parsed.line);
      if (owner) push(out, owner, { message: friendlyGlsl(parsed.text) });
    }
  }

  return out;
}
