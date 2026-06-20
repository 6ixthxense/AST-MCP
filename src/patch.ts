import https from "node:https";
import readline from "node:readline";
import fs from "node:fs";
import type { SmellResult } from "./smells.js";
import type { SecurityIssue } from "./security.js";

export interface PatchIssue {
  kind: "smell" | "security";
  smell?: SmellResult;
  security?: SecurityIssue;
  filePath: string;
  sourceCode: string;
  language: string;
}

export interface PatchResult {
  filePath: string;
  issue: string;
  before: string;
  after: string;
  explanation: string;
  applied: boolean;
  error?: string;
}

export interface PatchOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** Auto-apply all patches without prompting. */
  yes?: boolean;
}

// ─── ANSI ─────────────────────────────────────────────────────────────────────

const tty = process.stdout.isTTY ?? false;
const esc = (code: string) => (s: string) => tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const red = esc("31");
const green = esc("32");
const dim = esc("2");

// ─── Colored unified diff ─────────────────────────────────────────────────────

function coloredDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines: string[] = [dim("--- before"), dim("+++ after")];
  const max = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < max; i++) {
    if (i < beforeLines.length && i < afterLines.length) {
      if (beforeLines[i] !== afterLines[i]) {
        lines.push(red("- " + beforeLines[i]));
        lines.push(green("+ " + afterLines[i]));
      } else {
        lines.push(dim("  " + beforeLines[i]));
      }
    } else if (i < beforeLines.length) {
      lines.push(red("- " + beforeLines[i]));
    } else {
      lines.push(green("+ " + afterLines[i]));
    }
  }

  return lines.join("\n");
}

// ─── Claude API ───────────────────────────────────────────────────────────────

async function callClaude(prompt: string, opts: PatchOptions): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key — set ANTHROPIC_API_KEY or pass --api-key");

  const body = JSON.stringify({
    model: opts.model ?? "claude-sonnet-4-6",
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
            const parsed = JSON.parse(raw) as { error?: { message: string }; content?: Array<{ text: string }> };
            if (parsed.error) reject(new Error(`Anthropic API: ${parsed.error.message}`));
            else resolve(parsed.content?.[0]?.text ?? "");
          } catch { reject(new Error("Unexpected API response")); }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPatchPrompt(issue: PatchIssue): string {
  const langFence = issue.language === "typescript" ? "ts" : issue.language === "javascript" ? "js" : issue.language;
  let issueDesc: string;

  if (issue.kind === "smell" && issue.smell) {
    issueDesc = `Code smell: **${issue.smell.smell}**\nMessage: ${issue.smell.message}\nFile: ${issue.filePath}${issue.smell.line ? `, line ${issue.smell.line}` : ""}`;
  } else if (issue.kind === "security" && issue.security) {
    issueDesc = `Security issue: **${issue.security.rule}** (${issue.security.severity})\nMessage: ${issue.security.message}\nFile: ${issue.filePath}, line ${issue.security.line}\nSnippet: \`${issue.security.snippet}\``;
  } else {
    issueDesc = "Unknown issue";
  }

  return `You are an expert ${issue.language} developer fixing a code issue.

## Issue
${issueDesc}

## Source file
\`\`\`${langFence}
${issue.sourceCode}
\`\`\`

## Your task
Fix the issue with the minimal change needed (not the whole file unless necessary).

Format your response EXACTLY as:
<before>
// original code block
</before>
<after>
// fixed code block
</after>
<explanation>
One paragraph explanation of the fix.
</explanation>`;
}

function parseResponse(raw: string): { before: string; after: string; explanation: string } {
  const extract = (tag: string) => {
    const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : "";
  };
  return { before: extract("before"), after: extract("after"), explanation: extract("explanation") };
}

function issueLabel(issue: PatchIssue): string {
  if (issue.kind === "smell" && issue.smell) {
    return issue.smell.smell + (issue.smell.symbol ? `: ${issue.smell.symbol}` : "");
  }
  if (issue.kind === "security" && issue.security) {
    return `${issue.security.rule} (${issue.security.severity})`;
  }
  return "issue";
}

// ─── Interactive y/n ──────────────────────────────────────────────────────────

async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question + " [y/N] ", (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === "y");
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generatePatch(issue: PatchIssue, opts: PatchOptions = {}): Promise<PatchResult> {
  const label = issueLabel(issue);
  try {
    const raw = await callClaude(buildPatchPrompt(issue), opts);
    const { before, after, explanation } = parseResponse(raw);
    return { filePath: issue.filePath, issue: label, before, after, explanation, applied: false };
  } catch (e) {
    return { filePath: issue.filePath, issue: label, before: "", after: "", explanation: "", applied: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function interactivePatch(
  issues: PatchIssue[],
  opts: PatchOptions = {},
): Promise<PatchResult[]> {
  const results: PatchResult[] = [];

  for (const issue of issues) {
    console.log(`\n${dim("─────────────────────────────────────────────")}`);
    console.log(`${dim(issue.filePath)}  ${issueLabel(issue)}`);
    console.log(dim("Generating patch…"));

    const result = await generatePatch(issue, opts);

    if (result.error) {
      console.error(`  Error: ${result.error}`);
      results.push(result);
      continue;
    }

    if (!result.before || !result.after) {
      console.log(dim("  (no diff produced)"));
      results.push(result);
      continue;
    }

    console.log(coloredDiff(result.before, result.after));
    console.log(dim(`\n  ${result.explanation}`));

    let apply = opts.yes ?? false;
    if (!apply) {
      apply = await askYesNo(`  Apply this patch to ${issue.filePath}?`);
    }

    if (apply) {
      try {
        const src = fs.readFileSync(issue.filePath, "utf8");
        const patched = src.replace(result.before, result.after);
        if (patched === src) {
          console.log(dim("  (patch did not change file — before block not found verbatim)"));
        } else {
          fs.writeFileSync(issue.filePath, patched, "utf8");
          console.log(`${green("✓")} Applied patch to ${issue.filePath}`);
          results.push({ ...result, applied: true });
          continue;
        }
      } catch (e) {
        console.error(`  Failed to apply: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    results.push(result);
  }

  return results;
}
