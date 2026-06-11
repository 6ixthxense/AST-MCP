/**
 * Semantic symbol search — find symbols by *meaning*, not exact name.
 *
 * No embeddings, no network, no model downloads. Pure lexical semantics:
 *   1. Identifier tokenization  — camelCase / PascalCase / snake_case /
 *      kebab-case / digits / acronym boundaries ("HTTPServer" → http, server).
 *   2. Concept expansion        — a built-in thesaurus of programming
 *      synonym groups (fetch≈get≈load≈retrieve, remove≈delete≈destroy, …).
 *   3. Light stemming           — plural/gerund/past suffixes folded so
 *      "parsing" matches "parse", "users" matches "user".
 *   4. BM25-style ranking       — rare tokens weigh more (IDF over the
 *      scanned corpus); name hits outweigh doc/signature/path hits;
 *      direct hits outweigh synonym hits outweigh fuzzy hits.
 */

import path from "node:path";
import { buildSkeleton, collectSourceFiles } from "./skeleton.js";
import { resolveOptions, loadProjectConfig } from "./config.js";
import type { SymbolNode } from "./types.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface SemanticMatch {
  file: string;
  /** Full qualified name — nested symbols use dot notation: "MyClass.render" */
  symbol: string;
  kind: string;
  exported: boolean;
  range: { startLine: number; endLine: number };
  signature?: string | null;
  /** Relevance score, normalized to 0–1 within the result set. */
  score: number;
  /** Query concepts that matched, with how they matched. */
  matchedTerms: string[];
}

export interface SemanticSearchOptions {
  /** Maximum results to return. Default 20. */
  limit?: number;
  /** Filter by symbol kind. */
  kind?: string;
  /** Only return exported symbols. Default false. */
  exportedOnly?: boolean;
}

// ─── Synonym groups (programming thesaurus) ────────────────────────────────────
// Tokens in the same group are considered semantically equivalent (at a small
// penalty vs. a direct match). Keep each group tight — over-broad groups cause
// noisy results.

