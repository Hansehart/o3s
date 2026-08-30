import { randomUUID } from "crypto";
import escapeHtml from "escape-html";
import { Catalog, CatalogEntry, OptionValue } from "./catalog";
import { FeatureOption } from "./registry";

/** The webview-resolved locations the pages link to, as `asWebviewUri` returns them. */
export interface WebviewAssets {
  cspSource: string;
  styleUri: string;
  scriptUri: string;
  logoUri: string;
}

/** Everything the features page draws: what exists, where from, and what is already on. */
export interface FeaturesModel {
  catalog: Catalog;
  collections: string[];
  /** Keyed by `CatalogEntry.base`; the values a generated devcontainer.json already holds. */
  selected: Map<string, Record<string, OptionValue>>;
}

/**
 * The shell every page shares: nonce, stylesheet, script and baseline policy. Hyphens
 * are legal in a `nonce-` source expression, so a UUID serves directly, and `extraCsp`
 * grants each page exactly the directives it uses.
 */
function page(assets: WebviewAssets, bodyClass: string, body: string, extraCsp = ""): string {
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

const attr = (value: string): string => escapeHtml(value);

/** The last segment of a collection ref, which is what a provider is known by. */
const providerName = (collection: string): string =>
  collection.split("/").slice(1).join("/") || collection;

/**
 * One control per published option, chosen by the declared shape: an `enum` becomes a
 * closed list, while `proposals` become suggestions on a field that stays typeable.
 */
function optionHtml(base: string, name: string, option: FeatureOption, value: OptionValue): string {
  const id = `${base}::${name}`;
  const seed = String(value);
  const shared = `data-option="${attr(name)}" data-seed="${attr(seed)}"`;

  let control: string;
  if (option.type === "boolean") {
    control = `<input type="checkbox" ${shared}${value ? " checked" : ""}>`;
  } else if ("enum" in option && option.enum) {
    const choices = option.enum
      .map((c) => `<option value="${attr(c)}"${c === value ? " selected" : ""}>${escapeHtml(c)}</option>`)
      .join("");
    control = `<select ${shared}>${choices}</select>`;
  } else if ("proposals" in option && option.proposals) {
    const list = `${id}::list`;
    const choices = option.proposals.map((c) => `<option value="${attr(c)}">`).join("");
    control = `<input type="text" list="${attr(list)}" ${shared} value="${attr(seed)}">
        <datalist id="${attr(list)}">${choices}</datalist>`;
  } else {
    control = `<input type="text" ${shared} value="${attr(seed)}">`;
  }

  const description = option.description
    ? `<span class="option-desc" data-describes="${attr(name)}">${escapeHtml(option.description)}</span>`
    : "";

  return `<div class="option">
        <span class="option-name">${escapeHtml(name)}</span>
        ${control}
        ${description}
      </div>`;
}

function cardHtml(entry: CatalogEntry, chosen: Record<string, OptionValue> | undefined): string {
  const on = chosen !== undefined;
  const values = { ...entry.values, ...(chosen ?? {}) };

  const security = entry.security.length
    ? `<ul class="security">${entry.security.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
    : "";

  const docs = entry.documentationURL
    ? `<a class="docs" href="${attr(entry.documentationURL)}">Docs</a>`
    : "";

  const extensions = entry.extensions.length
    ? `<span class="extensions">also installs ${entry.extensions.length} VS Code extension${
        entry.extensions.length === 1 ? "" : "s"
      }</span>`
    : "";

  // Each published option, seeded with the value in force for it.
  const options = Object.entries(entry.options)
    .map(([name, option]) => optionHtml(entry.base, name, option, values[name] ?? ""))
    .join("\n");

  return `<div class="feature-card${on ? " on" : ""}" data-base="${attr(entry.base)}" data-collection="${attr(entry.collection)}">
      <div class="feature-head">
        <label class="switch">
          <input type="checkbox" class="toggle"${on ? " checked" : ""}>
          <span class="slider"></span>
        </label>
        <span class="feature-text">
          <span class="feature-title">${escapeHtml(entry.label)} <span class="version">v${escapeHtml(entry.version)}</span></span>
          <span class="feature-desc">${escapeHtml(entry.description)}</span>
          ${extensions}
          ${security}
          ${docs}
        </span>
      </div>
      <div class="feature-options">
${options}
        <button type="button" class="reset">Reset to o3s defaults</button>
      </div>
    </div>`;
}

export function featuresHtml(assets: WebviewAssets, model: FeaturesModel): string {
  // The catalog split across the two lists, each card rendered where its toggle puts it.
  const selectedCards = model.catalog
    .filter((entry) => model.selected.has(entry.base))
    .map((entry) => cardHtml(entry, model.selected.get(entry.base)))
    .join("\n");

  const browseCards = model.catalog
    .filter((entry) => !model.selected.has(entry.base))
    .map((entry) => cardHtml(entry, undefined))
    .join("\n");

  // One tab per collection, the first of them active.
  const providers = model.collections
    .map(
      (collection, index) =>
        `<button type="button" class="provider${index === 0 ? " active" : ""}" data-provider="${attr(collection)}">${escapeHtml(providerName(collection))}</button>`
    )
    .join("");

  return page(
    assets,
    "features-page",
    /* html */ `  <div class="header">
    <h3>Features</h3>
    <p>Choose what o3s installs in your dev container.</p>
  </div>
  <div class="scroll">
    <section class="section">
      <h4>Selected</h4>
      <div id="selected" class="list">
${selectedCards}
      </div>
    </section>
    <section class="section">
      <h4>Browse</h4>
      <div class="providers">${providers}</div>
      <div id="browse" class="list">
${browseCards}
      </div>
    </section>
    <div class="add-provider">
      <input type="text" id="provider-ref" placeholder="registry/namespace">
      <button type="button" id="add-provider">Add provider</button>
    </div>
  </div>
  <div class="footer">
    <span id="count"></span>
    <button id="generate">Generate</button>
  </div>`
  );
}

export function loadingHtml(assets: WebviewAssets): string {
  return page(assets, "notice-page", `  <p>Reading the feature catalog…</p>`);
}

/** Reports why the catalog is unavailable and offers a retry. */
export function errorHtml(assets: WebviewAssets, message: string): string {
  return page(
    assets,
    "notice-page",
    /* html */ `  <h3>No catalog</h3>
  <p>${escapeHtml(message)}</p>
  <button id="retry">Try again</button>`
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
