/**
 * glslPatterns — the shared shader-idiom library (docs/expression-explainer.md).
 *
 * Parse an expression, recognise well-known idioms in it, explain it in plain words, turn it
 * (or any part of it) into a reusable function, and find where else a shape is used. No AI, no
 * network: the same text always gives the same answer.
 *
 * Other modules (the suggestions / Do… bar, the code explorer) should import from here, not
 * from the files inside.
 */
export type { Expr, GlslType, BinaryOp, UnaryOp } from './ast';
export { printExpr, childrenOf, allNodes, walk, formatNumber, sourceOf } from './ast';
export { parseExpr, parseLine, splitStatements, pickExplainSpan, type ParseResult, type ParsedLine, type Statement } from './parse';
export { inferTypes, typesFromCode, GLOBAL_TYPES, type TypeEnv } from './types';
export { inferRoles, roleFromName, roleFromType, roleOfSourceNode, type Role, type RoleEnv, type RoleInfo } from './roles';
export { matchPattern, compilePattern, normalize, canonicalKey, constValue, closeEnough, NAMED_CONSTANTS, type Bindings, type Binding } from './match';
export { IDIOMS, idiomById, registerIdiom, type Idiom, type IdiomText, type HoleSpec, type IdiomCategory } from './idioms';
export {
  explainExpression, explainLine, explainTree, breakdownText, breakdownSegs, fmt,
  type ExplainContext, type Explanation, type ExplainResult, type LineExplanation, type Step, type Desc, type IdiomHit,
} from './explain';
export { parseSegs, toPlainText, stripMarks, segsToMarked, varsIn, spokenToken, mark, type Seg, type SegKind } from './segments';
export { MEANINGS, type Meaning } from './meanings';
export { transferPlot, singleInput, needsPicture, edgesOf, plotRange, type TransferPlot } from './plot';
export {
  generalise, generaliseText, buildFunction, descriptionFor, toIdentifier, patternIsUsable,
  type Generalised, type GenInput, type GenChoices, type BuiltFunction, type GeneraliseContext,
} from './generalise';
export { evaluate, evaluateFunction, type Value, type EvalEnv } from './evaluate';
export { workedVars, workedSteps, workedBlock, freeNames, showValue, type WorkedVar, type WorkedStep, type BlockInput, type BlockLineNumbers } from './worked';
export { findUses, matchesInLine, codeLines, provenance, exprBlockEnv, customFnEnv, type UseSource, type UseHit, type UseQuery } from './findUses';
export { toExprPreset, toPublishNode, exprPresetParams, insertFunction, callInCustomFn } from './saveFlows';

import { IDIOMS } from './idioms';

/**
 * Search words for every idiom: what the suggestions vocabulary / node browser / Do… bar can
 * index. `{ id, name, words }` per idiom.
 */
export function idiomVocabulary(): Array<{ id: string; name: string; category: string; words: string[] }> {
  return IDIOMS.map(i => ({ id: i.id, name: i.name, category: i.category, words: [i.name.toLowerCase(), i.fnName, ...(i.keywords ?? [])] }));
}
export {
  FUNCTION_REGISTRY, BUILTIN_FUNCTION_NAMES, GENERIC_TYPES, functionInfo, signatureText, genericTypesIn,
  type FnInfo, type FnKind, type FnOverload, type FnParam, type FnCategory, type FnPlot,
} from './functions';
export { functionAt, functionsIn, declaredFunctions, commentSpans, type FunctionHit, type FunctionAtOptions, type DeclaredFunction } from './fnAt';
export { functionCard, functionCardFor, plotForCall, explainCall, snippetFor, type FunctionCardModel, type FunctionCardContext } from './fnCard';
export {
  buildUpRows, defaultVarying, exprSource, pictureBudget, pictureKind, cpuStrip, cpuValue, spanOf, isFlat, HEAVY_TYPE, MAX_NODES, MAX_MS, STRIP_SAMPLES,
  type BuildUpRow, type BuildUpKind, type PictureKind, type GraphCost,
} from './buildUp';
