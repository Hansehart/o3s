import { randomUUID } from "crypto";
import escapeHtml from "escape-html";
import { Catalog } from "./devcontainerGenerator";

/** The webview-resolved locations the pages link to, as `asWebviewUri` returns them. */
export interface WebviewAssets {
  cspSource: string;
  styleUri: string;
  scriptUri: string;
  logoUri: string;
}

/**
 * The shell every page shares: the nonce, the stylesheet and the script both
 * pages link, and the baseline policy. Hyphens are legal in a `nonce-` source
 * expression, so a UUID serves directly. `extraCsp` carries the directives a
 * single page needs, so no page is granted a source only its neighbour uses.
 */
function page(
  assets: WebviewAssets,
  bodyClass: string,
  body: string,
  extraCsp = ""
): string {
  const nonce = randomUUID();
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${extraCsp}style-src ${assets.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${assets.styleUri}" rel="stylesheet">
  <title>o3s</title>
</head>
<body class="${bodyClass}">
${body}
  <script nonce="${nonce}" src="${assets.scriptUri}"></script>
</body>
</html>`;
}

export function featuresHtml(
  assets: WebviewAssets,
  catalog: Catalog,
  selected: Set<string>
): string {
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

  return page(
    assets,
    "features-page",
    /* html */ `  <div class="header">
    <h3>Features</h3>
    <p>Choose what o3s installs in your dev container.</p>
  </div>
  <form id="features" class="list">
    ${items}
  </form>
  <div class="footer">
    <span id="count"></span>
    <button id="generate">Generate</button>
  </div>`
  );
}

export function openProjectHtml(assets: WebviewAssets): string {
  return page(
    assets,
    "open-project-page",
    /* html */ `  <img class="logo" src="${assets.logoUri}" alt="o3s">
  <h3>Welcome to o3s</h3>
  <p>A sandboxed home for your AI agents - locked-down network, safe secrets. Clone the repo to get started.</p>
  <button id="clone">Clone o3s</button>`,
    `img-src ${assets.cspSource}; `
  );
}
