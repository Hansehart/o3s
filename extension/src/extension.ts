import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { parse as parseJsonc } from "jsonc-parser";

interface GenerateMessage {
  type: "generate";
  selected: string[];
}

interface CatalogEntry {
  label: string;
  description: string;
  options: unknown;
}

type Catalog = Record<string, CatalogEntry>;

function projectRoot(): string | undefined {
  return vscode.workspace.workspaceFolders
    ?.map((folder) => folder.uri.fsPath)
    .find((folderPath) => fs.existsSync(path.join(folderPath, ".o3s")));
}

function readJsonc(filePath: string): any {
  return parseJsonc(fs.readFileSync(filePath, "utf8"));
}

function loadCatalog(root: string): Catalog {
  const catalogPath = path.join(root, ".devcontainer", "templates", "features.json");
  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

function loadCurrentSelection(root: string, catalog: Catalog): string[] {
  const devcontainerPath = path.join(root, ".devcontainer", "devcontainer.json");
  if (!fs.existsSync(devcontainerPath)) {
    return [];
  }
  const current = readJsonc(devcontainerPath);
  const currentFeatures = Object.keys(current?.features ?? {});
  return currentFeatures.filter((id) => id in catalog);
}

function generateDevcontainer(root: string, selected: string[]) {
  const skeletonPath = path.join(root, ".devcontainer", "templates", "devcontainer.json");
  const catalog = loadCatalog(root);
  const skeleton = readJsonc(skeletonPath);

  skeleton.features = Object.fromEntries(
    selected.filter((id) => id in catalog).map((id) => [id, catalog[id].options])
  );

  const outPath = path.join(root, ".devcontainer", "devcontainer.json");
  fs.writeFileSync(outPath, JSON.stringify(skeleton, null, 4) + "\n", "utf8");
}

function nonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function openProjectHtml(): string {
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

class MainViewProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: true };

    const root = projectRoot();
    if (!root) {
      webviewView.webview.html = openProjectHtml();
      return;
    }

    const catalog = loadCatalog(root);
    const selected = new Set(loadCurrentSelection(root, catalog));
    const csp = nonce();

    const items = Object.entries(catalog)
      .map(([id, entry]) => {
        const checked = selected.has(id) ? "checked" : "";
        return `<label class="feature-card">
          <span class="switch">
            <input type="checkbox" value="${id}" ${checked}>
            <span class="slider"></span>
          </span>
          <span class="feature-text">
            <span class="feature-title">${entry.label}</span>
            <span class="feature-desc">${entry.description}</span>
          </span>
        </label>`;
      })
      .join("\n");

    const total = Object.keys(catalog).length;

    webviewView.webview.html = /* html */ `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${csp}';">
  <style>
    * {
      box-sizing: border-box;
    }
    html, body {
      height: 100%;
      margin: 0;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      display: flex;
      flex-direction: column;
    }
    .header {
      padding: 14px 12px 6px;
    }
    .header h3 {
      margin: 0;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
    }
    .header p {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px 4px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .feature-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 6px;
      cursor: pointer;
      transition: border-color 0.12s ease, background 0.12s ease;
    }
    .feature-card:hover {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-hoverBackground);
    }
    .feature-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .feature-title {
      font-weight: 600;
      font-size: 13px;
    }
    .feature-desc {
      font-size: 12px;
      line-height: 1.4;
      color: var(--vscode-descriptionForeground);
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 32px;
      height: 18px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      inset: 0;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      border-radius: 999px;
      transition: background 0.15s ease;
    }
    .slider::before {
      content: "";
      position: absolute;
      height: 12px;
      width: 12px;
      left: 2px;
      top: 2px;
      background: var(--vscode-foreground);
      border-radius: 50%;
      transition: transform 0.15s ease;
    }
    .switch input:checked + .slider {
      background: var(--vscode-button-background);
      border-color: var(--vscode-button-background);
    }
    .switch input:checked + .slider::before {
      transform: translateX(14px);
      background: var(--vscode-button-foreground);
    }
    .footer {
      position: sticky;
      bottom: 0;
      padding: 10px 12px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    #count {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    button {
      width: 100%;
      padding: 8px 10px;
      font-weight: 600;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
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
  <script nonce="${csp}">
    const vscode = acquireVsCodeApi();
    const checkboxes = Array.from(document.querySelectorAll("#features input"));
    const count = document.getElementById("count");
    const total = ${total};

    function updateCount() {
      const n = checkboxes.filter((el) => el.checked).length;
      count.textContent = n + " of " + total + " selected";
    }
    checkboxes.forEach((el) => el.addEventListener("change", updateCount));
    updateCount();

    document.getElementById("generate").addEventListener("click", () => {
      const selected = checkboxes.filter((el) => el.checked).map((el) => el.value);
      vscode.postMessage({ type: "generate", selected });
    });
  </script>
</body>
</html>`;

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
        webviewView.webview.html = openProjectHtml();
      }
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("o3s.generateDevcontainer", () => {
      vscode.commands.executeCommand("workbench.view.extension.o3s");
    }),
    vscode.window.registerWebviewViewProvider("o3s.mainView", new MainViewProvider())
  );
}

export function deactivate() {}
