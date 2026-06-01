/**
 * Standard Skeleton JSON schema — the shared "interlingua" that every
 * language extractor must produce, regardless of the source language.
 */

export type SymbolKind =
  | "class"
  | "interface"
  | "struct"
  | "function"
  | "method"
  | "type"
  | "enum"
  | "const"
  | "var"
  | "field";

export interface Range {
  /** 1-based line number where the symbol starts. */
  startLine: number;
  /** 1-based line number where the symbol ends. */
  endLine: number;
}

export interface PropInfo {
  /** Prop name. */
  name: string;
  /** Declared type as written in source (best-effort, whitespace-collapsed). */
  type?: string | null;
  /** True when the prop is optional (`foo?:`). */
  optional?: boolean;
}

export interface SymbolNode {
  name: string;
  /** Normalized kind, shared across all languages. */
  kind: SymbolKind;
  /** Raw node type from tree-sitter (kept for debugging). */
  rawKind?: string;
  /** Human-readable signature/header (present only in detail="full"). */
  signature?: string | null;
  /** "public" | "private" — derived per-language convention. */
  visibility: "public" | "private";
  /** Whether the symbol is exported from its module/file. */
  exported?: boolean;
  /** Leading comment or docstring (present only in detail="full"). */
  doc?: string | null;
  range: Range;
  /** React/TSX components: the props type name when a named type is used. */
  propsType?: string;
  /** React/TSX components: extracted prop fields (name, type, optional). */
  props?: PropInfo[];
  /** Decorators applied to this symbol, in source order, without the leading `@`. */
  decorators?: string[];
  /** Nested symbols (methods inside a class, fields inside a struct, etc.). */
  children: SymbolNode[];
}

export interface ImportRef {
  /** Imported symbol name, or "*" for namespace/side-effect imports. */
  symbol: string;
  /** Module specifier as written in source (may be relative). */
  from: string;
  /** Local alias when `import { Foo as Bar }` — alias is "Bar". */
  alias?: string;
  /** True for `import type { ... }`. */
  isTypeOnly?: boolean;
  /** True for `import * as Foo`. */
  isNamespaceImport?: boolean;
  /** True for `import Foo from ...` (default import). */
  isDefault?: boolean;
  /** True for `import "module"` (no bindings). */
  isSideEffect?: boolean;
}

export interface SkeletonFile {
  schemaVersion: string;
  /** Path relative to the configured root (forward-slashed). */
  file: string;
  language: string;
  generatedAt: string;
  parser: {
    engine: string;
    grammar: string;
  };
  /** Total number of symbols including nested ones. */
  symbolCount: number;
  /** Top-of-file directives, e.g. "use client" | "use server". */
  directives?: string[];
  /** Import statements found at the top level of this file. */
  imports?: ImportRef[];
  symbols: SymbolNode[];
}

export type Detail = "outline" | "full";
