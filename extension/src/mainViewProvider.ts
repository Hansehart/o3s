import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { asError } from "./log";
import {
  WebviewAssets,
  errorHtml,
  featuresHtml,
  loadingHtml,
  openProjectHtml,
} from "./webviewHtml";
import { Catalog, Sources, addCollection, buildCatalog, loadSources } from "./catalog";
import { PublishedFeature, fetchCollection, parseCollectionRef } from "./registry";
import { Selected, generateDevcontainer, loadCurrentSelection, projectRoot } from "./devcontainerGenerator";

type WebviewMessage =
  | { type: "generate"; selected: Selected[] }
  | { type: "addProvider"; ref: string }
  | { type: "refresh" }
  | { type: "clone" };

export class MainViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private root?: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel
  ) {}

  private assets(webview: vscode.Webview): WebviewAssets {
    const mediaUri = (name: string): string =>
      webview
        .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", name))
        .toString();
    return {
      cspSource: webview.cspSource,
      styleUri: mediaUri("main.css"),
      scriptUri: mediaUri("main.js"),
      logoUri: mediaUri("icon.png"),
    };
  }

  /** One file per collection, so each falls back on its own copy. */
  private cacheFile(collection: string): string {
    const slug = collection.replace(/[^a-z0-9]+/gi, "_");
    return path.join(this.context.globalStorageUri.fsPath, `${slug}.json`);
  }

  private readCache(collection: string): PublishedFeature[] | undefined {
    try {
      return JSON.parse(fs.readFileSync(this.cacheFile(collection), "utf8"));
    } catch {
      return undefined;
    }
  }

  private writeCache(collection: string, features: PublishedFeature[]): void {
    try {
      fs.mkdirSync(this.context.globalStorageUri.fsPath, { recursive: true });
      fs.writeFileSync(this.cacheFile(collection), JSON.stringify(features), "utf8");
    } catch (error) {
      this.log.warn(`could not cache ${collection}: ${asError(error).message}`);
    }
  }

  /** Reads every collection the sources name, preferring the registry over the cached copy. */
  private async collect(sources: Sources): Promise<Map<string, PublishedFeature[]>> {
    const fetched = new Map<string, PublishedFeature[]>();
    // Each collection on its own, so the sidebar stands on whichever ones resolve.
    for (const collection of sources.collections) {
      try {
        const features = await fetchCollection(collection);
        this.writeCache(collection, features);
        fetched.set(collection, features);
      } catch (error) {
        const cached = this.readCache(collection);
        this.log.warn(
          `${collection}: ${asError(error).message}${cached ? " - using the cached copy" : ""}`
        );
        if (cached) {
          fetched.set(collection, cached);
        }
      }
    }
    return fetched;
  }

  private async render(): Promise<void> {
    const view = this.view;
    const root = this.root;
    if (!view || !root) {
      return;
    }
    const assets = this.assets(view.webview);

    try {
      const sources = loadSources(root);
      const fetched = await this.collect(sources);
      if (fetched.size === 0) {
        throw new Error(
          sources.collections.length
            ? "No collection could be read, and nothing was cached."
            : "No collections are configured in .devcontainer/templates/features.json."
        );
      }

      const catalog: Catalog = buildCatalog(sources, fetched, (message) => this.log.warn(message));
      const selection = loadCurrentSelection(root, catalog);
      view.webview.html = featuresHtml(assets, {
        catalog,
        collections: sources.collections.filter((c) => fetched.has(c)),
        selected: new Map(selection.map((s) => [s.base, s.values])),
      });
    } catch (error) {
      this.log.error(asError(error));
      view.webview.html = errorHtml(assets, asError(error).message);
    }
  }

  /** Re-reads the catalog, which is what the view's refresh command asks for. */
  async refresh(): Promise<void> {
    if (this.view && this.root) {
      this.view.webview.html = loadingHtml(this.assets(this.view.webview));
      await this.render();
    }
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    const root = this.root;

    if (message.type === "clone") {
      try {
        await vscode.commands.executeCommand("o3s.cloneAndSetup");
      } catch (error) {
        // o3s.cloneAndSetup reports its own failures, so this covers a failed dispatch.
        this.log.error(asError(error));
        vscode.window.showErrorMessage(`o3s: could not start the clone - ${error}`);
      }
      return;
    }

    if (!root) {
      return;
    }

    if (message.type === "refresh") {
      await this.refresh();
      return;
    }

    if (message.type === "addProvider") {
      try {
        // Fetched first, so only a ref that resolves reaches the tracked file.
        const { resource } = parseCollectionRef(message.ref);
        await fetchCollection(resource);
        addCollection(root, resource);
        await this.refresh();
      } catch (error) {
        this.log.error(asError(error));
        vscode.window.showErrorMessage(`o3s: could not add ${message.ref} - ${error}`);
      }
      return;
    }

    try {
      // Rebuilt at write time, so an edit made while the panel is open applies.
      const sources = loadSources(root);
      const catalog = buildCatalog(sources, await this.collect(sources));
      generateDevcontainer(root, catalog, message.selected);
      vscode.window.showInformationMessage(
        "devcontainer.json generated. Press Ctrl/Cmd+Shift+P and run \"Rebuild and Reopen in Container\" to apply it.",
        { modal: true }
      );
    } catch (error) {
      this.log.error(asError(error));
      vscode.window.showErrorMessage(`o3s: could not write devcontainer.json - ${error}`);
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    this.view = webviewView;
    this.root = projectRoot();

    const listener = webviewView.webview.onDidReceiveMessage((message: WebviewMessage) =>
      this.onMessage(message)
    );
    webviewView.onDidDispose(() => {
      listener.dispose();
      this.view = undefined;
    });

    if (!this.root) {
      this.log.info("no .o3s marker in any workspace folder, showing the clone page");
      webviewView.webview.html = openProjectHtml(this.assets(webviewView.webview));
      return;
    }

    this.log.info(`o3s checkout: ${this.root}`);
    webviewView.webview.html = loadingHtml(this.assets(webviewView.webview));
    void this.render();
  }
}
