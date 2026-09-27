/**
 * The Data notebook's reference: every name a cell can use and every table
 * method (src/data/table.ts), with parameters, what it returns and an
 * example. The editor's Reference tab lists it and autocomplete reads it.
 */
import type { RefArg, RefGroup, RefItem } from '../components/play/layers/scriptReference';

type A = [name: string, type: string, doc: string];
const arg = ([name, type, doc]: A): RefArg => (name.endsWith('?') ? { name: name.slice(0, -1), type, doc, optional: true } : { name, type, doc });
const fn = (name: string, args: A[], type: string, doc: string, example: string, extra: Partial<RefItem> = {}): RefItem => ({ name, args: args.map(arg), type, doc, example, ...extra });
const val = (name: string, type: string, doc: string, example: string): RefItem => ({ name, type, doc, example });

const COLS: A = ['...cols', 'string', 'Column names, or one array of them.'];
const COL: A = ['col', 'string', 'A column name.'];
const TEST: A = ['test', 'function | string', 'A function of the row, r => r.temp > 20, or an expression with column names as variables: \'temp > 20\'.'];

export const DATA_REFERENCE: RefGroup[] = [
  { title: 'In every cell', items: [
    val('df', 'table', 'The imported table (CSV, TSV, or JSON records). Change it by assigning: df = df.where(…).', 'df = df.where(r => r.temp > 20)'),
    val('data', 'table | string | value', 'The file as it came in: the table, the text of a text file, or the JSON value.', 'data.split(\'\\n\').length'),
    val('result', 'any', 'Set it to choose the dataset. Without it, the last value of the last cell is used.', 'result = df.groupby(\'city\').mean(\'temp\')'),
    fn('table', [['input', 'records | columns', 'An array of records, [{ x: 1 }, …], or an object of column arrays, { x: [1, 2] }.']], 'table', 'Make a new table.', 'table([{ x: 0, y: 0 }, { x: 1, y: 1 }])'),
    fn('random', [['seed?', 'number', 'Same seed, same numbers (1 by default).']], 'function', 'A seeded random generator: call it for numbers in 0…1.', 'const rnd = random(4)\ndf.assign({ jitter: () => rnd() })'),
    fn('print', [['...values', 'any', 'What to show under the cell.']], 'nothing', 'Show values under the cell (console.log works too).', 'print(df.length, df.columns)'),
  ] },
  { title: 'Reading a table', items: [
    val('df[\'col\']', 'array', 'A column as an array. df.col(\'col\') is the same, and works when a column is named like a method.', 'df[\'temp\']'),
    fn('df.col', [COL], 'array', 'A column as an array.', 'Math.max(...df.col(\'temp\'))'),
    val('df.columns', 'string[]', 'The column names, in order.', 'df.columns'),
    val('df.length', 'number', 'How many rows.', 'df.length'),
    val('df.shape', '[rows, columns]', 'The size, like pandas.', 'df.shape'),
    fn('df.row', [['i', 'number', 'Row number, 0 first.']], 'object', 'One row as an object.', 'df.row(0).city'),
    fn('df.records', [], 'object[]', 'Every row as an object.', 'df.records().map(r => r.x + r.y)'),
    fn('df.map', [['fn', 'function', 'A function of the row (and its index).']], 'array', 'A function of each row, as an array.', 'df.map(r => r.x * r.y)'),
  ] },
  { title: 'Choosing rows and columns', items: [
    fn('df.where', [TEST], 'table', 'The rows that pass. filter() is the same.', 'df.where(\'temp > 20 && city != "Oslo"\')'),
    fn('df.select', [COLS], 'table', 'Only these columns, in this order.', 'df.select(\'x\', \'y\')'),
    fn('df.drop', [COLS], 'table', 'Without these columns.', 'df.drop(\'notes\')'),
    fn('df.rename', [['map', 'object', '{ old: \'new\' } pairs.']], 'table', 'Rename columns.', 'df.rename({ temperature: \'temp\' })'),
    fn('df.head', [['n?', 'number', 'How many (5).']], 'table', 'The first rows.', 'df.head(10)'),
    fn('df.tail', [['n?', 'number', 'How many (5).']], 'table', 'The last rows.', 'df.tail(3)'),
    fn('df.slice', [['start', 'number', 'First row.'], ['end?', 'number', 'Up to (not including); negative counts from the end.']], 'table', 'A range of rows.', 'df.slice(10, 20)'),
    fn('df.sample', [['n', 'number', 'How many rows.'], ['seed?', 'number', 'Same seed, same rows (1).']], 'table', 'Rows picked at random, without repeats.', 'df.sample(100, 7)'),
    fn('df.dropna', [COLS], 'table', 'Without rows missing a value (in any column, or the ones named).', 'df.dropna(\'temp\')'),
  ] },
  { title: 'Changing values', items: [
    fn('df.assign', [['spec', 'object', '{ name: r => …, other: [array], constant: 1 }. Evaluated in order.']], 'table', 'Add or replace columns.', 'df.assign({ f: r => r.temp * 9 / 5 + 32 })'),
    fn('df.sort', [['by', 'string | string[] | function', 'Column(s), or a function of the row.'], ['options?', '{ descending }', 'Largest first with { descending: true }.']], 'table', 'Sorted rows; missing values last.', 'df.sort(\'price\', { descending: true })'),
    fn('df.normalize', [COLS], 'table', 'Number columns (all, or the ones named) mapped from min…max to 0…1.', 'df.normalize(\'x\', \'y\')'),
    fn('df.fillna', [['value', 'any | object', 'One value for every column, or { col: value }.']], 'table', 'Fill missing values.', 'df.fillna({ rain: 0 })'),
    fn('df.concat', [['other', 'table | records', 'Rows to add after these.']], 'table', 'This table\'s rows then another\'s (columns matched by name).', 'df.concat(table([{ x: 0, y: 0 }]))'),
  ] },
  { title: 'Summaries', items: [
    fn('df.groupby', [['by', 'string | string[]', 'The column(s) to group by.'], ['options?', '{ sort }', 'Groups sorted by key unless { sort: false }.']], 'groups', 'Rows grouped by value. Follow with .mean(\'col\'), .sum, .count, .min, .max, .median, .std, .first, .last, .size() or .agg({ col: \'mean\' }). Without a column, every number column.', 'df.groupby(\'city\').mean(\'temp\')'),
    fn('groups.agg', [['spec', 'object', '{ col: \'mean\' | \'sum\' | \'count\' | \'min\' | \'max\' | \'median\' | \'std\' | \'first\' | \'last\' | values => … }']], 'table', 'A different summary per column.', 'df.groupby(\'month\').agg({ temp: \'max\', rain: \'sum\' })'),
    fn('df.describe', [COLS], 'table', 'count, mean, std, min, 25%, 50%, 75% and max of each number column.', 'df.describe()'),
    fn('df.unique', [COL], 'array', 'The distinct values, in order of first appearance.', 'df.unique(\'city\')'),
    fn('df.valueCounts', [COL], 'table', 'How often each value appears, most common first.', 'df.valueCounts(\'city\')'),
    fn('df.mean', [COL], 'number', 'The mean of a column. Also sum, min, max, median, std.', 'df.mean(\'temp\')'),
  ] },
  { title: 'Clusters', items: [
    fn('df.kmeans', [['cols', 'string | string[]', 'The number columns to cluster on.'], ['k', 'number', 'How many clusters.'], ['options?', '{ seed, iterations, column }', 'Same seed, same clusters (1). The new column is cluster unless you name it.']], 'table', 'k-means clustering: adds a cluster column (0 … k-1). Rows missing a value get none.', 'df = df.kmeans([\'x\', \'y\'], 4, { seed: 2 })'),
  ] },
];

/** Every table method name, for autocomplete after `df.`. */
export const TABLE_METHODS: RefItem[] = DATA_REFERENCE.flatMap(g => g.items).filter(it => it.name.startsWith('df.') && !it.name.includes('['));
