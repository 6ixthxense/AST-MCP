#!/usr/bin/env node
import { program } from "commander";
import path from "node:path";
import fs from "node:fs";

import { buildSkeleton, collectSourceFiles } from "./skeleton.js";
import { renderHtml, renderCombinedHtml } from "./html.js";
import { resolveOptions, loadProjectConfig } from "./config.js";
import { initDiskCache, defaultCacheDir, diskCacheStats, clearDiskCache } from "./diskcache.js";
import { buildSkeletonsBulk } from "./pool.js";
import { supportedLanguages } from "./registry.js";
import { findSymbol, findRelatedSymbols, findServerImports, isApiRoute, findMissingTryCatch, checkGeneralRules, GENERAL_RULE_DEFAULTS } from "./analysis.js";
import { resolveFileImports } from "./resolver.js";
import { buildSymbolGraph } from "./graph.js";
import { findDeadExports, findCircularDeps, getChangeImpact, getFileDeps, getTopSymbols, findDuplicateSymbols } from "./graph-analysis.js";
import { computeFileComplexity } from "./complexity.js";
import { findUnusedParams } from "./unused-params.js";
import { traceTypeInFile } from "./typeflow.js";
import { discoverWorkspace, findPackageCycles } from "./workspace.js";
import { buildExplorerHtml } from "./explorer.js";
import { readSourceMap } from "./sourcemap.js";
import { buildReport, buildReportHtml } from "./report.js";
import { runQualityGate, BASELINE_FILENAME, type CheckThresholds } from "./check.js";
import { computeDiff, computeRisk, isGitRepo } from "./gitdiff.js";
import { packContext } from "./contextpack.js";
import { computeCoupling } from "./coupling.js";
import { findLayerViolations } from "./layers.js";
import { computeModuleCoupling } from "./modulecoupling.js";
import { buildCallGraph } from "./callgraph.js";
import { searchSymbols } from "./search.js";
import { semanticSearch } from "./semantic.js";
import type { SkeletonFile } from "./types.js";

import { parseRootsFromEnv } from "./roots.js";
const ROOT = parseRootsFromEnv().roots[0]; // CLI is local — no boundary, primary root only

// Persistent parse cache (disable with AST_MAP_NO_CACHE=1 or "cache": false in config).
if (process.env.AST_MAP_NO_CACHE !== "1" && loadProjectConfig(ROOT).cache !== false) {
  initDiskCache(defaultCacheDir(ROOT));
}

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
  const items = files.map((f) => ({ abs: f, rel: path.relative(ROOT, f).split(path.sep).join("/") }));
  const built = await buildSkeletonsBulk(items, opts);
  return built.filter((r) => r !== null).map((r) => r!.skel);
}

function die(msg: string): never {
  console.error(red("✗") + " " + msg);
  process.exit(1);
}

// ─── Command: cache ───────────────────────────────────────────────────────────

