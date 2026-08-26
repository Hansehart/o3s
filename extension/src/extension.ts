import * as vscode from "vscode";

class MainViewProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: false };
    webviewView.webview.html = /* html */ `<!DOCTYPE html>
<html>
  <body></body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("o3s.generateDevcontainer", () => {
      vscode.window.showInformationMessage("o3s: devcontainer.json generation not implemented yet.");
    }),
    vscode.window.registerWebviewViewProvider("o3s.mainView", new MainViewProvider())
  );

  vscode.commands.executeCommand("workbench.view.extension.o3s");
}

export function deactivate() {}
