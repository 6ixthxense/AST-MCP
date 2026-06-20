import fs from "node:fs";
import path from "node:path";
import type { TestCoverageMap } from "./testmap.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type CoverageFormat = "istanbul" | "lcov" | "clover" | "cobertura" | "auto";

export interface FileCoverage {
  file: string;
  /** 0–1 line coverage ratio from the actual instrumented report. */
  lineCoverage: number;
  /** 0–1 branch coverage ratio (if available). */
  branchCoverage?: number;
  /** 0–1 function coverage ratio (if available). */
  functionCoverage?: number;
  /** Total lines in the report. */
  lines?: number;
  /** Covered lines. */
  coveredLines?: number;
}

export interface MergedCoverage {
  format: CoverageFormat;
  reportPath: string;
  /** Per-file actual coverage from the instrumented report. */
  actual: FileCoverage[];
  /** Summary stats from the actual report. */
  summary: {
    totalFiles: number;
    coveredFiles: number;
    avgLineCoverage: number;
    avgBranchCoverage?: number;
  };
  /** Files in structural coverage that now have actual % data. */
  enriched: Array<{
    file: string;
    hasTests: boolean; // from structural map
    lineCoverage: number; // from actual report
    branchCoverage?: number;
  }>;
  /** Files with tests but 0% actual coverage (dead tests). */
  deadTests: string[];
  /** Files with no tests at all. */
  uncovered: string[];
}

// ─── Format detection ─────────────────────────────────────────────────────────

export function detectFormat(reportPath: string): CoverageFormat {
  const ext = path.extname(reportPath).toLowerCase();
  const base = path.basename(reportPath).toLowerCase();
  if (ext === ".json") {
    try {
      const raw = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Record<string, unknown>;
      if ("total" in raw && typeof raw.total === "object") return "istanbul";
      if ("version" in raw) return "clover";
    } catch { /* fall through */ }
    return "istanbul";
  }
  if (ext === ".lcov" || base.endsWith(".info") || base === "lcov.info") return "lcov";
  if (base.includes("clover")) return "clover";
  if (base.includes("cobertura")) return "cobertura";
  return "istanbul";
}

// ─── Istanbul JSON parser ─────────────────────────────────────────────────────

interface IstanbulFileSummary {
  lines?: { total: number; covered: number; pct: number };
  branches?: { total: number; covered: number; pct: number };
  functions?: { total: number; covered: number; pct: number };
}

function parseIstanbul(reportPath: string): FileCoverage[] {
  const raw = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  const results: FileCoverage[] = [];

  for (const [file, data] of Object.entries(raw)) {
    if (file === "total") continue;
    const d = data as IstanbulFileSummary;
    results.push({
      file: normalizeFile(file),
      lineCoverage: (d.lines?.pct ?? 0) / 100,
      branchCoverage: d.branches ? d.branches.pct / 100 : undefined,
      functionCoverage: d.functions ? d.functions.pct / 100 : undefined,
      lines: d.lines?.total,
      coveredLines: d.lines?.covered,
    });
  }
  return results;
}

// ─── lcov parser ─────────────────────────────────────────────────────────────

function parseLcov(reportPath: string): FileCoverage[] {
  const text = fs.readFileSync(reportPath, "utf8");
  const results: FileCoverage[] = [];
  let file = "";
  let linesFound = 0, linesHit = 0, branchFound = 0, branchHit = 0;

  for (const line of text.split("\n")) {
    const l = line.trim();
    if (l.startsWith("SF:")) {
      file = normalizeFile(l.slice(3));
    } else if (l.startsWith("LF:")) {
      linesFound = parseInt(l.slice(3), 10) || 0;
    } else if (l.startsWith("LH:")) {
      linesHit = parseInt(l.slice(3), 10) || 0;
    } else if (l.startsWith("BRF:")) {
      branchFound = parseInt(l.slice(4), 10) || 0;
    } else if (l.startsWith("BRH:")) {
      branchHit = parseInt(l.slice(4), 10) || 0;
    } else if (l === "end_of_record" && file) {
      results.push({
        file,
        lineCoverage: linesFound > 0 ? linesHit / linesFound : 0,
        branchCoverage: branchFound > 0 ? branchHit / branchFound : undefined,
        lines: linesFound,
        coveredLines: linesHit,
      });
      file = ""; linesFound = 0; linesHit = 0; branchFound = 0; branchHit = 0;
    }
  }
  return results;
}

