#!/usr/bin/env node
import { program } from "commander";
import path from "node:path";
import fs from "node:fs";

import { buildSkeleton, collectSourceFiles } from "./skeleton.js";
import { renderHtml, renderCombinedHtml } from "./html.js";
import { resolveOptions } from "./config.js";
import { supportedLanguages } from "./registry.js";
import { findSymbol, findRelatedSymbols, hasDirective, findServerImports, isApiRoute, findMissingTryCatch } from "./analysis.js";
import { resolveFileImports } from "./resolver.js";
import { buildSymbolGraph } from "./graph.js";
import { findDeadExports, findCircularDeps, getChangeImpact } from "./graph-analysis.js";
import { buildCallGraph } from "./callgraph.js";
import type { SkeletonFile } from "./types.js";

const ROOT = path.resolve(process.env.AST_MAP_ROOT ?? process.cwd());

// ─── ANSI colours (disabled when not a TTY) ───────────────────────────────────
const tty = process.stdout.isTTY ?? false;
const esc = (code: string) => (s: string) => tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const bold   = esc("1");
const dim    = esc("2");
const red    = esc("31");
const green  = esc("32");
const yellow = esc("33");
const blue   = esc("34");
const cyan   = esc("36");
const gray   = esc("90");

// ─── Layout helpers ───────────────────────────────────────────────────────────

function header(title: string) {
  console.log(`\n${bold(title)}`);
  console.log(dim("─".repeat(Math.min(title.length + 4, 60))));
}

function indent(s: string, n = 2) { return " ".repeat(n) + s; }

function col(s: string, w: number) { return s.padEnd(w).slice(0, w); }

/** Minimal ASCII table — cols is array of [header, width] */
function table(rows: string[][], cols: Array<[string, number]>) {
  const header_row = cols.map(([h, w]) => bold(col(h, w))).join("  ");
  const sep = cols.map(([, w]) => dim("─".repeat(w))).join("  ");
  console.log(indent(header_row));
  console.log(indent(sep));
  for (const row of rows) {
    console.log(indent(row.map((cell, i) => col(cell, cols[i][1])).join("  ")));
  }
}

function jsonOut(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

// ─── Shared utilities ─────────────────────────────────────────────────────────

function resolveArg(p: string): { abs: string; rel: string } {
  const abs = path.resolve(ROOT, p);
  const rel = path.relative(ROOT, abs).split(path.sep).join("/") || ".";
  return { abs, rel };
}

async function gatherSkeletons(dirAbs: string, detail: "outline" | "full" = "outline"): Promise<SkeletonFile[]> {
  const opts = resolveOptions({ detail, emitHtml: false });
  const files = collectSourceFiles(dirAbs, opts);
  const skeletons: SkeletonFile[] = [];
  for (const file of files) {
    const fr = path.relative(ROOT, file).split(path.sep).join("/");
    try { skeletons.push(await buildSkeleton(file, fr, opts)); } catch { /* skip parse errors */ }
  }
  return skeletons;
}

function die(msg: string): never {
  console.error(red("✗") + " " + msg);
  process.exit(1);
}

// ─── Command: langs ───────────────────────────────────────────────────────────

program
  .command("langs")
  .description("List all supported languages and file extensions")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => {
    const langs = supportedLanguages();
    if (opts.json) return jsonOut({ root: ROOT, languages: langs });

    header("Supported Languages");
    for (const { language, extensions } of langs) {
      console.log(indent(`${cyan(col(language, 14))}  ${dim(extensions.join("  "))}`));
    }
    console.log();
  });

// ─── Command: skeleton ────────────────────────────────────────────────────────

