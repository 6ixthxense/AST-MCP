import fs from "node:fs";
import path from "node:path";
import type { Detail } from "./types.js";

export interface SkeletonOptions {
  /** "outline" (names + kinds + ranges) or "full" (+ signatures + docs). */
  detail: Detail;
  /** Whether to write an HTML view alongside the JSON. */
  emitHtml: boolean;
  /** Merge all per-file skeletons into a single <outputDir>/index.html. */
  combineHtml: boolean;
  /** Directory for HTML output. Defaults to <root>/.ast-map. */
  outputDir?: string;
  /** Directory names to skip when scanning folders. */
  ignore: string[];
  /** Skip files larger than this (bytes). */
  maxFileBytes: number;
}

export const DEFAULT_IGNORE = [
  "node_modules",
  "vendor",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  ".ast-map",
];

// ─── Project config file (.ast-map.config.json) ───────────────────────────────

export interface ValidationRuleConfig {
  enabled?: boolean;
  /** Max source lines before flagging as large-file. */
  maxLines?: number;
  /** Max import count before flagging as too-many-imports. */
  maxImports?: number;
  /** Max exported symbol count before flagging as god-export. */
  maxExports?: number;
}

export interface AstMapConfig {
  /** Glob patterns / directory names to ignore (merged with defaults). */
  ignore?: string[];
  /** Max file size in bytes. */
  maxFileBytes?: number;
  /** Default output directory for HTML. */
  outputDir?: string;
  /** Persistent parse cache in <root>/.ast-map/cache (default true). */
  cache?: boolean;
  /** Quality-gate thresholds for `ast-map check` / check_quality_gate. */
  check?: {
    maxCycles?: number;
    maxDeadExports?: number;
    maxSdpViolations?: number;
    maxVeryHighComplexity?: number;
    maxComplexity?: number;
    minScore?: number;
  };
  /** Per-rule overrides for validate_architecture. */
  rules?: {
    "large-file"?: ValidationRuleConfig;
    "too-many-imports"?: ValidationRuleConfig;
    "god-export"?: ValidationRuleConfig;
  };
  /** Architecture import rules (forbid/require import patterns). */
  arch?: {
    rules: Array<{
      name?: string;
      from: string;
      forbidImport?: string;
      requireImport?: string;
      severity?: "error" | "warning";
      message?: string;
    }>;
  };
}

let _configCache: { root: string; mtime: number; config: AstMapConfig } | null = null;

/**
 * Load .ast-map.config.json from the project root.
 * Cached per root path + file mtime so live edits are picked up without restarting.
 * Returns an empty config if no file is found.
 */
export function loadProjectConfig(root: string): AstMapConfig {
  const configPath = path.join(root, ".ast-map.config.json");
  let mtime = 0;
  try { mtime = fs.statSync(configPath).mtimeMs; } catch { /* file absent */ }

  if (_configCache?.root === root && _configCache.mtime === mtime) return _configCache.config;

  let config: AstMapConfig = {};
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(raw) as AstMapConfig;
  } catch {
    // No config file or parse error — use defaults
  }

  _configCache = { root, mtime, config };
  return config;
}

export function resolveOptions(
  opts: Partial<SkeletonOptions> = {},
  projectConfig: AstMapConfig = {},
): SkeletonOptions {
  const extraIgnore = projectConfig.ignore ?? [];
  const mergedIgnore = [...new Set([...DEFAULT_IGNORE, ...extraIgnore])];

  return {
    detail: opts.detail ?? "outline",
    emitHtml: opts.emitHtml ?? true,
    combineHtml: opts.combineHtml ?? false,
    outputDir: opts.outputDir ?? projectConfig.outputDir,
    ignore: opts.ignore ?? mergedIgnore,
    maxFileBytes: opts.maxFileBytes ?? projectConfig.maxFileBytes ?? 2_000_000,
  };
}
