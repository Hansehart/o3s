import * as vscode from "vscode";
import { createLog } from "./log";
import { cloneRepository } from "./clone";
import { MainViewProvider } from "./mainViewProvider";
import { PROVIDERS_SECTION, PROVIDERS_SETTING } from "./providers";

export function activate(context: vscode.ExtensionContext) {
  const log = createLog(context);

  log.info(`host: remoteName=${vscode.env.remoteName ?? "none"}`);
  // Each folder open in the window, which is where the checkout search looks.
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
    // A provider added through the settings reaches the sidebar too.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${PROVIDERS_SECTION}.${PROVIDERS_SETTING}`)) {
        void provider.refresh();
      }
    }),
    // Keeps the webview alive while the view is hidden, so a selection outlives a collapse.
    vscode.window.registerWebviewViewProvider("o3s.mainView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
}

export function deactivate() {}