program
  .command("skeleton <path>")
  .description("Parse a file or directory into a normalized code skeleton")
  .option("-d, --detail <level>", "outline or full", "outline")
  .option("--html", "Write per-file HTML views to .ast-map/")
  .option("--combine", "Write a combined index.html (directory mode only)")
  .option("-o, --output <dir>", "HTML output directory (default: .ast-map)")
  .option("--json", "Output raw skeleton JSON")
  .action(async (inputPath: string, opts: { detail?: string; html?: boolean; combine?: boolean; output?: string; json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    const detail = (opts.detail ?? "outline") as "outline" | "full";
    const skOpts = resolveOptions({ detail, emitHtml: opts.html, combineHtml: opts.combine, outputDir: opts.output });

    try {
      if (fs.statSync(abs).isDirectory()) {
        const files = collectSourceFiles(abs, skOpts);
        const skeletons: SkeletonFile[] = [];
        const errors: string[] = [];

        for (const file of files) {
          const fr = path.relative(ROOT, file).split(path.sep).join("/");
          try {
            const skel = await buildSkeleton(file, fr, skOpts);
            skeletons.push(skel);
            if (opts.html) {
              const outDir = opts.output ? path.resolve(ROOT, opts.output) : path.join(ROOT, ".ast-map");
              fs.mkdirSync(path.dirname(path.join(outDir, fr)), { recursive: true });
              fs.writeFileSync(path.join(outDir, `${fr}-skeleton.html`), renderHtml(skel), "utf8");
            }
          } catch (e) {
            errors.push(`${fr}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        let combinedPath: string | null = null;
        if (opts.combine && skeletons.length > 0) {
          const outDir = opts.output ? path.resolve(ROOT, opts.output) : path.join(ROOT, ".ast-map");
          fs.mkdirSync(outDir, { recursive: true });
          combinedPath = path.join(outDir, "index.html");
          fs.writeFileSync(combinedPath, renderCombinedHtml(skeletons), "utf8");
        }

        if (opts.json) return jsonOut(skeletons);

        header(`Skeleton — ${rel}/ (${skeletons.length} files)`);
        table(
          skeletons.map(s => [s.file, s.language, String(s.symbolCount)]),
          [["File", 44], ["Lang", 12], ["Symbols", 7]],
        );
        if (errors.length > 0) {
          console.log(`\n${yellow("Errors:")} ${errors.length}`);
          for (const e of errors) console.log(indent(dim(e)));
        }
        if (combinedPath) console.log(`\n${green("✓")} Combined HTML → ${combinedPath}`);
        console.log();

      } else {
        const skel = await buildSkeleton(abs, rel, skOpts);
        if (opts.json) return jsonOut(skel);

        header(`Skeleton — ${skel.file}  ${dim("(" + skel.language + ")")}`);
        for (const sym of skel.symbols) {
          const exp = sym.exported ? green(" ✓") : "";
          const range = dim(`L${sym.range.startLine}–${sym.range.endLine}`);
          console.log(indent(`${cyan(col(sym.kind, 12))} ${bold(sym.name)}${exp}  ${range}`));
          for (const child of sym.children) {
            console.log(indent(indent(`${dim(col(child.kind, 12))} ${dim(child.name)}  ${dim(`L${child.range.startLine}`)}`)));
          }
        }
        if (opts.html) {
          const outDir = opts.output ? path.resolve(ROOT, opts.output) : path.join(ROOT, ".ast-map");
          const htmlPath = path.join(outDir, `${rel}-skeleton.html`);
          fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
          fs.writeFileSync(htmlPath, renderHtml(skel), "utf8");
          console.log(`\n${green("✓")} HTML → ${htmlPath}`);
        }
        console.log();
      }
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
  });

// ─── Command: symbol ──────────────────────────────────────────────────────────

program
  .command("symbol <file> <name>")
  .description("Extract exact source lines of a named symbol")
  .option("-k, --kind <kind>", "Narrow by symbol kind (function/class/etc)")
  .option("--related", "Also show related types referenced in the signature")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, name: string, opts: { kind?: string; related?: boolean; json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    try {
      const source = fs.readFileSync(abs, "utf8");
      const sourceLines = source.split("\n");
      const skOpts = resolveOptions({ detail: "full", emitHtml: false });
      const skel = await buildSkeleton(abs, rel, skOpts);
      const found = findSymbol(skel.symbols, name, opts.kind);
      if (!found) die(`Symbol "${name}" not found in ${rel}`);

      const code = sourceLines.slice(found.range.startLine - 1, found.range.endLine).join("\n");
      const related = opts.related ? findRelatedSymbols(skel.symbols, found, sourceLines) : [];

      if (opts.json) return jsonOut({ file: rel, symbol: found.name, kind: found.kind, range: found.range, code, related });

      header(`${found.kind}  ${bold(found.name)}  ${dim(rel)}`);
      console.log(dim(`  Lines ${found.range.startLine}–${found.range.endLine}\n`));
      console.log(code);

      if (related.length > 0) {
        console.log(`\n${bold("Related types:")}`);
        for (const r of related) {
          console.log(`\n${dim(`── ${r.name} (${r.kind})`)}  ${dim(`L${r.range.startLine}`)}`);
          console.log(r.code);
        }
      }
      console.log();
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
  });

// ─── Command: imports ─────────────────────────────────────────────────────────

program
  .command("imports <file>")
  .description("Resolve all import statements to their source definitions")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, opts: { json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    try {
      const skOpts = resolveOptions({ detail: "full", emitHtml: false });
      const skel = await buildSkeleton(abs, rel, skOpts);
      const resolved = await resolveFileImports(skel, abs, ROOT);

      if (opts.json) return jsonOut({ file: rel, importCount: resolved.length, resolved });

      header(`Imports — ${rel} (${resolved.length})`);
      for (const r of resolved) {
        const status = r.found ? green("✓") : r.importKind === "external" ? blue("pkg") : red("✗");
        const alias = r.alias ? dim(` as ${r.alias}`) : "";
        const target = r.resolvedRel ?? r.from;
        const kind = r.kind ? dim(` [${r.kind}]`) : "";
        console.log(indent(`${status}  ${col(r.symbol, 28)}${alias}${kind}  ${dim(target)}`));
      }
      console.log();
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
  });

// ─── Command: graph ───────────────────────────────────────────────────────────

program
  .command("graph <dir>")
  .description("Build and inspect the symbol-level dependency graph")
  .option("-d, --detail <level>", "outline or full", "outline")
  .option("-o, --out <file>", "Write graph JSON to a file")
  .option("--json", "Output graph as JSON (stdout)")
  .action(async (inputPath: string, opts: { detail?: string; out?: string; json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const skeletons = await gatherSkeletons(abs, (opts.detail ?? "outline") as "outline" | "full");
    const graph = buildSymbolGraph(skeletons, ROOT);

    if (opts.out) {
      const outAbs = path.resolve(ROOT, opts.out);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, JSON.stringify(graph, null, 2), "utf8");
      console.log(green("✓") + ` Graph written → ${opts.out}`);
      return;
    }
    if (opts.json) return jsonOut(graph);

    const importEdges = graph.edges.filter(e => e.edgeType === "imports").length;
    header(`Symbol Graph — ${rel}/`);
    console.log(indent(`${bold("Files:")}    ${graph.stats.fileCount}`));
    console.log(indent(`${bold("Symbols:")}  ${graph.stats.symbolNodeCount}`));
    console.log(indent(`${bold("Edges:")}    ${graph.stats.edgeCount}  ${dim(`(${importEdges} cross-file imports)`)}`));
    console.log();
  });

// ─── Command: validate ────────────────────────────────────────────────────────

program
  .command("validate <path>")
  .description("Scan for Next.js App Router architecture violations")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, opts: { json?: boolean }) => {
    const { abs } = resolveArg(inputPath);
    const skOpts = resolveOptions({ detail: "full", emitHtml: false });
    const stat = fs.statSync(abs);
    const filesToCheck = stat.isDirectory() ? collectSourceFiles(abs, skOpts) : [abs];

    interface Violation { file: string; rule: string; severity: "error" | "warning"; message: string; line?: number }
    const violations: Violation[] = [];

    for (const file of filesToCheck) {
      const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
      let source: string;
      try { source = fs.readFileSync(file, "utf8"); } catch { continue; }

      if (hasDirective(source, "use client")) {
        for (const imp of findServerImports(source)) {
          violations.push({ file: fileRel, rule: "client-server-boundary", severity: "error",
            message: `"use client" imports server-only module "${imp.label}" (${imp.module})`, line: imp.line });
        }
      }

      if (isApiRoute(fileRel)) {
        try {
          const skel = await buildSkeleton(file, fileRel, skOpts);
          const sourceLines = source.split("\n");
          for (const sym of findMissingTryCatch(skel.symbols, sourceLines)) {
            violations.push({ file: fileRel, rule: "api-missing-try-catch", severity: "warning",
              message: `API handler "${sym.name}" has no try/catch`, line: sym.range.startLine });
          }
        } catch { /* skip */ }
      }
    }

    if (opts.json) return jsonOut({ scanned: filesToCheck.length, violations });

    const errors = violations.filter(v => v.severity === "error");
    const warnings = violations.filter(v => v.severity === "warning");
    header(`Validate — ${filesToCheck.length} files scanned`);

    if (violations.length === 0) {
      console.log(indent(green("✓ No architecture violations found.")));
    } else {
      for (const v of violations) {
        const icon = v.severity === "error" ? red("✗") : yellow("⚠");
        const line = v.line ? dim(`:${v.line}`) : "";
        console.log(indent(`${icon}  ${dim(v.file + line)}  ${v.message}`));
      }
      console.log(`\n  ${red(`${errors.length} error(s)`)}, ${yellow(`${warnings.length} warning(s)`)}`);
    }
    console.log();
  });

// ─── Command: dead ────────────────────────────────────────────────────────────

program
  .command("dead <dir>")
  .description("Find exported symbols that are never imported within the directory")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, opts: { json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const skeletons = await gatherSkeletons(abs);
    const graph = buildSymbolGraph(skeletons, ROOT);
    const dead = findDeadExports(graph);

    if (opts.json) return jsonOut({ directory: rel, scanned: skeletons.length, deadExportCount: dead.length, deadExports: dead });

    header(`Dead Code — ${rel}/  ${dim(`(${skeletons.length} files scanned)`)}`);
    if (dead.length === 0) {
      console.log(indent(green("✓ No dead exports found.")));
    } else {
      table(
        dead.map(d => [d.file, d.symbol, d.kind]),
        [["File", 44], ["Symbol", 28], ["Kind", 10]],
      );
      console.log(`\n  ${yellow(`${dead.length} dead export(s) found`)}`);
    }
    console.log();
  });

// ─── Command: cycles ──────────────────────────────────────────────────────────

program
  .command("cycles <dir>")
  .description("Detect circular import dependencies")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, opts: { json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const skeletons = await gatherSkeletons(abs);
    const cycles = findCircularDeps(skeletons, ROOT);

    if (opts.json) return jsonOut({ directory: rel, scanned: skeletons.length, cycleCount: cycles.length, cycles });

    header(`Circular Dependencies — ${rel}/  ${dim(`(${skeletons.length} files scanned)`)}`);
    if (cycles.length === 0) {
      console.log(indent(green("✓ No circular dependencies found.")));
    } else {
      for (const { cycle, length } of cycles) {
        const arrow = dim(" → ");
        console.log(indent(`${yellow("↻")}  ${dim(`(${length}-cycle)`)}  ${cycle.join(arrow)}`));
      }
      console.log(`\n  ${yellow(`${cycles.length} cycle(s) found`)}`);
    }
    console.log();
  });

// ─── Command: impact ──────────────────────────────────────────────────────────

program
  .command("impact <file> <symbol>")
  .description("Show the blast radius of changing a symbol (all dependents)")
  .option("--scan <dir>", "Directory to build the graph from (default: file's directory)")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, symbol: string, opts: { scan?: string; json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    if (fs.statSync(abs).isDirectory()) die(`Provide a single file path, not a directory`);

    const scanRoot = opts.scan ? resolveArg(opts.scan).abs : path.dirname(abs);
    const skeletons = await gatherSkeletons(scanRoot);
    const graph = buildSymbolGraph(skeletons, ROOT);
    const targetId = `${rel}::${symbol}`;
    const impact = getChangeImpact(graph, targetId);

    if (!impact) die(`Symbol "${symbol}" not found in graph for "${rel}". Check that the symbol is exported and the scan dir includes this file.`);
    if (opts.json) return jsonOut(impact);

    header(`Change Impact — ${bold(symbol)}  ${dim(rel)}`);
    console.log(indent(`${bold("Direct")} ${dim(`(${impact.direct.length})`)}`));
    if (impact.direct.length === 0) {
      console.log(indent(dim("  (none)"), 2));
    } else {
      for (const d of impact.direct) {
        console.log(indent(`${cyan("→")}  ${d.file}${d.symbol ? dim("::" + d.symbol) : ""}`, 4));
      }
    }

    console.log(`\n${indent(`${bold("Transitive")} ${dim(`(${impact.transitive.length})`)}`)}`);
    if (impact.transitive.length === 0) {
      console.log(indent(dim("  (none)"), 2));
    } else {
      for (const t of impact.transitive) {
        console.log(indent(`${gray("↝")}  ${t.file}${t.symbol ? dim("::" + t.symbol) : ""}`, 4));
      }
    }

    console.log(`\n  ${bold("Total affected files:")} ${impact.totalFiles}`);
    console.log();
  });

// ─── Command: calls ───────────────────────────────────────────────────────────

program
  .command("calls <file> <function>")
  .description("Show the call graph for a function (what it calls + who calls it)")
  .option("--scan <dir>", "Directory to scan for reverse lookup (calledBy)")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, funcName: string, opts: { scan?: string; json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    if (fs.statSync(abs).isDirectory()) die(`Provide a single file path, not a directory`);

    const scanRoot = opts.scan ? resolveArg(opts.scan).abs : path.dirname(abs);
    const skeletons = await gatherSkeletons(scanRoot);
    const result = await buildCallGraph(abs, funcName, ROOT, skeletons);

    if (!result) die(`Function "${funcName}" not found in "${rel}". Check the name and ensure the language is supported.`);
    if (opts.json) return jsonOut(result);

    header(`Call Graph — ${bold(funcName + "()")}  ${dim(rel)}`);
    console.log(dim(`  Lines ${result.functionRange.startLine}–${result.functionRange.endLine}`));

    console.log(`\n${indent(`${bold("Calls")} ${dim(`(${result.calls.length})`)}`)}`);
    if (result.calls.length === 0) {
      console.log(indent(dim("  (no calls detected)"), 2));
    } else {
      for (const call of result.calls) {
        const loc = dim(`L${call.line}`);
        let origin: string;
        if (call.isLocal) origin = dim("local");
        else if (call.isExternal) origin = blue(call.calleeFileRel ?? "external");
        else if (call.calleeFileRel) origin = cyan(call.calleeFileRel);
        else origin = dim("?");
        console.log(indent(`${green("→")}  ${col(call.callee, 32)} ${loc}  ${origin}`, 4));
      }
    }

    console.log(`\n${indent(`${bold("Called By")} ${dim(`(${result.calledBy.length})`)}`)}`);
    if (result.calledBy.length === 0) {
      console.log(indent(dim("  (no importers found in scan dir)"), 2));
    } else {
      for (const cb of result.calledBy) {
        console.log(indent(`${gray("←")}  ${cb.file}`, 4));
      }
    }
    console.log();
  });

// ─── Root metadata ────────────────────────────────────────────────────────────

program
  .name("ast-map")
  .description("CLI for universal-ast-mapper — structural code analysis tools")
  .version("0.3.0")
  .addHelpText("after", `
${bold("Examples:")}
  ast-map langs
  ast-map skeleton src/
  ast-map symbol src/utils.ts sanitize --related
  ast-map imports src/pages/login.tsx
  ast-map graph src/ -o graph.json
  ast-map validate src/
  ast-map dead src/
  ast-map cycles src/
  ast-map impact src/utils.ts sanitize --scan src/
  ast-map calls src/utils.ts buildCallGraph --scan src/

${bold("Root:")}
  Defaults to cwd. Override with AST_MAP_ROOT=<path> or run from your project root.
`);

program.parseAsync(process.argv).catch(err => {
  console.error(red("Fatal: ") + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
