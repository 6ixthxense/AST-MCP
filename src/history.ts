import fs from "node:fs";
import path from "node:path";
import type { ReportData } from "./report.js";

export interface HistoryEntry {
  date: string;       // ISO date string (generatedAt)
  score: number;
  grade: string;
  files: number;
  symbols: number;
  dead: number;
  cycles: number;
  maxComplexity: number;
  coverage: number;   // 0-100 integer
}

const HISTORY_SUBPATH = ".ast-map/history.json";

export function historyPath(root: string): string {
  return path.join(root, HISTORY_SUBPATH);
}

export function loadHistory(root: string): HistoryEntry[] {
  try {
    return JSON.parse(fs.readFileSync(historyPath(root), "utf8")) as HistoryEntry[];
  } catch {
    return [];
  }
}

/** Append current report to history (one entry per calendar day, keep last 30). */
export function appendHistory(root: string, report: ReportData): HistoryEntry[] {
  const entry: HistoryEntry = {
    date: report.generatedAt,
    score: report.score,
    grade: report.grade,
    files: report.fileCount,
    symbols: report.symbolCount,
    dead: report.dead.count,
    cycles: report.cycles.count,
    maxComplexity: report.complexity.max,
    coverage: Math.round(report.testCoverage.coverageRatio * 100),
  };
  const history = loadHistory(root);
  const today = entry.date.slice(0, 10);
  const filtered = history.filter((h) => h.date.slice(0, 10) !== today);
  const updated = [...filtered, entry].slice(-30);
  const p = historyPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(updated, null, 2), "utf8");
  return updated;
}
