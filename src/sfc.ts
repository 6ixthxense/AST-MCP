/**
 * Single-file-component preprocessing for Vue (.vue) and Svelte (.svelte).
 *
 * An SFC isn't a tree-sitter grammar we ship; instead we lift the `<script>`
 * block(s) out and parse them with the existing TS/JS extractor. The trick is to
 * blank-pad everything outside the script — replacing each non-newline character
 * with a space — so the script content keeps its exact byte offsets, line, and
 * column. That way every extracted symbol range still points at the right spot in
 * the original .vue/.svelte file.
 */
export interface ExtractedScript {
  /** The script-only source, blank-padded so offsets match the original file. */
  code: string;
  /** Grammar to parse the script with: "typescript" (lang="ts") or "javascript". */
  grammar: string;
  /** True if the file contained at least one <script> block. */
  hasScript: boolean;
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

export function isSfcExt(ext: string): boolean {
  return ext === ".vue" || ext === ".svelte";
}

export function extractScript(source: string): ExtractedScript {
  // Start from an all-blank canvas the same shape as the source (newlines kept,
  // every other character turned into a space) to preserve line/column offsets.
  let out = source.replace(/[^\n]/g, " ");
  let hasScript = false;
  let lang: "ts" | "js" = "js";

  let m: RegExpExecArray | null;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(source)) !== null) {
    hasScript = true;
    const attrs = m[1] ?? "";
    if (/lang\s*=\s*["'](ts|typescript)["']/i.test(attrs)) lang = "ts";
    const inner = m[2] ?? "";
    const innerStart = m.index + m[0].indexOf(inner, m[1] ? m[1].length : 0);
    out = out.slice(0, innerStart) + inner + out.slice(innerStart + inner.length);
  }

  return {
    code: hasScript ? out : "",
    grammar: lang === "ts" ? "typescript" : "javascript",
    hasScript,
  };
}
