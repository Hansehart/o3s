import * as assert from "assert";
import * as fs from "fs";
import {
  DEVCONTAINER_FILE,
  devcontainerPath,
  isProjectRoot,
  loadCurrentSelection,
  readJsonc,
  writeSelection,
} from "../../devcontainerFile";
import { buildCatalog } from "../../catalog";
import {
  CATALOG,
  CLAUDE,
  GITHUB,
  OURS,
  PUBLISHED,
  removeCheckout,
  tempCheckout,
} from "./fixtures";

const UNKNOWN = "ghcr.io/devcontainers/features/never-in-the-catalog";

/** A checkout's own file, carrying everything the sidebar must not disturb. */
const TRACKED = `// NAME
//        devcontainer.json - the o3s dev container (the "cage")
//
// SEE ALSO
//        compose.yaml
{
    // Name for the dev container
    "name": "o3s",
    "initializeCommand": "bash .devcontainer/lifecycle/initialize.sh",
    "features": {
        // Parked until someone needs it.
        // "ghcr.io/devcontainers/features/rust:1": {}
    },
    "customizations": {
        "vscode": {
            "settings": {
                "remote.autoForwardPorts": false
            }
        }
    }
}
`;

interface Devcontainer {
  name?: string;
  initializeCommand?: string;
  customizations?: unknown;
  features?: Record<string, Record<string, unknown>>;
}

suite("devcontainerFile: writeSelection", () => {
  let root: string;

  const write = (contents: string): void =>
    fs.writeFileSync(devcontainerPath(root), contents, "utf8");

  const text = (): string => fs.readFileSync(devcontainerPath(root), "utf8");

  const read = (): Devcontainer => readJsonc<Devcontainer>(devcontainerPath(root));

  setup(() => {
    root = tempCheckout({ [DEVCONTAINER_FILE]: TRACKED });
  });

  teardown(() => removeCheckout(root));

  test("writes the selection at the ref pinned to the published major", () => {
    writeSelection(root, CATALOG, [{ base: GITHUB, values: {} }]);
    assert.deepStrictEqual(Object.keys(read().features ?? {}), [`${GITHUB}:1`]);
  });

  test("a value equal to the published default is left out", () => {
    writeSelection(root, CATALOG, [{ base: GITHUB, values: { version: "latest" } }]);
    assert.deepStrictEqual(read().features?.[`${GITHUB}:1`], {});
  });

  test("a value the user changed is written", () => {
    writeSelection(root, CATALOG, [{ base: GITHUB, values: { version: "2.0" } }]);
    assert.deepStrictEqual(read().features?.[`${GITHUB}:1`], { version: "2.0" });
  });

  test("an option the feature does not publish never reaches the file", () => {
    writeSelection(root, CATALOG, [{ base: GITHUB, values: { version: "2.0", bogus: "x" } }]);
    assert.deepStrictEqual(read().features?.[`${GITHUB}:1`], { version: "2.0" });
  });

  test("a base absent from the catalog is ignored", () => {
    writeSelection(root, CATALOG, [
      { base: GITHUB, values: {} },
      { base: UNKNOWN, values: {} },
    ]);
    assert.deepStrictEqual(Object.keys(read().features ?? {}), [`${GITHUB}:1`]);
  });

  test("keeps the file's man-page header", () => {
    writeSelection(root, CATALOG, [{ base: GITHUB, values: {} }]);
    assert.ok(text().startsWith("// NAME"), "the header is the file's, not the sidebar's");
    assert.ok(text().includes("// SEE ALSO"), "and all of it survives");
  });

  test("keeps the keys the sidebar does not manage", () => {
    writeSelection(root, CATALOG, [{ base: GITHUB, values: {} }]);
    const written = read();
    assert.strictEqual(written.name, "o3s");
    assert.strictEqual(written.initializeCommand, "bash .devcontainer/lifecycle/initialize.sh");
    assert.ok(written.customizations, "a key it never reads is a key it never touches");
    assert.ok(text().includes("// Name for the dev container"), "including their comments");
  });

  test("keeps a commented-out feature it did not touch", () => {
    writeSelection(root, CATALOG, [{ base: GITHUB, values: {} }]);
    assert.ok(
      text().includes(`// "ghcr.io/devcontainers/features/rust:1": {}`),
      "a parked entry is someone's note, not the sidebar's to discard"
    );
  });

  test("keeps a parked entry sitting beside one it rewrites", () => {
    // The shape a real checkout carries: a note about a feature, parked in the features
    // object beside the entries that are on. A write replaces an entry's whole value.
    write(`{
    "features": {
        "${GITHUB}:1": { "version": "2.0" }
        // "${UNKNOWN}:1": { "version": "1.0" }
    }
}
`);
    writeSelection(root, CATALOG, [{ base: GITHUB, values: { version: "latest" } }]);

    assert.ok(text().includes(`// "${UNKNOWN}:1"`), "the parked note is not the sidebar's to drop");
    assert.deepStrictEqual(read().features?.[`${GITHUB}:1`], {}, "and the entry beside it is rewritten");
  });

  test("removes a feature that was switched off", () => {
    writeSelection(root, CATALOG, [{ base: GITHUB, values: {} }]);
    writeSelection(root, CATALOG, []);
    assert.deepStrictEqual(Object.keys(read().features ?? {}), []);
  });

  test("creates the features object when the file carries none", () => {
    write(`{ "name": "o3s" }\n`);
    writeSelection(root, CATALOG, [{ base: GITHUB, values: {} }]);
    assert.deepStrictEqual(Object.keys(read().features ?? {}), [`${GITHUB}:1`]);
  });

  test("a feature whose collection could not be read is left in place, not dropped", () => {
    write(`{ "features": { "${UNKNOWN}:1": { "version": "2.0" } } }\n`);
    writeSelection(root, CATALOG, [{ base: GITHUB, values: {} }]);

    const written = read().features ?? {};
    assert.deepStrictEqual(
      written[`${UNKNOWN}:1`],
      { version: "2.0" },
      "a registry that was down must not silently delete what it publishes"
    );
    assert.ok(`${GITHUB}:1` in written, "and the selection still lands");
  });

  test("moves a feature pinned at an older major onto the published one", () => {
    write(`{ "features": { "${CLAUDE}:1": {} } }\n`);
    const bumped = buildCatalog(
      [OURS],
      new Map([[OURS, PUBLISHED[OURS].map((f) => ({ ...f, version: "2.0.0" }))]])
    );
    writeSelection(root, bumped, [{ base: CLAUDE, values: {} }]);
    assert.deepStrictEqual(Object.keys(read().features ?? {}), [`${CLAUDE}:2`]);
  });

  test("a value set back to the published default does not come back on the next read", () => {
    // The seed the sidebar renders and the value the file omits are the same thing, so a
    // deliberate choice reads back as itself.
    writeSelection(root, CATALOG, [{ base: CLAUDE, values: { stateDir: "" } }]);
    const [selection] = loadCurrentSelection(root, CATALOG);
    const entry = CATALOG.find((candidate) => candidate.base === CLAUDE);

    assert.strictEqual(
      { ...entry?.defaults, ...selection.values }.stateDir,
      "",
      "what the card would render must be what the user chose"
    );
  });
});