program
  .command("cache [action]")
  .description("Inspect or clear the persistent parse cache (actions: stats, clear)")
  .option("--json", "Output as JSON")
  .action((action: string | undefined, opts: { json?: boolean }) => {
    const dir = defaultCacheDir(ROOT);
    if (action === "clear") {
      const removed = clearDiskCache(dir);
      if (opts.json) jsonOut({ dir, removed });
      else console.log(green("\u2713") + ` cleared ${removed} cached ${removed === 1 ? "entry" : "entries"} (${dir})`);
      return;
    }
    const stats = diskCacheStats(dir);
    if (opts.json) jsonOut(stats);
    else {
      console.log(bold("Parse cache") + "  " + dim(stats.dir));
      console.log(`  entries: ${stats.entries}`);
      console.log(`  size:    ${(stats.bytes / 1024).toFixed(1)} KB`);
    }
  });

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
  .description("Scan for architecture violations (boundary rules + general structural rules)")
  .option("--max-lines <n>", `Flag files over N lines (default: ${GENERAL_RULE_DEFAULTS.largeFileLines})`)
  .option("--max-imports <n>", `Flag files with over N imports (default: ${GENERAL_RULE_DEFAULTS.tooManyImports})`)
  .option("--max-exports <n>", `Flag files with over N exports (default: ${GENERAL_RULE_DEFAULTS.godExportCount})`)
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, opts: { maxLines?: string; maxImports?: string; maxExports?: string; json?: boolean }) => {
    const { abs } = resolveArg(inputPath);
    const projectConfig = loadProjectConfig(ROOT);
    const skOpts = resolveOptions({ detail: "full", emitHtml: false }, projectConfig);
    const stat = fs.statSync(abs);
    const filesToCheck = stat.isDirectory() ? collectSourceFiles(abs, skOpts) : [abs];

    const thresholds = {
      largeFileLines: opts.maxLines
        ? parseInt(opts.maxLines, 10)
        : (projectConfig.rules?.["large-file"]?.maxLines ?? GENERAL_RULE_DEFAULTS.largeFileLines),
      tooManyImports: opts.maxImports
        ? parseInt(opts.maxImports, 10)
        : (projectConfig.rules?.["too-many-imports"]?.maxImports ?? GENERAL_RULE_DEFAULTS.tooManyImports),
      godExportCount: opts.maxExports
        ? parseInt(opts.maxExports, 10)
        : (projectConfig.rules?.["god-export"]?.maxExports ?? GENERAL_RULE_DEFAULTS.godExportCount),
    };

    interface Violation { file: string; rule: string; severity: "error" | "warning"; message: string; line?: number }
    const violations: Violation[] = [];

    for (const file of filesToCheck) {
      const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
      let source: string;
      try { source = fs.readFileSync(file, "utf8"); } catch { continue; }

      let skel;
      try { skel = await buildSkeleton(file, fileRel, skOpts); } catch { continue; }

      if (skel.directives?.includes("use client")) {
        for (const imp of findServerImports(source)) {
          violations.push({ file: fileRel, rule: "client-server-boundary", severity: "error",
            message: `"use client" imports server-only module "${imp.label}" (${imp.module})`, line: imp.line });
        }
      }

      if (isApiRoute(fileRel)) {
        const sourceLines = source.split("\n");
        for (const sym of findMissingTryCatch(skel.symbols, sourceLines)) {
          violations.push({ file: fileRel, rule: "api-missing-try-catch", severity: "warning",
            message: `API handler "${sym.name}" has no try/catch`, line: sym.range.startLine });
        }
      }

      const importCount = skel.imports?.length ?? 0;
      for (const v of checkGeneralRules(fileRel, source, skel.symbols, importCount, thresholds)) {
        violations.push(v);
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

    const highConf = dead.filter(d => d.confidence === "high");
    const lowConf  = dead.filter(d => d.confidence === "low");

    header(`Dead Code — ${rel}/  ${dim(`(${skeletons.length} files scanned)`)}`);
    if (dead.length === 0) {
      console.log(indent(green("✓ No dead exports found.")));
    } else {
      if (highConf.length > 0) {
        console.log(indent(`${bold("High confidence")} ${dim("— functions / classes / consts")}`));
        table(
          highConf.map(d => [d.file, d.symbol, d.kind]),
          [["File", 44], ["Symbol", 28], ["Kind", 10]],
        );
      }
      if (lowConf.length > 0) {
        console.log(`\n${indent(`${bold("Low confidence")} ${dim("— types / interfaces / enums (may be used as type annotations)")}`)}` );
        table(
          lowConf.map(d => [d.file, d.symbol, d.kind]),
          [["File", 44], ["Symbol", 28], ["Kind", 10]],
        );
      }
      console.log(`\n  ${yellow(`${highConf.length} high`)} · ${dim(`${lowConf.length} low`)} confidence dead export(s)`);
    }
    console.log();
  });

// ─── Command: watch ───────────────────────────────────────────────────────────

program
  .command("watch [dir]")
  .description("Rebuild analysis (and optionally the explorer) when files change")
  .option("-o, --out <file>", "Also regenerate the explorer HTML on each change")
  .action(async (dir: string | undefined, opts: { out?: string }) => {
    const { abs, rel } = resolveArg(dir ?? ".");
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    let building = false;
    let queued = false;
    async function rebuild(reason: string) {
      if (building) { queued = true; return; }
      building = true;
      try {
        const skels = await gatherSkeletons(abs);
        const graph = buildSymbolGraph(skels, ROOT);
        const dead = findDeadExports(graph).filter((d) => d.confidence === "high").length;
        const cycles = findCircularDeps(graph).length;
        let line = `${dim(new Date().toLocaleTimeString())}  ${bold(String(skels.length))} files · ${dead} dead · ${cycles} cycle(s)`;
        if (opts.out) {
          fs.writeFileSync(path.resolve(process.cwd(), opts.out), buildExplorerHtml(graph, abs), "utf8");
          line += ` · ${green("explorer updated")}`;
        }
        line += `  ${dim(reason)}`;
        console.log(line);
      } finally {
        building = false;
        if (queued) { queued = false; rebuild("(coalesced)"); }
      }
    }

    header(`Watching ${rel}/  ${dim("(Ctrl+C to stop)")}`);
    await rebuild("initial");

    let timer: ReturnType<typeof setTimeout> | null = null;
    const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".cs", ".c", ".cpp", ".h", ".hpp", ".kt", ".swift"]);
    fs.watch(abs, { recursive: true }, (_evt, file) => {
      if (!file) return;
      const f = String(file).split(path.sep).join("/");
      if (/(^|\/)(node_modules|\.git|dist|\.ast-map)(\/|$)/.test(f)) return;
      if (!exts.has(path.extname(f).toLowerCase())) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => rebuild(`(${f.split("/").pop()} changed)`), 300);
    });

    await new Promise(() => {}); // keep the process alive
  });

// ─── Command: sourcemap ───────────────────────────────────────────────────────

program
  .command("sourcemap <file>")
  .description("Show the original sources a compiled file maps back to")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, opts: { json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    const info = readSourceMap(abs, rel);
    if (!info) die(`No source map found for "${rel}"`);
    if (opts.json) return jsonOut(info);
    header(`Source Map — ${rel}  ${dim("(" + info.mapKind + ")")}`);
    for (const sourceFile of info.sources) console.log(indent(green("←") + " " + sourceFile));
    console.log(`\n  ${info.sources.length} original source(s)` + (info.hasContent ? dim(" · embeds sourcesContent") : ""));
    console.log();
  });

