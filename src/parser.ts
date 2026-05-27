import Parser from "web-tree-sitter";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/**
 * Minimal structural view of a tree-sitter node — decoupled from the
 * web-tree-sitter type definitions so the build stays stable across versions.
 */
export interface TSNode {
  type: string;
  text: string;
  isNamed: boolean;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  namedChildCount: number;
  child(index: number): TSNode | null;
  namedChild(index: number): TSNode | null;
  childForFieldName(field: string): TSNode | null;
  parent: TSNode | null;
  previousSibling: TSNode | null;
  previousNamedSibling: TSNode | null;
  nextSibling: TSNode | null;
}

// `web-tree-sitter` 0.20.x ships a CommonJS class with static members that are
// only populated after `init()`. We treat the static surface loosely.
const P = Parser as unknown as {
  init(opts?: { locateFile?(name: string): string }): Promise<void>;
  new (): { setLanguage(lang: unknown): void; parse(src: string): { rootNode: TSNode } };
  Language: { load(pathOrBytes: string): Promise<unknown> };
};

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, unknown>();

function pkgDir(spec: string): string {
  return path.dirname(require.resolve(spec));
}

function grammarWasmPath(grammar: string): string {
  return path.join(pkgDir("tree-sitter-wasms/package.json"), "out", `tree-sitter-${grammar}.wasm`);
}

export async function initParser(): Promise<void> {
  if (!initPromise) {
    const coreDir = pkgDir("web-tree-sitter/package.json");
    initPromise = P.init({
      locateFile(name: string) {
        // The runtime requests "tree-sitter.wasm"; serve it from the package dir.
        return path.join(coreDir, name);
      },
    });
  }
  return initPromise;
}

async function loadLanguage(grammar: string): Promise<unknown> {
  await initParser();
  const cached = languageCache.get(grammar);
  if (cached) return cached;
  const lang = await P.Language.load(grammarWasmPath(grammar));
  languageCache.set(grammar, lang);
  return lang;
}

/** Parse source code with the given grammar and return the root node. */
export async function parseSource(grammar: string, source: string): Promise<TSNode> {
  const lang = await loadLanguage(grammar);
  const parser = new P();
  parser.setLanguage(lang);
  return parser.parse(source).rootNode;
}

/* ----------------------------- node helpers ----------------------------- */

export function namedChildren(node: TSNode): TSNode[] {
  const out: TSNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) out.push(c);
  }
  return out;
}

export function nameOf(node: TSNode): string | null {
  const n = node.childForFieldName("name");
  return n ? n.text : null;
}

/**
 * Build a one-line "header" signature: text from the node start up to the
 * start of its body (or the whole node if there is no body), whitespace
 * collapsed. Works uniformly across languages.
 */
export function headerSignature(node: TSNode, body: TSNode | null): string {
  const src = node.text;
  const slice = body ? src.slice(0, body.startIndex - node.startIndex) : src;
  return slice.replace(/\s+/g, " ").trim();
}

/** Collect consecutive leading line/block comments immediately above a node. */
export function leadingComment(node: TSNode): string | null {
  const lines: string[] = [];
  let prev = node.previousNamedSibling;
  while (prev && prev.type === "comment") {
    lines.unshift(prev.text);
    prev = prev.previousNamedSibling;
  }
  if (lines.length === 0) return null;
  return lines.join("\n").slice(0, 500);
}