suite("devcontainerFile: isProjectRoot", () => {
  let candidate: string;

  teardown(() => removeCheckout(candidate));

  test("a checkout carrying a devcontainer.json is one", () => {
    candidate = tempCheckout({ [DEVCONTAINER_FILE]: "{}" });
    assert.strictEqual(isProjectRoot(candidate), true);
  });

  test("a folder without one is not", () => {
    candidate = tempCheckout();
    assert.strictEqual(isProjectRoot(candidate), false);
  });

  test("the file the sidebar edits decides it, not a marker beside it", () => {
    candidate = tempCheckout({ "templates/features.json": "{}" });
    assert.strictEqual(
      isProjectRoot(candidate),
      false,
      "a marker without the file would offer a sidebar with nothing to edit"
    );
  });
});

suite("devcontainerFile: loadCurrentSelection", () => {
  let root: string;

  const write = (contents: string): void =>
    fs.writeFileSync(devcontainerPath(root), contents, "utf8");

  setup(() => {
    root = tempCheckout({ [DEVCONTAINER_FILE]: TRACKED });
  });

  teardown(() => removeCheckout(root));

  test("is empty when the file holds no features", () => {
    assert.deepStrictEqual(loadCurrentSelection(root, CATALOG), []);
  });

  test("is empty when no devcontainer.json exists", () => {
    const bare = tempCheckout();
    try {
      assert.deepStrictEqual(loadCurrentSelection(bare, CATALOG), []);
    } finally {
      removeCheckout(bare);
    }
  });

  test("reads the selection and its values through the comments", () => {
    write(`// a leading comment
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
      [OURS],
      new Map([[OURS, PUBLISHED[OURS].map((f) => ({ ...f, version: "2.0.0" }))]])
    );
    write(`{ "features": { "${CLAUDE}:1": {} } }`);
    assert.deepStrictEqual(loadCurrentSelection(root, bumped), [{ base: CLAUDE, values: {} }]);
  });

  test("a renamed feature is matched through its legacy id, not dropped", () => {
    const renamed = buildCatalog(
      [OURS],
      new Map([[OURS, [{ ...PUBLISHED[OURS][0], id: "claude", legacyIds: ["claude-code"] }]]])
    );
    write(`{ "features": { "${CLAUDE}:1": { "version": "stable" } } }`);
    assert.deepStrictEqual(loadCurrentSelection(root, renamed), [
      { base: `${OURS}/claude`, values: { version: "stable" } },
    ]);
  });

  test("drops features absent from the catalog", () => {
    write(`{ "features": { "${CLAUDE}:1": {}, "${UNKNOWN}:1": {} } }`);
    assert.deepStrictEqual(
      loadCurrentSelection(root, CATALOG).map((s) => s.base),
      [CLAUDE]
    );
  });
});
