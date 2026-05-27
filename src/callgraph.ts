import fs from "node:fs";
import path from "node:path";
import { parseSource } from "./parser.js";
import type { TSNode } from "./parser.js";
import { buildSkeleton } from "./skeleton.js";
import { resolveOptions, loadProjectConfig } from "./config.js";
import { detectLanguage } from "./registry.js";
import { resolveImportPath } from "./resolver.js";
import type { SkeletonFile } from "./types.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface CallRef {
  /** The callee expression as written in source, e.g. "sanitize" or "obj.method". */
  callee: string;
  line: number;
  /** Relative path of the file the callee lives in (if cross-file). */
  calleeFileRel?: string;
  /** True when the call target is a local symbol in the same file. */
  isLocal?: boolean;
  /** True when the callee is an external package (not a relative import). */
  isExternal?: boolean;
}

export interface CalledByRef {
  /** File that imports (and therefore likely calls) this function. */
  file: string;
}

export interface CallGraphResult {
  file: string;
  function: string;
  functionRange: { startLine: number; endLine: number };
  /** Functions/methods this function calls. */
  calls: CallRef[];
  /** Files that import this function (reverse import lookup). */
  calledBy: CalledByRef[];
}

// ─── AST traversal ────────────────────────────────────────────────────────────

interface RawCall {
  callee: string;
  line: number;
}

/** Recursively collect call expressions from a subtree. */
function collectCalls(node: TSNode, out: RawCall[]): void {
  // TypeScript / JavaScript / Go use "call_expression"; Python uses "call"
  if (node.type === "call_expression" || node.type === "call") {
    const fn = node.childForFieldName("function");
    if (fn) {
      let callee: string | null = null;
      if (fn.type === "identifier") {
        callee = fn.text;
      } else if (fn.type === "member_expression" || fn.type === "attribute") {
        // TS/JS: member_expression with "object"/"property" fields
        // Python: attribute with "object"/"attribute" fields
        const obj = fn.childForFieldName("object");
        const prop =
          fn.childForFieldName("property") ?? fn.childForFieldName("attribute");
        if (prop) callee = obj ? `${obj.text}.${prop.text}` : prop.text;
      }
      if (callee) out.push({ callee, line: fn.startPosition.row + 1 });
    }
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) collectCalls(c, out);
  }
}

/**
 * Walk the AST and return the first function/method node whose declared name
 * matches `name`. Handles:
 *   - function declarations (TS/JS/Go)
 *   - const/let arrow functions and function expressions (TS/JS)
 *   - method definitions inside classes (TS/JS)
 *   - function_definition (Python)
 *   - method_declaration (Go)
 */
function findFunctionNode(root: TSNode, name: string): TSNode | null {
  function walk(node: TSNode): TSNode | null {
    const t = node.type;

    // Direct named functions / methods
    if (
      t === "function_declaration" ||
      t === "generator_function_declaration" ||
      t === "method_definition" ||
      t === "method_signature" ||
      t === "abstract_method_signature" ||
      t === "function_definition" ||       // Python
      t === "async_function_definition" || // Python async
      t === "method_declaration"           // Go
    ) {
      if (node.childForFieldName("name")?.text === name) return node;
    }

    // const foo = () => ... or const foo = function() ...
    if (t === "variable_declarator") {
      const declName = node.childForFieldName("name")?.text;
      const value = node.childForFieldName("value");
      if (
        declName === name &&
        value &&
        (value.type === "arrow_function" ||
          value.type === "function" ||
          value.type === "function_expression")
      ) {
        return value;
      }
    }

    // Recurse
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) {
        const found = walk(c);
        if (found) return found;
      }
    }
    return null;
  }

  return walk(root);
}

// ─── Destructuring alias tracker ─────────────────────────────────────────────

/**
 * Walk a subtree and collect variable destructuring patterns where the source
 * is a known import. Handles:
 *   const { sign, verify } = jwt;          → sign/verify → (jwt's source)
 *   const { readFile: rf } = fs;           → rf → (fs's source)
 *   let { a, b } = someNamespace.nested;   → a/b → (someNamespace's source)
 *
 * Returns a map of localAlias → moduleSpecifier (same format as importMap).
 */
