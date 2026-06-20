import fs from "node:fs";
import path from "node:path";
import type { SkeletonFile, SymbolNode } from "./types.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export type TestFramework = "vitest" | "jest" | "mocha" | "node" | "pytest" | "gotest";

export interface TestGenOptions {
  /** Override auto-detected framework. */
  framework?: TestFramework;
  /** Only generate tests for exported symbols (default: true). */
  exportedOnly?: boolean;
  /** Custom output directory; defaults to same directory as source. */
  outDir?: string;
}

export interface TestGenResult {
  /** Relative source file path. */
  sourceFile: string;
  /** Absolute path where test file would be written. */
  testFilePath: string;
  /** Framework used. */
  framework: TestFramework;
  /** Generated test file content. */
  content: string;
  /** Number of `it/test` stubs generated. */
  testCount: number;
}

// ─── Framework detection ───────────────────────────────────────────────────────

/** Infer the test framework from the nearest package.json. */
export function detectTestFramework(root: string): TestFramework {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["vitest"]) return "vitest";
    if (deps["jest"] || deps["@jest/core"] || deps["ts-jest"] || deps["babel-jest"]) return "jest";
    if (deps["mocha"]) return "mocha";
  } catch { /* no package.json */ }
  return "node";
}

/** Derive the conventional test file path for a source file. */
export function resolveTestPath(sourceAbs: string, lang: string, outDir?: string): string {
  const dir = outDir ?? path.dirname(sourceAbs);
  const base = path.basename(sourceAbs);
  const ext = path.extname(base);
  const stem = base.slice(0, -ext.length);
  if (lang === "python") return path.join(dir, `test_${stem}.py`);
  if (lang === "go") return path.join(dir, `${stem}_test.go`);
  if (lang === "java") return path.join(dir, `${stem}Test.java`);
  if (lang === "ruby") return path.join(dir, `${stem}_spec.rb`);
  return path.join(dir, `${stem}.test${ext}`);
}

// ─── Signature helpers ─────────────────────────────────────────────────────────

/** Extract param names from a function signature, returned as comment hints. */
function paramHints(sym: SymbolNode): string {
  const s = sym.signature ?? "";
  const m = s.match(/\(([^)]*)\)/);
  if (!m || !m[1].trim()) return "";
  return m[1]
    .split(",")
    .map((p) => {
      const raw = p.trim()
        .replace(/^\.\.\./, "")
        .replace(/:.*$/, "")
        .replace(/=.*$/, "")
        .replace(/\?$/, "")
        .trim();
      return raw && raw !== "this" ? raw : null;
    })
    .filter(Boolean)
    .map((n) => `/* ${n} */`)
    .join(", ");
}

function isAsync(sym: SymbolNode): boolean {
  return (sym.signature ?? "").includes("async ");
}

// ─── JavaScript / TypeScript ───────────────────────────────────────────────────

function jsFrameworkHeader(fw: TestFramework): string[] {
  if (fw === "vitest") return [`import { describe, it, expect, beforeEach, vi } from 'vitest';`];
  if (fw === "jest")   return [`import { describe, it, expect, beforeEach, jest } from '@jest/globals';`];
  if (fw === "mocha")  return [`import { describe, it } from 'mocha';`, `import { expect } from 'chai';`];
  // node:test (default)
  return [`import { describe, it } from 'node:test';`, `import assert from 'node:assert/strict';`];
}

function jsAssert(fw: TestFramework, expr: string, indent: string): string {
  if (fw === "node")
    return `${indent}assert.ok(${expr}); // TODO: assert expected value`;
  return `${indent}expect(${expr}).toBeDefined(); // TODO: assert expected value`;
}

