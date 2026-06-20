import type { SkeletonFile, SymbolNode } from "./types.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SmellResult {
  file: string;
  smell: string;
  symbol?: string;
  severity: "warning" | "info";
  message: string;
  line?: number;
}

export interface SmellSummary {
  file: string;
  smells: SmellResult[];
}

export interface SmellOptions {
  maxMethods?: number;
  maxFields?: number;
  maxMethodLines?: number;
  maxParams?: number;
}

// ─── Parameter counting ───────────────────────────────────────────────────────

/**
 * Count the number of parameters in a signature string by finding the first
 * `(...)` group and splitting by comma. Handles `...rest` as 1 param.
 * Returns -1 when no parameter list can be found.
 */
function countParams(signature: string | null | undefined): number {
  if (!signature) return -1;

  // Find the first balanced parenthesis group
  const start = signature.indexOf("(");
  if (start === -1) return -1;

  let depth = 0;
  let end = -1;
  for (let i = start; i < signature.length; i++) {
    if (signature[i] === "(") depth++;
    else if (signature[i] === ")") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return -1;

  const inner = signature.slice(start + 1, end).trim();
  if (inner === "") return 0;

  // Split by top-level commas only (ignore generics / nested parens)
  const parts: string[] = [];
  let buf = "";
  let nested = 0;
  for (const ch of inner) {
    if (ch === "(" || ch === "<" || ch === "[" || ch === "{") { nested++; buf += ch; }
    else if (ch === ")" || ch === ">" || ch === "]" || ch === "}") { nested--; buf += ch; }
    else if (ch === "," && nested === 0) { parts.push(buf.trim()); buf = ""; }
    else { buf += ch; }
  }
  if (buf.trim()) parts.push(buf.trim());

  // Filter out empty strings and `this` parameters
  const filtered = parts.filter((p) => p.length > 0 && p !== "this" && !p.startsWith("this:"));
  return filtered.length;
}

/**
 * Determine whether a signature's parameter list consists exclusively of
 * primitive types (string, number, boolean). Returns true only when there are
 * more than 3 params AND every param type annotation is a primitive (or a
 * union of primitives).
 */
function isPrimitiveObsession(signature: string | null | undefined, paramCount: number): boolean {
  if (!signature || paramCount <= 3) return false;

  const start = signature.indexOf("(");
  if (start === -1) return false;

  let depth = 0;
  let end = -1;
  for (let i = start; i < signature.length; i++) {
    if (signature[i] === "(") depth++;
    else if (signature[i] === ")") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return false;

  const inner = signature.slice(start + 1, end).trim();
  if (!inner) return false;

  // Remove `this` param
  const withoutThis = inner.replace(/^this\s*:[^,]+,?\s*/, "");

  // Strip parameter names — keep only the type annotation portion
  // Handles: `name: type`, `name?: type`, `...rest: type`
  // We check the extracted type annotations against known primitives
  const PRIMITIVE_RE = /^(string|number|boolean)(\s*\|\s*(string|number|boolean))*(\[\])?(\s*\|\s*null|\s*\|\s*undefined)*$/;

  // Extract type annotations: split by top-level comma, then grab the part after `:`
  const parts: string[] = [];
  let buf = "";
  let nested2 = 0;
  for (const ch of withoutThis) {
    if (ch === "(" || ch === "<" || ch === "[" || ch === "{") { nested2++; buf += ch; }
    else if (ch === ")" || ch === ">" || ch === "]" || ch === "}") { nested2--; buf += ch; }
    else if (ch === "," && nested2 === 0) { parts.push(buf.trim()); buf = ""; }
    else { buf += ch; }
  }
  if (buf.trim()) parts.push(buf.trim());

  const meaningful = parts.filter((p) => p.length > 0 && p !== "this" && !p.startsWith("this:"));
  if (meaningful.length === 0) return false;

  for (const param of meaningful) {
    // Strip leading `...` for rest params
    const stripped = param.replace(/^\.\.\./, "");
    // Get the type annotation after `:`
    const colonIdx = stripped.indexOf(":");
    if (colonIdx === -1) {
      // No explicit type — treat as unknown (non-primitive)
      return false;
    }
    const typeAnnotation = stripped.slice(colonIdx + 1).trim().replace(/\s*=\s*.*$/, ""); // remove default value
    if (!PRIMITIVE_RE.test(typeAnnotation)) return false;
  }

  return true;
}

// ─── Individual smell detectors ───────────────────────────────────────────────

function checkGodClass(
  sym: SymbolNode,
  file: string,
  maxMethods: number,
  maxFields: number,
): SmellResult | null {
  if (sym.kind !== "class") return null;

  const publicMethods = sym.children.filter(
    (c) => (c.kind === "method" || c.kind === "function") && c.visibility === "public",
  );
  const fields = sym.children.filter((c) => c.kind === "field");

  if (publicMethods.length > maxMethods) {
    return {
      file,
      smell: "god-class",
      symbol: sym.name,
      severity: "warning",
      message: `Class "${sym.name}" has ${publicMethods.length} public methods (threshold: ${maxMethods})`,
      line: sym.range.startLine,
    };
  }

  if (fields.length > maxFields) {
    return {
      file,
      smell: "god-class",
      symbol: sym.name,
      severity: "warning",
      message: `Class "${sym.name}" has ${fields.length} fields (threshold: ${maxFields})`,
      line: sym.range.startLine,
    };
  }

  return null;
}

function checkLongMethod(
  sym: SymbolNode,
  file: string,
  maxLines: number,
): SmellResult | null {
  if (sym.kind !== "function" && sym.kind !== "method") return null;

  const length = sym.range.endLine - sym.range.startLine;
  if (length > maxLines) {
    return {
      file,
      smell: "long-method",
      symbol: sym.name,
      severity: "warning",
      message: `"${sym.name}" is ${length} lines long (threshold: ${maxLines})`,
      line: sym.range.startLine,
    };
  }

  return null;
}

function checkLongParamList(
  sym: SymbolNode,
  file: string,
  maxParams: number,
): SmellResult | null {
  if (sym.kind !== "function" && sym.kind !== "method") return null;

  const count = countParams(sym.signature);
  if (count > maxParams) {
    return {
      file,
      smell: "long-param-list",
      symbol: sym.name,
      severity: "warning",
      message: `"${sym.name}" has ${count} parameters (threshold: ${maxParams})`,
      line: sym.range.startLine,
    };
  }

  return null;
}

function checkPrimitiveObsession(
  sym: SymbolNode,
  file: string,
): SmellResult | null {
  if (sym.kind !== "function" && sym.kind !== "method") return null;

  const count = countParams(sym.signature);
  if (count > 3 && isPrimitiveObsession(sym.signature, count)) {
    return {
      file,
      smell: "primitive-obsession",
      symbol: sym.name,
      severity: "info",
      message: `"${sym.name}" has ${count} parameters all of primitive types — consider a parameter object`,
      line: sym.range.startLine,
    };
  }

  return null;
}

function checkShallowWrapper(
  sym: SymbolNode,
  file: string,
): SmellResult | null {
  if (sym.kind !== "class") return null;

  const publicMethods = sym.children.filter(
    (c) => (c.kind === "method" || c.kind === "function") && c.visibility === "public",
  );

  if (publicMethods.length !== 1) return null;

  const method = publicMethods[0];
  const methodLines = method.range.endLine - method.range.startLine;
  if (methodLines <= 5) {
    return {
      file,
      smell: "shallow-wrapper",
      symbol: sym.name,
      severity: "info",
      message: `Class "${sym.name}" has exactly 1 public method "${method.name}" (${methodLines} lines) — may be a thin wrapper`,
      line: sym.range.startLine,
    };
  }

  return null;
}

// ─── Walk helpers ─────────────────────────────────────────────────────────────

/**
 * Recursively walk top-level symbols and their children, collecting smells.
 * `exported` is propagated from the parent class when checking methods.
 */
function walkSymbols(
  symbols: SymbolNode[],
  file: string,
  maxMethods: number,
  maxFields: number,
  maxMethodLines: number,
  maxParams: number,
  results: SmellResult[],
  parentExported: boolean,
): void {
  for (const sym of symbols) {
    const isExported = sym.exported ?? parentExported;

    // Only check exported (or publicly accessible) symbols
    if (isExported || parentExported) {
      // class-level smells
      const godClass = checkGodClass(sym, file, maxMethods, maxFields);
      if (godClass) results.push(godClass);

      const shallowWrapper = checkShallowWrapper(sym, file);
      if (shallowWrapper) results.push(shallowWrapper);

      // function/method smells
      const longMethod = checkLongMethod(sym, file, maxMethodLines);
      if (longMethod) results.push(longMethod);

      const longParam = checkLongParamList(sym, file, maxParams);
      if (longParam) results.push(longParam);

      const primitiveObs = checkPrimitiveObsession(sym, file);
      if (primitiveObs) results.push(primitiveObs);
    }

    // Recurse into children (methods inside a class inherit the parent's exported status)
    if (sym.children.length > 0) {
      walkSymbols(sym.children, file, maxMethods, maxFields, maxMethodLines, maxParams, results, isExported);
    }
  }
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export function detectSmells(
  skel: SkeletonFile,
  sourceLineCount: number,
  opts?: SmellOptions,
): SmellResult[] {
  const maxMethods = opts?.maxMethods ?? 10;
  const maxFields = opts?.maxFields ?? 8;
  const maxMethodLines = opts?.maxMethodLines ?? 60;
  const maxParams = opts?.maxParams ?? 4;

  const results: SmellResult[] = [];

  // ── large-file ────────────────────────────────────────────────────────────
  if (sourceLineCount > 500) {
    results.push({
      file: skel.file,
      smell: "large-file",
      severity: "warning",
      message: `File has ${sourceLineCount} lines (threshold: 500)`,
    });
  }

  // ── symbol-level smells ───────────────────────────────────────────────────
  walkSymbols(
    skel.symbols,
    skel.file,
    maxMethods,
    maxFields,
    maxMethodLines,
    maxParams,
    results,
    false,
  );

  return results;
}
