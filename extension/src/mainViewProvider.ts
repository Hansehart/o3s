import * as vscode from "vscode";
import escapeHtml from "escape-html";
import { getNonce } from "./getNonce";
import {
  Catalog,
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

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    const root = projectRoot();
    if (!root) {
      webviewView.webview.html = this.openProjectHtml(webviewView.webview);
      webviewView.webview.onDidReceiveMessage((message: CloneMessage) => {
        if (message.type === "clone") {
          vscode.commands.executeCommand("o3s.cloneAndSetup");
        }
      });
      return;
    }

    const catalog = loadCatalog(root);
    const selected = new Set(loadCurrentSelection(root, catalog));
    webviewView.webview.html = this.featuresHtml(webviewView.webview, catalog, selected);

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
        webviewView.webview.html = this.openProjectHtml(webviewView.webview);
      }
    });
  }

  private featuresHtml(webview: vscode.Webview, catalog: Catalog, selected: Set<string>): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "main.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "main.js"));
    const nonce = getNonce();
    const total = Object.keys(catalog).length;

    const items = Object.entries(catalog)
      .map(([id, entry]) => {
        const checked = selected.has(id) ? "checked" : "";
        return `<label class="feature-card">
          <span class="switch">
            <input type="checkbox" value="${escapeHtml(id)}" ${checked}>
            <span class="slider"></span>
          </span>
          <span class="feature-text">
            <span class="feature-title">${escapeHtml(entry.label)}</span>
            <span class="feature-desc">${escapeHtml(entry.description)}</span>
          </span>
        </label>`;
      })
      .join("\n");

    return /* html */ `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
</head>
<body class="features-page">
  <div class="header">
    <h3>Features</h3>
    <p>Choose what o3s installs in your dev container.</p>
  </div>
  <form id="features" class="list">
    ${items}
  </form>
  <div class="footer">
    <span id="count"></span>
    <button id="generate">Generate</button>
  </div>
  <script nonce="${nonce}" data-total="${total}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private openProjectHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "main.css"));
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "icon.png"));
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
</head>
<body class="open-project-page">
  <img class="logo" src="${logoUri}" alt="o3s">
  <h3>Welcome to o3s</h3>
  <p>A sandboxed home for your AI agents - locked-down network, safe secrets. Clone the repo to get started.</p>
  <button id="clone">Clone o3s</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById("clone").addEventListener("click", () => {
      vscode.postMessage({ type: "clone" });
    });
  </script>
</body>
</html>`;
  }
}