// ─── Command: pack ────────────────────────────────────────────────────────────

program
  .command("pack <file> [symbol]")
  .description("Minimal context pack for a symbol (source + dep signatures + dependents)")
  .option("--scan <dir>", "Directory to scan for dependents", ".")
  .option("--json", "Output as JSON")
  .action(async (file: string, symbol: string | undefined, opts: { scan: string; json?: boolean }) => {
    const { abs, rel } = resolveArg(file);
    if (fs.statSync(abs).isDirectory()) die(`"${rel}" is a directory; pass a file`);
    const scanAbs = resolveArg(opts.scan).abs;
    const pack = await packContext(abs, rel, ROOT, symbol, scanAbs);
    if (opts.json) return jsonOut(pack);
    header(`Context Pack \u2014 ${rel}${symbol ? "::" + symbol : ""}  ${dim("(~" + pack.tokenEstimate + " tokens)")}`);
    console.log(indent(bold("Primary") + dim(`  lines ${pack.primary.startLine}-${pack.primary.endLine}`)));
    console.log();
    console.log(indent(bold("Depends on:")));
    if (pack.dependencies.length === 0) console.log(indent(dim("(none in-project)"), 4));
    for (const d of pack.dependencies) {
      console.log(indent(green(d.file), 4));
      for (const sym of d.symbols) console.log(indent(dim((sym.signature || sym.name)), 6));
    }
    console.log();
    console.log(indent(bold("Depended on by:")));
    if (pack.dependents.length === 0) console.log(indent(dim("(none found in scan)"), 4));
    for (const dep of pack.dependents) console.log(indent(yellow(dep.file), 4));
    console.log();
  });

// ─── Command: diff ────────────────────────────────────────────────────────────

program
  .command("diff [base]")
  .description("Symbols changed since a git ref + breaking changes + blast radius")
  .option("--dir <dir>", "Limit to a subdirectory", ".")
  .option("--json", "Output as JSON")
  .action(async (base: string | undefined, opts: { dir: string; json?: boolean }) => {
    if (!isGitRepo(ROOT)) die("not a git repository (or git is unavailable)");
    const { abs, rel } = resolveArg(opts.dir);
    const ref = base ?? "HEAD";
    const d = await computeDiff(abs, ROOT, ref);
    if (opts.json) return jsonOut(d);
    header(`Diff since ${bold(ref)}  ${dim(`(${d.summary.filesChanged} file(s) · +${d.summary.added} ~${d.summary.modified} -${d.summary.removed})`)}`);
    if (d.files.length === 0) { console.log(indent(dim("No source-symbol changes."))); console.log(); return; }
    for (const f of d.files) {
      console.log(indent(`${bold(f.file)} ${dim("[" + f.status + "]")}`));
      for (const a of f.added) console.log(indent(green("+ ") + a.symbol + dim(a.exported ? " (exported)" : ""), 4));
      for (const m of f.modified) console.log(indent(yellow("~ ") + m.symbol + dim(m.exported ? " (exported)" : ""), 4));
      for (const r of f.removed) console.log(indent(red("- ") + r.symbol + dim(r.exported ? " (exported)" : ""), 4));
    }
    if (d.breaking.length > 0) {
      console.log(`\n${indent(bold(red("\u26a0 Breaking changes (" + d.breaking.length + ")")))}`);
      for (const b of d.breaking) console.log(indent(`${red(b.symbol)}  ${dim(b.reason)}  ${dim(b.file)}`, 4));
      console.log(`\n${indent(yellow(d.impactedFiles.length + " file(s) impacted") + dim(" by breaking changes"))}`);
      for (const f of d.impactedFiles.slice(0, 20)) console.log(indent(dim(f), 4));
    }
    console.log();
  });

// ─── Command: risk ────────────────────────────────────────────────────────────

program
  .command("risk [dir]")
  .description("Rank files by refactor risk (git churn × complexity)")
  .option("--json", "Output as JSON")
  .option("-n, --top <n>", "Show top N", (v) => parseInt(v, 10), 15)
  .action(async (dir: string | undefined, opts: { json?: boolean; top: number }) => {
    if (!isGitRepo(ROOT)) die("not a git repository (or git is unavailable)");
    const { abs, rel } = resolveArg(dir ?? ".");
    const files = await computeRisk(abs, ROOT);
    if (opts.json) return jsonOut({ count: files.length, files });
    header(`Refactor Risk \u2014 ${rel}/  ${dim("(churn × max complexity)")}`);
    if (files.length === 0) { console.log(indent(green("✓ nothing risky (no churn × complexity)"))); console.log(); return; }
    table(
      files.slice(0, opts.top).map((f) => [String(f.risk), `${f.churn} × ${f.maxComplexity}`, f.file]),
      [["Risk", 7], ["churn×cx", 12], ["File", 44]],
    );
    console.log();
  });

// ─── Command: coupling ────────────────────────────────────────────────────────

