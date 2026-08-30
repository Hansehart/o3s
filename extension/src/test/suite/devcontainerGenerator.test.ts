import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  Catalog,
  devcontainerPath,
  generateDevcontainer,
  loadCatalog,
  loadCurrentSelection,
  templatePath,
} from "../../devcontainerGenerator";
import { CATALOG, CLAUDE, GITHUB } from "./fixtures";

const UNKNOWN = "ghcr.io/devcontainers/features/never-in-the-catalog:1";

const SKELETON = `// NAME
//        devcontainer.json - the o3s dev container
{
    "name": "o3s",
    "service": "cage"
}
`;

interface Devcontainer {
  name?: string;
  service?: string;
  features?: Record<string, unknown>;
}

suite("devcontainerGenerator", () => {
  let root: string;

  const writeDevcontainer = (contents: string): void =>
    fs.writeFileSync(devcontainerPath(root), contents, "utf8");

  const readDevcontainer = (): Devcontainer =>
    JSON.parse(fs.readFileSync(devcontainerPath(root), "utf8"));

  setup(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "o3s-test-"));
    fs.mkdirSync(path.dirname(templatePath(root, "features.json")), { recursive: true });
    fs.writeFileSync(templatePath(root, "features.json"), JSON.stringify(CATALOG), "utf8");
    fs.writeFileSync(templatePath(root, "devcontainer.json"), SKELETON, "utf8");
  });

  teardown(() => fs.rmSync(root, { recursive: true, force: true }));

  test("loadCatalog reads the feature catalog", () => {
    const catalog: Catalog = loadCatalog(root);
    assert.deepStrictEqual(Object.keys(catalog), [CLAUDE, GITHUB]);
    assert.strictEqual(catalog[GITHUB].label, "GitHub CLI");
  });

  test("loadCurrentSelection is empty when no devcontainer.json exists", () => {
    assert.deepStrictEqual(loadCurrentSelection(root, CATALOG), []);
  });

  test("loadCurrentSelection reads features through the comments", () => {
    writeDevcontainer(`// a leading comment
{
    // and an inline one
    "features": { "${CLAUDE}": {} }
}
`);
    assert.deepStrictEqual(loadCurrentSelection(root, CATALOG), [CLAUDE]);
  });

  test("loadCurrentSelection drops features absent from the catalog", () => {
    writeDevcontainer(`{ "features": { "${CLAUDE}": {}, "${UNKNOWN}": {} } }`);
    assert.deepStrictEqual(loadCurrentSelection(root, CATALOG), [CLAUDE]);
  });

  test("generateDevcontainer writes the selection onto the skeleton", () => {
    generateDevcontainer(root, CATALOG, [GITHUB]);
    const written: Devcontainer = readDevcontainer();
    assert.strictEqual(written.name, "o3s");
    assert.strictEqual(written.service, "cage");
    assert.deepStrictEqual(written.features, { [GITHUB]: { version: "latest" } });
  });

  test("generateDevcontainer ignores ids absent from the catalog", () => {
    generateDevcontainer(root, CATALOG, [GITHUB, UNKNOWN]);
    assert.deepStrictEqual(Object.keys(readDevcontainer().features ?? {}), [GITHUB]);
  });

  test("generateDevcontainer replaces an existing file and drops its comments", () => {
    writeDevcontainer(SKELETON);
    generateDevcontainer(root, CATALOG, [CLAUDE]);
    const contents = fs.readFileSync(devcontainerPath(root), "utf8");
    assert.ok(!contents.includes("//"), "comments do not survive a round trip");
    assert.deepStrictEqual(Object.keys(readDevcontainer().features ?? {}), [CLAUDE]);
  });
});
