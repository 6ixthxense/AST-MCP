import * as vscode from "vscode";
import { runCliJson, workspaceRoot } from "./runner.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SmellResult {
  file: string;
  smell: string;
  symbol?: string;
  severity: "warning" | "info";
  message: string;
  line?: number;
}

interface SecurityIssue {
  file: string;
  rule: string;
  severity: string;
  message: string;
  line: number;
}

type IssueKind = "smell" | "security";

interface IssueNode {
  kind: IssueKind;
  file: string;
  line?: number;
  label: string;
  severity: "error" | "warning" | "info";
  detail: string;
}

// ─── Tree items ───────────────────────────────────────────────────────────────

class IssueItem extends vscode.TreeItem {
  constructor(readonly issue: IssueNode) {
    super(issue.label, vscode.TreeItemCollapsibleState.None);
    this.description = `${issue.file}:${issue.line ?? "?"}`;
    this.tooltip = issue.detail;
    this.iconPath = new vscode.ThemeIcon(
      issue.severity === "error" ? "error" : issue.severity === "warning" ? "warning" : "info",
    );
    if (issue.line) {
      const uri = vscode.Uri.file((workspaceRoot() ?? ".") + "/" + issue.file);
      this.command = {
        command: "vscode.open",
        title: "Open file",
        arguments: [uri, { selection: new vscode.Range(issue.line - 1, 0, issue.line - 1, 0) }],
      };
    }
  }
}

class CategoryItem extends vscode.TreeItem {
  constructor(label: string, readonly children: IssueItem[]) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `(${children.length})`;
    this.iconPath = new vscode.ThemeIcon("list-unordered");
  }
}

type TreeNode = CategoryItem | IssueItem;

// ─── Provider ─────────────────────────────────────────────────────────────────

export class IssuesViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._emitter.event;

  private nodes: TreeNode[] = [];

  refresh() {
    this._emitter.fire(undefined);
  }

  async load(): Promise<void> {
    const root = workspaceRoot();
    if (!root) { this.nodes = []; this.refresh(); return; }

    const [smells, security] = await Promise.allSettled([
      runCliJson<SmellResult[]>(["smells", "."], root),
      runCliJson<SecurityIssue[]>(["security", "."], root),
    ]);

    const smellItems: IssueItem[] = [];
    if (smells.status === "fulfilled") {
      for (const s of smells.value) {
        smellItems.push(new IssueItem({
          kind: "smell",
          file: s.file,
          line: s.line,
          label: s.symbol ? `${s.smell}: ${s.symbol}` : s.smell,
          severity: s.severity === "warning" ? "warning" : "info",
          detail: s.message,
        }));
      }
    }

    const secItems: IssueItem[] = [];
    if (security.status === "fulfilled") {
      for (const i of security.value) {
        secItems.push(new IssueItem({
          kind: "security",
          file: i.file,
          line: i.line,
          label: `${i.rule}: ${i.message.slice(0, 60)}`,
          severity: ["critical", "high"].includes(i.severity) ? "error" : "warning",
          detail: i.message,
        }));
      }
    }

    this.nodes = [];
    if (smellItems.length) this.nodes.push(new CategoryItem("Code Smells", smellItems));
    if (secItems.length) this.nodes.push(new CategoryItem("Security Issues", secItems));

    this.refresh();
  }

  getTreeItem(element: TreeNode) { return element; }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) return this.nodes;
    if (element instanceof CategoryItem) return element.children;
    return [];
  }
}
