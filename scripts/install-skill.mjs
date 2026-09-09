#!/usr/bin/env node
/**
 * Postinstall: copies the /ast-map Claude Code skill to ~/.claude/skills/ast-map/
 * so it appears in the / command palette automatically after install.
 * Skips silently if Claude Code is not installed or if running in CI.
 *
 * The skill content lives in ../skills/ast-map/ as real markdown files — edit
 * those, not this script.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

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

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "ast-map");

function main() {
  const claudeDir = path.join(os.homedir(), ".claude");

  // Only install if Claude Code config directory exists
  if (!fs.existsSync(claudeDir)) return;

  try {
    // 1. Copy SKILL.md
    const skillDir = path.join(claudeDir, "skills", "ast-map");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(SRC, "SKILL.md"), path.join(skillDir, "SKILL.md"));

    // 2. Update CLAUDE.md — idempotent (skip if entry already present)
    const claudeMdPath = path.join(claudeDir, "CLAUDE.md");
    const existing = fs.existsSync(claudeMdPath)
      ? fs.readFileSync(claudeMdPath, "utf8")
      : "";

    if (!existing.includes('skill: "ast-map"')) {
      const entry = fs.readFileSync(path.join(SRC, "CLAUDE-entry.md"), "utf8");
      fs.writeFileSync(claudeMdPath, existing.trimEnd() + "\n\n" + entry, "utf8");
    }

    console.log("✓ /ast-map skill installed to Claude Code (~/.claude/skills/ast-map/)");
    console.log("  Type /ast-map in any Claude Code session to run code analysis.");
  } catch {
    // Non-fatal — skill install is best-effort, don't break npm install
  }
}

main();
