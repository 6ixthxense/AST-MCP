import * as vscode from "vscode";
import { runCliJson, rootForUri } from "./runner.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeadExport {
  file: string;
  symbol: string;
  kind: string;
  line?: number;
  confidence: "high" | "medium" | "low";
}

interface SecurityIssue {
  file: string;
  rule: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  line: number;
  snippet: string;
}

// ─── Severity mapping ─────────────────────────────────────────────────────────

const SEC_SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error,
  high: vscode.DiagnosticSeverity.Error,
  medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information,
};

// ─── Diagnostics collection ───────────────────────────────────────────────────

export const COLLECTION_DEAD = vscode.languages.createDiagnosticCollection("astMap.dead");
export const COLLECTION_SECURITY = vscode.languages.createDiagnosticCollection("astMap.security");

// ─── Refresh for a single file ────────────────────────────────────────────────

export async function refreshFileDiagnostics(document: vscode.TextDocument): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("astMap");
  if (!cfg.get<boolean>("enableDiagnostics", true)) return;

  const root = rootForUri(document.uri);
  const rel = vscode.workspace.asRelativePath(document.uri, false);

  await Promise.all([
    refreshDeadExports(document.uri, rel, root),
    refreshSecurity(document.uri, rel, root),
  ]);
}

async function refreshDeadExports(
  uri: vscode.Uri,
  rel: string,
  root: string,
): Promise<void> {
  try {
    const result = await runCliJson<{ dead: DeadExport[] }>(["dead", rel, "--scan", rel], root);
    const fileDead = (result.dead ?? []).filter(
      (d) => d.file === rel && d.confidence === "high",
    );
    const diags = fileDead.map((d) => {
      const line = Math.max(0, (d.line ?? 1) - 1);
      const range = new vscode.Range(line, 0, line, 999);
      const diag = new vscode.Diagnostic(
        range,
        `Dead export: "${d.symbol}" (${d.kind}) is never imported within the scanned directory.`,
        vscode.DiagnosticSeverity.Warning,
      );
      diag.source = "ast-map";
      diag.code = "dead-export";
      return diag;
    });
    COLLECTION_DEAD.set(uri, diags);
  } catch {
    COLLECTION_DEAD.delete(uri);
  }
}

async function refreshSecurity(
  uri: vscode.Uri,
  rel: string,
  root: string,
): Promise<void> {
  try {
    const issues = await runCliJson<SecurityIssue[]>(["security", rel], root);
    const diags = issues.map((i) => {
      const line = Math.max(0, i.line - 1);
      const range = new vscode.Range(line, 0, line, 999);
      const severity = SEC_SEVERITY[i.severity] ?? vscode.DiagnosticSeverity.Warning;
      const diag = new vscode.Diagnostic(
        range,
        `[${i.severity.toUpperCase()}] ${i.message}`,
        severity,
      );
      diag.source = "ast-map";
      diag.code = i.rule;
      return diag;
    });
    COLLECTION_SECURITY.set(uri, diags);
  } catch {
    COLLECTION_SECURITY.delete(uri);
  }
}

// ─── Workspace-wide refresh ───────────────────────────────────────────────────

export async function refreshWorkspaceDiagnostics(): Promise<void> {
  const editors = vscode.window.visibleTextEditors;
  await Promise.all(editors.map((e) => refreshFileDiagnostics(e.document)));
}
