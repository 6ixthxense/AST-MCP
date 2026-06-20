import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { runCli, runCliJson, rootForUri, workspaceRoot } from "./runner.js";
import { AstMapCodeLensProvider } from "./codelens.js";
import {
  COLLECTION_DEAD,
  COLLECTION_SECURITY,
  refreshFileDiagnostics,
  refreshWorkspaceDiagnostics,
} from "./diagnostics.js";
import { IssuesViewProvider } from "./issues-view.js";
import { startLspClient, stopLspClient } from "./lsp-client.js";

// ─── Language selector ────────────────────────────────────────────────────────

const SUPPORTED_LANGS: vscode.DocumentFilter[] = [
  "typescript", "javascript", "typescriptreact", "javascriptreact",
  "python", "go", "java", "ruby",
].map((language) => ({ language, scheme: "file" }));

// ─── Status bar ───────────────────────────────────────────────────────────────

let statusBarItem: vscode.StatusBarItem;

async function updateStatusBar(): Promise<void> {
  const root = workspaceRoot();
  if (!root) { statusBarItem.hide(); return; }

  try {
    const result = await runCliJson<{ score: number; grade: string }>(
      ["report", ".", "--json"],
      root,
    );
    statusBarItem.text = `$(symbol-structure) AST ${result.grade} ${result.score}`;
    statusBarItem.tooltip = `AST Map health score: ${result.score}/100 (${result.grade})`;
    statusBarItem.backgroundColor =
      result.score < 50
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : result.score < 75
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
    statusBarItem.show();
  } catch {
    statusBarItem.hide();
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdGenerateTests(ai: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage("No active editor."); return; }

  const uri = editor.document.uri;
  const root = rootForUri(uri);
  const rel = vscode.workspace.asRelativePath(uri, false);
  const fw = detectFramework(root);

  const args = ["testgen", rel, "--framework", fw, "--dry-run"];

  if (ai) {
    const cfg = vscode.workspace.getConfiguration("astMap");
    const apiKey: string = cfg.get("anthropicApiKey") ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    if (!apiKey && !process.env["ANTHROPIC_API_KEY"]) {
      vscode.window.showWarningMessage(
        "Set ANTHROPIC_API_KEY or configure astMap.anthropicApiKey to use AI test generation.",
      );
    }
    args.push("--ai");
    if (apiKey) args.push("--api-key", apiKey);
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: ai ? "Generating tests (AI)…" : "Generating tests…", cancellable: false },
    async () => {
      try {
        const content = await runCli(args, root);
        const testPath = resolveTestPath(uri.fsPath);
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.parse(`untitled:${testPath}`),
        );
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), stripCliHeader(content));
        await vscode.workspace.applyEdit(edit);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`Test file ready: ${path.basename(testPath)}`);
      } catch (e) {
        vscode.window.showErrorMessage(`ast-map testgen failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}

async function cmdRunSmells(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const root = rootForUri(editor.document.uri);
  const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
  const out = vscode.window.createOutputChannel("AST Map — Smells");

  try {
    const raw = await runCli(["smells", rel], root);
    out.clear();
    out.appendLine(raw);
    out.show(true);
  } catch (e) {
    vscode.window.showErrorMessage(`ast-map smells failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function cmdRunSecurity(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const root = rootForUri(editor.document.uri);
  const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
  const out = vscode.window.createOutputChannel("AST Map — Security");

  try {
    const raw = await runCli(["security", rel], root);
    out.clear();
    out.appendLine(raw);
    out.show(true);
  } catch (e) {
    vscode.window.showErrorMessage(`ast-map security failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function cmdShowDiagram(): Promise<void> {
  const root = workspaceRoot();
  if (!root) { vscode.window.showWarningMessage("No workspace folder open."); return; }

  try {
    const result = await runCliJson<{ mermaid: string; title: string }>(
      ["diagram", ".", "--type", "deps"],
      root,
    );
    const panel = vscode.window.createWebviewPanel(
      "astMapDiagram",
      `AST Map — ${result.title}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );
    panel.webview.html = buildDiagramHtml(result.title, result.mermaid);
  } catch (e) {
    vscode.window.showErrorMessage(`ast-map diagram failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function cmdOpenReport(): Promise<void> {
  const root = workspaceRoot();
  if (!root) return;

  try {
    await runCli(["report", ".", "-o", ".ast-map/report.html"], root);
    const reportPath = path.join(root, ".ast-map", "report.html");
    if (fs.existsSync(reportPath)) {
      vscode.env.openExternal(vscode.Uri.file(reportPath));
    } else {
      vscode.window.showWarningMessage("Report not found at .ast-map/report.html");
    }
  } catch (e) {
    vscode.window.showErrorMessage(`ast-map report failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectFramework(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["vitest"]) return "vitest";
    if (deps["jest"] || deps["ts-jest"]) return "jest";
    if (deps["mocha"]) return "mocha";
  } catch { /* no package.json */ }
  return "node";
}

function resolveTestPath(sourcePath: string): string {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath);
  const ext = path.extname(base);
  const stem = base.slice(0, -ext.length);
  if (sourcePath.endsWith(".py")) return path.join(dir, `test_${stem}.py`);
  if (sourcePath.endsWith(".go")) return path.join(dir, `${stem}_test.go`);
  if (sourcePath.endsWith(".java")) return path.join(dir, `${stem}Test.java`);
  if (sourcePath.endsWith(".rb")) return path.join(dir, `${stem}_spec.rb`);
  return path.join(dir, `${stem}.test${ext}`);
}

/** Strip the `── file.ts ──` header line that --dry-run prints */
function stripCliHeader(text: string): string {
  return text.replace(/^──[^\n]+──\n/, "").trimStart();
}

function buildDiagramHtml(title: string, mermaid: string): string {
  const safe = mermaid.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
<body style="background:#1e1e1e;color:#ccc;font-family:sans-serif;padding:20px">
<h2>${title}</h2>
<div class="mermaid" style="background:#252526;padding:16px;border-radius:6px">
${safe}
</div>
<script>mermaid.initialize({ startOnLoad: true, theme: 'dark' })</script>
</body>
</html>`;
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "astMap.openReport";
  context.subscriptions.push(statusBarItem);

  // Code Lens
  const codeLensProvider = new AstMapCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(SUPPORTED_LANGS, codeLensProvider),
  );

  // Diagnostic collections
  context.subscriptions.push(COLLECTION_DEAD, COLLECTION_SECURITY);

  // Issues tree view
  const issuesView = new IssuesViewProvider();
  context.subscriptions.push(
    vscode.window.createTreeView("astMap.issuesView", {
      treeDataProvider: issuesView,
      showCollapseAll: true,
    }),
  );

  // Start LSP client (provides always-on diagnostics + code lenses via ast-map-lsp)
  try {
    startLspClient(context);
  } catch {
    // LSP unavailable — fall back to on-save polling diagnostics below
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("astMap.generateTests", () => cmdGenerateTests(false)),
    vscode.commands.registerCommand("astMap.generateTestsAi", () => cmdGenerateTests(true)),
    vscode.commands.registerCommand("astMap.runSmells", cmdRunSmells),
    vscode.commands.registerCommand("astMap.runSecurity", cmdRunSecurity),
    vscode.commands.registerCommand("astMap.showDiagram", cmdShowDiagram),
    vscode.commands.registerCommand("astMap.openReport", cmdOpenReport),
    vscode.commands.registerCommand("astMap.refreshDiagnostics", () => {
      issuesView.load();
      refreshWorkspaceDiagnostics();
      codeLensProvider.invalidate();
    }),
  );

  // Auto-refresh diagnostics on file open/save
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isSupportedDoc(doc)) refreshFileDiagnostics(doc);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isSupportedDoc(doc)) {
        refreshFileDiagnostics(doc);
        codeLensProvider.invalidate(doc.uri);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isSupportedDoc(editor.document)) {
        refreshFileDiagnostics(editor.document);
      }
    }),
  );

  // Initial load
  updateStatusBar();
  issuesView.load();
  for (const editor of vscode.window.visibleTextEditors) {
    if (isSupportedDoc(editor.document)) refreshFileDiagnostics(editor.document);
  }

  // Refresh status bar on config change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("astMap")) {
        updateStatusBar();
        codeLensProvider.invalidate();
      }
    }),
  );
}

function isSupportedDoc(doc: vscode.TextDocument): boolean {
  return SUPPORTED_LANGS.some((f) => f.language === doc.languageId) && doc.uri.scheme === "file";
}

export function deactivate(): Promise<void> {
  statusBarItem?.dispose();
  COLLECTION_DEAD.dispose();
  COLLECTION_SECURITY.dispose();
  return stopLspClient();
}