function collectDestructuredAliases(
  node: TSNode,
  importMap: Map<string, string>,
): Map<string, string> {
  const aliases = new Map<string, string>();

  function walk(n: TSNode): void {
    if (n.type === "variable_declarator") {
      const nameNode = n.childForFieldName("name");
      const valueNode = n.childForFieldName("value");
      if (nameNode && valueNode && nameNode.type === "object_pattern") {
        // value might be `jwt` or `jwt.utils` — base is the first identifier
        const baseName = valueNode.text.split(".")[0];
        const origin = importMap.get(baseName) ?? aliases.get(baseName);
        if (origin) {
          for (let i = 0; i < nameNode.namedChildCount; i++) {
            const prop = nameNode.namedChild(i);
            if (!prop) continue;
            // { sign } — shorthand
            if (
              prop.type === "shorthand_property_identifier_pattern" ||
              prop.type === "shorthand_property_identifier"
            ) {
              aliases.set(prop.text, origin);
            }
            // { readFile: rf } — renamed
            if (prop.type === "pair_pattern") {
              const val = prop.childForFieldName("value");
              if (val) aliases.set(val.text, origin);
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c) walk(c);
    }
  }

  walk(node);
  return aliases;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the call graph for a single named function.
 *
 * @param filePath   Absolute path to the source file.
 * @param funcName   Name of the function/method to analyse.
 * @param root       Project root (for computing relative paths).
 * @param allSkeletons  Optional: pre-parsed skeletons of the whole project,
 *                   used to find which files import (and thus call) this function.
 *
 * Returns null if the language is unsupported or the function is not found.
 */
export async function buildCallGraph(
  filePath: string,
  funcName: string,
  root: string,
  allSkeletons?: SkeletonFile[],
): Promise<CallGraphResult | null> {
  const langEntry = detectLanguage(filePath);
  if (!langEntry) return null;

  const source = fs.readFileSync(filePath, "utf8");
  const relPath = path.relative(root, filePath).split(path.sep).join("/");
  const rootNode = await parseSource(langEntry.grammar, source);

  const funcNode = findFunctionNode(rootNode, funcName);
  if (!funcNode) return null;

  // Use the body subtree for call extraction (avoids counting the signature itself)
  const body = funcNode.childForFieldName("body") ?? funcNode;

  const rawCalls: RawCall[] = [];
  collectCalls(body, rawCalls);

  // Parse the file's imports to resolve callee origins
  const opts = resolveOptions({ detail: "outline", emitHtml: false }, loadProjectConfig(root));
  const skel = await buildSkeleton(filePath, relPath, opts);

  // localName → module specifier
  const importMap = new Map<string, string>();
  for (const imp of skel.imports ?? []) {
    if (imp.symbol !== "*" && !imp.isSideEffect) {
      importMap.set(imp.alias ?? imp.symbol, imp.from);
    }
  }

  const localNames = new Set(skel.symbols.map((s) => s.name));

  // Track destructured aliases within the function body
  // e.g. const { sign } = jwt  →  sign maps to the same source as jwt
  const destructuredAliases = collectDestructuredAliases(body, importMap);

  // Deduplicate by callee+line and resolve origins
  const calls: CallRef[] = [];
  const seen = new Set<string>();
  for (const { callee, line } of rawCalls) {
    const key = `${callee}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const baseName = callee.split(".")[0];
    // Check import map first, then destructured aliases
    const importFrom = importMap.get(baseName) ?? destructuredAliases.get(baseName);
    const call: CallRef = { callee, line };

    if (importFrom) {
      if (importFrom.startsWith(".")) {
        const resolvedAbs = resolveImportPath(importFrom, filePath);
        if (resolvedAbs) {
          call.calleeFileRel = path.relative(root, resolvedAbs).split(path.sep).join("/");
        }
      } else {
        call.isExternal = true;
        call.calleeFileRel = importFrom;
      }
    } else if (localNames.has(baseName)) {
      call.isLocal = true;
    }

    calls.push(call);
  }

  // calledBy: files that import this function (reverse import lookup)
  const calledBy: CalledByRef[] = [];
  if (allSkeletons) {
    for (const otherSkel of allSkeletons) {
      if (otherSkel.file === relPath) continue;
      for (const imp of otherSkel.imports ?? []) {
        const importedName = imp.alias ?? imp.symbol;
        if (importedName !== funcName && imp.symbol !== funcName) continue;
        if (!imp.from.startsWith(".")) continue;
        const otherAbs = path.resolve(root, otherSkel.file);
        const resolvedAbs = resolveImportPath(imp.from, otherAbs);
        if (!resolvedAbs) continue;
        const resolvedRel = path.relative(root, resolvedAbs).split(path.sep).join("/");
        if (resolvedRel === relPath) {
          calledBy.push({ file: otherSkel.file });
          break;
        }
      }
    }
  }

  return {
    file: relPath,
    function: funcName,
    functionRange: {
      startLine: funcNode.startPosition.row + 1,
      endLine: funcNode.endPosition.row + 1,
    },
    calls,
    calledBy,
  };
}
