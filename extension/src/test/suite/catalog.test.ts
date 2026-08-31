import * as assert from "assert";
import { PublishedFeature } from "../../registry";
import { buildCatalog } from "../../catalog";
import { OURS, THEIRS } from "./fixtures";

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
  test("pins the tag to the published major, so the file never states a version", () => {
    const [entry] = buildCatalog([OURS], fetched({ [OURS]: [dind] }));
    assert.strictEqual(entry.ref, `${OURS}/docker-in-docker:2`);
    assert.strictEqual(entry.base, `${OURS}/docker-in-docker`);
    assert.strictEqual(entry.version, "2.0.0");
  });

  test("takes the label and description from the published name and description", () => {
    const [entry] = buildCatalog([OURS], fetched({ [OURS]: [node()] }));
    assert.strictEqual(entry.label, "Node.js");
    assert.strictEqual(entry.description, "Installs Node.js.");
  });

  test("the published defaults are the only seed an entry carries", () => {
    const [entry] = buildCatalog([OURS], fetched({ [OURS]: [node()] }));
    assert.deepStrictEqual(entry.defaults, { version: "lts", stateDir: "" });
  });

  test("an option published without a default contributes no seed", () => {
    const [entry] = buildCatalog(
      [OURS],
      fetched({ [OURS]: [node({ options: { version: { type: "string" } } })] })
    );
    assert.deepStrictEqual(entry.defaults, {});
    assert.ok("version" in entry.options, "but the control is still rendered for it");
  });

  test("the same id in two collections stays two entries", () => {
    const catalog = buildCatalog(
      [OURS, THEIRS],
      fetched({ [OURS]: [node()], [THEIRS]: [node({ version: "2.1.0", name: "Node.js (via nvm)" })] })
    );
    assert.deepStrictEqual(
      catalog.map((e) => e.ref),
      [`${OURS}/node:1`, `${THEIRS}/node:2`]
    );
  });

  test("what a feature does to the container's isolation is carried onto the card", () => {
    const [entry] = buildCatalog(
      [THEIRS],
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
    const [entry] = buildCatalog([OURS], fetched({ [OURS]: [node()] }));
    assert.deepStrictEqual(entry.security, []);
  });

  test("the VS Code extensions a feature installs come along", () => {
    const [entry] = buildCatalog(
      [OURS],
      fetched({ [OURS]: [node({ customizations: { vscode: { extensions: ["a.b", "c.d"] } } })] })
    );
    assert.deepStrictEqual(entry.extensions, ["a.b", "c.d"]);
  });

  test("a deprecated feature sorts last rather than disappearing", () => {
    const catalog = buildCatalog([OURS], fetched({ [OURS]: [node({ deprecated: true }), dind] }));
    assert.deepStrictEqual(
      catalog.map((e) => e.base),
      [`${OURS}/docker-in-docker`, `${OURS}/node`]
    );
    assert.strictEqual(catalog[1].deprecated, true);
  });

  test("a collection that could not be fetched drops out without taking the others", () => {
    const catalog = buildCatalog([OURS, THEIRS], fetched({ [OURS]: [node()] }));
    assert.deepStrictEqual(
      catalog.map((e) => e.collection),
      [OURS]
    );
  });

  test("a feature published without a readable version is skipped, not guessed at", () => {
    const warnings: string[] = [];
    const catalog = buildCatalog(
      [OURS],
      fetched({ [OURS]: [node({ version: "latest" as string })] }),
      (message) => warnings.push(message)
    );
    assert.deepStrictEqual(catalog, []);
    assert.strictEqual(warnings.length, 1);
  });
});
