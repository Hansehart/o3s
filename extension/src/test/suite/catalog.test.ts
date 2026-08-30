import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PublishedFeature } from "../../registry";
import { addCollection, buildCatalog, loadSources } from "../../catalog";
import { templatePath } from "../../devcontainerGenerator";

const OURS = "ghcr.io/hansehart/devcontainer-features";
const THEIRS = "ghcr.io/devcontainers/features";

const node = (over: Partial<PublishedFeature> = {}): PublishedFeature => ({
  id: "node",
  version: "1.0.1",
  name: "Node.js",
  description: "Installs Node.js.",
  options: {
    version: { type: "string", proposals: ["lts", "latest"], default: "lts" },
    stateDir: { type: "string", default: "" },
  },
  ...over,
});

const dind: PublishedFeature = {
  id: "docker-in-docker",
  version: "2.0.0",
  name: "Docker in Docker",
  description: "Installs a Docker engine.",
  options: { version: { type: "string", default: "latest" } },
};

const fetched = (entries: Record<string, PublishedFeature[]>) => new Map(Object.entries(entries));

suite("catalog: buildCatalog", () => {
  test("pins the tag to the published major, so the repo never states a version", () => {
    const [entry] = buildCatalog({ collections: [OURS], overrides: {} }, fetched({ [OURS]: [dind] }));
    assert.strictEqual(entry.ref, `${OURS}/docker-in-docker:2`);
    assert.strictEqual(entry.base, `${OURS}/docker-in-docker`);
    assert.strictEqual(entry.version, "2.0.0");
  });

  test("takes the label and description from the published name and description", () => {
    const [entry] = buildCatalog({ collections: [OURS], overrides: {} }, fetched({ [OURS]: [node()] }));
    assert.strictEqual(entry.label, "Node.js");
    assert.strictEqual(entry.description, "Installs Node.js.");
  });

  test("effective values are the published defaults under the o3s overrides", () => {
    const [entry] = buildCatalog(
      { collections: [OURS], overrides: { [`${OURS}/node`]: { stateDir: "/home/ubuntu/features/node" } } },
      fetched({ [OURS]: [node()] })
    );
    assert.deepStrictEqual(entry.defaults, { version: "lts", stateDir: "" });
    assert.deepStrictEqual(entry.values, { version: "lts", stateDir: "/home/ubuntu/features/node" });
    assert.deepStrictEqual(entry.overrides, { stateDir: "/home/ubuntu/features/node" });
  });

  test("the same id in two collections stays two entries, and an override picks one", () => {
    const catalog = buildCatalog(
      { collections: [OURS, THEIRS], overrides: { [`${OURS}/node`]: { stateDir: "/state" } } },
      fetched({ [OURS]: [node()], [THEIRS]: [node({ version: "2.1.0", name: "Node.js (via nvm)" })] })
    );
    assert.deepStrictEqual(
      catalog.map((e) => e.ref),
      [`${OURS}/node:1`, `${THEIRS}/node:2`]
    );
    assert.strictEqual(catalog[0].values.stateDir, "/state");
    assert.strictEqual(catalog[1].values.stateDir, "");
  });

  test("an override naming an option the feature dropped is reported, not written", () => {
    const warnings: string[] = [];
    const [entry] = buildCatalog(
      { collections: [OURS], overrides: { [`${OURS}/node`]: { gone: "x", stateDir: "/state" } } },
      fetched({ [OURS]: [node()] }),
      (message) => warnings.push(message)
    );
    assert.ok(!("gone" in entry.values), "a dead override does not reach devcontainer.json");
    assert.strictEqual(entry.values.stateDir, "/state");
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /gone/);
  });

  test("what a feature does to the container's isolation is carried onto the card", () => {
    const [entry] = buildCatalog(
      { collections: [THEIRS], overrides: {} },
      fetched({
        [THEIRS]: [
          {
            id: "rust",
            version: "1.0.0",
            name: "Rust",
            privileged: true,
            capAdd: ["SYS_PTRACE"],
            securityOpt: ["seccomp=unconfined"],
          },
        ],
      })
    );
    assert.deepStrictEqual(entry.security, [
      "runs privileged",
      "adds SYS_PTRACE",
      "sets seccomp=unconfined",
    ]);
  });

  test("a feature that changes nothing about isolation carries no notes", () => {
    const [entry] = buildCatalog({ collections: [OURS], overrides: {} }, fetched({ [OURS]: [node()] }));
    assert.deepStrictEqual(entry.security, []);
  });

  test("the VS Code extensions a feature installs come along", () => {
    const [entry] = buildCatalog(
      { collections: [OURS], overrides: {} },
      fetched({
        [OURS]: [node({ customizations: { vscode: { extensions: ["a.b", "c.d"] } } })],
      })
    );
    assert.deepStrictEqual(entry.extensions, ["a.b", "c.d"]);
  });

  test("a deprecated feature sorts last rather than disappearing", () => {
    const catalog = buildCatalog(
      { collections: [OURS], overrides: {} },
      fetched({ [OURS]: [node({ deprecated: true }), dind] })
    );
    assert.deepStrictEqual(
      catalog.map((e) => e.id),
      ["docker-in-docker", "node"]
    );
    assert.strictEqual(catalog[1].deprecated, true);
  });

  test("a collection that could not be fetched drops out without taking the others", () => {
    const catalog = buildCatalog(
      { collections: [OURS, THEIRS], overrides: {} },
      fetched({ [OURS]: [node()] })
    );
    assert.deepStrictEqual(
      catalog.map((e) => e.collection),
      [OURS]
    );
  });

  test("a feature published without a readable version is skipped, not guessed at", () => {
    const warnings: string[] = [];
    const catalog = buildCatalog(
      { collections: [OURS], overrides: {} },
      fetched({ [OURS]: [node({ version: "latest" as string })] }),
      (message) => warnings.push(message)
    );
    assert.deepStrictEqual(catalog, []);
    assert.strictEqual(warnings.length, 1);
  });
});

