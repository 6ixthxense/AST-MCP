import https from "node:https";
import type { SkeletonFile, SymbolNode } from "./types.js";
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

async function callClaude(prompt: string, opts: ExplainOptions): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key — set ANTHROPIC_API_KEY or pass --api-key");

  const body = JSON.stringify({
    model: opts.model ?? "claude-sonnet-4-6",
    max_tokens: opts.maxTokens ?? 1024,
    messages: [{ role: "user", content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            const parsed = JSON.parse(raw) as { error?: { message: string }; content?: Array<{ text: string }> };
            if (parsed.error) reject(new Error(`Anthropic API: ${parsed.error.message}`));
            else resolve(parsed.content?.[0]?.text ?? "");
          } catch { reject(new Error(`Unexpected API response`)); }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function aiExplain(
  result: ExplainResult,
  sourceCode: string,
  opts: ExplainOptions = {},
): Promise<ExplainResult> {
  const aiExplanation = await callClaude(buildPrompt(result, sourceCode), opts);
  return { ...result, aiExplanation };
}
