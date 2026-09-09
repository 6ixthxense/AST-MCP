import type { TestGenResult } from "./testgen.js";
import { callClaude } from "./anthropic.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AiTestGenOptions {
  /** Anthropic API key — falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Model ID (default: claude-sonnet-4-6). */
  model?: string;
  /** Max tokens in the response (default: 4096). */
  maxTokens?: number;
}

export interface AiTestGenResult extends TestGenResult {
  /** True when AI enhanced the stubs; false when stubs are returned as-is. */
  aiEnhanced: boolean;
}

// ─── Anthropic API ────────────────────────────────────────────────────────────

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(
  sourceFile: string,
  sourceCode: string,
  stubContent: string,
  framework: string,
  language: string,
): string {
  const langFence = language === "typescript" ? "ts" : language === "javascript" ? "js" : language;

  return `You are an expert ${language} developer and TDD practitioner.

Your task: given a source file and its auto-generated test stubs, replace all TODO placeholders with real, meaningful assertions.

## Source file: ${sourceFile}
\`\`\`${langFence}
${sourceCode}
\`\`\`

## Generated stubs to fill in:
\`\`\`${langFence}
${stubContent}
\`\`\`

## Rules:
- Test framework: **${framework}**
- Keep every test name and describe block from the stubs exactly as-is
- Replace "// TODO: arrange" with real setup code using the source implementation
- Replace generic assertions (toBeDefined, is not None, assertNotNull) with precise assertions that verify actual return values, side effects, or thrown errors
- For functions with clear deterministic behavior, use concrete expected values
- Cover happy path AND at least one edge case (empty/null/zero input) for each test
- For async functions, always use async/await
- Do NOT import anything extra beyond what the stubs already import
- Do NOT add tests beyond what is in the stubs
- Return ONLY the complete test file — no markdown fences, no explanation`;
}

// ─── Stripper ─────────────────────────────────────────────────────────────────

/** Remove leading/trailing markdown code fences if Claude adds them anyway. */
function stripFences(text: string): string {
  return text
    .replace(/^```[\w]*\r?\n/m, "")
    .replace(/\r?\n```$/m, "")
    .trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enhance a stub-only TestGenResult by asking Claude to fill in real assertions.
 * Falls back to the original stubs if the API is unavailable or `opts.apiKey` / the
 * ANTHROPIC_API_KEY env var is not set.
 */
export async function aiEnhanceTests(
  result: TestGenResult,
  sourceCode: string,
  language: string,
  opts: AiTestGenOptions = {},
): Promise<AiTestGenResult> {
  const enhanced = await callClaude(
    buildPrompt(result.sourceFile, sourceCode, result.content, result.framework, language),
    opts,
  );
  const cleaned = stripFences(enhanced);
  return { ...result, content: cleaned, aiEnhanced: true };
}

/**
 * Like `aiEnhanceTests` but never throws — returns original stubs if the API call
 * fails, and sets `aiEnhanced: false` along with an `error` field for diagnostics.
 */
export async function tryAiEnhanceTests(
  result: TestGenResult,
  sourceCode: string,
  language: string,
  opts: AiTestGenOptions = {},
): Promise<AiTestGenResult & { error?: string }> {
  try {
    return await aiEnhanceTests(result, sourceCode, language, opts);
  } catch (e) {
    return { ...result, aiEnhanced: false, error: e instanceof Error ? e.message : String(e) };
  }
}
