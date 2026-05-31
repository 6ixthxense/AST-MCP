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

function flatten(symbols: SymbolNode[], acc: SymbolNode[] = []): SymbolNode[] {
  for (const s of symbols) {
    acc.push(s);
    flatten(s.children, acc);
  }
  return acc;
}

/**
 * Compute cyclomatic complexity for every function/method in a file.
 * Complexity is attributed by line range, so a function's score includes the
 * control flow of any closures/nested functions declared inside it.
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

  const functions: FunctionComplexity[] = flatten(skel.symbols)
    .filter((s) => FN_KINDS.has(s.kind))
    .map((s) => {
      const count = decisionLines.filter(
        (l) => l >= s.range.startLine && l <= s.range.endLine,
      ).length;
      const complexity = 1 + count;
      return {
        name: s.name,
        kind: s.kind,
        startLine: s.range.startLine,
        endLine: s.range.endLine,
        complexity,
        rating: rate(complexity),
      };
    })
    .sort((a, b) => b.complexity - a.complexity);

  const maxComplexity = functions.reduce((m, f) => Math.max(m, f.complexity), 0);
  const averageComplexity =
    functions.length === 0
      ? 0
      : Math.round((functions.reduce((s, f) => s + f.complexity, 0) / functions.length) * 10) / 10;

  return { file: skel.file, functions, maxComplexity, averageComplexity };
}