program
  .command("coupling [dir]")
  .description("Per-file coupling metrics: afferent (Ca), efferent (Ce), instability")
  .option("--json", "Output as JSON")
  .option("-n, --top <n>", "Show top N by total coupling", (v) => parseInt(v, 10), 25)
  .action(async (dir: string | undefined, opts: { json?: boolean; top: number }) => {
    const { abs, rel } = resolveArg(dir ?? ".");
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);
    const skeletons = await gatherSkeletons(abs);
    const metrics = computeCoupling(buildSymbolGraph(skeletons, ROOT));
    if (opts.json) return jsonOut({ count: metrics.length, files: metrics });
    header(`Coupling \u2014 ${rel}/  ${dim("(Ca = fan-in, Ce = fan-out, I = instability)")}`);
    if (metrics.length === 0) { console.log(indent(dim("No import edges found."))); console.log(); return; }
    const icolor = (i: number) => (i >= 0.8 ? red : i <= 0.2 ? green : yellow);
    table(
      metrics.slice(0, opts.top).map((m) => [String(m.afferent), String(m.efferent), icolor(m.instability)(m.instability.toFixed(2)), m.file]),
      [["Ca", 4], ["Ce", 4], ["I", 6], ["File", 46]],
    );
    console.log(indent(dim("high Ca = load-bearing (break carefully) · high I = volatile")));
    console.log();
  });

// ─── Command: layers ──────────────────────────────────────────────────────────

program
  .command("layers [dir]")
  .alias("sdp")
  .description("Stable Dependencies Principle: stable files that depend on volatile ones")
  .option("--json", "Output as JSON")
  .option("-g, --min-gap <n>", "Only show violations with instability gap > n", (v) => parseFloat(v), 0)
  .action(async (dir: string | undefined, opts: { json?: boolean; minGap: number }) => {
    const { abs, rel } = resolveArg(dir ?? ".");
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);
    const skeletons = await gatherSkeletons(abs);
    const violations = findLayerViolations(buildSymbolGraph(skeletons, ROOT), opts.minGap);
    if (opts.json) return jsonOut({ count: violations.length, violations });
    header(`Layer Violations \u2014 ${rel}/  ${dim("(stable \u2192 volatile dependencies, SDP)")}`);
    if (violations.length === 0) { console.log(indent(green("\u2713 No SDP violations \u2014 dependencies flow toward stability."))); console.log(); return; }
    for (const v of violations) {
      const sev = v.severity >= 0.4 ? red : v.severity >= 0.2 ? yellow : dim;
      console.log(indent(`${sev(v.severity.toFixed(2))}  ${bold(v.from)} ${dim(`(I=${v.fromInstability})`)} ${red("\u2192")} ${v.to} ${dim(`(I=${v.toInstability})`)}`));
    }
    console.log();
    console.log(indent(dim(`${violations.length} stable file(s) depend on more volatile ones \u2014 they churn when those do`)));
    console.log();
  });

// ─── Command: modules ─────────────────────────────────────────────────────────

program
  .command("modules [dir]")
  .alias("mods")
  .description("Directory/module-level coupling: per-module Ca / Ce / instability + edges")
  .option("--json", "Output as JSON")
  .action(async (dir: string | undefined, opts: { json?: boolean }) => {
    const { abs, rel } = resolveArg(dir ?? ".");
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);
    const skeletons = await gatherSkeletons(abs);
    const mc = computeModuleCoupling(buildSymbolGraph(skeletons, ROOT));
    if (opts.json) return jsonOut(mc);
    header(`Module Coupling \u2014 ${rel}/  ${dim("(directory-level Ca / Ce / instability)")}`);
    if (mc.modules.length === 0) { console.log(indent(dim("No cross-module imports found."))); console.log(); return; }
    const icolor = (i: number) => (i >= 0.8 ? red : i <= 0.2 ? green : yellow);
    table(
      mc.modules.map((m) => [String(m.files), String(m.afferent), String(m.efferent), icolor(m.instability)(m.instability.toFixed(2)), m.module]),
      [["Files", 6], ["Ca", 4], ["Ce", 4], ["I", 6], ["Module", 40]],
    );
    if (mc.edges.length) {
      console.log(indent(bold("Inter-module dependencies:")));
      for (const e of mc.edges.slice(0, 20)) console.log(indent(`  ${e.from} ${dim("\u2192")} ${e.to} ${dim(`(${e.weight})`)}`));
    }
    console.log();
  });

// ─── Command: report ──────────────────────────────────────────────────────────

program
  .command("report [dir]")
  .description("Generate a code-health dashboard (HTML)")
  .option("-o, --out <file>", "Output HTML path", "ast-report.html")
  .option("--json", "Print the report data as JSON")
  .action(async (dir: string | undefined, opts: { out: string; json?: boolean }) => {
    const { abs, rel } = resolveArg(dir ?? ".");
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);
    const data = await buildReport(abs, ROOT);
    if (opts.json) return jsonOut(data);
    const out = path.resolve(process.cwd(), opts.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buildReportHtml(data), "utf8");
    header(`Code Health \u2014 ${rel}/  ${dim(`(${data.fileCount} files)`)}`);
    const gcolor = data.grade === "A" || data.grade === "B" ? green : data.grade === "C" || data.grade === "D" ? yellow : (x: string) => x;
    console.log(indent(`Grade ${bold(gcolor(data.grade))}  ${dim("(" + data.score + "/100)")}  ·  ${data.dead.count} dead · ${data.cycles.count} cycles · max cx ${data.complexity.max}`));
    console.log(indent(green("✓ wrote " + path.relative(process.cwd(), out))));
    console.log();
  });