suite("catalog: sources file", () => {
  let root: string;

  setup(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "o3s-catalog-"));
    fs.mkdirSync(path.dirname(templatePath(root, "features.json")), { recursive: true });
  });

  teardown(() => fs.rmSync(root, { recursive: true, force: true }));

  const write = (contents: string) =>
    fs.writeFileSync(templatePath(root, "features.json"), contents, "utf8");

  const read = () => fs.readFileSync(templatePath(root, "features.json"), "utf8");

  test("reads the collections and the overrides", () => {
    write(`{
      "collections": ["${OURS}"],
      "overrides": { "${OURS}/node": { "stateDir": "/state" } }
    }`);
    const sources = loadSources(root);
    assert.deepStrictEqual(sources.collections, [OURS]);
    assert.deepStrictEqual(sources.overrides, { [`${OURS}/node`]: { stateDir: "/state" } });
  });

  test("a file missing either key still reads, rather than throwing at the sidebar", () => {
    write("{}");
    assert.deepStrictEqual(loadSources(root), { collections: [], overrides: {} });
  });

  test("adding a collection keeps the comments the tracked file carries", () => {
    write(`// NAME
//        features.json - the feature sources
{
    // Where the sidebar reads its catalog from
    "collections": [
        "${OURS}"
    ],
    "overrides": {}
}
`);
    addCollection(root, THEIRS);

    const contents = read();
    assert.ok(contents.includes("// NAME"), "the header survives the edit");
    assert.ok(contents.includes("// Where the sidebar reads"), "the inline comment survives");
    assert.deepStrictEqual(loadSources(root).collections, [OURS, THEIRS]);
  });

  test("adding a collection already listed changes nothing", () => {
    write(`{ "collections": ["${OURS}"], "overrides": {} }`);
    addCollection(root, OURS);
    assert.deepStrictEqual(loadSources(root).collections, [OURS]);
  });

  test("a ref that is not a collection is refused before it is written", () => {
    write(`{ "collections": [], "overrides": {} }`);
    assert.throws(() => addCollection(root, "ghcr.io"), /namespace/i);
    assert.deepStrictEqual(loadSources(root).collections, []);
  });
});
