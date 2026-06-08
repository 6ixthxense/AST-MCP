import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSkeleton, collectSourceFiles } from "./skeleton.js";
import { resolveOptions } from "./config.js";
import { buildSymbolGraph } from "./graph.js";
import { getChangeImpact } from "./graph-analysis.js";
import { detectLanguage } from "./registry.js";
import { computeFileComplexity } from "./complexity.js";
import type { SkeletonFile, SymbolNode } from "./types.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function isGitRepo(root: string): boolean {
  try { git(["rev-parse", "--is-inside-work-tree"], root); return true; } catch { return false; }
}

interface ChangedFile { file: string; status: "A" | "M" | "D" }

function changedFiles(root: string, base: string): ChangedFile[] {
  let out: string;
  try { out = git(["diff", "--name-status", base, "--"], root); } catch { return []; }
  const res: ChangedFile[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^([AMD])\t(.+)$/);
    if (m) { res.push({ status: m[1] as ChangedFile["status"], file: m[2] }); continue; }
    const r = line.match(/^R\d+\t\S+\t(.+)$/); // rename → treat new path as modified
    if (r) res.push({ status: "M", file: r[1] });
  }
  // Untracked files are new since any ref — treat them as added.
  try {
    const untracked = git(["ls-files", "--others", "--exclude-standard"], root);
    for (const f of untracked.split(/\r?\n/)) {
      if (f.trim() && !res.some((x) => x.file === f)) res.push({ status: "A", file: f });
    }
  } catch { /* ignore */ }
  return res.filter((f) => detectLanguage(f.file));
}

function oldContent(root: string, base: string, rel: string): string | null {
  try { return git(["show", `${base}:${rel}`], root); } catch { return null; }
}

async function skeletonFromSource(source: string, rel: string): Promise<SkeletonFile | null> {
  const ext = path.extname(rel);
  const tmp = path.join(os.tmpdir(), `astdiff-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  try {
    fs.writeFileSync(tmp, source);
    return await buildSkeleton(tmp, rel, resolveOptions({ detail: "full", emitHtml: false }));
  } catch { return null; } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}

function flatten(syms: SymbolNode[], prefix: string, acc: Map<string, SymbolNode>): Map<string, SymbolNode> {
  for (const s of syms) {
    const q = prefix ? prefix + "." + s.name : s.name;
    acc.set(q, s);
    flatten(s.children, q, acc);
  }
  return acc;
}

export interface SymbolChange { symbol: string; kind: string; exported: boolean }
export interface FileDiff {
  file: string;
  status: "added" | "modified" | "deleted";
  added: SymbolChange[];
  removed: SymbolChange[];
  modified: SymbolChange[];
}
export interface DiffResult {
  base: string;
  files: FileDiff[];
  breaking: { file: string; symbol: string; reason: string }[];
  impactedFiles: string[];
  summary: { filesChanged: number; added: number; removed: number; modified: number; breaking: number; impactedFiles: number };
}

const sc = (s: SymbolNode): SymbolChange => ({ symbol: s.name, kind: s.kind, exported: s.exported ?? false });

export async function computeDiff(absDir: string, root: string, base: string): Promise<DiffResult> {
  const absDirNorm = path.resolve(absDir);
  const changed = changedFiles(root, base).filter((f) => path.resolve(root, f.file).startsWith(absDirNorm));

  const files: FileDiff[] = [];
  const breaking: DiffResult["breaking"] = [];

  for (const cf of changed) {
    const rel = cf.file;
    const newSkel = cf.status === "D" ? null : await safeBuildFromDisk(path.resolve(root, rel), rel);
    const oldSrc = cf.status === "A" ? null : oldContent(root, base, rel);
    const oldSkel = oldSrc != null ? await skeletonFromSource(oldSrc, rel) : null;

    const oldMap = oldSkel ? flatten(oldSkel.symbols, "", new Map()) : new Map<string, SymbolNode>();
    const newMap = newSkel ? flatten(newSkel.symbols, "", new Map()) : new Map<string, SymbolNode>();

    const added: SymbolChange[] = [], removed: SymbolChange[] = [], modified: SymbolChange[] = [];
    for (const [q, s] of newMap) if (!oldMap.has(q)) added.push(sc(s));
    for (const [q, s] of oldMap) if (!newMap.has(q)) removed.push(sc(s));
    for (const [q, s] of newMap) {
      const o = oldMap.get(q);
      if (o && (o.signature ?? "") !== (s.signature ?? "")) modified.push(sc(s));
    }

    const status = cf.status === "A" ? "added" : cf.status === "D" ? "deleted" : "modified";
    files.push({ file: rel, status, added, removed, modified });

    for (const r of removed) if (r.exported && !r.symbol.includes(" ")) {
      breaking.push({ file: rel, symbol: r.symbol, reason: cf.status === "D" ? "file deleted" : "export removed" });
    }
    for (const m of modified) if (m.exported) breaking.push({ file: rel, symbol: m.symbol, reason: "signature changed" });
  }

  // Blast radius of breaking changes (top-level symbols only).
  const impacted = new Set<string>();
  if (breaking.length > 0) {
    const opts = resolveOptions({ detail: "outline", emitHtml: false });
    const skels: SkeletonFile[] = [];
    for (const f of collectSourceFiles(absDirNorm, opts)) {
      const r = path.relative(root, f).split(path.sep).join("/");
      try { skels.push(await buildSkeleton(f, r, opts)); } catch { /* skip */ }
    }
    const graph = buildSymbolGraph(skels, root);
    for (const b of breaking) {
      const imp = getChangeImpact(graph, `${b.file}::${b.symbol}`);
      if (imp) for (const d of [...imp.direct, ...imp.transitive]) if (d.file !== b.file) impacted.add(d.file);
    }
  }

  const sum = files.reduce(
    (a, f) => ({ added: a.added + f.added.length, removed: a.removed + f.removed.length, modified: a.modified + f.modified.length }),
    { added: 0, removed: 0, modified: 0 },
  );

  return {
    base,
    files,
    breaking,
    impactedFiles: [...impacted].sort(),
    summary: { filesChanged: files.length, ...sum, breaking: breaking.length, impactedFiles: impacted.size },
  };
}

async function safeBuildFromDisk(abs: string, rel: string): Promise<SkeletonFile | null> {
  try { return await buildSkeleton(abs, rel, resolveOptions({ detail: "full", emitHtml: false })); } catch { return null; }
}

/* ─── Risk map: churn × complexity ─────────────────────────────────────────── */

export interface RiskFile { file: string; churn: number; maxComplexity: number; risk: number }

export async function computeRisk(absDir: string, root: string): Promise<RiskFile[]> {
  const opts = resolveOptions({ detail: "outline", emitHtml: false });
  const out: RiskFile[] = [];
  for (const f of collectSourceFiles(absDir, opts)) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    let churn = 0;
    try { churn = parseInt(git(["rev-list", "--count", "HEAD", "--", rel], root).trim(), 10) || 0; } catch { churn = 0; }
    const fc = await computeFileComplexity(f, rel);
    const maxC = fc ? fc.maxComplexity : 0;
    out.push({ file: rel, churn, maxComplexity: maxC, risk: churn * maxC });
  }
  return out.filter((r) => r.risk > 0).sort((a, b) => b.risk - a.risk);
}
