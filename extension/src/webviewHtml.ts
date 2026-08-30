import escapeHtml from "escape-html";
import { getNonce } from "./getNonce";
import { Catalog } from "./devcontainerGenerator";

/** The webview-resolved locations the pages link to, as `asWebviewUri` returns them. */
export interface WebviewAssets {
  cspSource: string;
  styleUri: string;
  scriptUri: string;
  logoUri: string;
}

export function featuresHtml(
  assets: WebviewAssets,
  catalog: Catalog,
  selected: Set<string>
): string {
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${assets.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${assets.styleUri}" rel="stylesheet">
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
  <script nonce="${nonce}" data-total="${total}" src="${assets.scriptUri}"></script>
</body>
</html>`;
}

export function openProjectHtml(assets: WebviewAssets): string {
  const nonce = getNonce();
  return /* html */ `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${assets.cspSource}; style-src ${assets.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${assets.styleUri}" rel="stylesheet">
</head>
<body class="open-project-page">
  <img class="logo" src="${assets.logoUri}" alt="o3s">
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
