import * as vscode from "vscode";
import { createLog } from "./log";
import { cloneRepository } from "./clone";
import { MainViewProvider } from "./mainViewProvider";

export function activate(context: vscode.ExtensionContext) {
  const log = createLog(context);

  log.info(`host: remoteName=${vscode.env.remoteName ?? "none"}`);
  // Each folder open in the window, which is where the marker search looks.
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    log.info(`folder: uri=${folder.uri.toString()} fsPath=${folder.uri.fsPath}`);
  }

  const provider = new MainViewProvider(context, log);

  context.subscriptions.push(
    // The view's own focus command, which VS Code registers for every contributed view.
    vscode.commands.registerCommand("o3s.generateDevcontainer", () =>
      vscode.commands.executeCommand("o3s.mainView.focus")
    ),
    vscode.commands.registerCommand("o3s.refreshCatalog", () => provider.refresh()),
    vscode.commands.registerCommand("o3s.cloneAndSetup", () => cloneRepository(log)),
    vscode.window.registerWebviewViewProvider("o3s.mainView", provider)
  );
}

export function deactivate() {}
