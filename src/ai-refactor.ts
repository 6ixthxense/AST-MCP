import https from "node:https";
import fs from "node:fs";
import type { SmellResult } from "./smells.js";
import type { SecurityIssue } from "./security.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RefactorTarget {
  kind: "smell" | "security";
  smell?: SmellResult;
  security?: SecurityIssue;
  sourceCode: string;
  filePath: string;
  language: string;
}

export interface RefactorResult {
  filePath: string;
  symbol?: string;
  issue: string;
  before: string;
  after: string;
  explanation: string;
  model: string;
}

export interface AiRefactorOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

// ─── Anthropic API ────────────────────────────────────────────────────────────

export async function callClaude(prompt: string, opts: AiRefactorOptions): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key — set ANTHROPIC_API_KEY or pass --api-key");

  const model = opts.model ?? "claude-sonnet-4-6";
  const body = JSON.stringify({
    model,
    max_tokens: opts.maxTokens ?? 4096,
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
            const parsed = JSON.parse(raw) as {
              error?: { message: string };
              content?: Array<{ type: string; text: string }>;
              model?: string;
            };
            if (parsed.error) reject(new Error(`Anthropic API: ${parsed.error.message}`));
            else resolve(parsed.content?.[0]?.text ?? "");
          } catch {
            reject(new Error(`Unexpected API response: ${raw.slice(0, 300)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function smellPrompt(smell: SmellResult, sourceCode: string, language: string): string {
  const langFence = language === "typescript" ? "ts" : language === "javascript" ? "js" : language;
  const symbol = smell.symbol ? ` for \`${smell.symbol}\`` : "";
  return `You are an expert ${language} developer performing a refactoring.

## Problem
Smell type: **${smell.smell}**${symbol}
Message: ${smell.message}
File: ${smell.file}${smell.line ? `, line ${smell.line}` : ""}

## Source file
\`\`\`${langFence}
${sourceCode}
\`\`\`

## Your task
Refactor the code to eliminate the smell. Provide:
1. The **minimal refactored code** — just the changed function/class (not the whole file unless necessary)
2. A one-paragraph **explanation** of what you changed and why

Format your response EXACTLY as:
<before>
// paste the original problematic code block here
</before>
<after>
// paste the refactored code here
</after>
<explanation>
Your explanation here.
</explanation>`;
}

function securityPrompt(issue: SecurityIssue, sourceCode: string, language: string): string {
  const langFence = language === "typescript" ? "ts" : language === "javascript" ? "js" : language;
  return `You are a security expert performing a code fix.

## Security Issue
Rule: **${issue.rule}** (${issue.severity})
Message: ${issue.message}
File: ${issue.file}, line ${issue.line}
Snippet: \`${issue.snippet}\`

## Source file
\`\`\`${langFence}
${sourceCode}
\`\`\`

## Your task
Fix the security vulnerability. Provide:
1. The **minimal fixed code** — just the changed lines/block
2. A one-paragraph **explanation** of the vulnerability and how the fix addresses it

Format your response EXACTLY as:
<before>
${issue.snippet}
</before>
<after>
// fixed code here
</after>
<explanation>
Your explanation here.
</explanation>`;
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseResponse(raw: string): { before: string; after: string; explanation: string } {
  const extract = (tag: string): string => {
    const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : "";
  };
  return {
    before: extract("before"),
    after: extract("after"),
    explanation: extract("explanation"),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Send one refactor target to Claude and return a structured RefactorResult. */
export async function aiRefactor(
  target: RefactorTarget,
  opts: AiRefactorOptions = {},
): Promise<RefactorResult> {
  const model = opts.model ?? "claude-sonnet-4-6";
  let prompt: string;
  let issue: string;
  let symbol: string | undefined;

  if (target.kind === "smell" && target.smell) {
    prompt = smellPrompt(target.smell, target.sourceCode, target.language);
    issue = `${target.smell.smell}${target.smell.symbol ? `: ${target.smell.symbol}` : ""}`;
    symbol = target.smell.symbol;
  } else if (target.kind === "security" && target.security) {
    prompt = securityPrompt(target.security, target.sourceCode, target.language);
    issue = `${target.security.rule} (${target.security.severity})`;
  } else {
    throw new Error("Invalid refactor target: must have smell or security");
  }

  const raw = await callClaude(prompt, opts);
  const { before, after, explanation } = parseResponse(raw);

  return {
    filePath: target.filePath,
    symbol,
    issue,
    before: before || "(see source)",
    after: after || raw,
    explanation: explanation || "(no explanation provided)",
    model,
  };
}

/**
 * Batch-refactor: takes a list of targets and calls Claude once per target.
 * Returns results in the same order; errors produce a result with `error` set.
 */
export async function aiRefactorBatch(
  targets: RefactorTarget[],
  opts: AiRefactorOptions = {},
): Promise<Array<RefactorResult & { error?: string }>> {
  const results: Array<RefactorResult & { error?: string }> = [];
  for (const target of targets) {
    try {
      results.push(await aiRefactor(target, opts));
    } catch (e) {
      results.push({
        filePath: target.filePath,
        issue: target.kind === "smell" ? target.smell?.smell ?? "smell" : target.security?.rule ?? "security",
        before: "",
        after: "",
        explanation: "",
        model: opts.model ?? "claude-sonnet-4-6",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

/** Read source code for a file, returning empty string on error. */
export function readSource(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
}
