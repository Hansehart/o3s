import * as vscode from "vscode";
import { MainViewProvider } from "./mainViewProvider";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("o3s.generateDevcontainer", () => {
      vscode.commands.executeCommand("workbench.view.extension.o3s");
    }),
    vscode.commands.registerCommand("o3s.cloneAndSetup", () => {
      vscode.commands.executeCommand("git.clone", "git@github.com:Hansehart/o3s.git");
    }),
    vscode.window.registerWebviewViewProvider("o3s.mainView", new MainViewProvider(context.extensionUri))
  );
}

export function deactivate() {}
