/**
 * What the notebook's autocomplete offers: the names every cell has, the
 * table methods after `df.` (and `data.`), the dataset's column names, Math
 * after `Math.`, and JavaScript keywords.
 */
import type { Completion } from '../code/glslReference';
import type { MemberCompletions } from '../code/useCompletion';
import { refToCompletion } from '../play/layers/scriptCompletions';
import { DATA_REFERENCE, TABLE_METHODS } from '../../data/dataReference';

const KEYWORDS = ['const', 'let', 'function', 'return', 'if', 'else', 'for', 'of', 'in', 'true', 'false', 'null', 'new', 'Math', 'Object', 'Array', 'Number', 'String'];
const MATH = ['abs', 'sin', 'cos', 'atan2', 'sqrt', 'pow', 'hypot', 'floor', 'ceil', 'round', 'min', 'max', 'sign', 'exp', 'log', 'PI'];

const TOP: Completion[] = DATA_REFERENCE.flatMap(g => g.items).filter(it => !it.name.includes('.') && !it.name.includes('[')).map(it => refToCompletion(it));
const METHODS: Completion[] = TABLE_METHODS.map(it => refToCompletion(it, it.name.slice(3)));
const MATH_C: Completion[] = MATH.map(n => (n === 'PI' ? { kind: 'const', name: n, doc: 'π.', insert: n } : { kind: 'fn', name: n, detail: '()', doc: `Math.${n}.`, insert: `${n}()` }));

export function dataCompletions(columns: readonly string[]): { all: Completion[]; members: MemberCompletions } {
  const cols: Completion[] = columns.filter(c => /^[A-Za-z_$][\w$]*$/.test(c)).map(c => ({ kind: 'var', name: c, type: 'column', doc: 'A column of the dataset.', insert: c }));
  return {
    all: [...TOP, ...cols, ...KEYWORDS.map(k => ({ kind: 'keyword' as const, name: k, insert: k }))],
    members: { df: METHODS, data: METHODS, Math: MATH_C, r: cols, row: cols },
  };
}
