import path from "node:path";
import type { SymbolNode } from "./types.js";

// ─── Symbol lookup ────────────────────────────────────────────────────────────

/** Recursively search for a symbol by name and optional kind. */
export function findSymbol(symbols: SymbolNode[], name: string, kind?: string): SymbolNode | null {
  for (const sym of symbols) {
    if (sym.name === name && (!kind || sym.kind === kind)) return sym;
    const found = findSymbol(sym.children, name, kind);
    if (found) return found;
  }
  return null;
}

/**
 * Given a target symbol with a signature, find related type/interface/enum
 * symbols referenced in that signature and return their source code blocks.
 */
export function findRelatedSymbols(
  symbols: SymbolNode[],
  target: SymbolNode,
  sourceLines: string[],
): Array<{ name: string; kind: string; range: { startLine: number; endLine: number }; code: string }> {
  if (!target.signature) return [];

  const seen = new Set<string>([target.name]);
  // PascalCase identifiers in the signature are likely type references
  const typeRefs = [...target.signature.matchAll(/\b([A-Z][a-zA-Z0-9_]*)\b/g)]
    .map((m) => m[1])
    .filter((v) => !seen.has(v) && (seen.add(v), true));

  const related: Array<{ name: string; kind: string; range: { startLine: number; endLine: number }; code: string }> = [];
  for (const typeName of typeRefs) {
    const sym = findSymbol(symbols, typeName);
    if (sym && (sym.kind === "interface" || sym.kind === "type" || sym.kind === "enum")) {
      const code = sourceLines.slice(sym.range.startLine - 1, sym.range.endLine).join("\n");
      related.push({ name: sym.name, kind: sym.kind, range: sym.range, code });
    }
  }
  return related;
}

// ─── Architecture validation ──────────────────────────────────────────────────

/** True if the first 500 chars of source contain the given directive literal. */
export function hasDirective(source: string, directive: string): boolean {
  const head = source.slice(0, 500);
  return head.includes(`"${directive}"`) || head.includes(`'${directive}'`);
}

interface ServerPattern { pattern: RegExp; label: string }

/** Patterns that flag server-only imports in a "use client" file. */
const SERVER_IMPORT_PATTERNS: ServerPattern[] = [
  { pattern: /from\s+['"]server-only['"]/, label: "server-only" },
  { pattern: /from\s+['"][^'"]*\/prisma['"]/, label: "prisma client" },
  { pattern: /from\s+['"][^'"]*lib\/prisma['"]/, label: "lib/prisma" },
  { pattern: /from\s+['"]next\/headers['"]/, label: "next/headers" },
  { pattern: /from\s+['"]next\/cookies['"]/, label: "next/cookies" },
  { pattern: /from\s+['"][^'"]*lib\/auth['"]/, label: "lib/auth" },
  { pattern: /from\s+['"][^'"]*lib\/auditLog['"]/, label: "lib/auditLog" },
  { pattern: /from\s+['"][^'"]*lib\/apiAuth['"]/, label: "lib/apiAuth" },
];

export interface ImportViolation {
  module: string;
  label: string;
  line: number;
}

/** Scan source lines for server-only imports (called on "use client" files). */
export function findServerImports(source: string): ImportViolation[] {
  const lines = source.split("\n");
  const violations: ImportViolation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, label } of SERVER_IMPORT_PATTERNS) {
      if (pattern.test(line)) {
        const match = line.match(/from\s+['"]([^'"]+)['"]/);
        violations.push({ module: match ? match[1] : line.trim(), label, line: i + 1 });
        break;
      }
    }
  }
  return violations;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

/** True if the relative path looks like a Next.js App Router API route file. */
export function isApiRoute(relPath: string): boolean {
  const norm = relPath.split(path.sep).join("/");
  return /app\/api\/.+\/route\.(ts|js|tsx|jsx)$/.test(norm);
}

/**
 * Find exported HTTP handler functions that have no try/catch.
 * A simple but effective heuristic: look for the `try {` keyword in the body.
 */
export function findMissingTryCatch(symbols: SymbolNode[], sourceLines: string[]): SymbolNode[] {
  const missing: SymbolNode[] = [];
  for (const sym of symbols) {
    if (!HTTP_METHODS.has(sym.name) || sym.exported === false) continue;
    const bodyText = sourceLines.slice(sym.range.startLine - 1, sym.range.endLine).join("\n");
    if (!/\btry\s*\{/.test(bodyText)) missing.push(sym);
  }
  return missing;
}
