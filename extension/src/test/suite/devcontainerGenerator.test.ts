import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  devcontainerPath,
  generateDevcontainer,
  loadCurrentSelection,
  templatePath,
} from "../../devcontainerGenerator";
import { buildCatalog } from "../../catalog";
import { CATALOG, CLAUDE, GITHUB, OURS, OVERRIDES, PUBLISHED, entryFor } from "./fixtures";

const UNKNOWN = "ghcr.io/devcontainers/features/never-in-the-catalog";

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
  features?: Record<string, Record<string, unknown>>;
}

suite("devcontainerGenerator", () => {
  let root: string;

  const writeDevcontainer = (contents: string): void =>
    fs.writeFileSync(devcontainerPath(root), contents, "utf8");

  const readDevcontainer = (): Devcontainer =>
    JSON.parse(fs.readFileSync(devcontainerPath(root), "utf8"));

  setup(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "o3s-test-"));
    fs.mkdirSync(path.dirname(templatePath(root, "devcontainer.json")), { recursive: true });
    fs.writeFileSync(templatePath(root, "devcontainer.json"), SKELETON, "utf8");
  });

  teardown(() => fs.rmSync(root, { recursive: true, force: true }));

  test("writes the selection onto the skeleton, tagged with the published major", () => {
    generateDevcontainer(root, CATALOG, [{ base: GITHUB, values: entryFor(GITHUB).values }]);
    const written = readDevcontainer();
    assert.strictEqual(written.name, "o3s");
    assert.strictEqual(written.service, "cage");
    assert.deepStrictEqual(Object.keys(written.features ?? {}), [`${GITHUB}:1`]);
  });

  test("a value equal to the published default is left out", () => {
    generateDevcontainer(root, CATALOG, [{ base: GITHUB, values: { version: "latest" } }]);
    assert.deepStrictEqual(readDevcontainer().features?.[`${GITHUB}:1`], {});
  });

  test("a value the user changed is written", () => {
    generateDevcontainer(root, CATALOG, [{ base: GITHUB, values: { version: "2.0" } }]);
    assert.deepStrictEqual(readDevcontainer().features?.[`${GITHUB}:1`], { version: "2.0" });
  });

  test("the o3s overrides survive, because they differ from the feature's defaults", () => {
    generateDevcontainer(root, CATALOG, [{ base: CLAUDE, values: entryFor(CLAUDE).values }]);
    assert.deepStrictEqual(readDevcontainer().features?.[`${CLAUDE}:1`], {
      stateDir: "/home/ubuntu/features/claude",
      disableNonessentialTraffic: true,
    });
  });

  test("an option the feature does not publish never reaches the file", () => {
    generateDevcontainer(root, CATALOG, [{ base: GITHUB, values: { version: "2.0", bogus: "x" } }]);
    assert.deepStrictEqual(readDevcontainer().features?.[`${GITHUB}:1`], { version: "2.0" });
  });

  test("a base absent from the catalog is ignored", () => {
    generateDevcontainer(root, CATALOG, [
      { base: GITHUB, values: {} },
      { base: UNKNOWN, values: {} },
    ]);
    assert.deepStrictEqual(Object.keys(readDevcontainer().features ?? {}), [`${GITHUB}:1`]);
  });

  test("replaces an existing file and drops its comments", () => {
    writeDevcontainer(SKELETON);
    generateDevcontainer(root, CATALOG, [{ base: CLAUDE, values: {} }]);
    const contents = fs.readFileSync(devcontainerPath(root), "utf8");
    assert.ok(!contents.includes("//"), "comments do not survive a round trip");
    assert.deepStrictEqual(Object.keys(readDevcontainer().features ?? {}), [`${CLAUDE}:1`]);
  });

  suite("loadCurrentSelection", () => {
    test("is empty when no devcontainer.json exists", () => {
      assert.deepStrictEqual(loadCurrentSelection(root, CATALOG), []);
    });

    test("reads the selection and its values through the comments", () => {
      writeDevcontainer(`// a leading comment
{
    // and an inline one
    "features": { "${CLAUDE}:1": { "stateDir": "/elsewhere" } }
}
`);
      assert.deepStrictEqual(loadCurrentSelection(root, CATALOG), [
        { base: CLAUDE, values: { stateDir: "/elsewhere" } },
      ]);
    });

    test("a feature written at an older major is still recognised", () => {
      const bumped = buildCatalog(
        { collections: [OURS], overrides: OVERRIDES },
        new Map([[OURS, PUBLISHED[OURS].map((f) => ({ ...f, version: "2.0.0" }))]])
      );
      writeDevcontainer(`{ "features": { "${CLAUDE}:1": {} } }`);
      assert.deepStrictEqual(loadCurrentSelection(root, bumped), [{ base: CLAUDE, values: {} }]);
    });

    test("a renamed feature is matched through its legacy id, not dropped", () => {
      const renamed = buildCatalog(
        { collections: [OURS], overrides: {} },
        new Map([[OURS, [{ ...PUBLISHED[OURS][0], id: "claude", legacyIds: ["claude-code"] }]]])
      );
      writeDevcontainer(`{ "features": { "${CLAUDE}:1": { "version": "stable" } } }`);
      assert.deepStrictEqual(loadCurrentSelection(root, renamed), [
        { base: `${OURS}/claude`, values: { version: "stable" } },
      ]);
    });

    test("drops features absent from the catalog", () => {
      writeDevcontainer(`{ "features": { "${CLAUDE}:1": {}, "${UNKNOWN}:1": {} } }`);
      assert.deepStrictEqual(
        loadCurrentSelection(root, CATALOG).map((s) => s.base),
        [CLAUDE]
      );
    });
  });
});
