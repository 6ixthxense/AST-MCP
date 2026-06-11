/**
 * Test-coverage mapping — pair test files with the source files they exercise,
 * and surface source files no test touches.
 *
 * This is *structural* coverage (which files have tests at all), not line
 * coverage — no instrumentation, no test runner, works on a cold checkout.
 *
 * Two matching signals, strongest first:
 *   1. import  — a test file imports the source file (graph edge; definitive).
 *   2. name    — naming convention pairs them ("auth.test.ts" → "auth.ts",
 *                "test_utils.py" → "utils.py", "FooTest.java" → "Foo.java"),
 *                resolved to the candidate sharing the longest path prefix.
 */

import type { SymbolGraph, GraphSymbolNode, GraphFileNode } from "./graph.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface TestLink {
  /** Test file (rel path). */
  test: string;
  /** Source file it covers (rel path). */
  source: string;
  /** How the pair was established. */
  via: "import" | "name";
}

export interface TestedSource {
  file: string;
  /** Test files covering this source. */
  tests: string[];
}

export interface UntestedSource {
  file: string;
  /** Symbol count — bigger files are worse to leave untested. */
  symbols: number;
  /** Fan-in from other source files — load-bearing files are riskiest. */
  afferent: number;
}

export interface TestCoverageMap {
  sourceFiles: number;
  testFiles: number;
  /** Files under fixtures/mocks/testdata dirs — support material, excluded from both sides. */
  fixtureFiles: number;
  testedSources: number;
  untestedSources: number;
  /** testedSources / sourceFiles, 2-decimal (0 when no sources). */
  coverageRatio: number;
  links: TestLink[];
  tested: TestedSource[];
  /** Sorted by risk: afferent desc, then symbols desc. */
  untested: UntestedSource[];
  /** Test files that could not be paired with any source file. */
  orphanTests: string[];
}

// ─── Test-file detection ───────────────────────────────────────────────────────

const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "specs", "testing", "e2e", "integration-tests"]);

/** Support material, not tests and not production source: excluded from both sides. */
const FIXTURE_DIRS = new Set(["fixtures", "fixture", "__fixtures__", "__mocks__", "mocks", "testdata", "snapshots", "__snapshots__"]);

/** True when a rel path lives under a fixtures/mocks/testdata directory. */
export function isFixtureFile(rel: string): boolean {
  return rel.split("/").slice(0, -1).some((d) => FIXTURE_DIRS.has(d.toLowerCase()));
}

const TEST_BASENAME_PATTERNS: RegExp[] = [
  /\.(test|spec)\.[^.]+$/i,          // auth.test.ts, auth.spec.js
  /[_-](test|tests|spec)\.[^.]+$/i,  // auth_test.go, auth-test.js, auth_spec.rb
  /^(test|spec)[_-]/i,               // test_auth.py, spec_auth.rb
  /Tests?\.(java|cs|kt|kts|swift|scala)$/, // AuthTest.java, AuthTests.cs
  /Spec\.(java|cs|kt|kts|swift|scala)$/,   // AuthSpec.kt
];

/** True when a rel path (forward-slashed) looks like a test file. */
export function isTestFile(rel: string): boolean {
  const parts = rel.split("/");
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).some((d) => TEST_DIRS.has(d.toLowerCase()))) return true;
  return TEST_BASENAME_PATTERNS.some((re) => re.test(base));
}

/**
 * Derive the source basename a test file's name points at, or null when the
 * name carries no convention ("smoke.mjs" in a test dir → null).
 * "auth.test.ts" → "auth" · "test_utils.py" → "utils" · "AuthTest.java" → "Auth"
 */
export function testNameTarget(rel: string): string | null {
  const base = rel.split("/").pop()!;
  const noExt = base.replace(/\.[^.]+$/, "");
  let t = noExt
    .replace(/\.(test|spec)$/i, "")
    .replace(/[_-](test|tests|spec|smoke)$/i, "")
    .replace(/\.(smoke)$/i, "")
    .replace(/^(test|spec)[_-]/i, "")
    .replace(/(Test|Tests|Spec)$/, "");
  if (t === noExt || t.length === 0) return null;
  return t;
}

// ─── Mapping ───────────────────────────────────────────────────────────────────

function commonPrefixLen(a: string, b: string): number {
  const pa = a.split("/");
  const pb = b.split("/");
  let i = 0;
  while (i < pa.length - 1 && i < pb.length - 1 && pa[i] === pb[i]) i++;
  return i;
}

