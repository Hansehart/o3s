import * as vscode from "vscode";
import { asError, createLog } from "./log";
import { MainViewProvider } from "./mainViewProvider";

export function activate(context: vscode.ExtensionContext) {
  const log = createLog(context);

  log.info(`host: remoteName=${vscode.env.remoteName ?? "none"}`);
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    log.info(`folder: uri=${folder.uri.toString()} fsPath=${folder.uri.fsPath}`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("o3s.generateDevcontainer", () => {
      vscode.commands.executeCommand("workbench.view.extension.o3s");
    }),
    vscode.commands.registerCommand("o3s.cloneAndSetup", async () => {
      log.info("executing git.clone");
      try {
        await vscode.commands.executeCommand("git.clone", "git@github.com:Hansehart/o3s.git");
      } catch (error) {
        log.error(asError(error));
        vscode.window.showErrorMessage(`o3s: could not clone o3s - ${error}`);
      }
    }),
    vscode.window.registerWebviewViewProvider(
      "o3s.mainView",
      new MainViewProvider(context.extensionUri, log)
    )
  );
}

export function deactivate() {}
