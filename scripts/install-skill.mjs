#!/usr/bin/env node
/**
 * Postinstall: copies the /ast-map Claude Code skill to ~/.claude/skills/ast-map/
 * so it appears in the / command palette automatically after install.
 * Skips silently if Claude Code is not installed or if running in CI.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── Skip in CI / non-interactive environments ────────────────────────────────
if (
  process.env.CI ||
  process.env.CONTINUOUS_INTEGRATION ||
  process.env.npm_config_ci ||
  process.env.GITHUB_ACTIONS ||
  process.env.GITLAB_CI
) {
  process.exit(0);
}

// ─── Skill content ────────────────────────────────────────────────────────────

const SKILL_MD = `---
name: ast-map
description: "AST-based code analysis using universal-ast-mapper. Use to understand codebase structure, find dead code, detect circular deps, check blast radius, validate architecture. Works on TypeScript, JavaScript, Python, Go."
trigger: /ast-map
---

# /ast-map

Run AST-based code analysis on the current project using universal-ast-mapper (tree-sitter).

## Usage

\`\`\`
/ast-map                          # architecture overview: dead code + cycles + top symbols
/ast-map dead [dir]               # find unused exports
/ast-map cycles [dir]             # detect circular import chains
/ast-map validate [path]          # architecture + structural violations
/ast-map skeleton <file>          # show a file's symbols and imports
/ast-map top [dir]                # top N most-imported symbols (God Nodes)
/ast-map impact <file> <symbol>   # blast radius of changing a symbol
/ast-map calls <file> <fn>        # call graph for a function
/ast-map search <name> [dir]      # find a symbol across all files
/ast-map deps <file>              # what this file imports / what imports it
\`\`\`

If no path is given, use \`.\` (current working directory). Do not ask the user for a path.

---

## What You Must Do When Invoked

### Step 1 — Determine mode

Parse the arguments after \`/ast-map\`:

| Command | Action |
|---------|--------|
| _(no args)_ | Run full overview: dead + cycles + validate |
| \`dead [dir]\` | Find dead exports |
| \`cycles [dir]\` | Find circular deps |
| \`validate [path]\` | Architecture + structural check |
| \`skeleton <file>\` | File skeleton |
| \`top [dir]\` | Top imported symbols |
| \`impact <file> <symbol>\` | Change impact |
| \`calls <file> <fn>\` | Call graph |
| \`search <name> [dir]\` | Symbol search |
| \`deps <file>\` | File dependencies |

### Step 2 — Choose execution method

**Prefer MCP tools** (faster, no subprocess). If \`mcp__ast-mapper__*\` tools are available in the current session, use them. Otherwise fall back to CLI.

**MCP tool → CLI command mapping:**

| Command | MCP Tool | CLI fallback |
|---------|----------|-------------|
| dead | \`find_dead_code\` | \`ast-map dead <dir>\` |
| cycles | \`find_circular_deps\` | \`ast-map cycles <dir>\` |
| validate | \`validate_architecture\` | \`ast-map validate <path>\` |
| skeleton | \`get_skeleton_json\` | \`ast-map skeleton <file>\` |
| top | \`get_top_symbols\` | \`ast-map top <dir>\` |
| impact | \`get_change_impact\` | \`ast-map impact <file> <symbol>\` |
| calls | \`get_call_graph\` | \`ast-map calls <file> <fn>\` |
| search | \`search_symbol\` | \`ast-map search <name> <dir>\` |
| deps | \`get_file_deps\` | \`ast-map deps <file>\` |

### Step 3 — Full overview (no args)

If no command was given, run a 3-part overview and present a unified report:

1. **Dead code** — find high-confidence unused exports
2. **Circular deps** — detect import cycles
3. **Top symbols** — list the 5 most-imported symbols

Then summarise:
\`\`\`
AST-MCP Overview — [directory]
Scanned: N files

Dead Code (high confidence): X symbols
  [list, grouped by file]

Circular Dependencies: Y cycles
  [list each cycle as A → B → C → A]

God Nodes (top 5 most imported):
  1. symbolName (file) — imported by N files
  ...

Recommendation: [1-2 sentences on what to look at first]
\`\`\`

### Step 4 — Present results clearly

- **Dead code**: group by file, show symbol name + kind. Note if 0 ("No dead exports found ✓")
- **Cycles**: show each cycle as \`A.ts → B.ts → C.ts → A.ts\`. Note length.
- **validate**: group by severity (errors first, then warnings). Show file + rule + message.
- **skeleton**: show symbols as a tree with line ranges.
- **impact**: show direct and transitive file lists + totalFiles count.
- **calls**: show call list with line numbers + whether external.
- **search**: show file + symbol + kind + line range.

Always end with a relevant follow-up offer:
- Found dead code? → "Want me to verify each one with \`impact\` before deleting?"
- Found cycles? → "Want me to show which import to break to resolve the shortest cycle?"
- Found God Nodes? → "Want me to check the blast radius of the top one?"

---

## Examples

### /ast-map
Runs dead + cycles + top on the current directory — a 30-second architecture health check.

### /ast-map dead src/
Finds all exported symbols in \`src/\` that are never imported by any other file.

### /ast-map validate src/ --max-lines 300
Checks for boundary violations, API routes missing try/catch, files over 300 lines.

### /ast-map impact src/lib/auth.ts validateSession
Shows every file that directly or transitively depends on \`validateSession\`.
`;

// ─── CLAUDE.md entry ──────────────────────────────────────────────────────────

const CLAUDE_MD_ENTRY = `
# ast-map
- **ast-map** (\`~/.claude/skills/ast-map/SKILL.md\`) - AST-based code analysis: dead code, circular deps, blast radius, architecture validation, symbol search. Trigger: \`/ast-map\`
When the user types \`/ast-map\`, invoke the Skill tool with \`skill: "ast-map"\` before doing anything else.
`;

// ─── Install ──────────────────────────────────────────────────────────────────

function main() {
  const claudeDir = path.join(os.homedir(), ".claude");

  // Only install if Claude Code config directory exists
  if (!fs.existsSync(claudeDir)) return;

  try {
    // 1. Write SKILL.md
    const skillDir = path.join(claudeDir, "skills", "ast-map");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), SKILL_MD, "utf8");

    // 2. Update CLAUDE.md — idempotent (skip if entry already present)
    const claudeMdPath = path.join(claudeDir, "CLAUDE.md");
    const existing = fs.existsSync(claudeMdPath)
      ? fs.readFileSync(claudeMdPath, "utf8")
      : "";

    if (!existing.includes('skill: "ast-map"')) {
      fs.writeFileSync(claudeMdPath, existing.trimEnd() + "\n" + CLAUDE_MD_ENTRY, "utf8");
    }

    console.log("✓ /ast-map skill installed to Claude Code (~/.claude/skills/ast-map/)");
    console.log('  Type /ast-map in any Claude Code session to run code analysis.');
  } catch {
    // Non-fatal — skill install is best-effort, don't break npm install
  }
}

main();
