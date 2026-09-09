import https from "node:https";

/**
 * One Anthropic Messages API call, shared by every AI-backed feature
 * (ai-refactor, ai-testgen, docgen, explain, patch).
 *
 * Raw https rather than @anthropic-ai/sdk deliberately: this package's only
 * runtime dependencies are the ones it cannot do without (tree-sitter, the MCP
 * SDK, zod), and every AI feature here is a single non-streaming request with
 * no tools. Reach for the SDK if that stops being true — streaming, tool use,
 * retries and typed errors are exactly what it is for.
 */

/** Every AI feature's options carry at least these three. */
export interface ClaudeOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

/** Default model for every AI feature. One place to change it. */
export const DEFAULT_MODEL = "claude-sonnet-4-6";

/** The model a call will actually use — for reporting it back in results. */
export function modelFor(opts: ClaudeOptions): string {
  return opts.model ?? DEFAULT_MODEL;
}

/**
 * Send one prompt, return the first text block.
 * `defaultMaxTokens` is the caller's own ceiling when `opts.maxTokens` is unset —
 * a doc comment needs far less room than a refactored file.
 */
export function callClaude(
  prompt: string,
  opts: ClaudeOptions,
  defaultMaxTokens = 4096,
): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Promise.reject(
      new Error("No Anthropic API key — set ANTHROPIC_API_KEY or pass --api-key"),
    );
  }

  const body = JSON.stringify({
    model: modelFor(opts),
    max_tokens: opts.maxTokens ?? defaultMaxTokens,
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
              content?: Array<{ type?: string; text: string }>;
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
