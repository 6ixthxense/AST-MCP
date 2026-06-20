import { execFile } from "child_process";
import * as vscode from "vscode";

/** Run `ast-map <args>` and return stdout as a string. Rejects on non-zero exit. */
export function runCli(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cfg = vscode.workspace.getConfiguration("astMap");
    const cliPath: string = cfg.get("cliPath") ?? "ast-map";

    execFile(cliPath, args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Run and parse JSON output. */
export async function runCliJson<T>(args: string[], cwd: string): Promise<T> {
  const raw = await runCli([...args, "--json"], cwd);
  return JSON.parse(raw) as T;
}

/** Return the workspace root, or undefined if no folder is open. */
export function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Return the root for a given URI (first workspace folder that contains it). */
export function rootForUri(uri: vscode.Uri): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const f of folders) {
    if (uri.fsPath.startsWith(f.uri.fsPath)) return f.uri.fsPath;
  }
  return folders[0]?.uri.fsPath ?? ".";
}
