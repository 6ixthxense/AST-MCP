import * as vscode from "vscode";
import * as path from "path";
import { execSync } from "child_process";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

/** Resolve the path to the `ast-map-lsp` binary. */
function resolveLspBinary(): string {
  const cfg = vscode.workspace.getConfiguration("astMap");
  const cliPath: string = cfg.get("cliPath") ?? "ast-map";

  // Derive lsp binary from cli path
  const dir = path.dirname(cliPath);
  const lspPath = dir === "." ? "ast-map-lsp" : path.join(dir, "ast-map-lsp");

  try {
    // Verify the binary exists and is runnable
    execSync(`"${lspPath}" --version 2>&1`, { timeout: 3000 });
    return lspPath;
  } catch {
    // Fall back to npx
    return "ast-map-lsp";
  }
}

export function startLspClient(context: vscode.ExtensionContext): LanguageClient {
  const lspBin = resolveLspBinary();

  const serverOptions: ServerOptions = {
    command: lspBin,
    args: [],
    transport: TransportKind.stdio,
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "typescriptreact" },
      { scheme: "file", language: "javascriptreact" },
      { scheme: "file", language: "python" },
      { scheme: "file", language: "go" },
      { scheme: "file", language: "java" },
      { scheme: "file", language: "ruby" },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx,js,jsx,mjs,py,go,java,rb}"),
    },
    outputChannelName: "AST Map LSP",
  };

  client = new LanguageClient(
    "astMapLsp",
    "AST Map Language Server",
    serverOptions,
    clientOptions,
  );

  client.start();
  context.subscriptions.push(client);

  return client;
}

export function stopLspClient(): Promise<void> {
  if (client) {
    const c = client;
    client = undefined;
    return c.stop();
  }
  return Promise.resolve();
}

export function getLspClient(): LanguageClient | undefined {
  return client;
}