// ─── Command: check ───────────────────────────────────────────────────────────

const num = (v: string) => Number.parseFloat(v);

program
  .command("check [dir]")
  .description("CI quality gate: absolute thresholds + baseline ratchet (cycles, dead exports, SDP, complexity, score)")
  .option("--baseline <file>", `Baseline file (default ${BASELINE_FILENAME})`)
  .option("--update-baseline", "Write current metrics as the new baseline")
  .option("--max-cycles <n>", "Fail when circular dependencies exceed n", num)
  .option("--max-dead-exports <n>", "Fail when dead exports exceed n", num)
  .option("--max-sdp-violations <n>", "Fail when SDP/layer violations exceed n", num)
  .option("--max-very-high-complexity <n>", "Fail when functions with complexity > 20 exceed n", num)
  .option("--max-complexity <n>", "Fail when any function's complexity exceeds n", num)
  .option("--min-score <n>", "Fail when the health score drops below n", num)
  .option("--json", "Output the gate result as JSON")
  .action(async (dir: string | undefined, o: {
    baseline?: string; updateBaseline?: boolean; json?: boolean;
    maxCycles?: number; maxDeadExports?: number; maxSdpViolations?: number;
    maxVeryHighComplexity?: number; maxComplexity?: number; minScore?: number;
  }) => {
    const { abs, rel } = resolveArg(dir ?? ".");
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const fromConfig = loadProjectConfig(ROOT).check ?? {};
    const thresholds: CheckThresholds = {
      maxCycles: o.maxCycles ?? fromConfig.maxCycles,
      maxDeadExports: o.maxDeadExports ?? fromConfig.maxDeadExports,
      maxSdpViolations: o.maxSdpViolations ?? fromConfig.maxSdpViolations,
      maxVeryHighComplexity: o.maxVeryHighComplexity ?? fromConfig.maxVeryHighComplexity,
      maxComplexity: o.maxComplexity ?? fromConfig.maxComplexity,
      minScore: o.minScore ?? fromConfig.minScore,
    };

    const result = await runQualityGate(abs, ROOT, {
      baselinePath: o.baseline,
      thresholds,
      updateBaseline: o.updateBaseline,
    });

    if (o.json) {
      jsonOut(result);
      if (!result.passed) process.exit(1);
      return;
    }

    header(`Quality gate \u2014 ${rel}/`);
    const m = result.metrics;
    const b = result.baseline;
    const delta = (key: keyof typeof m) =>
      b ? dim(` (baseline ${String(b[key])})`) : "";
    console.log(indent(`score ${bold(String(m.score))}/100 (${m.grade})${delta("score")}`));
    console.log(indent(`cycles ${m.cycles}${delta("cycles")} · dead exports ${m.deadExports}${delta("deadExports")} · SDP ${m.sdpViolations}${delta("sdpViolations")}`));
    console.log(indent(`complexity: max ${m.maxComplexity} · very-high (>20) ${m.veryHighComplexity}${delta("veryHighComplexity")}`));

    if (result.baselineUpdated) {
      console.log(indent(green("\u2713") + " baseline updated: " + path.relative(process.cwd(), result.baselinePath)));
    } else if (!b) {
      console.log(indent(dim(`no baseline (${path.relative(process.cwd(), result.baselinePath)}) \u2014 run with --update-baseline to create one`)));
    }

    if (result.failures.length > 0) {
      console.log();
      for (const f of result.failures) {
        console.log(indent(red("\u2717") + ` [${f.kind}] ${f.message}`));
      }
      console.log();
      console.log(indent(red(`gate FAILED \u2014 ${result.failures.length} violation(s)`)));
      process.exit(1);
    }
    console.log(indent(green("\u2713 gate passed")));
    console.log();
  });

// ─── Command: explore ─────────────────────────────────────────────────────────

program
  .command("explore [dir]")
  .description("Generate an interactive HTML dependency-graph explorer")
  .option("-o, --out <file>", "Output HTML path")
  .action(async (dir: string | undefined, opts: { out?: string }) => {
    const { abs, rel } = resolveArg(dir ?? ".");
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const skeletons = await gatherSkeletons(abs);
    const graph = buildSymbolGraph(skeletons, ROOT);
    const html = buildExplorerHtml(graph, abs);

    const outPath = opts.out
      ? path.resolve(process.cwd(), opts.out)
      : path.join(abs, "ast-explorer.html");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, "utf8");

    header(`Graph Explorer — ${rel}/  ${dim(`(${skeletons.length} files)`)}`);
    console.log(indent(green("✓ wrote " + path.relative(process.cwd(), outPath))));
    console.log(indent(dim("open it in a browser — drag nodes, scroll to zoom, click to highlight, filter by name")));
    console.log();
  });

