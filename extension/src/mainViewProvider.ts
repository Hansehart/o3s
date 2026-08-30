import * as vscode from "vscode";
import { asError } from "./log";
import { WebviewAssets, featuresHtml, openProjectHtml } from "./webviewHtml";
import {
  generateDevcontainer,
  loadCatalog,
  loadCurrentSelection,
  projectRoot,
} from "./devcontainerGenerator";

type WebviewMessage = { type: "generate"; selected: string[] } | { type: "clone" };

export class MainViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: vscode.LogOutputChannel
  ) {}

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
    if (root) {
      this.log.info(`o3s checkout: ${root}`);
      const catalog = loadCatalog(root);
      const selected = new Set(loadCurrentSelection(root, catalog));
      webviewView.webview.html = featuresHtml(assets, catalog, selected);
    } else {
      this.log.info("no .o3s marker in any workspace folder, showing the clone page");
      webviewView.webview.html = openProjectHtml(assets);
    }

    const listener = webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (message.type === "clone") {
        try {
          await vscode.commands.executeCommand("o3s.cloneAndSetup");
        } catch (error) {
          // o3s.cloneAndSetup handles clone failures itself and resolves, so only a
          // failed dispatch reaches here - the case that is otherwise silent.
          this.log.error(asError(error));
          vscode.window.showErrorMessage(`o3s: could not start the clone - ${error}`);
        }
        return;
      }
      if (!root) {
        return;
      }
      try {
        // Read the catalog at write time, so an edit made while the panel is open applies.
        generateDevcontainer(root, loadCatalog(root), message.selected);
        vscode.window.showInformationMessage(
          "devcontainer.json generated. Press Ctrl/Cmd+Shift+P and run \"Rebuild and Reopen in Container\" to apply it.",
          { modal: true }
        );
      } catch (error) {
        this.log.error(asError(error));
        vscode.window.showErrorMessage(`o3s: could not write devcontainer.json - ${error}`);
      }
    });
    webviewView.onDidDispose(() => listener.dispose());
  }
}
