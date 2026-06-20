import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildSkeletonsBulk } from "./pool.js";
import { collectSourceFiles } from "./skeleton.js";
import { resolveOptions } from "./config.js";
import type { SkeletonFile } from "./types.js";
import type { SkeletonOptions } from "./config.js";

const INDEX_VERSION = "2";
const INDEX_FILE = ".ast-map/index.json";

export interface IndexEntry {
  rel: string;
  hash: string;
  builtAt: string;
  skel: SkeletonFile;
}

export interface IndexStore {
  version: string;
  root: string;
  scanDir: string;
  builtAt: string;
  fileCount: number;
  entries: Record<string, IndexEntry>;
}

function indexPath(root: string): string {
  return path.join(root, INDEX_FILE);
}

export function loadIndex(root: string): IndexStore | null {
  try {
    const raw = fs.readFileSync(indexPath(root), "utf8");
    const store = JSON.parse(raw) as IndexStore;
    if (store.version !== INDEX_VERSION) return null;
    return store;
  } catch {
    return null;
  }
}

export function saveIndex(root: string, store: IndexStore): void {
  const p = indexPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf8");
}

export function hashFile(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha1").update(content).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

export function isIndexFresh(store: IndexStore): boolean {
  for (const [, entry] of Object.entries(store.entries)) {
    const abs = path.join(store.root, entry.rel);
    if (hashFile(abs) !== entry.hash) return false;
  }
  return true;
}

export function getSkeletons(store: IndexStore, filterPrefix?: string): SkeletonFile[] {
  const entries = Object.values(store.entries);
  if (filterPrefix) {
    const norm = filterPrefix.split(path.sep).join("/");
    return entries.filter(e => e.rel.startsWith(norm)).map(e => e.skel);
  }
  return entries.map(e => e.skel);
}

export async function buildIndex(
  root: string,
  scanDir: string,
  opts?: Partial<SkeletonOptions>,
): Promise<IndexStore> {
  const skOpts = resolveOptions({ ...opts, detail: "outline", emitHtml: false });
  const files = collectSourceFiles(scanDir, skOpts);
  const items = files.map(f => ({
    abs: f,
    rel: path.relative(root, f).split(path.sep).join("/"),
  }));

  const existing = loadIndex(root);
  const existingEntries = existing?.entries ?? {};

  const toRebuild: typeof items = [];
  const reused: IndexEntry[] = [];

  for (const item of items) {
    const h = hashFile(item.abs);
    const cached = existingEntries[item.rel];
    if (cached && cached.hash === h) {
      reused.push(cached);
    } else {
      toRebuild.push(item);
    }
  }

  const built = await buildSkeletonsBulk(toRebuild, skOpts);
  const entries: Record<string, IndexEntry> = {};

  for (const e of reused) {
    entries[e.rel] = e;
  }

  for (let i = 0; i < toRebuild.length; i++) {
    const r = built[i];
    if (!r) continue;
    const rel = toRebuild[i].rel;
    entries[rel] = {
      rel,
      hash: hashFile(toRebuild[i].abs),
      builtAt: new Date().toISOString(),
      skel: r.skel,
    };
  }

  const store: IndexStore = {
    version: INDEX_VERSION,
    root,
    scanDir,
    builtAt: new Date().toISOString(),
    fileCount: Object.keys(entries).length,
    entries,
  };

  saveIndex(root, store);
  return store;
}

export async function refreshIndex(root: string, scanDir: string): Promise<IndexStore> {
  return buildIndex(root, scanDir);
}