// ─── Command: workspace ───────────────────────────────────────────────────────

program
  .command("workspace [dir]")
  .alias("ws")
  .description("Discover monorepo packages and their internal dependency graph")
  .option("--json", "Output as JSON")
  .action(async (dir: string | undefined, opts: { json?: boolean }) => {
    const { abs, rel } = resolveArg(dir ?? ".");
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const info = discoverWorkspace(abs);
    const cycles = findPackageCycles(info);

    if (opts.json) {
      return jsonOut({ root: rel, tool: info.tool, packageCount: info.packages.length, packages: info.packages, edges: info.edges, packageCycles: cycles });
    }

    header(`Workspace — ${rel}/  ${dim(`(${info.tool}, ${info.packages.length} package(s))`)}`);
    if (info.packages.length === 0) {
      console.log(indent(dim("No workspace packages found (no workspaces/pnpm-workspace.yaml/lerna.json).")));
    } else {
      table(
        info.packages.map((p) => [
          p.name,
          p.dir,
          p.internalDeps.length > 0 ? yellow(`→ ${p.internalDeps.join(", ")}`) : dim("(no internal deps)"),
        ]),
        [["Package", 24], ["Dir", 22], ["Internal deps", 34]],
      );
      if (cycles.length > 0) {
        console.log(`\n${indent(bold(yellow("Circular package dependencies:")))}`);
        for (const c of cycles) console.log(indent(`${yellow("↻")}  ${c.join(dim(" → "))}`));
      }
      console.log(`\n  ${info.edges.length} internal edge(s)` + (cycles.length ? ` · ${yellow(`${cycles.length} cycle(s)`)}` : ""));
    }
    console.log();
  });

// ─── Command: trace-type ──────────────────────────────────────────────────────

program
  .command("trace-type <type> [dir]")
  .alias("flow")
  .description("Trace a type through params, returns, variables and fields")
  .option("--json", "Output as JSON")
  .action(async (typeName: string, dir: string | undefined, opts: { json?: boolean }) => {
    const { abs, rel } = resolveArg(dir ?? ".");
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const sopts = resolveOptions({ detail: "outline", emitHtml: false });
    const refs = [];
    for (const file of collectSourceFiles(abs, sopts)) {
      const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
      refs.push(...(await traceTypeInFile(file, fileRel, typeName)));
    }

    if (opts.json) return jsonOut({ type: typeName, dir: rel, refCount: refs.length, refs });

    header(`Type Flow: ${bold(typeName)} — ${rel}/  ${dim(`(${refs.length} ref(s))`)}`);
    if (refs.length === 0) {
      console.log(indent(dim(`No references to type "${typeName}" found in signatures.`)));
    } else {
      const roleColor = (r: string) => (r === "return" ? green : r === "param" ? yellow : dim);
      table(
        refs.map((r) => [
          roleColor(r.role)(r.role),
          r.symbol + (r.detail ? `(${r.detail})` : ""),
          `:${r.line}`,
          r.file,
        ]),
        [["Role", 9], ["Symbol", 24], ["Line", 6], ["File", 34]],
      );
    }
    console.log();
  });

// ─── Command: unused-params ───────────────────────────────────────────────────

program
  .command("unused-params <path>")
  .alias("unused")
  .description("Find function parameters that are never used in the body")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, opts: { json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    const stat = fs.statSync(abs);

    const results = [];
    if (stat.isDirectory()) {
      const sopts = resolveOptions({ detail: "outline", emitHtml: false });
      for (const file of collectSourceFiles(abs, sopts)) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
        const r = await findUnusedParams(file, fileRel);
        if (r && r.functions.length > 0) results.push(r);
      }
    } else {
      const r = await findUnusedParams(abs, rel);
      if (!r) die(`Unsupported file type: ${rel}`);
      if (r.functions.length > 0) results.push(r);
    }

    const rows = results.flatMap((r) => r.functions.map((f) => ({ file: r.file, ...f })));

    if (opts.json) return jsonOut({ path: rel, count: rows.length, functions: rows });

    header(`Unused Parameters — ${rel}`);
    if (rows.length === 0) {
      console.log(indent(green("✓ No unused parameters found.")));
    } else {
      table(
        rows.map((f) => [f.function, yellow(f.unused.join(", ")), f.file]),
        [["Function", 26], ["Unused params", 28], ["File", 36]],
      );
      const totalP = rows.reduce((a, f) => a + f.unused.length, 0);
      console.log(`\n  ${yellow(`${totalP} unused parameter(s)`)} in ${rows.length} function(s)`);
    }
    console.log();
  });

// ─── Command: complexity ──────────────────────────────────────────────────────

