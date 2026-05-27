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

export function resolveOptions(opts: Partial<SkeletonOptions> = {}): SkeletonOptions {
  return {
    detail: opts.detail ?? "outline",
    emitHtml: opts.emitHtml ?? true,
    combineHtml: opts.combineHtml ?? false,
    outputDir: opts.outputDir,
    ignore: opts.ignore ?? DEFAULT_IGNORE,
    maxFileBytes: opts.maxFileBytes ?? 2_000_000,
  };
}
