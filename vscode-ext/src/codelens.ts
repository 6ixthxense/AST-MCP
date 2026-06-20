import * as vscode from "vscode";
import { runCliJson, rootForUri } from "./runner.js";

// ─── Types (matching ast-map --json output) ───────────────────────────────────

interface ComplexityEntry {
  symbol: string;
  line: number;
  complexity: number;
  rank: string;
}

interface ComplexityResult {
  file: string;
  entries: ComplexityEntry[];
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, { ts: number; data: ComplexityResult }>();
const TTL_MS = 10_000;

async function getComplexity(uri: vscode.Uri): Promise<ComplexityResult | null> {
  const key = uri.fsPath;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;

  try {
    const root = rootForUri(uri);
    const rel = vscode.workspace.asRelativePath(uri, false);
    const data = await runCliJson<ComplexityResult>(["complexity", rel], root);
    cache.set(key, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class AstMapCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._emitter.event;

  invalidate(uri?: vscode.Uri) {
    if (uri) cache.delete(uri.fsPath);
    else cache.clear();
    this._emitter.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const cfg = vscode.workspace.getConfiguration("astMap");
    if (!cfg.get<boolean>("enableCodeLens", true)) return [];

    const data = await getComplexity(document.uri);
    if (!data?.entries?.length) return [];

    const warnThreshold = cfg.get<number>("complexityWarningThreshold", 10);
    const errorThreshold = cfg.get<number>("complexityErrorThreshold", 20);

    return data.entries.map((e) => {
      const line = Math.max(0, e.line - 1);
      const range = new vscode.Range(line, 0, line, 0);

      let icon = "✦";
      let label: string;
      if (e.complexity >= errorThreshold) {
        icon = "🔴";
        label = `${icon} Complexity: ${e.complexity} (${e.rank}) — refactor recommended`;
      } else if (e.complexity >= warnThreshold) {
        icon = "🟡";
        label = `${icon} Complexity: ${e.complexity} (${e.rank}) — consider simplifying`;
      } else {
        label = `${icon} Complexity: ${e.complexity} (${e.rank})`;
      }

      return new vscode.CodeLens(range, {
        title: label,
        command: "",
        arguments: [],
      });
    });
  }
}
