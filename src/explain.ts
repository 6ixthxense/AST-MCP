import type { SkeletonFile, SymbolNode } from "./types.js";
import { callClaude } from "./anthropic.js";
import type { SymbolGraph } from "./graph.js";
import type { ChangeImpact } from "./graph-analysis.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ExplainResult {
  symbol: string;
  file: string;
  kind: string;
  signature?: string | null;
  /** Structural summary (no AI). */
  summary: {
    callerFiles: string[];
    callerCount: number;
    dependsOn: string[];
    childCount: number;
    lineCount: number;
    isExported: boolean;
    isAsync: boolean;
  };
  smells: string[];
  complexityRating?: string;
  /** AI-generated prose explanation (requires API key). */
  aiExplanation?: string;
}

export interface ExplainOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** Include AI explanation (requires API key). */
  ai?: boolean;
}

// ─── Structural analysis ──────────────────────────────────────────────────────

export function buildExplainResult(
  symbolName: string,
  skel: SkeletonFile,
  graph: SymbolGraph,
  impact: ChangeImpact | null,
  smells: string[],
  complexityRating?: string,
): ExplainResult {
  // Find the symbol node in the skeleton
  const sym = findSymbolNode(skel.symbols, symbolName);

  // Callers = files that transitively depend on this symbol
  const callerFiles = impact
    ? [...new Set([...impact.direct, ...impact.transitive].map((n) => n.file))]
    : [];

  // Dependencies = what this file imports that relate to this symbol
  const dependsOn = (skel.imports ?? [])
    .filter((imp) => imp.symbol || imp.from)
    .map((imp) => imp.symbol ? `${imp.symbol} from ${imp.from}` : imp.from)
    .slice(0, 10);

  const lineCount = sym ? sym.range.endLine - sym.range.startLine + 1 : 0;
  const isAsync = !!(sym?.signature?.includes("async "));
  const isExported = sym?.exported !== false;

  return {
    symbol: symbolName,
    file: skel.file,
    kind: sym?.kind ?? "unknown",
    signature: sym?.signature,
    summary: {
      callerFiles: callerFiles.slice(0, 20),
      callerCount: impact ? impact.totalFiles : 0,
      dependsOn,
      childCount: sym?.children.length ?? 0,
      lineCount,
      isExported,
      isAsync,
    },
    smells,
    complexityRating,
  };
}

function findSymbolNode(symbols: SymbolNode[], name: string): SymbolNode | undefined {
  for (const sym of symbols) {
    if (sym.name === name) return sym;
    const child = findSymbolNode(sym.children, name);
    if (child) return child;
  }
  return undefined;
}

// ─── AI explanation ───────────────────────────────────────────────────────────

function buildPrompt(result: ExplainResult, sourceCode: string): string {
  const callers = result.summary.callerFiles.slice(0, 8).join(", ") || "none detected";
  const deps = result.summary.dependsOn.slice(0, 6).join(", ") || "none";
  const smellsStr = result.smells.length ? result.smells.join(", ") : "none";

  return `You are a senior software engineer explaining a codebase symbol to a teammate.

## Symbol: \`${result.symbol}\`
- Kind: ${result.kind}
- File: ${result.file}
- Signature: ${result.signature ?? "(no signature)"}
- Exported: ${result.summary.isExported}
- Async: ${result.summary.isAsync}
- Line count: ${result.summary.lineCount}
- Complexity rating: ${result.complexityRating ?? "unknown"}
- Code smells: ${smellsStr}
- Depends on: ${deps}
- Used by (${result.summary.callerCount} files): ${callers}

## Source snippet (first 60 lines):
\`\`\`
${sourceCode.split("\n").slice(0, 60).join("\n")}
\`\`\`

Explain this symbol in 3–5 concise sentences covering:
1. What it does (purpose, not implementation)
2. When/why callers use it
3. Key dependencies or side effects worth knowing
4. Change risk: what breaks if this symbol is modified or removed

Do NOT include code. Plain prose only. Be specific, not generic.`;
}

export async function aiExplain(
  result: ExplainResult,
  sourceCode: string,
  opts: ExplainOptions = {},
): Promise<ExplainResult> {
  const aiExplanation = await callClaude(buildPrompt(result, sourceCode), opts, 1024);
  return { ...result, aiExplanation };
}
