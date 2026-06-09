// Worker-thread entry: builds skeletons (and optionally per-file complexity)
// off the main thread. Spawned by pool.ts with { cacheDir } as workerData.
import { parentPort, workerData } from "node:worker_threads";
import { buildSkeleton } from "./skeleton.js";
import { computeFileComplexity } from "./complexity.js";
import { initDiskCache } from "./diskcache.js";
import type { SkeletonOptions } from "./config.js";

interface TaskMsg {
  id: number;
  abs: string;
  rel: string;
  opts: SkeletonOptions;
  withComplexity?: boolean;
}

const data = (workerData ?? {}) as { cacheDir?: string | null };
if (data.cacheDir) initDiskCache(data.cacheDir);

parentPort!.on("message", (msg: TaskMsg) => {
  void (async () => {
    try {
      const skel = await buildSkeleton(msg.abs, msg.rel, msg.opts);
      const complexity = msg.withComplexity
        ? await computeFileComplexity(msg.abs, msg.rel)
        : undefined;
      parentPort!.postMessage({ id: msg.id, ok: true, skel, complexity });
    } catch (e) {
      parentPort!.postMessage({
        id: msg.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();
});
