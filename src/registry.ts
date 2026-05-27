import path from "node:path";
import type { TSNode } from "./parser.js";
import type { SymbolNode, ImportRef } from "./types.js";
import { extractTypeScript, extractDirectivesTS, extractImportsTS } from "./extractors/typescript.js";
import { extractPython, extractImportsPython } from "./extractors/python.js";
import { extractGo, extractImportsGo } from "./extractors/go.js";

export interface LanguageEntry {
  /** Friendly language label used in output. */
  language: string;
  /** tree-sitter-wasms grammar name (file is tree-sitter-<grammar>.wasm). */
  grammar: string;
  /** Turns a parse tree into a normalized symbol list. */
  extract: (root: TSNode, source: string) => SymbolNode[];
  /** Extract top-of-file directives (e.g. "use client"). Optional — only TS/JS need this. */
  extractDirectives?: (root: TSNode, source: string) => string[];
  /** Extract import statements into structured ImportRef list. */
  extractImports?: (root: TSNode, source: string) => ImportRef[];
}

const TS_ENTRY = (language: string, grammar: string): LanguageEntry => ({
  language,
  grammar,
  extract: extractTypeScript,
  extractDirectives: extractDirectivesTS,
  extractImports: extractImportsTS,
});

/** Map of file extension -> language entry. The Factory/Strategy registry. */
const BY_EXT: Record<string, LanguageEntry> = {
  ".ts":  TS_ENTRY("typescript",  "typescript"),
  ".mts": TS_ENTRY("typescript",  "typescript"),
  ".cts": TS_ENTRY("typescript",  "typescript"),
  ".tsx": TS_ENTRY("tsx",         "tsx"),
  ".js":  TS_ENTRY("javascript",  "javascript"),
  ".mjs": TS_ENTRY("javascript",  "javascript"),
  ".cjs": TS_ENTRY("javascript",  "javascript"),
  ".jsx": TS_ENTRY("javascript",  "tsx"),
  ".py":  { language: "python", grammar: "python", extract: extractPython, extractImports: extractImportsPython },
  ".pyi": { language: "python", grammar: "python", extract: extractPython, extractImports: extractImportsPython },
  ".go":  { language: "go",     grammar: "go",     extract: extractGo,     extractImports: extractImportsGo },
};

export function detectLanguage(filePath: string): LanguageEntry | null {
  return BY_EXT[path.extname(filePath).toLowerCase()] ?? null;
}

export function supportedExtensions(): string[] {
  return Object.keys(BY_EXT);
}

export function supportedLanguages(): { language: string; extensions: string[] }[] {
  const map = new Map<string, string[]>();
  for (const [ext, entry] of Object.entries(BY_EXT)) {
    const arr = map.get(entry.language) ?? [];
    arr.push(ext);
    map.set(entry.language, arr);
  }
  return [...map.entries()].map(([language, extensions]) => ({ language, extensions }));
}
