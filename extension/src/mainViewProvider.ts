import * as vscode from "vscode";
import { WebviewAssets, featuresHtml, openProjectHtml } from "./webviewHtml";
import {
  generateDevcontainer,
  loadCatalog,
  loadCurrentSelection,
  projectRoot,
} from "./devcontainerGenerator";

interface GenerateMessage {
  type: "generate";
  selected: string[];
}

interface CloneMessage {
  type: "clone";
}

export class MainViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  private assets(webview: vscode.Webview): WebviewAssets {
    const mediaUri = (name: string): string =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", name)).toString();
    return {
      cspSource: webview.cspSource,
      styleUri: mediaUri("main.css"),
      scriptUri: mediaUri("main.js"),
      logoUri: mediaUri("icon.png"),
    };
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    const assets = this.assets(webviewView.webview);

    const root = projectRoot();
    if (!root) {
      webviewView.webview.html = openProjectHtml(assets);
      webviewView.webview.onDidReceiveMessage((message: CloneMessage) => {
        if (message.type === "clone") {
          vscode.commands.executeCommand("o3s.cloneAndSetup");
        }
      });
      return;
    }

    const catalog = loadCatalog(root);
    const selected = new Set(loadCurrentSelection(root, catalog));
    webviewView.webview.html = featuresHtml(assets, catalog, selected);

    webviewView.webview.onDidReceiveMessage((message: GenerateMessage) => {
      if (message.type !== "generate") {
        return;
      }
      try {
        generateDevcontainer(root, message.selected);
        vscode.window.showInformationMessage(
          "devcontainer.json generated. Press Ctrl/Cmd+Shift+P and run \"Rebuild and Reopen in Container\" to apply it.",
          { modal: true }
        );
      } catch {
        webviewView.webview.html = openProjectHtml(assets);
      }
    });
  }
}