function jsSymbolTests(sym: SymbolNode, fw: TestFramework, isTs: boolean): { lines: string[]; count: number } {
  const lines: string[] = [];
  let count = 0;

  if (sym.kind === "function") {
    const hint = paramHints(sym);
    const awaitKw = isAsync(sym) ? "await " : "";
    const itKw = isAsync(sym) ? "it('should ...', async () => {" : "it('should ...', () => {";
    count++;
    lines.push(
      `describe('${sym.name}', () => {`,
      `  ${itKw}`,
      `    // TODO: arrange`,
      `    const result = ${awaitKw}${sym.name}(${hint});`,
      jsAssert(fw, "result", "    "),
      `  });`,
      `});`,
      "",
    );
  } else if (sym.kind === "class") {
    const publicMethods = sym.children.filter(
      (c) => c.kind === "method" && c.visibility === "public" && c.name !== "constructor",
    );
    const typeAnno = isTs ? `: ${sym.name}` : "";
    lines.push(
      `describe('${sym.name}', () => {`,
      `  let instance${typeAnno};`,
      "",
      `  beforeEach(() => {`,
      `    instance = new ${sym.name}(/* TODO: constructor args */);`,
      `  });`,
      "",
    );
    if (publicMethods.length === 0) {
      count++;
      lines.push(
        `  it('should be instantiable', () => {`,
        jsAssert(fw, "instance", "    "),
        `  });`,
      );
    } else {
      for (const m of publicMethods) {
        const hint = paramHints(m);
        const awaitKw = isAsync(m) ? "await " : "";
        const itKw = isAsync(m) ? `it('${m.name}: should ...', async () => {` : `it('${m.name}: should ...', () => {`;
        count++;
        lines.push(
          `  ${itKw}`,
          `    // TODO: arrange`,
          `    const result = ${awaitKw}instance.${m.name}(${hint});`,
          jsAssert(fw, "result", "    "),
          `  });`,
          "",
        );
      }
    }
    lines.push(`});`, "");
  } else if (sym.kind === "const" || sym.kind === "var") {
    count++;
    lines.push(
      `describe('${sym.name}', () => {`,
      `  it('should be defined', () => {`,
      jsAssert(fw, sym.name, "    "),
      `  });`,
      `});`,
      "",
    );
  }

  return { lines, count };
}

function generateJsTest(skel: SkeletonFile, syms: SymbolNode[], fw: TestFramework, isTs: boolean): { content: string; testCount: number } {
  const lines: string[] = [...jsFrameworkHeader(fw), ""];

  const srcBase = path.basename(skel.file).replace(/\.[^.]+$/, "");
  const srcPath = `./${srcBase}${isTs ? "" : ".js"}`;

  const runtimeImports = syms.filter((s) => !["interface", "type"].includes(s.kind)).map((s) => s.name);
  if (runtimeImports.length > 0)
    lines.push(`import { ${runtimeImports.join(", ")} } from '${srcPath}';`);

  if (isTs) {
    const typeImports = syms.filter((s) => s.kind === "interface" || s.kind === "type").map((s) => s.name);
    if (typeImports.length > 0)
      lines.push(`import type { ${typeImports.join(", ")} } from '${srcPath}';`);
  }

  lines.push("");

  let testCount = 0;
  for (const sym of syms) {
    const { lines: symLines, count } = jsSymbolTests(sym, fw, isTs);
    lines.push(...symLines);
    testCount += count;
  }

  return { content: lines.join("\n"), testCount };
}

// ─── Python ───────────────────────────────────────────────────────────────────

