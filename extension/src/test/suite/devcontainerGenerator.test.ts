import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  Catalog,
  generateDevcontainer,
  loadCatalog,
  loadCurrentSelection,
} from "../../devcontainerGenerator";

const CLAUDE = "ghcr.io/hansehart/devcontainer-features/claude-code:1";
const GITHUB = "ghcr.io/devcontainers/features/github-cli:1";
const UNKNOWN = "ghcr.io/devcontainers/features/never-in-the-catalog:1";

const CATALOG: Catalog = {
  [CLAUDE]: {
    label: "Claude Code CLI",
    description: "Installs the Claude Code CLI on a selectable channel.",
    options: { version: "latest" },
  },
  [GITHUB]: {
    label: "GitHub CLI",
    description: "Installs the GitHub CLI (gh).",
    options: { version: "latest" },
  },
};

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
    fs.writeFileSync(path.join(root, ".devcontainer", "devcontainer.json"), contents, "utf8");

  const readDevcontainer = (): Devcontainer =>
    JSON.parse(fs.readFileSync(path.join(root, ".devcontainer", "devcontainer.json"), "utf8"));

  setup(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "o3s-test-"));
    const templates = path.join(root, ".devcontainer", "templates");
    fs.mkdirSync(templates, { recursive: true });
    fs.writeFileSync(path.join(templates, "features.json"), JSON.stringify(CATALOG), "utf8");
    fs.writeFileSync(path.join(templates, "devcontainer.json"), SKELETON, "utf8");
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
    generateDevcontainer(root, [GITHUB]);
    const written: Devcontainer = readDevcontainer();
    assert.strictEqual(written.name, "o3s");
    assert.strictEqual(written.service, "cage");
    assert.deepStrictEqual(written.features, { [GITHUB]: { version: "latest" } });
  });

  test("generateDevcontainer ignores ids absent from the catalog", () => {
    generateDevcontainer(root, [GITHUB, UNKNOWN]);
    assert.deepStrictEqual(Object.keys(readDevcontainer().features ?? {}), [GITHUB]);
  });

  test("generateDevcontainer replaces an existing file and drops its comments", () => {
    writeDevcontainer(SKELETON);
    generateDevcontainer(root, [CLAUDE]);
    const contents = fs.readFileSync(
      path.join(root, ".devcontainer", "devcontainer.json"),
      "utf8"
    );
    assert.ok(!contents.includes("//"), "comments do not survive a round trip");
    assert.deepStrictEqual(Object.keys(readDevcontainer().features ?? {}), [CLAUDE]);
  });
});