function baseNoExt(rel: string): string {
  return rel.split("/").pop()!.replace(/\.[^.]+$/, "");
}

/**
 * Build the test↔source coverage map from a symbol graph
 * (use `buildSymbolGraph` over a directory that includes the test files).
 */
export function mapTestCoverage(graph: SymbolGraph): TestCoverageMap {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const allFiles: GraphFileNode[] = graph.nodes.filter((n): n is GraphFileNode => n.nodeType === "file");
  const fixtureCount = allFiles.filter((f) => isFixtureFile(f.id)).length;
  const files = allFiles.filter((f) => !isFixtureFile(f.id));
  const testFiles = files.filter((f) => isTestFile(f.id));
  const sourceFiles = files.filter((f) => !isTestFile(f.id));
  const isTest = new Set(testFiles.map((f) => f.id));
  const sourceByBase = new Map<string, string[]>();
  for (const s of sourceFiles) {
    const b = baseNoExt(s.id).toLowerCase();
    (sourceByBase.get(b) ?? sourceByBase.set(b, []).get(b)!).push(s.id);
  }

  // Signal 1: import edges test → source. Also count source-side fan-in (Ca).
  const links: TestLink[] = [];
  const seen = new Set<string>();
  const afferent = new Map<string, Set<string>>(); // source ← importers (non-test)
  for (const e of graph.edges) {
    if (e.edgeType !== "imports") continue;
    const to = nodeMap.get(e.to);
    const toFile = to ? (to.nodeType === "file" ? to.id : (to as GraphSymbolNode).file) : null;
    if (!toFile || e.from === toFile) continue;
    if (isTest.has(e.from) && !isTest.has(toFile)) {
      const key = e.from + "|" + toFile;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ test: e.from, source: toFile, via: "import" });
      }
    } else if (!isTest.has(e.from) && !isTest.has(toFile)) {
      (afferent.get(toFile) ?? afferent.set(toFile, new Set()).get(toFile)!).add(e.from);
    }
  }

  // Signal 2: naming convention, for test files with no import link yet.
  const linkedTests = new Set(links.map((l) => l.test));
  for (const t of testFiles) {
    if (linkedTests.has(t.id)) continue;
    // Explicit marker in the name, else (for files inside test dirs, where the
    // dir itself is the marker) the plain basename: test/analysis.mjs → "analysis".
    const target = testNameTarget(t.id) ?? baseNoExt(t.id);
    const candidates = sourceByBase.get(target.toLowerCase());
    if (!candidates || candidates.length === 0) continue;
    // Prefer the candidate sharing the longest directory prefix with the test.
    let best: string[] = [];
    let bestScore = -1;
    for (const c of candidates) {
      const s = commonPrefixLen(t.id, c);
      if (s > bestScore) { bestScore = s; best = [c]; }
      else if (s === bestScore) best.push(c);
    }
    for (const c of best) {
      const key = t.id + "|" + c;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ test: t.id, source: c, via: "name" });
      }
    }
  }

  // Aggregate.
  const testsBySource = new Map<string, string[]>();
  for (const l of links) {
    (testsBySource.get(l.source) ?? testsBySource.set(l.source, []).get(l.source)!).push(l.test);
  }
  const tested: TestedSource[] = [];
  const untested: UntestedSource[] = [];
  for (const s of sourceFiles) {
    const tests = testsBySource.get(s.id);
    if (tests) tested.push({ file: s.id, tests: [...new Set(tests)].sort() });
    else untested.push({ file: s.id, symbols: s.symbolCount, afferent: afferent.get(s.id)?.size ?? 0 });
  }
  tested.sort((a, b) => a.file.localeCompare(b.file));
  untested.sort((a, b) => b.afferent - a.afferent || b.symbols - a.symbols || a.file.localeCompare(b.file));
  const covered = new Set(links.map((l) => l.test));
  const orphanTests = testFiles.map((f) => f.id).filter((id) => !covered.has(id)).sort();

  return {
    sourceFiles: sourceFiles.length,
    testFiles: testFiles.length,
    fixtureFiles: fixtureCount,
    testedSources: tested.length,
    untestedSources: untested.length,
    coverageRatio: sourceFiles.length === 0 ? 0 : Math.round((tested.length / sourceFiles.length) * 100) / 100,
    links,
    tested,
    untested,
    orphanTests,
  };
}