program
  .command("complexity <path>")
  .alias("cx")
  .description("Cyclomatic complexity per function (file or directory)")
  .option("--json", "Output as JSON")
  .option("--min <n>", "Only show functions with complexity >= n", (v) => parseInt(v, 10))
  .action(async (inputPath: string, opts: { json?: boolean; min?: number }) => {
    const { abs, rel } = resolveArg(inputPath);
    const stat = fs.statSync(abs);
    const min = opts.min ?? 1;

    const fileResults = [];
    if (stat.isDirectory()) {
      const sopts = resolveOptions({ detail: "outline", emitHtml: false });
      for (const file of collectSourceFiles(abs, sopts)) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
        const fc = await computeFileComplexity(file, fileRel);
        if (fc) fileResults.push(fc);
      }
    } else {
      const fc = await computeFileComplexity(abs, rel);
      if (!fc) die(`Unsupported file type: ${rel}`);
      fileResults.push(fc);
    }

    const rows = fileResults
      .flatMap((r) => r.functions.map((f) => ({ file: r.file, ...f })))
      .filter((f) => f.complexity >= min)
      .sort((a, b) => b.complexity - a.complexity);

    if (opts.json) return jsonOut({ path: rel, functionCount: rows.length, functions: rows });

    header(`Cyclomatic Complexity — ${rel}  ${dim(`(${fileResults.length} file(s))`)}`);
    if (rows.length === 0) {
      console.log(indent(green("✓ No functions found.")));
    } else {
      const colorFor = (r: string) => (r === "very-high" || r === "high" ? yellow : r === "moderate" ? bold : dim);
      table(
        rows.slice(0, 40).map((f) => [String(f.complexity), colorFor(f.rating)(f.rating), f.name, f.file]),
        [["Cx", 4], ["Rating", 11], ["Function", 26], ["File", 38]],
      );
      const high = rows.filter((f) => f.complexity > 10).length;
      console.log(`\n  ${rows.length} function(s)` + (high > 0 ? ` · ${yellow(`${high} above 10`)}` : ""));
    }
    console.log();
  });

// ─── Command: duplicates ──────────────────────────────────────────────────────

