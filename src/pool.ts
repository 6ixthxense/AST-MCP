import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { SkeletonFile } from "./types.js";
import type { SkeletonOptions } from "./config.js";
import { buildSkeleton } from "./skeleton.js";
import { computeFileComplexity, type FileComplexity } from "./complexity.js";
import { diskCacheDir } from "./diskcache.js";

// ─── Parallel skeleton building (worker-thread pool) ─────────────────────────
// Used by bulk scans (directory skeletons, reports, CLI gather). Falls back to
// sequential parsing for small batches, single-core machines, AST_MAP_WORKERS=0,
// or any worker failure — parallelism is an optimisation, never a requirement.

export interface BulkItem {
  abs: string;
  rel: string;
}

export interface BulkResult {
  skel: SkeletonFile;
  complexity?: FileComplexity | null;
}

/** Batches smaller than this are parsed sequentially (worker startup costs more). */
const MIN_BATCH = 64;
const MAX_WORKERS = 8;

function envWorkers(): number | null {
  const env = process.env.AST_MAP_WORKERS;
  if (env === undefined || env === "") return null;
  const v = Number.parseInt(env, 10);
  return Number.isNaN(v) ? null : Math.max(0, Math.min(v, MAX_WORKERS));
}

function plannedWorkers(n: number): number {
  const forced = envWorkers();
  if (forced !== null) return forced;
  const cpus = os.cpus().length;
  return Math.min(Math.max(cpus - 1, 0), MAX_WORKERS, Math.ceil(n / MIN_BATCH));
}

async function buildSequential(
  items: BulkItem[],
  opts: SkeletonOptions,
  withComplexity: boolean,
  out: Array<BulkResult | null>,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (out[i] !== undefined) continue; // already produced by a worker
    try {
      const skel = await buildSkeleton(items[i].abs, items[i].rel, opts);
      const complexity = withComplexity
        ? await computeFileComplexity(items[i].abs, items[i].rel)
        : undefined;
      out[i] = { skel, complexity };
    } catch {
      out[i] = null; // unparsable / unsupported — callers skip nulls
    }
  }
}

/**
 * Build skeletons for many files, in parallel when it pays off.
 * Returns one entry per input item (null = failed/unsupported file).
 */
export async function buildSkeletonsBulk(
  items: BulkItem[],
  opts: SkeletonOptions,
  withComplexity = false,
): Promise<Array<BulkResult | null>> {
  const out: Array<BulkResult | null> = new Array(items.length);
  const workers = plannedWorkers(items.length);
  const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.js");

  // An explicit AST_MAP_WORKERS >= 2 bypasses the batch-size gate.
  const smallBatch = items.length < MIN_BATCH && envWorkers() === null;
  if (smallBatch || workers <= 1 || !fs.existsSync(workerFile)) {
    await buildSequential(items, opts, withComplexity, out);
    return out;
  }

  let failed = false;
  await new Promise<void>((resolve) => {
    let next = 0;
    let done = 0;
    let open = 0;
    const pool: Worker[] = [];

    const finish = () => {
      for (const w of pool) void w.terminate();
      resolve();
    };

    const dispatch = (w: Worker) => {
      if (failed || next >= items.length) {
        return;
      }
      const id = next++;
      w.postMessage({ id, abs: items[id].abs, rel: items[id].rel, opts, withComplexity });
    };

    for (let i = 0; i < workers; i++) {
      let w: Worker;
      try {
        w = new Worker(workerFile, { workerData: { cacheDir: diskCacheDir() } });
      } catch {
        failed = true;
        break;
      }
      open++;
      pool.push(w);
      w.on("message", (msg: { id: number; ok: boolean; skel?: SkeletonFile; complexity?: FileComplexity | null; }) => {
        out[msg.id] = msg.ok && msg.skel ? { skel: msg.skel, complexity: msg.complexity } : null;
        done++;
        if (done >= items.length || failed) finish();
        else dispatch(w);
      });
      w.on("error", () => {
        failed = true;
        finish();
      });
      dispatch(w);
      // prime a second task per worker to hide round-trip latency
      dispatch(w);
    }

    if (pool.length === 0) resolve();
    else if (open === 0) resolve();
  });

  // Fill any gaps (worker failure, early termination) sequentially.
  for (let i = 0; i < items.length; i++) {
    if (out[i] === undefined) {
      await buildSequential(items, opts, withComplexity, out);
      break;
    }
  }
  return out;
}
