import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface IncrementalState {
  /** Map from relative file path → sha256 hash of last-seen content. */
  hashes: Record<string, string>;
  /** ISO timestamp of last full analysis. */
  lastRun: string;
  /** Root directory these hashes are relative to. */
  root: string;
}

export interface ChangedFiles {
  /** Files modified/added since the last recorded state. */
  changed: string[];
  /** Files deleted since the last recorded state. */
  deleted: string[];
  /** Files unchanged. */
  unchanged: string[];
}

// ─── State persistence ────────────────────────────────────────────────────────

const STATE_FILE = ".ast-map/incremental.json";

export function statePath(root: string): string {
  return path.join(root, STATE_FILE);
}

export function loadState(root: string): IncrementalState | null {
  try {
    const raw = fs.readFileSync(statePath(root), "utf8");
    return JSON.parse(raw) as IncrementalState;
  } catch { return null; }
}

export function saveState(root: string, hashes: Record<string, string>): IncrementalState {
  const state: IncrementalState = { hashes, lastRun: new Date().toISOString(), root };
  const p = statePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
  return state;
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

export function hashFile(filePath: string): string {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 16);
  } catch { return ""; }
}

export function hashFiles(files: string[], root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    hashes[rel] = hashFile(abs);
  }
  return hashes;
}

// ─── Change detection ─────────────────────────────────────────────────────────

/** Compare current file set against saved state to find changed/deleted/unchanged files. */
export function detectChanges(
  files: string[],
  root: string,
  state: IncrementalState | null,
): ChangedFiles {
  if (!state) {
    // No prior state → everything is "changed"
    return { changed: files, deleted: [], unchanged: [] };
  }

  const currentHashes = hashFiles(files, root);
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const [rel, hash] of Object.entries(currentHashes)) {
    const abs = path.resolve(root, rel);
    if (state.hashes[rel] === hash) {
      unchanged.push(abs);
    } else {
      changed.push(abs);
    }
  }

  const currentRels = new Set(Object.keys(currentHashes));
  const deleted = Object.keys(state.hashes)
    .filter((rel) => !currentRels.has(rel));

  return { changed, deleted, unchanged };
}

// ─── Git-based change detection ───────────────────────────────────────────────

/**
 * Get files changed relative to a git ref (e.g. "HEAD", "main", "origin/main").
 * Returns absolute paths of changed/added/modified files (excludes deleted).
 */
export function gitChangedFiles(root: string, base = "HEAD"): string[] {
  try {
    const raw = execSync(`git diff --name-only --diff-filter=ACM ${base}`, {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((rel) => path.resolve(root, rel))
      .filter((abs) => fs.existsSync(abs));
  } catch { return []; }
}

/**
 * Get files staged for commit (git index).
 */
export function gitStagedFiles(root: string): string[] {
  try {
    const raw = execSync("git diff --cached --name-only --diff-filter=ACM", {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((rel) => path.resolve(root, rel))
      .filter((abs) => fs.existsSync(abs));
  } catch { return []; }
}

/**
 * Filter a file list to only those changed since `base` according to git.
 * Falls back to returning all files if git is unavailable.
 */
export function filterToGitChanged(
  allFiles: string[],
  root: string,
  base = "HEAD",
): { files: string[]; fromGit: boolean } {
  const changed = gitChangedFiles(root, base);
  if (changed.length === 0) return { files: allFiles, fromGit: false };

  const changedSet = new Set(changed);
  const filtered = allFiles.filter((f) => changedSet.has(f));
  return { files: filtered.length > 0 ? filtered : allFiles, fromGit: filtered.length > 0 };
}