program
  .command("duplicates <dir>")
  .alias("dupes")
  .description("Find symbol names exported from more than one file")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, opts: { json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const skeletons = await gatherSkeletons(abs);
    const graph = buildSymbolGraph(skeletons, ROOT);
    const duplicates = findDuplicateSymbols(graph);

    if (opts.json) return jsonOut({ directory: rel, scanned: skeletons.length, duplicateCount: duplicates.length, duplicates });

    header(`Duplicate Symbols — ${rel}/  ${dim(`(${skeletons.length} files scanned)`)}`);
    if (duplicates.length === 0) {
      console.log(indent(green("✓ No duplicate exported symbols found.")));
    } else {
      for (const d of duplicates) {
        console.log(indent(`${yellow(d.symbol)} ${dim(`— exported from ${d.count} files`)}`));
        for (const loc of d.locations) {
          console.log(indent(`${dim(col(loc.kind, 10))} ${loc.file}`, 5));
        }
      }
      console.log(`\n  ${yellow(`${duplicates.length} duplicated name(s)`)}`);
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
    const graph = buildSymbolGraph(skeletons, ROOT);
    const cycles = findCircularDeps(graph);

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

// ─── Command: search ─────────────────────────────────────────────────────────

program
  .command("search <pattern> [dir]")
  .description("Find symbols by name across all files in a directory")
  .option("-m, --match <type>", "contains (default) | exact | regex", "contains")
  .option("-k, --kind <kind>", "Filter by kind: function, class, interface, type, method, const…")
  .option("-e, --exported", "Only show exported symbols")
  .option("--json", "Output as JSON")
  .action(async (pattern: string, dir: string | undefined, opts: { match?: string; kind?: string; exported?: boolean; json?: boolean }) => {
    const searchDir = dir ?? ".";
    const { abs, rel } = resolveArg(searchDir);
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const matchType = (opts.match ?? "contains") as "contains" | "exact" | "regex";
    const matches = await searchSymbols(abs, pattern, ROOT, {
      matchType,
      kind: opts.kind,
      exportedOnly: opts.exported,
    });

    if (opts.json) return jsonOut({ directory: rel, pattern, matchCount: matches.length, matches });

    header(`Symbol Search — ${bold(`"${pattern}"`)} in ${rel}/`);
    if (matches.length === 0) {
      console.log(indent(dim("No matches found.")));
    } else {
      table(
        matches.map(m => [m.file, m.symbol, m.kind, m.exported ? green("✓") : dim("–")]),
        [["File", 40], ["Symbol", 30], ["Kind", 12], ["Exported", 8]],
      );
      console.log(`\n  ${matches.length} match(es)`);
    }
    console.log();
  });

// ─── Command: find (semantic search) ─────────────────────────────────────────

program
  .command("find <query> [dir]")
  .description("Semantic symbol search — find symbols by meaning, not exact name")
  .option("-l, --limit <n>", "Max results (default 20)", "20")
  .option("-k, --kind <kind>", "Filter by kind: function, class, interface, type, method, const…")
  .option("-e, --exported", "Only show exported symbols")
  .option("--json", "Output as JSON")
  .action(async (query: string, dir: string | undefined, opts: { limit?: string; kind?: string; exported?: boolean; json?: boolean }) => {
    const searchDir = dir ?? ".";
    const { abs, rel } = resolveArg(searchDir);
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const limit = Math.max(1, parseInt(opts.limit ?? "20", 10) || 20);
    const matches = await semanticSearch(abs, query, ROOT, {
      limit,
      kind: opts.kind,
      exportedOnly: opts.exported,
    });

    if (opts.json) return jsonOut({ directory: rel, query, matchCount: matches.length, matches });

    header(`Semantic Search — ${bold(`"${query}"`)} in ${rel}/`);
    if (matches.length === 0) {
      console.log(indent(dim("No matches found.")));
    } else {
      table(
        matches.map(m => [
          m.score.toFixed(3),
          m.file,
          m.symbol,
          m.kind,
          m.matchedTerms.slice(0, 4).join(", "),
        ]),
        [["Score", 6], ["File", 34], ["Symbol", 26], ["Kind", 10], ["Matched", 30]],
      );
      console.log(`\n  ${matches.length} match(es)`);
    }
    console.log();
  });

// ─── Command: deps ────────────────────────────────────────────────────────────

program
  .command("deps <file>")
  .description("Show what a file imports and what imports it")
  .option("--scan <dir>", "Directory to build the graph from (default: file's directory)")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, opts: { scan?: string; json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    if (fs.statSync(abs).isDirectory()) die(`Provide a single file path, not a directory`);

    const scanRoot = opts.scan ? resolveArg(opts.scan).abs : path.dirname(abs);
    const skeletons = await gatherSkeletons(scanRoot);
    const graph = buildSymbolGraph(skeletons, ROOT);
    const fileId = rel;
    const result = getFileDeps(graph, fileId);

    if (!result) die(`"${rel}" not found in graph — check it's inside the scan directory and is a supported source file`);
    if (opts.json) return jsonOut(result);

    header(`File Dependencies — ${bold(rel)}`);

    console.log(`\n${indent(`${bold("Imports from")} ${dim(`(${result.imports.length} files)`)}`)}`);
    if (result.imports.length === 0) {
      console.log(indent(dim("  (no local imports)"), 2));
    } else {
      for (const dep of result.imports) {
        const syms = dep.symbols.length > 0 ? dim(`  [${dep.symbols.slice(0, 5).join(", ")}${dep.symbols.length > 5 ? ` +${dep.symbols.length - 5}` : ""}]`) : "";
        console.log(indent(`${green("→")}  ${dep.file}${syms}`, 4));
      }
    }

    console.log(`\n${indent(`${bold("Imported by")} ${dim(`(${result.importedBy.length} files)`)}`)}`);
    if (result.importedBy.length === 0) {
      console.log(indent(dim("  (no files import this)"), 2));
    } else {
      for (const dep of result.importedBy) {
        const syms = dep.symbols.length > 0 ? dim(`  [${dep.symbols.slice(0, 5).join(", ")}${dep.symbols.length > 5 ? ` +${dep.symbols.length - 5}` : ""}]`) : "";
        console.log(indent(`${gray("←")}  ${dep.file}${syms}`, 4));
      }
    }
    console.log();
  });

// ─── Command: top ─────────────────────────────────────────────────────────────

program
  .command("top <dir>")
  .description("Show the most-imported symbols — find God Nodes before they hurt you")
  .option("-n, --limit <n>", "Number of results to show", "10")
  .option("--json", "Output as JSON")
  .action(async (inputPath: string, opts: { limit?: string; json?: boolean }) => {
    const { abs, rel } = resolveArg(inputPath);
    if (!fs.statSync(abs).isDirectory()) die(`"${rel}" is not a directory`);

    const skeletons = await gatherSkeletons(abs);
    const graph = buildSymbolGraph(skeletons, ROOT);
    const limit = Math.max(1, parseInt(opts.limit ?? "10", 10) || 10);
    const top = getTopSymbols(graph, limit);

    if (opts.json) return jsonOut({ directory: rel, scanned: skeletons.length, topSymbols: top });

    header(`Top Imported Symbols — ${rel}/  ${dim(`(${skeletons.length} files)`)}`);
    if (top.length === 0) {
      console.log(indent(dim("No import edges found.")));
    } else {
      table(
        top.map((s, i) => [
          String(i + 1).padStart(2),
          s.symbol,
          s.file,
          s.kind,
          yellow(String(s.importCount)),
        ]),
        [["#", 3], ["Symbol", 28], ["File", 38], ["Kind", 10], ["Used by", 7]],
      );
    }
    console.log();
  });

// ─── Root metadata ────────────────────────────────────────────────────────────

program
  .name("ast-map")
  .description("CLI for universal-ast-mapper — structural code analysis tools")
  .version("0.5.3")
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
  ast-map search validateSession src/ --exported
  ast-map deps src/lib/auth.ts --scan src/
  ast-map top src/ -n 15
  ast-map impact src/utils.ts sanitize --scan src/
  ast-map calls src/utils.ts buildCallGraph --scan src/

${bold("Root:")}
  Defaults to cwd. Override with AST_MAP_ROOT=<path> or run from your project root.
`);

program.parseAsync(process.argv).catch(err => {
  console.error(red("Fatal: ") + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
