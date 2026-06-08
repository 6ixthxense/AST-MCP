import fs from "node:fs";
import path from "node:path";
import { buildSkeleton, collectSourceFiles } from "./skeleton.js";
import { resolveOptions } from "./config.js";
import { resolveFileImports } from "./resolver.js";
import { buildCallGraph } from "./callgraph.js";
import type { SkeletonFile, SymbolNode } from "./types.js";

function findSym(syms: SymbolNode[], name: string): SymbolNode | null {
  for (const s of syms) {
    if (s.name === name) return s;
    const n = findSym(s.children, name);
    if (n) return n;
  }
  return null;
}
const tok = (s: string) => Math.round(s.length / 4);

export interface ContextPack {
  seed: { file: string; symbol?: string };
  primary: { file: string; symbol?: string; startLine: number; endLine: number; source: string };
  dependencies: { file: string; symbols: { name: string; signature?: string | null }[] }[];
  dependents: { file: string }[];
  tokenEstimate: number;
  note: string;
}

/**
 * Assemble the minimal context an agent needs to understand or change a symbol:
 * the symbol's own source, the signatures of what it depends on (resolved
 * imports), and the files that depend on it — instead of reading whole files.
 */
export async function packContext(
  absFile: string,
  relFile: string,
  root: string,
  symbolName?: string,
  scanDir?: string,
): Promise<ContextPack> {
  const opts = resolveOptions({ detail: "full", emitHtml: false });
  const skel = await buildSkeleton(absFile, relFile, opts);
  const lines = fs.readFileSync(absFile, "utf8").split(/\r?\n/);

  let startLine = 1, endLine = lines.length;
  if (symbolName) {
    const sym = findSym(skel.symbols, symbolName);
    if (sym) { startLine = sym.range.startLine; endLine = sym.range.endLine; }
  }
  const source = lines.slice(startLine - 1, endLine).join("\n");

  // Dependencies: resolved in-project imports + the target symbol signatures.
  const refs = await resolveFileImports(skel, absFile, root);
  const byFile = new Map<string, { name: string; signature?: string | null }[]>();
  for (const r of refs) {
    if (!r.found || !r.resolvedRel) continue;
    const arr = byFile.get(r.resolvedRel) ?? [];
    if (!arr.some((x) => x.name === r.symbol)) arr.push({ name: r.symbol, signature: r.signature ?? null });
    byFile.set(r.resolvedRel, arr);
  }
  const dependencies = [...byFile.entries()].map(([file, symbols]) => ({ file, symbols }));

  // Dependents: who calls the seed symbol (needs a directory scan).
  let dependents: { file: string }[] = [];
  if (symbolName && scanDir) {
    const sopts = resolveOptions({ detail: "outline", emitHtml: false });
    const skels: SkeletonFile[] = [];
    for (const f of collectSourceFiles(scanDir, sopts)) {
      const rr = path.relative(root, f).split(path.sep).join("/");
      try { skels.push(await buildSkeleton(f, rr, sopts)); } catch { /* skip */ }
    }
    const cg = await buildCallGraph(absFile, symbolName, root, skels);
    if (cg) {
      const seen = new Set<string>();
      for (const c of cg.calledBy) if (!seen.has(c.file)) { seen.add(c.file); dependents.push({ file: c.file }); }
    }
  }

  const depTok = dependencies.reduce(
    (a, d) => a + d.symbols.reduce((b, s) => b + tok(s.signature || s.name), 0), 0,
  );
  return {
    seed: { file: relFile, ...(symbolName ? { symbol: symbolName } : {}) },
    primary: { file: relFile, ...(symbolName ? { symbol: symbolName } : {}), startLine, endLine, source },
    dependencies,
    dependents,
    tokenEstimate: tok(source) + depTok,
    note: "Read primary.source in full; for dependencies you usually only need the listed signatures, not the whole files.",
  };
}
