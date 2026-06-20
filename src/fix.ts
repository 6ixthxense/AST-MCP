import type { SkeletonFile, SymbolNode } from "./types.js";
import type { DeadExport } from "./graph-analysis.js";
import type { SmellResult } from "./smells.js";
import type { SecurityIssue } from "./security.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type FixKind =
  | "remove-dead-export"    // remove unused export keyword
  | "prefix-unused-param"   // rename param to _paramName
  | "extract-method"        // long method → suggest extracting
  | "split-class"           // god class → suggest splitting
  | "use-https"             // http:// → https://
  | "remove-eval"           // replace eval with safer alternative
  | "add-rate-limit";       // add rate limit middleware

export interface FixSuggestion {
  kind: FixKind;
  file: string;
  line?: number;
  symbol?: string;
  description: string;
  /** Pseudo-patch: what the change would look like (not a real diff, just illustrative) */
  before?: string;
  after?: string;
  /** Priority: 1=must fix, 2=should fix, 3=nice to have */
  priority: 1 | 2 | 3;
}

export interface FixReport {
  file: string;
  suggestions: FixSuggestion[];
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildFixSuggestions(opts: {
  dead?: DeadExport[];
  smells?: SmellResult[];
  security?: SecurityIssue[];
  skeletons?: SkeletonFile[];
}): FixSuggestion[] {
  const suggestions: FixSuggestion[] = [];

  // ── Dead exports → remove-dead-export (high confidence only) ─────────────
  if (opts.dead) {
    for (const dead of opts.dead) {
      if (dead.confidence !== "high") continue;
      suggestions.push({
        kind: "remove-dead-export",
        file: dead.file,
        symbol: dead.symbol,
        description: `"${dead.symbol}" is exported but never imported within the scanned directory. Remove the export keyword to reduce surface area.`,
        before: `export ${dead.kind} ${dead.symbol}`,
        after: `${dead.kind} ${dead.symbol}`,
        priority: 2,
      });
    }
  }

  // ── Smells ────────────────────────────────────────────────────────────────
  if (opts.smells) {
    for (const smell of opts.smells) {
      if (smell.smell === "long-method") {
        suggestions.push({
          kind: "extract-method",
          file: smell.file,
          line: smell.line,
          symbol: smell.symbol,
          description: smell.symbol
            ? `"${smell.symbol}" is too long. ${smell.message}. Extract cohesive blocks into smaller helper functions.`
            : `${smell.message}. Extract cohesive blocks into smaller helper functions.`,
          priority: 3,
        });
      } else if (smell.smell === "god-class") {
        suggestions.push({
          kind: "split-class",
          file: smell.file,
          line: smell.line,
          symbol: smell.symbol,
          description: smell.symbol
            ? `"${smell.symbol}" has too many responsibilities. ${smell.message}. Consider splitting into focused classes.`
            : `${smell.message}. Consider splitting into focused classes.`,
          priority: 2,
        });
      }
    }
  }

  // ── Security issues ───────────────────────────────────────────────────────
  if (opts.security) {
    for (const issue of opts.security) {
      if (issue.rule === "eval") {
        suggestions.push({
          kind: "remove-eval",
          file: issue.file,
          line: issue.line,
          description: `${issue.message}. Replace eval() with a safer alternative such as JSON.parse() for data, or Function() with strict input validation.`,
          before: `eval(userInput)`,
          after: `JSON.parse(userInput)  // or use a safe parser`,
          priority: 1,
        });
      } else if (issue.rule === "http-url") {
        // Try to extract the actual URL from the snippet for a more precise suggestion.
        const urlMatch = issue.snippet.match(/http:\/\/[^\s'"`,)]+/);
        const exampleUrl = urlMatch ? urlMatch[0] : "http://api.example.com";
        const httpsUrl = exampleUrl.replace("http://", "https://");
        suggestions.push({
          kind: "use-https",
          file: issue.file,
          line: issue.line,
          description: `${issue.message}. Switch to HTTPS to ensure data in transit is encrypted.`,
          before: exampleUrl,
          after: httpsUrl,
          priority: 3,
        });
      } else if (issue.rule === "no-rate-limit") {
        suggestions.push({
          kind: "add-rate-limit",
          file: issue.file,
          line: issue.line,
          description: `${issue.message}. Add rate-limit middleware (e.g. express-rate-limit) to prevent abuse.`,
          before: `app.post('/api/endpoint', handler)`,
          after: `app.post('/api/endpoint', rateLimiter, handler)`,
          priority: 1,
        });
      }
    }
  }

  return suggestions;
}
