import path from "node:path";
import type { TSNode } from "./parser.js";
import type { SymbolNode, ImportRef } from "./types.js";
import { extractTypeScript, extractDirectivesTS, extractImportsTS } from "./extractors/typescript.js";
import { extractPython, extractImportsPython } from "./extractors/python.js";
import { extractGo, extractImportsGo } from "./extractors/go.js";
import { extractRust, extractImportsRust } from "./extractors/rust.js";
import { extractJava, extractDirectivesJava, extractImportsJava } from "./extractors/java.js";
import { extractCSharp, extractDirectivesCSharp, extractImportsCSharp } from "./extractors/csharp.js";
import { extractC, extractImportsC } from "./extractors/c.js";
import { extractCpp, extractImportsCpp } from "./extractors/cpp.js";
import { extractKotlin, extractDirectivesKotlin, extractImportsKotlin } from "./extractors/kotlin.js";
import { extractSwift, extractImportsSwift } from "./extractors/swift.js";
import { extractPhp, extractImportsPhp } from "./extractors/php.js";
import { extractRuby, extractImportsRuby } from "./extractors/ruby.js";

export interface LanguageEntry {
  language: string;
  grammar: string;
  extract: (root: TSNode, source: string) => SymbolNode[];
  extractDirectives?: (root: TSNode, source: string) => string[];
  extractImports?: (root: TSNode, source: string) => ImportRef[];
  /** Single-file component: lift the <script> block before parsing (Vue/Svelte). */
  sfc?: boolean;
}

const TS_ENTRY = (language: string, grammar: string): LanguageEntry => ({
  language,
  grammar,
  extract: extractTypeScript,
  extractDirectives: extractDirectivesTS,
  extractImports: extractImportsTS,
});

const SFC_ENTRY = (language: string): LanguageEntry => ({
  language,
  grammar: "typescript", // overridden per-file after detecting lang="ts" vs js
  extract: extractTypeScript,
  extractDirectives: extractDirectivesTS,
  extractImports: extractImportsTS,
  sfc: true,
});

const BY_EXT: Record<string, LanguageEntry> = {
  ".ts": TS_ENTRY("typescript", "typescript"),
  ".mts": TS_ENTRY("typescript", "typescript"),
  ".cts": TS_ENTRY("typescript", "typescript"),
  ".tsx": TS_ENTRY("tsx", "tsx"),
  ".js": TS_ENTRY("javascript", "javascript"),
  ".mjs": TS_ENTRY("javascript", "javascript"),
  ".cjs": TS_ENTRY("javascript", "javascript"),
  ".jsx": TS_ENTRY("javascript", "tsx"),
  ".py": { language: "python", grammar: "python", extract: extractPython, extractImports: extractImportsPython },
  ".pyi": { language: "python", grammar: "python", extract: extractPython, extractImports: extractImportsPython },
  ".go": { language: "go", grammar: "go", extract: extractGo, extractImports: extractImportsGo },
  ".rs": { language: "rust", grammar: "rust", extract: extractRust, extractImports: extractImportsRust },
  ".java": {
    language: "java", grammar: "java",
    extract: extractJava, extractDirectives: extractDirectivesJava, extractImports: extractImportsJava,
  },
  ".cs": {
    language: "csharp", grammar: "c_sharp",
    extract: extractCSharp, extractDirectives: extractDirectivesCSharp, extractImports: extractImportsCSharp,
  },
  ".c": { language: "c", grammar: "c", extract: extractC, extractImports: extractImportsC },
  ".h": { language: "c", grammar: "c", extract: extractC, extractImports: extractImportsC },
  ".cpp": { language: "cpp", grammar: "cpp", extract: extractCpp, extractImports: extractImportsCpp },
  ".cxx": { language: "cpp", grammar: "cpp", extract: extractCpp, extractImports: extractImportsCpp },
  ".cc":  { language: "cpp", grammar: "cpp", extract: extractCpp, extractImports: extractImportsCpp },
  ".hpp": { language: "cpp", grammar: "cpp", extract: extractCpp, extractImports: extractImportsCpp },
  ".hxx": { language: "cpp", grammar: "cpp", extract: extractCpp, extractImports: extractImportsCpp },
  ".hh":  { language: "cpp", grammar: "cpp", extract: extractCpp, extractImports: extractImportsCpp },
  ".kt": {
    language: "kotlin", grammar: "kotlin",
    extract: extractKotlin, extractDirectives: extractDirectivesKotlin, extractImports: extractImportsKotlin,
  },
  ".kts": {
    language: "kotlin", grammar: "kotlin",
    extract: extractKotlin, extractDirectives: extractDirectivesKotlin, extractImports: extractImportsKotlin,
  },
  ".swift": { language: "swift", grammar: "swift", extract: extractSwift, extractImports: extractImportsSwift },
  ".php": { language: "php", grammar: "php", extract: extractPhp, extractImports: extractImportsPhp },
  ".rb": { language: "ruby", grammar: "ruby", extract: extractRuby, extractImports: extractImportsRuby },
  ".rake": { language: "ruby", grammar: "ruby", extract: extractRuby, extractImports: extractImportsRuby },
  ".vue": SFC_ENTRY("vue"),
  ".svelte": SFC_ENTRY("svelte"),
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
