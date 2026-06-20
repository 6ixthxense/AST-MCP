import type { SymbolGraph } from "./graph.js";
import type { AstMapConfig } from "./config.js";

export interface ArchRule {
  name?: string;
  /** Glob pattern matching source file paths that this rule applies to. */
  from: string;
  /** If set, files matching `from` must NOT import anything matching this glob. */
  forbidImport?: string;
  /** If set, files matching `from` MUST import something matching this glob. */
  requireImport?: string;
  severity?: "error" | "warning";
  message?: string;
}

export interface ArchViolation {
  rule: string;
  severity: "error" | "warning";
  file: string;
  message: string;
}

export interface ArchRulesConfig {
  rules: ArchRule[];
}

function globToRegex(pattern: string): RegExp {
  let result = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      result += ".*";
      i++;
    } else if (c === "*") {
      result += "[^/]*";
    } else if (c === "?") {
      result += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      result += "\\" + c;
    } else {
      result += c;
    }
  }
  return new RegExp("^" + result + "$");
}

function matchGlob(pattern: string, str: string): boolean {
  try {
    return globToRegex(pattern).test(str);
  } catch {
    return false;
  }
}

export function loadArchRules(projectConfig: AstMapConfig): ArchRule[] {
  const arch = (projectConfig as AstMapConfig & { arch?: ArchRulesConfig }).arch;
  return arch?.rules ?? [];
}

export function checkArchRules(
  graph: SymbolGraph,
  rules: ArchRule[],
): ArchViolation[] {
  if (rules.length === 0) return [];
  const violations: ArchViolation[] = [];

  const fileImports = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.edgeType === "imports") {
      const fromFile = edge.from.split("::")[0];
      const toFile = edge.to.split("::")[0];
      if (!fileImports.has(fromFile)) fileImports.set(fromFile, new Set());
      fileImports.get(fromFile)!.add(toFile);
    }
  }

  const allFiles = [...fileImports.keys()];

  for (const rule of rules) {
    const severity = rule.severity ?? "error";
    const fromFiles = allFiles.filter(f => matchGlob(rule.from, f));

    for (const file of fromFiles) {
      const imports = fileImports.get(file) ?? new Set();

      if (rule.forbidImport) {
        for (const imp of imports) {
          if (matchGlob(rule.forbidImport, imp)) {
            violations.push({
              rule: rule.name ?? `forbid: ${rule.from} → ${rule.forbidImport}`,
              severity,
              file,
              message: rule.message ?? `"${file}" must not import "${imp}" (matches ${rule.forbidImport})`,
            });
          }
        }
      }

      if (rule.requireImport) {
        const hasRequired = [...imports].some(imp => matchGlob(rule.requireImport!, imp));
        if (!hasRequired) {
          violations.push({
            rule: rule.name ?? `require: ${rule.from} → ${rule.requireImport}`,
            severity,
            file,
            message: rule.message ?? `"${file}" must import something matching "${rule.requireImport}"`,
          });
        }
      }
    }
  }

  return violations;
}