function generatePyTest(skel: SkeletonFile, syms: SymbolNode[]): { content: string; testCount: number } {
  const lines: string[] = ["import pytest", ""];
  const mod = path.basename(skel.file).replace(/\.py$/, "");
  const fns = syms.filter((s) => s.kind === "function" && !s.name.startsWith("_"));
  const classes = syms.filter((s) => s.kind === "class");

  const toImport = [...fns.map((s) => s.name), ...classes.map((s) => s.name)];
  if (toImport.length > 0) lines.push(`from .${mod} import ${toImport.join(", ")}`, "");

  let testCount = 0;

  for (const fn of fns) {
    const hint = paramHints(fn).replace(/\/\* (\w+) \*\//g, "$1");
    testCount++;
    lines.push(
      `def test_${fn.name}():`,
      `    # TODO: arrange`,
      `    result = ${fn.name}(${hint})`,
      `    assert result is not None  # TODO: assert expected value`,
      "",
    );
  }

  for (const cls of classes) {
    const methods = cls.children.filter((c) => c.kind === "method" && c.visibility === "public" && !c.name.startsWith("__"));
    lines.push(`class Test${cls.name}:`, "");
    lines.push(`    def setup_method(self):`, `        self.instance = ${cls.name}()  # TODO: args`, "");
    if (methods.length === 0) {
      testCount++;
      lines.push(`    def test_created(self):`, `        assert self.instance is not None`, "");
    } else {
      for (const m of methods) {
        const hint = paramHints(m).replace(/\/\* (\w+) \*\//g, "$1");
        testCount++;
        lines.push(
          `    def test_${m.name}(self):`,
          `        # TODO: arrange`,
          `        result = self.instance.${m.name}(${hint})`,
          `        assert result is not None  # TODO: assert expected value`,
          "",
        );
      }
    }
  }

  return { content: lines.join("\n"), testCount };
}

// ─── Go ───────────────────────────────────────────────────────────────────────

function generateGoTest(skel: SkeletonFile, syms: SymbolNode[]): { content: string; testCount: number } {
  const pkgDir = path.dirname(skel.file).split("/").pop() ?? "main";
  const lines: string[] = [`package ${pkgDir}`, "", `import (`, `\t"testing"`, `)`, ""];

  let testCount = 0;
  const fns = syms.filter((s) => s.kind === "function" && s.exported);
  const structs = syms.filter((s) => s.kind === "struct" && s.exported);

  for (const fn of fns) {
    const hint = paramHints(fn).replace(/\/\* (\w+) \*\//g, "/* $1 */");
    testCount++;
    lines.push(
      `func Test${fn.name}(t *testing.T) {`,
      `\t// TODO: arrange`,
      `\t_ = ${fn.name}(${hint})`,
      `\t// if got != want { t.Errorf("expected %v, got %v", want, got) }`,
      `}`,
      "",
    );
  }

  for (const s of structs) {
    const methods = s.children.filter((c) => c.kind === "method" && c.visibility === "public");
    for (const m of methods) {
      testCount++;
      lines.push(
        `func Test${s.name}_${m.name}(t *testing.T) {`,
        `\t// TODO: arrange`,
        `\t// instance := ${s.name}{}`,
        `\t// got := instance.${m.name}(/* args */)`,
        `\t// if got != want { t.Errorf("expected %v, got %v", want, got) }`,
        `}`,
        "",
      );
    }
  }

  return { content: lines.join("\n"), testCount };
}

// ─── Java ─────────────────────────────────────────────────────────────────────

function generateJavaTest(skel: SkeletonFile, syms: SymbolNode[]): { content: string; testCount: number } {
  const classes = syms.filter((s) => s.kind === "class" && s.exported);
  const lines: string[] = [
    `import org.junit.jupiter.api.Test;`,
    `import org.junit.jupiter.api.BeforeEach;`,
    `import static org.junit.jupiter.api.Assertions.*;`,
    "",
  ];

  let testCount = 0;

  for (const cls of classes) {
    const methods = cls.children.filter((c) => c.kind === "method" && c.visibility === "public");
    lines.push(`class ${cls.name}Test {`, "", `    private ${cls.name} instance;`, "");
    lines.push(`    @BeforeEach`, `    void setUp() {`, `        instance = new ${cls.name}(); // TODO: args`, `    }`, "");

    if (methods.length === 0) {
      testCount++;
      lines.push(`    @Test`, `    void shouldBeCreated() {`, `        assertNotNull(instance);`, `    }`, "");
    } else {
      for (const m of methods) {
        if (m.name === "constructor" || m.name === cls.name) continue;
        testCount++;
        const camel = m.name.charAt(0).toUpperCase() + m.name.slice(1);
        lines.push(
          `    @Test`,
          `    void ${m.name}ShouldWork() {`,
          `        // TODO: arrange`,
          `        var result = instance.${m.name}(/* args */);`,
          `        assertNotNull(result); // TODO: assert expected value`,
          `    }`,
          "",
        );
      }
    }
    lines.push(`}`);
  }

  return { content: lines.join("\n"), testCount };
}

// ─── Ruby ─────────────────────────────────────────────────────────────────────

function generateRubyTest(skel: SkeletonFile, syms: SymbolNode[]): { content: string; testCount: number } {
  const srcRel = "./" + path.basename(skel.file).replace(/\.rb$/, "");
  const lines: string[] = [`require 'rspec'`, `require_relative '${srcRel}'`, ""];

  let testCount = 0;
  const classes = syms.filter((s) => s.kind === "class");
  const fns = syms.filter((s) => s.kind === "function");

  for (const cls of classes) {
    const methods = cls.children.filter((c) => c.kind === "method" && c.visibility === "public" && !c.name.startsWith("initialize"));
    lines.push(`RSpec.describe ${cls.name} do`, `  subject { described_class.new }`, "");
    if (methods.length === 0) {
      testCount++;
      lines.push(`  it 'is instantiable' do`, `    expect(subject).not_to be_nil`, `  end`, "");
    } else {
      for (const m of methods) {
        testCount++;
        lines.push(
          `  describe '#${m.name}' do`,
          `    it 'should ...' do`,
          `      # TODO: arrange`,
          `      result = subject.${m.name}(/* args */)`,
          `      expect(result).not_to be_nil`,
          `    end`,
          `  end`,
          "",
        );
      }
    }
    lines.push(`end`, "");
  }

  for (const fn of fns) {
    testCount++;
    lines.push(
      `RSpec.describe '${fn.name}' do`,
      `  it 'should ...' do`,
      `    result = ${fn.name}(/* args */)`,
      `    expect(result).not_to be_nil`,
      `  end`,
      `end`,
      "",
    );
  }

  return { content: lines.join("\n"), testCount };
}

// ─── Entry point ───────────────────────────────────────────────────────────────

/** Generate a test file for a parsed skeleton. Returns content and metadata. */
export function generateTestFile(
  skel: SkeletonFile,
  sourceAbs: string,
  opts: TestGenOptions = {},
): TestGenResult {
  const fw = opts.framework ?? "node";
  const exportedOnly = opts.exportedOnly ?? true;
  const syms = exportedOnly
    ? skel.symbols.filter((s) => s.exported !== false)
    : skel.symbols;
  const testPath = resolveTestPath(sourceAbs, skel.language, opts.outDir);

  const lang = skel.language;
  let content: string;
  let testCount: number;

  if (lang === "typescript" || lang === "tsx") {
    ({ content, testCount } = generateJsTest(skel, syms, fw, true));
  } else if (lang === "javascript" || lang === "jsx") {
    ({ content, testCount } = generateJsTest(skel, syms, fw, false));
  } else if (lang === "python") {
    ({ content, testCount } = generatePyTest(skel, syms));
  } else if (lang === "go") {
    ({ content, testCount } = generateGoTest(skel, syms));
  } else if (lang === "java") {
    ({ content, testCount } = generateJavaTest(skel, syms));
  } else if (lang === "ruby") {
    ({ content, testCount } = generateRubyTest(skel, syms));
  } else {
    content = `// Test file for ${skel.file}\n// Language: ${lang} — add tests manually\n`;
    testCount = 0;
  }

  return { sourceFile: skel.file, testFilePath: testPath, framework: fw, content, testCount };
}
