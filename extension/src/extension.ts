import * as vscode from "vscode";
import { asError, createLog } from "./log";
import { MainViewProvider } from "./mainViewProvider";

/** HTTPS rather than SSH, so the clone travels the path the gateway injects GH_TOKEN into. */
const REPO_URL = "https://github.com/Hansehart/o3s.git";

export function activate(context: vscode.ExtensionContext) {
  const log = createLog(context);

  log.info(`host: remoteName=${vscode.env.remoteName ?? "none"}`);
  // Each folder open in the window, which is where the marker search looks.
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    log.info(`folder: uri=${folder.uri.toString()} fsPath=${folder.uri.fsPath}`);
  }

  const provider = new MainViewProvider(context, log);

  context.subscriptions.push(
    vscode.commands.registerCommand("o3s.generateDevcontainer", () => {
      vscode.commands.executeCommand("workbench.view.extension.o3s");
    }),
    vscode.commands.registerCommand("o3s.refreshCatalog", () => provider.refresh()),
    vscode.commands.registerCommand("o3s.cloneAndSetup", async () => {
      log.info("executing git.clone");
      try {
        await vscode.commands.executeCommand("git.clone", REPO_URL);
      } catch (error) {
        log.error(asError(error));
        vscode.window.showErrorMessage(`o3s: could not clone o3s - ${error}`);
      }
    }),
    vscode.window.registerWebviewViewProvider("o3s.mainView", provider)
  );
}

export function deactivate() {}
