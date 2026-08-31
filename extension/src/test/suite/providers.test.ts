import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import {
  PROVIDERS_SETTING,
  addProvider,
  allProviders,
  configuredProviders,
  providersInUse,
} from "../../providers";
import { DEVCONTAINER_FILE, devcontainerPath } from "../../devcontainerFile";
import { OURS, THEIRS, removeCheckout, tempCheckout } from "./fixtures";

const OTHER = "registry.example.com/team/features";

const setProviders = (value: string[] | undefined): Thenable<void> =>
  vscode.workspace
    .getConfiguration("o3s")
    .update(PROVIDERS_SETTING, value, vscode.ConfigurationTarget.Global);

suite("providers", () => {
  let root: string;

  const writeFeatures = (refs: Record<string, unknown>): void =>
    fs.writeFileSync(
      devcontainerPath(root),
      JSON.stringify({ name: "o3s", features: refs }, null, 4),
      "utf8"
    );

  setup(async () => {
    root = tempCheckout({ [DEVCONTAINER_FILE]: `{ "name": "o3s" }` });
    await setProviders([OURS]);
  });

  teardown(async () => {
    // Back to what package.json declares, so each test starts from the same setting.
    await setProviders(undefined);
    removeCheckout(root);
  });

  test("the configured providers are what the setting states", () => {
    assert.deepStrictEqual(configuredProviders(), [OURS]);
  });

  test("a provider is offered when devcontainer.json already references it", () => {
    writeFeatures({ [`${THEIRS}/github-cli:1`]: {} });
    assert.deepStrictEqual(providersInUse(root), [THEIRS]);
  });

  test("a checkout's providers are the configured ones and the ones it uses", () => {
    writeFeatures({ [`${THEIRS}/github-cli:1`]: {} });
    assert.deepStrictEqual(allProviders(root), [OURS, THEIRS]);
  });

  test("a provider both configured and in use is offered once", () => {
    writeFeatures({ [`${OURS}/claude-code:1`]: {} });
    assert.deepStrictEqual(allProviders(root), [OURS]);
  });

  test("a ref that names no collection is not mistaken for a provider", () => {
    writeFeatures({ "./local-feature": {}, "ghcr.io/lonely:1": {} });
    assert.deepStrictEqual(providersInUse(root), []);
  });

  test("adding a provider writes the setting", async () => {
    await addProvider(OTHER);
    assert.deepStrictEqual(configuredProviders(), [OURS, OTHER]);
  });

  test("adding a provider touches no file in the checkout", async () => {
    const before = fs.readFileSync(devcontainerPath(root), "utf8");
    await addProvider(OTHER);
    assert.strictEqual(
      fs.readFileSync(devcontainerPath(root), "utf8"),
      before,
      "a provider is the user's, not the repo's"
    );
  });

  test("adding a provider already configured changes nothing", async () => {
    await addProvider(OURS);
    assert.deepStrictEqual(configuredProviders(), [OURS]);
  });

  test("a ref that is not a collection is refused before the setting is touched", async () => {
    await assert.rejects(() => addProvider("ghcr.io"), /namespace/i);
    assert.deepStrictEqual(configuredProviders(), [OURS]);
  });
});
