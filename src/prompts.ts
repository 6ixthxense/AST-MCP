import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** GetPromptResult helper — a single user-role text message. */
function userPrompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

const dirArg = { dir: z.string().optional().describe("Directory to analyze, relative to the project root. Default 'src'.") };
const d = (dir?: string) => (dir && dir.trim() ? dir.trim() : "src");

/**
 * Register the Cookbook recipes as MCP prompts so clients can invoke a whole
 * AST-MCP workflow (a chain of tool calls) by name, instead of the user pasting
 * the recipe text. Each prompt returns a ready-to-run instruction that references
 * the server's own tools.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "architecture_audit",
    {
      title: "Architecture audit",
      description: "Full structural audit of a directory: God Nodes, cycles, rule violations, and module coupling.",
      argsSchema: dirArg,
    },
    ({ dir }) =>
      userPrompt(
        `Run a full architecture audit of \`${d(dir)}\` using the ast-mapper tools, in this order:\n\n` +
          `1. \`build_symbol_graph\` on \`${d(dir)}\` to load the dependency graph.\n` +
          `2. \`get_top_symbols\` — identify the 5 most-imported symbols (the "God Nodes").\n` +
          `3. \`find_circular_deps\` — report any circular import chains.\n` +
          `4. \`validate_architecture\` — list structural rule violations (large files, too many imports, god exports).\n` +
          `5. \`get_module_coupling\` — which directories are load-bearing (high Ca) vs. volatile (high I)?\n` +
          `6. \`get_layer_violations\` — any stable code depending on volatile code (SDP breaks)?\n\n` +
          `Then write a short prioritized summary: the top 3 architectural risks and a concrete first step for each.`,
      ),
  );

  server.registerPrompt(
    "safe_refactor",
    {
      title: "Safe refactor checklist",
      description: "Everything you need to know before changing a specific symbol: blast radius, callees, and minimal context.",
      argsSchema: {
        file: z.string().describe("File containing the symbol, relative to the project root."),
        symbol: z.string().describe("Name of the function/class/symbol you intend to change."),
      },
    },
    ({ file, symbol }) =>
      userPrompt(
        `Before refactoring \`${symbol}\` in \`${file}\`, gather the impact using the ast-mapper tools:\n\n` +
          `1. \`get_change_impact\` for \`${file}\` / \`${symbol}\` — who depends on it (the blast radius)?\n` +
          `2. \`get_call_graph\` — what does \`${symbol}\` call, and what calls it?\n` +
          `3. \`pack_context\` for \`${file}\` / \`${symbol}\` — the minimal context (its source + the signatures it depends on).\n\n` +
          `Then summarize: what will break if the signature changes, which call sites need updating, and a safe step-by-step refactor order.`,
      ),
  );

  server.registerPrompt(
    "dead_code_cleanup",
    {
      title: "Dead-code cleanup",
      description: "Find unused exports and verify each is safe to delete before removing it.",
      argsSchema: dirArg,
    },
    ({ dir }) =>
      userPrompt(
        `Help me remove dead code from \`${d(dir)}\` using the ast-mapper tools:\n\n` +
          `1. \`find_dead_code\` on \`${d(dir)}\` — list exported symbols nobody imports.\n` +
          `2. For each HIGH-confidence result, double-check with \`get_change_impact\` (should be empty).\n` +
          `3. Before suggesting deletion, show the symbol's source with \`get_symbol_context\`.\n\n` +
          `Produce a deletion checklist: only symbols that are high-confidence AND have zero impact. Flag anything dynamic (string-referenced, re-exported) as "verify manually".`,
      ),
  );

  server.registerPrompt(
    "health_check",
    {
      title: "Codebase health check",
      description: "A one-pass health report: overall grade, riskiest files, and stability inversions.",
      argsSchema: dirArg,
    },
    ({ dir }) =>
      userPrompt(
        `Give me a health check of \`${d(dir)}\` using the ast-mapper tools:\n\n` +
          `1. \`get_codebase_report\` on \`${d(dir)}\` — overall grade A–F, hotspots, god nodes, dead code, cycles.\n` +
          `2. \`get_risk_map\` — the files with the highest churn × complexity (best refactor / test targets).\n` +
          `3. \`get_layer_violations\` — stable files depending on volatile ones.\n\n` +
          `Summarize as: the grade, the single biggest problem, and the 3 files I should touch first to improve it.`,
      ),
  );

  server.registerPrompt(
    "onboard_codebase",
    {
      title: "Onboard to a codebase",
      description: "Get oriented in an unfamiliar directory: languages, structure, the core symbols, and how modules connect.",
      argsSchema: dirArg,
    },
    ({ dir }) =>
      userPrompt(
        `I'm new to this codebase. Walk me through \`${d(dir)}\` using the ast-mapper tools:\n\n` +
          `1. \`list_supported_languages\` then \`generate_skeleton\` on \`${d(dir)}\` — what languages and overall shape?\n` +
          `2. \`get_top_symbols\` — the most-depended-on symbols are the concepts to learn first.\n` +
          `3. \`get_module_coupling\` — how do the directories relate; what's the stable core?\n` +
          `4. For the top God Node, \`get_symbol_context\` with related symbols to see how it's used.\n\n` +
          `Then write a 5-bullet "start here" orientation: what this code does, its core abstractions, and where to begin reading.`,
      ),
  );
}