const SYNONYM_GROUPS: string[][] = [
  ["get", "fetch", "load", "retrieve", "read", "lookup", "resolve"],
  ["set", "update", "write", "assign", "put", "patch", "modify", "change", "edit"],
  ["create", "make", "build", "new", "generate", "construct", "init", "initialize", "spawn"],
  ["delete", "remove", "destroy", "drop", "clear", "purge", "erase"],
  ["find", "search", "query", "locate", "match", "scan", "discover"],
  ["send", "dispatch", "emit", "publish", "post", "broadcast", "notify"],
  ["receive", "consume", "subscribe", "listen", "handle", "process"],
  ["start", "begin", "launch", "run", "execute", "invoke", "trigger"],
  ["stop", "end", "halt", "kill", "terminate", "cancel", "abort", "shutdown", "close"],
  ["check", "validate", "verify", "test", "assert", "ensure", "confirm"],
  ["parse", "decode", "deserialize", "unmarshal", "extract", "tokenize"],
  ["format", "encode", "serialize", "marshal", "stringify", "render", "print"],
  ["convert", "transform", "map", "translate", "cast", "normalize"],
  ["user", "account", "member", "person", "profile", "customer"],
  ["auth", "authenticate", "login", "signin", "authorize", "session", "credential"],
  ["config", "configuration", "settings", "options", "preferences", "setup"],
  ["error", "exception", "fault", "failure", "err", "panic"],
  ["log", "logger", "logging", "trace", "audit"],
  ["cache", "memo", "memoize", "store", "buffer"],
  ["list", "enumerate", "all", "collection", "array", "items"],
  ["count", "total", "sum", "aggregate", "tally"],
  ["file", "document", "path", "filename"],
  ["dir", "directory", "folder"],
  ["request", "req", "call", "http"],
  ["response", "res", "reply", "result", "output"],
  ["message", "msg", "event", "signal"],
  ["connect", "connection", "link", "attach", "bind", "join"],
  ["disconnect", "detach", "unbind", "release", "unsubscribe"],
  ["save", "persist", "commit", "flush", "sync"],
  ["copy", "clone", "duplicate", "snapshot"],
  ["merge", "combine", "concat", "union", "join"],
  ["split", "divide", "partition", "chunk", "segment"],
  ["sort", "order", "rank", "arrange"],
  ["filter", "select", "exclude", "where"],
  ["compare", "diff", "equal", "equals", "cmp"],
  ["compute", "calculate", "calc", "derive", "evaluate", "measure"],
  ["watch", "observe", "monitor", "track", "poll"],
  ["wait", "sleep", "delay", "debounce", "throttle", "defer"],
  ["retry", "attempt", "backoff"],
  ["lock", "mutex", "semaphore", "guard"],
  ["queue", "stack", "heap", "pool", "buffer"],
  ["graph", "tree", "node", "edge", "vertex"],
  ["dependency", "dep", "import", "require"],
  ["token", "symbol", "identifier", "ident", "name"],
  ["database", "db", "storage", "repository", "repo", "dao"],
  ["key", "id", "identifier", "uuid", "guid"],
  ["string", "str", "text", "char"],
  ["number", "num", "int", "integer", "float", "numeric"],
  ["boolean", "bool", "flag", "toggle"],
  ["helper", "util", "utility", "utils", "tool", "common"],
  ["test", "spec", "mock", "stub", "fixture"],
  ["render", "draw", "paint", "display", "show", "view"],
  ["hide", "conceal", "mask", "suppress"],
  ["enable", "activate", "on"],
  ["disable", "deactivate", "off"],
  ["add", "insert", "append", "push", "register"],
  ["pop", "shift", "dequeue", "take"],
  ["circular", "cycle", "cyclic", "loop", "recursive"],
  ["dead", "unused", "orphan", "unreachable", "stale"],
  ["complexity", "complex", "cyclomatic", "cognitive"],
  ["coupling", "cohesion", "instability", "afferent", "efferent"],
];

const GROUP_OF = new Map<string, number[]>();
SYNONYM_GROUPS.forEach((group, gi) => {
  for (const word of group) {
    // Register both raw and stemmed forms so stemmed corpus/query tokens
    // ("setting", "item") still hit groups declared as "settings", "items".
    for (const form of new Set([word, stem(word)])) {
      const list = GROUP_OF.get(form);
      if (list) {
        if (!list.includes(gi)) list.push(gi);
      } else {
        GROUP_OF.set(form, [gi]);
      }
    }
  }
});

// ─── Tokenization ──────────────────────────────────────────────────────────────

/** Light stemmer: fold common English suffixes so "parsing"→"parse", "users"→"user". */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ing")) {
    w = w.slice(0, -3);
    // "mapping" → "mapp" → "map"; "parsing" → "pars" → add back "e"? keep both simple:
    if (w.length > 2 && w[w.length - 1] === w[w.length - 2]) w = w.slice(0, -1);
    return w;
  }
  if (w.length > 4 && w.endsWith("ed")) {
    w = w.slice(0, -2);
    if (w.length > 2 && w[w.length - 1] === w[w.length - 2]) w = w.slice(0, -1);
    return w;
  }
  if (w.length > 3 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/**
 * Split an identifier into lowercase word tokens.
 * Handles camelCase, PascalCase, snake_case, kebab-case, dots, digits and
 * acronym boundaries: "getHTTPServerByID" → [get, http, server, by, id].
 */
export function splitIdentifier(identifier: string): string[] {
  const out: string[] = [];
  for (const chunk of identifier.split(/[^A-Za-z0-9]+/)) {
    if (!chunk) continue;
    // Insert boundaries: aA | AAa (acronym→word) | letter↔digit
    const spaced = chunk
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([A-Za-z])([0-9])/g, "$1 $2")
      .replace(/([0-9])([A-Za-z])/g, "$1 $2");
    for (const word of spaced.split(" ")) {
      if (word) out.push(word.toLowerCase());
    }
  }
  return out;
}

