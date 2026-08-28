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

export class MainViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    const root = projectRoot();
    if (!root) {
      webviewView.webview.html = this.openProjectHtml();
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
        webviewView.webview.html = this.openProjectHtml();
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
<body>
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

  private openProjectHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 8px;
      padding: 32px 16px;
    }
    .icon {
      font-size: 32px;
    }
    h3 {
      margin: 0;
      font-size: 15px;
    }
    p {
      margin: 0;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="icon">&#9432;</div>
  <h3>Open the o3s project</h3>
  <p>This view only works inside the o3s repository.</p>
</body>
</html>`;
  }
}
