import * as vscode from "vscode";

export function createLog(context: vscode.ExtensionContext): vscode.LogOutputChannel {
  const log = vscode.window.createOutputChannel("o3s", { log: true });
  context.subscriptions.push(log);
  return log;
}

export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Puts a failure where both audiences look: the full error in the log, the reason in a toast. */
export function report(log: vscode.LogOutputChannel, action: string, error: unknown): void {
  const failure = asError(error);
  log.error(failure);
  vscode.window.showErrorMessage(`o3s: ${action} - ${failure.message}`);
}
