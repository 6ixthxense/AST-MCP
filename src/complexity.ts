import fs from "node:fs";
import { parseSource } from "./parser.js";
import type { TSNode } from "./parser.js";
import { detectLanguage } from "./registry.js";
import { buildSkeleton } from "./skeleton.js";
import { resolveOptions } from "./config.js";
import type { SymbolNode } from "./types.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export type ComplexityRating = "low" | "moderate" | "high" | "very-high";

export interface FunctionComplexity {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  /** Cyclomatic complexity: 1 + number of decision points in the function body. */
  complexity: number;
  rating: ComplexityRating;
}

export interface FileComplexity {
  file: string;
  functions: FunctionComplexity[];
  maxComplexity: number;
  averageComplexity: number;
}

// ─── Decision points ───────────────────────────────────────────────────────────

/**
 * Node types that introduce a branch (each adds 1 to cyclomatic complexity).
 * This is a deliberately broad cross-language union; languages that use a node
 * type not listed here simply undercount rather than miscount.
 */
const DECISION_TYPES = new Set([
  // conditionals
  "if_statement", "if_expression", "elif_clause", "else_if_clause",
  // loops
  "for_statement", "for_in_statement", "for_of_statement", "enhanced_for_statement",
  "for_expression", "while_statement", "while_expression", "do_statement", "loop_statement",
  // switch / match arms (the default/else arm is intentionally excluded)
  "switch_case", "expression_case", "type_case", "case_clause", "when_entry",
  "when_clause", "match_arm", "case_statement",
  // exception handlers
  "catch_clause", "except_clause", "rescue_clause",
  // ternary
  "ternary_expression", "conditional_expression",
  // python `and` / `or`
  "boolean_operator",
]);

const FN_KINDS = new Set(["function", "method"]);

/**
 * Function-like node types across the supported grammars. Used to find nested
 * functions so their control flow is scored against *them* and not against
 * whatever encloses them.
 */
const FUNCTION_TYPES = new Set([
  "function_declaration", "function_definition", "function_expression",
  "generator_function", "generator_function_declaration",
  "arrow_function", "lambda", "lambda_expression",
  "method_definition", "method_declaration", "constructor_declaration",
  "local_function_statement", "function_item", "func_literal",
  "anonymous_function_creation_expression", "closure_expression",
]);

function rate(c: number): ComplexityRating {
  if (c <= 5) return "low";
  if (c <= 10) return "moderate";
  if (c <= 20) return "high";
  return "very-high";
}

/** Collect the start line of every decision point in the tree. */
function collectDecisionLines(node: TSNode, out: number[]): void {
  const t = node.type;
  if (DECISION_TYPES.has(t)) {
    out.push(node.startPosition.row + 1);
  } else if (t === "binary_expression") {
    // Short-circuit operators add a branch; arithmetic operators do not.
    const op = node.childForFieldName("operator");
    if (op && (op.text === "&&" || op.text === "||")) out.push(node.startPosition.row + 1);
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) collectDecisionLines(c, out);
  }
}

interface FnRange { startLine: number; endLine: number; name: string; kind: string }

/** Every function-like node in the tree, with a usable name where one exists. */
function collectFunctionRanges(node: TSNode, out: FnRange[]): void {
  if (FUNCTION_TYPES.has(node.type)) {
    out.push({
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      name: nameOfFunction(node),
      kind: node.type.includes("method") || node.type.includes("constructor") ? "method" : "function",
    });
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) collectFunctionRanges(c, out);
  }
}

/**
 * A name for a function node: its own `name` field, else the variable it is
 * assigned to (`const handler = () => {}`), else an anonymous marker so a
 * complex callback is still findable by line.
 */
function nameOfFunction(node: TSNode): string {
  const own = node.childForFieldName("name");
  if (own?.text) return own.text;
  // walk up past the value position to a declarator/pair that names it
  let p = node.parent;
  for (let hops = 0; p && hops < 3; hops++, p = p.parent) {
    const id = p.childForFieldName("name") ?? p.childForFieldName("key")
      ?? p.childForFieldName("left") ?? p.childForFieldName("declarator");
    if (id?.text && !id.text.includes("\n")) return id.text;
  }
  return `<anonymous>:${node.startPosition.row + 1}`;
}

function flatten(symbols: SymbolNode[], acc: SymbolNode[] = []): SymbolNode[] {
  for (const s of symbols) {
    acc.push(s);
    flatten(s.children, acc);
  }
  return acc;
}

/**
 * Compute cyclomatic complexity for every function in a file.
 *
 * Each function is scored on *its own* control flow: decision points inside a
 * nested function count against that function, not against its enclosing one.
 * Attributing by raw line range instead made any function that declares a
 * callback read as complex, and made extracting a nested helper — the most
 * common refactor in this language — change nothing.
 *
 * Nested functions are reported as entries in their own right, named after the
 * binding they are assigned to where there is one, so complexity moved into a
 * closure stays visible rather than disappearing from the total.
 */
export async function computeFileComplexity(
  absPath: string,
  relPath: string,
): Promise<FileComplexity | null> {
  const lang = detectLanguage(absPath);
  if (!lang) return null;

  const source = fs.readFileSync(absPath, "utf8");
  const root = await parseSource(lang.grammar, source);
  const decisionLines: number[] = [];
  collectDecisionLines(root, decisionLines);

  const opts = resolveOptions({ detail: "outline", emitHtml: false });
  const skel = await buildSkeleton(absPath, relPath, opts);

  const fnRanges: FnRange[] = [];
  collectFunctionRanges(root, fnRanges);

  // Prefer the skeleton's names for top-level functions/methods — they carry the
  // qualified form ("MyClass.render") — and fall back to the AST for the nested
  // ones the skeleton does not model.
  const named = new Map<string, string>();
  for (const s of flatten(skel.symbols)) {
    if (FN_KINDS.has(s.kind)) named.set(`${s.range.startLine}`, s.name);
  }

  const functions: FunctionComplexity[] = fnRanges
    .map((fn) => {
      // Ranges strictly inside this one belong to a nested function.
      const nested = fnRanges.filter(
        (o) => o !== fn && o.startLine > fn.startLine && o.endLine <= fn.endLine,
      );
      const own = decisionLines.filter(
        (l) =>
          l >= fn.startLine && l <= fn.endLine &&
          !nested.some((o) => l >= o.startLine && l <= o.endLine),
      ).length;
      const complexity = 1 + own;
      return {
        name: named.get(`${fn.startLine}`) ?? fn.name,
        kind: fn.kind,
        startLine: fn.startLine,
        endLine: fn.endLine,
        complexity,
        rating: rate(complexity),
      };
    })
    .sort((a, b) => b.complexity - a.complexity || a.startLine - b.startLine);

  const maxComplexity = functions.reduce((m, f) => Math.max(m, f.complexity), 0);
  const averageComplexity =
    functions.length === 0
      ? 0
      : Math.round((functions.reduce((s, f) => s + f.complexity, 0) / functions.length) * 10) / 10;

  return { file: skel.file, functions, maxComplexity, averageComplexity };
}