/** Levenshtein distance with early exit when > max. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function sharesGroup(a: string, b: string): boolean {
  const ga = GROUP_OF.get(a);
  if (!ga) return false;
  const gb = GROUP_OF.get(b);
  if (!gb) return false;
  return ga.some((g) => gb.includes(g));
}

// ─── Corpus building ───────────────────────────────────────────────────────────

interface SymbolDoc {
  match: Omit<SemanticMatch, "score" | "matchedTerms">;
  /** token → field weight (max across fields the token appears in). */
  tokens: Map<string, number>;
  nameTokens: Set<string>;
}

const FIELD_WEIGHT = { name: 3, doc: 2, signature: 1.5, path: 1, kind: 1 } as const;

function addToken(doc: SymbolDoc, raw: string, weight: number): void {
  const t = stem(raw);
  if (t.length < 2) return;
  const existing = doc.tokens.get(t);
  if (existing === undefined || weight > existing) doc.tokens.set(t, weight);
}

function* flattenDocs(
  symbols: SymbolNode[],
  file: string,
  parentName?: string,
): Generator<{ sym: SymbolNode; fullName: string }> {
  for (const sym of symbols) {
    const fullName = parentName ? `${parentName}.${sym.name}` : sym.name;
    yield { sym, fullName };
    if (sym.children.length > 0) yield* flattenDocs(sym.children, file, fullName);
  }
}

function buildDoc(sym: SymbolNode, fullName: string, file: string): SymbolDoc {
  const doc: SymbolDoc = {
    match: {
      file,
      symbol: fullName,
      kind: sym.kind,
      exported: sym.exported ?? false,
      range: sym.range,
      ...(sym.signature ? { signature: sym.signature } : {}),
    },
    tokens: new Map(),
    nameTokens: new Set(),
  };
  for (const t of splitIdentifier(fullName)) {
    addToken(doc, t, FIELD_WEIGHT.name);
    doc.nameTokens.add(stem(t));
  }
  addToken(doc, sym.kind, FIELD_WEIGHT.kind);
  if (sym.doc) {
    for (const t of splitIdentifier(sym.doc)) addToken(doc, t, FIELD_WEIGHT.doc);
  }
  if (sym.signature) {
    for (const t of splitIdentifier(sym.signature)) addToken(doc, t, FIELD_WEIGHT.signature);
  }
  for (const seg of file.split("/")) {
    for (const t of splitIdentifier(seg)) addToken(doc, t, FIELD_WEIGHT.path);
  }
  return doc;
}

// ─── Scoring ───────────────────────────────────────────────────────────────────

const MATCH_WEIGHT = { direct: 1, synonym: 0.7, fuzzy: 0.45 } as const;

// English/query stopwords — ignored as query concepts.
const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "for", "to", "with", "that", "this",
  "is", "are", "be", "and", "or", "by", "from", "at", "it", "its", "as",
  "do", "does", "how", "what", "which", "where", "when", "i", "we", "you",
  "function", "method", "code", "thing", "stuff", "something",
]);

/**
 * Search for symbols by meaning across all source files in a directory.
 *
 * @param dirAbs   Absolute path of directory to scan.
 * @param query    Natural-language-ish query, e.g. "remove expired sessions".
 * @param root     Project root (for relative paths in results).
 * @param options  limit, kind filter, exportedOnly.
 */
