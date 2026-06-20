import fs from "node:fs";
import path from "node:path";
import type { SkeletonFile } from "./types.js";

// ─── Plugin API ───────────────────────────────────────────────────────────────

export interface PluginViolation {
  /** Descriptive rule ID, e.g. "no-barrel-reexport". */
  rule: string;
  file: string;
  /** 1-based line number, if applicable. */
  line?: number;
  symbol?: string;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface PluginContext {
  /** Project root directory. */
  root: string;
  /** All skeleton files currently being analysed. */
  skeletons: SkeletonFile[];
}

export interface AstMapPlugin {
  /** Unique plugin ID. */
  id: string;
  /** Human-readable description. */
  description?: string;
  /**
   * Called once with the full skeleton list. Return any violations found.
   * May be async.
   */
  run(ctx: PluginContext): PluginViolation[] | Promise<PluginViolation[]>;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

const PLUGINS_DIR = ".ast-map/plugins";

/** Load all `.mjs` / `.js` plugin files from `<root>/.ast-map/plugins/`. */
export async function loadPlugins(root: string): Promise<AstMapPlugin[]> {
  const dir = path.join(root, PLUGINS_DIR);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs") || f.endsWith(".js"));
  const plugins: AstMapPlugin[] = [];

  for (const file of files) {
    const abs = path.resolve(dir, file);
    try {
      const mod = await import(abs) as { default?: AstMapPlugin; plugin?: AstMapPlugin } | AstMapPlugin;
      const plugin: AstMapPlugin | undefined =
        "default" in mod && isPlugin(mod.default) ? mod.default
        : "plugin" in mod && isPlugin(mod.plugin) ? mod.plugin
        : isPlugin(mod) ? mod
        : undefined;
      if (plugin) plugins.push(plugin);
      else process.stderr.write(`[ast-map plugins] ${file}: no valid default/plugin export\n`);
    } catch (e) {
      process.stderr.write(`[ast-map plugins] failed to load ${file}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  return plugins;
}

function isPlugin(v: unknown): v is AstMapPlugin {
  return typeof v === "object" && v !== null && "id" in v && "run" in v && typeof (v as AstMapPlugin).run === "function";
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export interface PluginRunResult {
  pluginId: string;
  description?: string;
  violations: PluginViolation[];
  error?: string;
}

/** Run all loaded plugins against the given skeletons. */
export async function runPlugins(
  plugins: AstMapPlugin[],
  ctx: PluginContext,
): Promise<PluginRunResult[]> {
  const results: PluginRunResult[] = [];
  for (const plugin of plugins) {
    try {
      const violations = await plugin.run(ctx);
      results.push({ pluginId: plugin.id, description: plugin.description, violations });
    } catch (e) {
      results.push({
        pluginId: plugin.id,
        description: plugin.description,
        violations: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

// ─── Example plugin scaffolding (written to disk by ast-map init) ─────────────

export const EXAMPLE_PLUGIN = `/**
 * Example ast-map plugin: no-console-in-lib
 *
 * Reports any "console.log/warn/error" usage in library source files.
 * Adapt the logic to define your own custom rules.
 *
 * Export your plugin as the default export.
 * @type {import('universal-ast-mapper').AstMapPlugin}
 */
export default {
  id: "no-console-in-lib",
  description: "Disallow console.* calls in library code",

  run({ skeletons }) {
    const violations = [];
    for (const skel of skeletons) {
      // Only apply to files under src/ (adjust as needed)
      if (!skel.file.startsWith("src/")) continue;
      for (const sym of skel.symbols) {
        if (sym.name.startsWith("console")) {
          violations.push({
            rule: "no-console-in-lib",
            file: skel.file,
            line: sym.range?.startLine,
            symbol: sym.name,
            severity: "warning",
            message: \`console.\${sym.name} should not be used in library code\`,
          });
        }
      }
    }
    return violations;
  },
};
`;
