import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { asError, report } from "./log";
import { cloneRepository } from "./clone";
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
  /** What the last read of the registry returned, so writing does not repeat it. */
  private fetched = new Map<string, PublishedFeature[]>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
    /** How the checkout is found, which a test outside a workspace supplies for itself. */
    private readonly findRoot: () => string | undefined = projectRoot
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

  /** What a collection publishes: the registry when it answers, the cached copy when it does not. */
  private async read(collection: string): Promise<PublishedFeature[] | undefined> {
    try {
      const features = await fetchCollection(collection);
      this.writeCache(collection, features);
      return features;
    } catch (error) {
      const cached = this.readCache(collection);
      this.log.warn(
        `${collection}: ${asError(error).message}${cached ? " - using the cached copy" : ""}`
      );
      return cached;
    }
  }

  /**
   * Reads every collection the sources name, all at once - each is an independent walk of
   * manifest, token and blob, so the wait is the slowest of them rather than their sum.
   * Each collection is read on its own, so the sidebar stands on whichever ones resolve.
   */
  private async collect(sources: Sources): Promise<Map<string, PublishedFeature[]>> {
    const read = await Promise.all(
      sources.collections.map(async (collection) => [collection, await this.read(collection)] as const)
    );
    this.fetched = new Map(
      read.flatMap(([collection, features]) => (features ? [[collection, features] as const] : []))
    );
    return this.fetched;
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
      const failure = asError(error);
      this.log.error(failure);
      view.webview.html = errorHtml(assets, failure.message);
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
      await cloneRepository(this.log);
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
        // Written first, then read back along with every other collection, so adding a
        // provider costs one walk of the registry rather than two. A ref that does not
        // resolve is kept and reported rather than undone, leaving the tracked file the
        // one place a provider is added or removed.
        const { resource } = parseCollectionRef(message.ref);
        addCollection(root, resource);
        await this.refresh();

        if (!this.fetched.has(resource)) {
          vscode.window.showWarningMessage(
            `o3s: added ${resource}, but it could not be read - see the o3s log.`
          );
        }
      } catch (error) {
        report(this.log, `could not add ${message.ref}`, error);
      }
      return;
    }

    try {
      // Rebuilt at write time from what was last read, so an override edited while the panel
      // is open applies without walking every registry again. A collection added since that
      // read has no cards on screen, so there is nothing selected from it to write either.
      const sources = loadSources(root);
      const catalog = buildCatalog(sources, this.fetched, (warning) => this.log.warn(warning));
      generateDevcontainer(root, catalog, message.selected);
      vscode.window.showInformationMessage(
        "devcontainer.json generated. Press Ctrl/Cmd+Shift+P and run \"Rebuild and Reopen in Container\" to apply it.",
        { modal: true }
      );
    } catch (error) {
      report(this.log, "could not write devcontainer.json", error);
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    this.view = webviewView;
    this.root = this.findRoot();

    const listener = webviewView.webview.onDidReceiveMessage((message: WebviewMessage) =>
      this.onMessage(message)
    );
    webviewView.onDidDispose(() => {
      listener.dispose();
      this.view = undefined;
    });

    if (!this.root) {
      this.log.info("no o3s checkout in any workspace folder, showing the clone page");
      webviewView.webview.html = openProjectHtml(this.assets(webviewView.webview));
      return;
    }

    this.log.info(`o3s checkout: ${this.root}`);
    void this.refresh();
  }
}
