import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { MainViewProvider } from "../../mainViewProvider";
import { SOURCES_FILE, templatePath } from "../../devcontainerGenerator";
import { loadSources } from "../../catalog";
import { removeCheckout, tempCheckout } from "./fixtures";
import { FakeRegistry, startRegistry } from "./fakeRegistry";

/** The two namespaces the fake registry publishes; anything else 404s. */
const SEEDED = "acme/one";
const ADDED = "acme/two";
/** Served by nothing, so it stands in for a ref that does not resolve. */
const MISSING = "acme/missing";

interface FakeView {
  view: vscode.WebviewView;
  /** Hands a message to the provider the way the webview would, and awaits the handling. */
  send: (message: unknown) => Promise<void>;
  html: () => string;
}

/**
 * The parts of a WebviewView the provider actually touches. The message handler is
 * captured rather than delivered through a real webview, so a test drives `onMessage`
 * directly instead of round-tripping through a DOM.
 */
function fakeView(): FakeView {
  let handler: ((message: unknown) => Promise<void>) | undefined;
  let html = "";

  const webview = {
    options: {},
    cspSource: "vscode-webview:",
    asWebviewUri: (uri: vscode.Uri) => uri,
    onDidReceiveMessage: (listener: (message: unknown) => Promise<void>) => {
      handler = listener;
      return { dispose: () => undefined };
    },
    get html(): string {
      return html;
    },
    set html(value: string) {
      html = value;
    },
  };

  const view = {
    webview,
    onDidDispose: () => ({ dispose: () => undefined }),
  } as unknown as vscode.WebviewView;

  return {
    view,
    send: (message) => handler?.(message) ?? Promise.resolve(),
    html: () => html,
  };
}

/** `resolveWebviewView` renders in the background, so a test waits for it to land. */
async function settle(view: FakeView): Promise<void> {
  for (let tick = 0; tick < 300; tick++) {
    if (view.html() !== "" && !view.html().includes("Reading the feature catalog")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`the view never rendered; last html: ${view.html().slice(0, 200)}`);
}

suite("mainViewProvider: adding a provider", () => {
  let registry: FakeRegistry;
  let root: string;
  let storage: string;
  let log: vscode.LogOutputChannel;
  let warnings: string[];
  const realShowWarning = vscode.window.showWarningMessage;

  const sourcesFile = (): string => templatePath(root, SOURCES_FILE);
  const read = (): string => fs.readFileSync(sourcesFile(), "utf8");
  const ref = (namespace: string): string => `${registry.origin}/${namespace}`;

  /** Counts what a fetch of `namespace` costs, which is one manifest read per walk. */
  const manifests = (namespace: string): number =>
    registry.requests.filter((p) => p === `/v2/${namespace}/manifests/latest`).length;

  const start = async (): Promise<FakeView> => {
    const context = {
      extensionUri: vscode.Uri.file(path.resolve(__dirname, "..", "..", "..")),
      globalStorageUri: vscode.Uri.file(storage),
    } as unknown as vscode.ExtensionContext;

    const view = fakeView();
    new MainViewProvider(context, log, () => root).resolveWebviewView(view.view);
    await settle(view);
    // Only what the message under test causes is counted.
    registry.requests.length = 0;
    return view;
  };

  setup(async () => {
    // Anonymous, so one walk of the registry is exactly one manifest request.
    registry = await startRegistry({ namespaces: [SEEDED, ADDED], anonymous: true });
    storage = tempCheckout();
    root = tempCheckout({
      [SOURCES_FILE]: `{ "collections": ["${ref(SEEDED)}"], "overrides": {} }`,
    });
    log = vscode.window.createOutputChannel("o3s-test", { log: true });

    warnings = [];
    vscode.window.showWarningMessage = ((message: string) => {
      warnings.push(message);
      return Promise.resolve(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
  });

  teardown(async () => {
    vscode.window.showWarningMessage = realShowWarning;
    log.dispose();
    await registry.close();
    removeCheckout(root);
    removeCheckout(storage);
  });

  test("a provider that resolves is read once, not once to check and again to show", async () => {
    const view = await start();
    await view.send({ type: "addProvider", ref: ref(ADDED) });

    assert.deepStrictEqual(loadSources(root).collections, [ref(SEEDED), ref(ADDED)]);
    assert.strictEqual(
      manifests(ADDED),
      1,
      "checking the ref before writing it would walk the registry twice"
    );
    assert.deepStrictEqual(warnings, [], "a provider that resolves says nothing");
  });

  test("the added provider is shown as a tab of its own", async () => {
    const view = await start();
    await view.send({ type: "addProvider", ref: ref(ADDED) });

    assert.ok(
      view.html().includes(`data-provider="${ref(ADDED)}"`),
      "the new collection should have joined the browse tabs"
    );
  });

  test("a ref that does not resolve is still written, so it can be corrected in the file", async () => {
    const view = await start();
    await view.send({ type: "addProvider", ref: ref(MISSING) });

    assert.deepStrictEqual(loadSources(root).collections, [ref(SEEDED), ref(MISSING)]);
  });

  test("a ref that does not resolve says so, rather than failing silently", async () => {
    const view = await start();
    await view.send({ type: "addProvider", ref: ref(MISSING) });

    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], new RegExp(MISSING));
  });

  test("a ref that does not resolve gets no tab, and takes nothing else down", async () => {
    const view = await start();
    await view.send({ type: "addProvider", ref: ref(MISSING) });

    assert.ok(
      !view.html().includes(`data-provider="${ref(MISSING)}"`),
      "a collection that could not be read has nothing to browse"
    );
    assert.ok(
      view.html().includes(`data-provider="${ref(SEEDED)}"`),
      "the collections that did resolve still render"
    );
  });

  test("a ref that is not a collection is refused before anything is written", async () => {
    const view = await start();
    const before = read();

    await view.send({ type: "addProvider", ref: "ghcr.io" });

    assert.strictEqual(read(), before, "a ref with no namespace never reaches the file");
    assert.deepStrictEqual(warnings, [], "nothing was written, so this is an error, not a warning");
  });
});
