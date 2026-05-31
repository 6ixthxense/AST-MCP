import fs from "node:fs";
import { parseSource } from "./parser.js";
import type { TSNode } from "./parser.js";
import { detectLanguage } from "./registry.js";

export interface UnusedParamFn {
  function: string;
  line: number;
  unused: string[];
}

export interface FileUnusedParams {
  file: string;
  functions: UnusedParamFn[];
}

// Named function-like nodes across the supported languages. Anonymous arrows /
// lambdas are intentionally skipped: they're usually callbacks where an unused
// parameter is required by the caller's signature (event handlers, map indices).
const FN_TYPES = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_definition",          // Python / C / C++
  "async_function_definition",    // Python
  "method_definition",            // TS/JS class member
  "method_declaration",           // Go / Java / C#
  "constructor_declaration",      // Java / C#
  "function_item",                // Rust
]);

const PARAM_CONTAINERS = new Set([
  "formal_parameters", "parameters", "parameter_list", "function_value_parameters",
]);

const ID_TYPES = new Set(["identifier", "simple_identifier"]);
// Identifier-like nodes that count as a *usage* of a name. Includes object
// shorthand (`{ foo }` references `foo`), which is ubiquitous in JS/TS.
const USE_TYPES = new Set([
  "identifier", "simple_identifier",
  "shorthand_property_identifier", "shorthand_property_identifier_pattern",
]);
// Binding shapes we do NOT try to resolve to a single name (avoid false positives).
const SKIP_PARAM = /splat|rest|spread|object_pattern|array_pattern|tuple_pattern|object_type/;

function fnName(node: TSNode): string {
  const nm = node.childForFieldName("name");
  if (nm) return nm.text;
  // Kotlin/Swift function_declaration: name is the first simple_identifier child.
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === "simple_identifier") return c.text;
  }
  return "(anonymous)";
}

function paramsNode(fn: TSNode): TSNode | null {
  const p = fn.childForFieldName("parameters");
  if (p) return p;
  for (let i = 0; i < fn.namedChildCount; i++) {
    const c = fn.namedChild(i);
    if (c && PARAM_CONTAINERS.has(c.type)) return c;
  }
  return null;
}

/** Best-effort binding names for one parameter node (may be empty when unsure). */
function paramNames(p: TSNode): string[] {
  if (ID_TYPES.has(p.type)) return [p.text];
  if (SKIP_PARAM.test(p.type)) return [];
  const pat = p.childForFieldName("pattern");
  if (pat) return ID_TYPES.has(pat.type) ? [pat.text] : [];
  const nm = p.childForFieldName("name");
  if (nm && ID_TYPES.has(nm.type)) return [nm.text];
  // Go: `a, b int` → several identifier children before the type.
  const ids: string[] = [];
  for (let i = 0; i < p.namedChildCount; i++) {
    const c = p.namedChild(i);
    if (c && c.type === "identifier") ids.push(c.text);
  }
  return ids;
}

/** Collect every bare identifier reference in the subtree (not member/field names). */
function collectIdentifierUses(node: TSNode, out: Set<string>): void {
  if (USE_TYPES.has(node.type)) out.add(node.text);
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) collectIdentifierUses(c, out);
  }
}

function unusedInFunction(fn: TSNode): string[] {
  const pnode = paramsNode(fn);
  const body = fn.childForFieldName("body");
  if (!pnode || !body) return [];

  const names: string[] = [];
  for (let i = 0; i < pnode.namedChildCount; i++) {
    const p = pnode.namedChild(i);
    if (p) names.push(...paramNames(p));
  }
  if (names.length === 0) return [];

  const used = new Set<string>();
  collectIdentifierUses(body, used);

  // Skip `_`-prefixed (conventionally intentional) and `this`/`self`.
  return names.filter(
    (n) => n !== "_" && !n.startsWith("_") && n !== "this" && n !== "self" && !used.has(n),
  );
}

export async function findUnusedParams(
  absPath: string,
  relPath: string,
): Promise<FileUnusedParams | null> {
  const lang = detectLanguage(absPath);
  if (!lang) return null;
  const source = fs.readFileSync(absPath, "utf8");
  const root = await parseSource(lang.grammar, source);

  const functions: UnusedParamFn[] = [];
  const walk = (node: TSNode): void => {
    if (FN_TYPES.has(node.type)) {
      const unused = unusedInFunction(node);
      if (unused.length > 0) {
        functions.push({
          function: fnName(node),
          line: node.startPosition.row + 1,
          unused,
        });
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) walk(c);
    }
  };
  walk(root);

  return { file: relPath, functions };
}
