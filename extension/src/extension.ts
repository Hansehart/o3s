import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("o3s.generateDevcontainer", () => {
      vscode.window.showInformationMessage("o3s: devcontainer.json generation not implemented yet.");
    })
  );
}

export function deactivate() {}