// ─── Cobertura / Clover XML parser (minimal) ──────────────────────────────────

function parseXmlCoverage(reportPath: string): FileCoverage[] {
  const text = fs.readFileSync(reportPath, "utf8");
  const results: FileCoverage[] = [];
  // Match <class filename="..." line-rate="..." branch-rate="...">
  const classRe = /(?:filename|name)="([^"]+)"[^>]*(?:line-rate|lineRate)="([^"]+)"(?:[^>]*(?:branch-rate|branchRate)="([^"]+)")?/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(text)) !== null) {
    results.push({
      file: normalizeFile(m[1]),
      lineCoverage: parseFloat(m[2]) || 0,
      branchCoverage: m[3] ? parseFloat(m[3]) : undefined,
    });
  }
  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeFile(f: string): string {
  return f.replace(/\\/g, "/").replace(/^\.\//, "");
}

function parseReport(reportPath: string, format: CoverageFormat): FileCoverage[] {
  const effectiveFormat = format === "auto" ? detectFormat(reportPath) : format;
  if (effectiveFormat === "lcov") return parseLcov(reportPath);
  if (effectiveFormat === "clover" || effectiveFormat === "cobertura") return parseXmlCoverage(reportPath);
  return parseIstanbul(reportPath);
}

// ─── Merge ────────────────────────────────────────────────────────────────────

export function mergeCoverage(
  reportPath: string,
  structuralMap: TestCoverageMap,
  root: string,
  format: CoverageFormat = "auto",
): MergedCoverage {
  const actual = parseReport(reportPath, format === "auto" ? detectFormat(reportPath) : format);
  const effectiveFormat = format === "auto" ? detectFormat(reportPath) : format;

  // Index actual by normalised file path
  const actualByFile = new Map<string, FileCoverage>();
  for (const fc of actual) {
    // Try multiple key forms: absolute, root-relative, basename
    actualByFile.set(fc.file, fc);
    actualByFile.set(path.relative(root, fc.file).replace(/\\/g, "/"), fc);
    actualByFile.set(path.basename(fc.file), fc);
  }

  const testedSet = new Set(structuralMap.tested.map((f) => f.file));
  const untestedSet = new Set(structuralMap.untested.map((f) => f.file));

  const enriched: MergedCoverage["enriched"] = [];
  const deadTests: string[] = [];
  const uncovered: string[] = [];

  for (const src of structuralMap.tested) {
    const fc = actualByFile.get(src.file)
      ?? actualByFile.get(path.relative(root, src.file))
      ?? actualByFile.get(path.basename(src.file));
    const lineCov = fc?.lineCoverage ?? 0;
    if (lineCov === 0 && fc) deadTests.push(src.file);
    enriched.push({
      file: src.file,
      hasTests: true,
      lineCoverage: lineCov,
      branchCoverage: fc?.branchCoverage,
    });
  }

  for (const src of structuralMap.untested) {
    const fc = actualByFile.get(src.file)
      ?? actualByFile.get(path.relative(root, src.file))
      ?? actualByFile.get(path.basename(src.file));
    enriched.push({
      file: src.file,
      hasTests: false,
      lineCoverage: fc?.lineCoverage ?? 0,
      branchCoverage: fc?.branchCoverage,
    });
    if (!fc || fc.lineCoverage === 0) uncovered.push(src.file);
  }

  const totalLines = actual.reduce((s, f) => s + (f.lineCoverage ?? 0), 0);
  const avgLineCoverage = actual.length > 0 ? totalLines / actual.length : 0;
  const branchEntries = actual.filter((f) => f.branchCoverage !== undefined);
  const avgBranchCoverage = branchEntries.length > 0
    ? branchEntries.reduce((s, f) => s + (f.branchCoverage ?? 0), 0) / branchEntries.length
    : undefined;

  return {
    format: effectiveFormat,
    reportPath,
    actual,
    summary: {
      totalFiles: actual.length,
      coveredFiles: actual.filter((f) => f.lineCoverage > 0).length,
      avgLineCoverage,
      avgBranchCoverage,
    },
    enriched,
    deadTests,
    uncovered,
  };
}
