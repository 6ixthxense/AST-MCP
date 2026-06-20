import https from "node:https";
import type { SkeletonFile, SymbolNode } from "./types.js";

export interface DocSymbol {
  file: string;
  name: string;
  kind: string;
  signature?: string | null;
  exported: boolean;
  lineStart: number;
  description?: string;
}

export interface DocFile {
  file: string;
  language: string;
  symbols: DocSymbol[];
}

export interface DocOutput {
  files: DocFile[];
  totalSymbols: number;
  exportedSymbols: number;
}

export interface DocOptions {
  exportedOnly?: boolean;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  ai?: boolean;
}

function flattenSymbols(symbols: SymbolNode[], file: string): DocSymbol[] {
  const result: DocSymbol[] = [];
  for (const sym of symbols) {
    result.push({
      file,
      name: sym.name,
      kind: sym.kind,
      signature: sym.signature,
      exported: sym.exported !== false,
      lineStart: sym.range.startLine,
      description: sym.doc ?? undefined,
    });
    if (sym.children.length > 0) {
      result.push(...flattenSymbols(sym.children, file));
    }
  }
  return result;
}

export function buildDocOutput(skeletons: SkeletonFile[], opts: DocOptions = {}): DocOutput {
  const files: DocFile[] = [];
  let totalSymbols = 0;
  let exportedSymbols = 0;

  for (const skel of skeletons) {
    let syms = flattenSymbols(skel.symbols, skel.file);
    if (opts.exportedOnly) syms = syms.filter(s => s.exported);
    if (syms.length === 0) continue;
    totalSymbols += syms.length;
    exportedSymbols += syms.filter(s => s.exported).length;
    files.push({ file: skel.file, language: skel.language, symbols: syms });
  }

  return { files, totalSymbols, exportedSymbols };
}

function htmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderMarkdown(output: DocOutput): string {
  const lines: string[] = [
    "# API Reference",
    "",
    `> ${output.exportedSymbols} exported symbols across ${output.files.length} files`,
    "",
  ];

  for (const f of output.files) {
    lines.push(`## \`${f.file}\``, "");
    for (const sym of f.symbols) {
      const expMark = sym.exported ? "" : " _(internal)_";
      lines.push(`### \`${sym.name}\` _(${sym.kind})_${expMark}`, "");
      if (sym.signature) lines.push("```", sym.signature, "```", "");
      if (sym.description) lines.push(sym.description, "");
      lines.push(`_Line ${sym.lineStart}_`, "");
    }
  }

  return lines.join("\n");
}

export function renderDocHtml(output: DocOutput): string {
  const rows = output.files.flatMap(f =>
    f.symbols.map(s =>
      `<tr><td><code>${htmlEsc(f.file)}</code></td><td><code>${htmlEsc(s.name)}</code></td><td>${s.kind}</td><td>${s.exported ? "✓" : ""}</td><td><code>${htmlEsc(s.signature ?? "")}</code></td><td>${htmlEsc(s.description ?? "")}</td></tr>`
    )
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>API Reference</title>
<style>body{font-family:sans-serif;padding:2rem;max-width:1200px;margin:0 auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f5f5f5;font-size:.8em;text-transform:uppercase}code{font-family:monospace;font-size:.9em;background:#f0f0f0;padding:1px 3px;border-radius:2px}h1{margin-bottom:4px}p{color:#666;margin-bottom:1.5rem}</style>
</head>
<body>
<h1>API Reference</h1>
<p>${output.exportedSymbols} exported symbols &bull; ${output.files.length} files</p>
<table>
<thead><tr><th>File</th><th>Name</th><th>Kind</th><th>Exp</th><th>Signature</th><th>Description</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body></html>`;
}

// ─── AI enhancement ───────────────────────────────────────────────────────────

async function callClaude(prompt: string, opts: DocOptions): Promise<string> {
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
          } catch { reject(new Error("Unexpected API response")); }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function aiEnhanceDocs(output: DocOutput, opts: DocOptions = {}): Promise<DocOutput> {
  const enhanced: DocOutput = {
    ...output,
    files: output.files.map(f => ({ ...f, symbols: f.symbols.map(s => ({ ...s })) })),
  };

  for (const docFile of enhanced.files) {
    const toEnhance = docFile.symbols.filter(s => s.exported && !s.description);
    if (toEnhance.length === 0) continue;

    const batch = toEnhance.slice(0, 20);
    const symbolList = batch.map(s =>
      `- ${s.name} (${s.kind})${s.signature ? `: ${s.signature}` : ""}`
    ).join("\n");

    const prompt = `You are a technical writer generating concise JSDoc-style descriptions for API symbols.

File: ${docFile.file}
Language: ${docFile.language}

For each symbol below, write a single short sentence (max 20 words) describing what it does.
Respond ONLY as JSON: {"symbolName": "description", ...}

Symbols:
${symbolList}`;

    try {
      const raw = await callClaude(prompt, opts);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const descriptions = JSON.parse(jsonMatch[0]) as Record<string, string>;
        for (const sym of docFile.symbols) {
          if (descriptions[sym.name]) sym.description = descriptions[sym.name];
        }
      }
    } catch { /* skip on error */ }
  }

  return enhanced;
}
