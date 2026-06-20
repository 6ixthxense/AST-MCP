// ─── Static security scanner ──────────────────────────────────────────────────
// Line-by-line regex scanning — no AST needed. Finds dangerous patterns
// in source code across JavaScript, TypeScript, Python, etc.

export interface SecurityRule {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  pattern: RegExp;
  /** If set, only trigger when file path matches this pattern */
  fileFilter?: RegExp;
  /** If set, do NOT trigger when line also matches this (false positive filter) */
  exclude?: RegExp;
}

export interface SecurityIssue {
  file: string;       // relative file path
  rule: string;       // rule id
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  line: number;       // 1-based
  snippet: string;    // the matching line, trimmed, max 120 chars
}

export interface SecurityScanResult {
  file: string;
  issues: SecurityIssue[];
}

// ─── Rule definitions ─────────────────────────────────────────────────────────

export const SECURITY_RULES: SecurityRule[] = [
  {
    id: "eval",
    severity: "critical",
    message: "Use of eval() allows arbitrary code execution",
    // matches eval( but not eval.toString( or eval.call(
    pattern: /\beval\s*\(/,
    exclude: /\beval\s*\.\s*\w+/,
  },
  {
    id: "inner-html",
    severity: "high",
    message: "Direct assignment to innerHTML can lead to XSS",
    // .innerHTML = but not .innerHTML +=
    pattern: /\.innerHTML\s*=[^=+]/,
  },
  {
    id: "document-write",
    severity: "high",
    message: "document.write() can overwrite the page and lead to XSS",
    pattern: /\bdocument\s*\.\s*write\s*\(/,
  },
  {
    id: "dangerously-set-inner-html",
    severity: "high",
    message: "dangerouslySetInnerHTML bypasses React's XSS protection",
    pattern: /dangerouslySetInnerHTML/,
  },
  {
    id: "child-process",
    severity: "medium",
    message: "Use of child_process module can lead to command injection if inputs are not sanitized",
    pattern: /require\s*\(\s*['"]child_process['"]\s*\)|import\s+.*\bchild_process\b/,
  },
  {
    id: "shell-exec",
    severity: "high",
    message: "exec/execSync with a non-literal argument is vulnerable to command injection",
    // Only flag when the argument looks like a variable/template (contains $ or an identifier before ))
    pattern: /\b(?:exec|execSync)\s*\(\s*(?:[`$]|\w+\s*[+,)])/,
  },
  {
    id: "weak-crypto",
    severity: "medium",
    message: "MD5 and SHA-1 are cryptographically weak and should not be used for security purposes",
    pattern: /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/i,
  },
  {
    id: "hardcoded-secret",
    severity: "high",
    message: "Hardcoded secret/credential detected",
    // variable named password/secret/api_key/apiKey/token/passwd assigned a string literal of 8+ chars
    pattern: /(?:password|secret|api_key|apiKey|token|passwd)\s*[=:]\s*['"][^'"]{8,}['"]/i,
    // filter out common placeholders
    exclude: /(?:your[-_]?key|xxx+|changeme|placeholder|example|test|dummy|sample|fake|mock|<|>|\*)/i,
  },
  {
    id: "sql-injection",
    severity: "high",
    message: "SQL query built with string concatenation may be vulnerable to injection",
    // query( or execute( followed by string concatenation on same line or a nearby + sign
    pattern: /\b(?:query|execute)\s*\(\s*[`"']?[^)]*\+/,
  },
  {
    id: "http-url",
    severity: "low",
    message: "Hardcoded HTTP (non-HTTPS) URL detected",
    pattern: /['"`]http:\/\/(?!(?:localhost|127\.0\.0\.1|0\.0\.0\.0|example\.com|schema\.org))/,
  },
  {
    id: "no-rate-limit",
    severity: "medium",
    message: "Express route handler without apparent rate limiting",
    // Express route .get( or .post( etc.
    pattern: /\.\s*(?:get|post|put|patch|delete|all)\s*\(\s*['"`]/,
    // only applies to JS/TS files
    fileFilter: /\.[jt]sx?$/,
  },
  {
    id: "prototype-pollution",
    severity: "high",
    message: "Potential prototype pollution via __proto__, constructor.prototype, or unsafe Object.assign",
    pattern: /(?:__proto__|constructor\s*\.\s*prototype|Object\.assign\s*\(\s*\{\s*\}[^)]*(?:req|params|body|input|data|user))/,
  },
];

// ─── Comment-line detection ───────────────────────────────────────────────────

/**
 * Returns true when the (trimmed) line is a comment and should be skipped
 * for most security rules. Covers //, #, * (JSDoc / block comment lines).
 */
function isCommentLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

// Rules that should also scan comment lines (none by default — keep list empty
// but the structure allows future exceptions).
const SCAN_COMMENTS_FOR = new Set<string>([]);

// ─── Core scanner ─────────────────────────────────────────────────────────────

/**
 * Scan a single file's source text for security issues.
 *
 * @param source   - Full file contents.
 * @param relPath  - Relative file path (used for fileFilter matching and issue reporting).
 * @param rules    - Rule set to apply (defaults to SECURITY_RULES).
 */
export function scanFileForSecurityIssues(
  source: string,
  relPath: string,
  rules: SecurityRule[] = SECURITY_RULES,
): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const lines = source.split("\n");

  // Pre-filter rules by fileFilter so we don't re-test every line.
  const applicableRules = rules.filter(
    (r) => r.fileFilter === undefined || r.fileFilter.test(relPath),
  );

  // Build a lookup of line indices that need rate-limit context checks.
  // (We collect matches first, then do the window search in one pass.)
  const rateLimitMatches: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const lineNo = i + 1; // 1-based

    for (const rule of applicableRules) {
      // Skip comment lines unless the rule explicitly needs them.
      if (isCommentLine(trimmed) && !SCAN_COMMENTS_FOR.has(rule.id)) continue;

      if (!rule.pattern.test(raw)) continue;
      if (rule.exclude && rule.exclude.test(raw)) continue;

      // Special handling for no-rate-limit: defer until we have all line indices.
      if (rule.id === "no-rate-limit") {
        rateLimitMatches.push(i);
        continue;
      }

      issues.push({
        file: relPath,
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        line: lineNo,
        snippet: trimmed.slice(0, 120),
      });
    }
  }

  // ── no-rate-limit: window check ──────────────────────────────────────────
  // For each matched route line, look 5 lines before and 5 lines after for
  // rate-limit keywords. Only emit an issue when none are found nearby.
  const rateLimitRule = applicableRules.find((r) => r.id === "no-rate-limit");
  if (rateLimitRule && rateLimitMatches.length > 0) {
    const WINDOW = 5;
    const rateLimitKeyword = /rateLimit|throttle|limiter/i;

    for (const idx of rateLimitMatches) {
      const windowStart = Math.max(0, idx - WINDOW);
      const windowEnd = Math.min(lines.length - 1, idx + WINDOW);

      let hasRateLimit = false;
      for (let w = windowStart; w <= windowEnd; w++) {
        if (rateLimitKeyword.test(lines[w])) {
          hasRateLimit = true;
          break;
        }
      }

      if (!hasRateLimit) {
        const trimmed = lines[idx].trim();
        issues.push({
          file: relPath,
          rule: "no-rate-limit",
          severity: rateLimitRule.severity,
          message: rateLimitRule.message,
          line: idx + 1,
          snippet: trimmed.slice(0, 120),
        });
      }
    }
  }

  return issues;
}
