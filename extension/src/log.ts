import * as vscode from "vscode";

export function createLog(context: vscode.ExtensionContext): vscode.LogOutputChannel {
  const log = vscode.window.createOutputChannel("o3s", { log: true });
  context.subscriptions.push(log);
  return log;
}

export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
