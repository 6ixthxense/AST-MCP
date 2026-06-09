import fs from "node:fs";
import path from "node:path";
import { buildReport, type ReportData } from "./report.js";

// ─── Quality gate (`ast-map check` / check_quality_gate) ─────────────────────
// Two complementary mechanisms:
//   1. Absolute thresholds (config `.ast-map.config.json` → "check", or CLI flags)
//   2. Baseline ratchet — compare against a committed `.ast-map.baseline.json`
//      and fail when any tracked metric regresses. `--update-baseline` re-anchors.

export interface CheckMetrics {
  fileCount: number;
  symbolCount: number;
  cycles: number;
  deadExports: number;
  sdpViolations: number;
  /** Functions with cyclomatic complexity > 20. */
  veryHighComplexity: number;
  maxComplexity: number;
  score: number;
  grade: string;
}

export interface CheckThresholds {
  maxCycles?: number;
  maxDeadExports?: number;
  maxSdpViolations?: number;
  maxVeryHighComplexity?: number;
  maxComplexity?: number;
  minScore?: number;
}

export interface CheckFailure {
  kind: "threshold" | "regression";
  metric: string;
  limit: number;
  actual: number;
  message: string;
}

export interface CheckResult {
  passed: boolean;
  metrics: CheckMetrics;
  baseline: CheckMetrics | null;
  baselinePath: string;
  baselineUpdated: boolean;
  failures: CheckFailure[];
}

export const BASELINE_FILENAME = ".ast-map.baseline.json";

export function metricsFromReport(r: ReportData): CheckMetrics {
  return {
    fileCount: r.fileCount,
    symbolCount: r.symbolCount,
    cycles: r.cycles.count,
    deadExports: r.dead.count,
    sdpViolations: r.layerViolations.count,
    veryHighComplexity: r.complexity.hotspots.filter((h) => h.complexity > 20).length,
    maxComplexity: r.complexity.max,
    score: r.score,
    grade: r.grade,
  };
}

function readBaseline(file: string): CheckMetrics | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { metrics?: CheckMetrics };
    return raw.metrics ?? null;
  } catch {
    return null;
  }
}

function checkThresholds(m: CheckMetrics, t: CheckThresholds, out: CheckFailure[]): void {
  const rules: Array<[keyof CheckThresholds, keyof CheckMetrics, "max" | "min"]> = [
    ["maxCycles", "cycles", "max"],
    ["maxDeadExports", "deadExports", "max"],
    ["maxSdpViolations", "sdpViolations", "max"],
    ["maxVeryHighComplexity", "veryHighComplexity", "max"],
    ["maxComplexity", "maxComplexity", "max"],
    ["minScore", "score", "min"],
  ];
  for (const [tKey, mKey, dir] of rules) {
    const limit = t[tKey];
    if (limit === undefined) continue;
    const actual = m[mKey] as number;
    const bad = dir === "max" ? actual > limit : actual < limit;
    if (bad) {
      out.push({
        kind: "threshold",
        metric: mKey,
        limit,
        actual,
        message: `${mKey} is ${actual}, ${dir === "max" ? "exceeds max" : "below min"} ${limit}`,
      });
    }
  }
}

/** Metrics where an increase vs the baseline is a regression. */
const RATCHET_UP: Array<keyof CheckMetrics> = [
  "cycles",
  "deadExports",
  "sdpViolations",
  "veryHighComplexity",
];

function checkBaseline(m: CheckMetrics, base: CheckMetrics, out: CheckFailure[]): void {
  for (const key of RATCHET_UP) {
    const was = base[key] as number;
    const now = m[key] as number;
    if (now > was) {
      out.push({
        kind: "regression",
        metric: key,
        limit: was,
        actual: now,
        message: `${key} regressed: ${was} → ${now} (baseline ratchet)`,
      });
    }
  }
  if (m.score < base.score) {
    out.push({
      kind: "regression",
      metric: "score",
      limit: base.score,
      actual: m.score,
      message: `health score regressed: ${base.score} → ${m.score}`,
    });
  }
}

export interface QualityGateOptions {
  baselinePath?: string;
  thresholds?: CheckThresholds;
  /** Write the current metrics as the new baseline (gate still evaluated first). */
  updateBaseline?: boolean;
}

export async function runQualityGate(
  absDir: string,
  root: string,
  opts: QualityGateOptions = {},
): Promise<CheckResult> {
  const report = await buildReport(absDir, root);
  const metrics = metricsFromReport(report);
  const baselinePath = path.resolve(root, opts.baselinePath ?? BASELINE_FILENAME);
  const baseline = readBaseline(baselinePath);

  const failures: CheckFailure[] = [];
  if (opts.thresholds) checkThresholds(metrics, opts.thresholds, failures);
  if (baseline) checkBaseline(metrics, baseline, failures);

  let baselineUpdated = false;
  if (opts.updateBaseline) {
    const doc = {
      tool: "universal-ast-mapper",
      updatedAt: new Date().toISOString(),
      metrics,
    };
    fs.writeFileSync(baselinePath, JSON.stringify(doc, null, 2) + "\n", "utf8");
    baselineUpdated = true;
  }

  return {
    passed: failures.length === 0,
    metrics,
    baseline,
    baselinePath,
    baselineUpdated,
    failures,
  };
}