export async function semanticSearch(
  dirAbs: string,
  query: string,
  root: string,
  options: SemanticSearchOptions = {},
): Promise<SemanticMatch[]> {
  const { limit = 20, kind, exportedOnly = false } = options;

  // Query concepts: tokenized, stopword-filtered, stemmed (dedup, keep order).
  const concepts: string[] = [];
  for (const raw of splitIdentifier(query)) {
    if (STOPWORDS.has(raw)) continue;
    const t = stem(raw);
    if (t.length >= 2 && !concepts.includes(t)) concepts.push(t);
  }
  if (concepts.length === 0) return [];

  // Build corpus (detail "full" so doc comments and signatures are available).
  const opts = resolveOptions({ detail: "full", emitHtml: false }, loadProjectConfig(root));
  const files = collectSourceFiles(dirAbs, opts);
  const docs: SymbolDoc[] = [];
  for (const file of files) {
    const fileRel = path.relative(root, file).split(path.sep).join("/");
    try {
      const skel = await buildSkeleton(file, fileRel, opts);
      for (const { sym, fullName } of flattenDocs(skel.symbols, skel.file)) {
        if (kind && sym.kind !== kind) continue;
        if (exportedOnly && !(sym.exported ?? false)) continue;
        docs.push(buildDoc(sym, fullName, skel.file));
      }
    } catch {
      // skip unreadable / unparseable files
    }
  }
  if (docs.length === 0) return [];

  // Document frequency per concept (direct-token presence) → BM25-ish IDF.
  const N = docs.length;
  const idf = new Map<string, number>();
  for (const concept of concepts) {
    let df = 0;
    for (const doc of docs) if (doc.tokens.has(concept)) df++;
    idf.set(concept, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }

  const scored: SemanticMatch[] = [];
  for (const doc of docs) {
    let score = 0;
    const matchedTerms: string[] = [];
    let nameHits = 0;

    for (const concept of concepts) {
      let best = 0;
      let how: string | null = null;

      for (const [token, fieldWeight] of doc.tokens) {
        let mw = 0;
        let label: string | null = null;
        if (token === concept) {
          mw = MATCH_WEIGHT.direct;
          label = concept;
        } else if (sharesGroup(token, concept)) {
          mw = MATCH_WEIGHT.synonym;
          label = `${concept}≈${token}`;
        } else if (
          concept.length >= 4 &&
          token.length >= 4 &&
          editDistance(token, concept, 1) <= 1
        ) {
          mw = MATCH_WEIGHT.fuzzy;
          label = `${concept}~${token}`;
        }
        const contribution = mw * fieldWeight;
        if (contribution > best) {
          best = contribution;
          how = label;
          if (fieldWeight >= FIELD_WEIGHT.name && mw === MATCH_WEIGHT.direct) break; // can't beat this
        }
      }

      if (best > 0 && how) {
        score += best * (idf.get(concept) ?? 1);
        matchedTerms.push(how);
        if (doc.nameTokens.has(concept)) nameHits++;
      }
    }

    if (matchedTerms.length === 0) continue;

    // Bonuses: all concepts matched; full query substring of name; coverage ratio.
    const coverage = matchedTerms.length / concepts.length;
    score *= 0.5 + 0.5 * coverage;
    if (nameHits === concepts.length) score *= 1.25;
    const flatQuery = concepts.join("");
    if (doc.match.symbol.toLowerCase().includes(flatQuery)) score *= 1.2;
    // Length normalization: prefer focused names — "login" beats "handleLogin"
    // when both match the same concepts. Penalize name tokens no concept explains.
    let unmatchedNameTokens = 0;
    for (const t of doc.nameTokens) {
      const explained = concepts.some(
        (c) =>
          t === c ||
          sharesGroup(t, c) ||
          (c.length >= 4 && t.length >= 4 && editDistance(t, c, 1) <= 1),
      );
      if (!explained) unmatchedNameTokens++;
    }
    score /= 1 + 0.15 * unmatchedNameTokens;

    scored.push({ ...doc.match, score, matchedTerms });
  }

  scored.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const top = scored.slice(0, limit);

  // Normalize scores to 0–1 within the result set.
  const max = top.length > 0 ? top[0].score : 1;
  if (max > 0) for (const m of top) m.score = Math.round((m.score / max) * 1000) / 1000;
  return top;
}
