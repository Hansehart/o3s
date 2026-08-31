import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { parse as parseJsonc } from "jsonc-parser";
import { stripVersion } from "./registry";
import type { Catalog, CatalogEntry, OptionValue } from "./catalog";

/** A feature the user has switched on, with the option values chosen for it. */
export interface Selected {
  base: string;
  values: Record<string, OptionValue>;
}

/** The generated file, and the templates it is built from - the layout, stated once. */
export const devcontainerPath = (root: string): string =>
  path.join(root, ".devcontainer", "devcontainer.json");

export const templatePath = (root: string, name: string): string =>
  path.join(root, ".devcontainer", "templates", name);

/** The template naming the collections to read, which is also what marks an o3s checkout. */
export const SOURCES_FILE = "features.json";

/** The template a generated devcontainer.json is written onto. */
export const SKELETON_FILE = "devcontainer.json";

/**
 * A checkout is one the sidebar can work in exactly when the sources file it reads is
 * there. Testing for that file rather than a marker beside it keeps one answer to the
 * question, so a checkout cannot both claim to be o3s and have nothing to offer.
 */
export const isProjectRoot = (folderPath: string): boolean =>
  fs.existsSync(templatePath(folderPath, SOURCES_FILE));

export function projectRoot(): string | undefined {
  return vscode.workspace.workspaceFolders
    ?.map((folder) => folder.uri.fsPath)
    .find(isProjectRoot);
}

/** Reads a JSONC file as `T`, throwing on a malformed one for the caller to report. */
export function readJsonc<T>(filePath: string): T {
  return parseJsonc(fs.readFileSync(filePath, "utf8")) as T;
}

/** Matches a written ref to its entry across a moved major and a rename, keeping the selection. */
function entryForRef(catalog: Catalog, ref: string): CatalogEntry | undefined {
  const base = stripVersion(ref);
  return (
    catalog.find((entry) => entry.base === base) ??
    catalog.find((entry) => entry.legacyIds.some((id) => `${entry.collection}/${id}` === base))
  );
}

/** Keeps the values that differ from the feature's published defaults, which follow the feature. */
function worthWriting(entry: CatalogEntry, values: Record<string, OptionValue>) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([name, value]) => name in entry.options && value !== entry.defaults[name]
    )
  );
}

export function loadCurrentSelection(root: string, catalog: Catalog): Selected[] {
  const current = devcontainerPath(root);
  if (!fs.existsSync(current)) {
    return [];
  }
  // The generated file is the user's to edit, so it is read as whatever it currently holds.
  const parsed = readJsonc<{ features?: Record<string, unknown> } | undefined>(current);

  // Each written feature, carried over when the catalog still recognises its ref.
  return Object.entries(parsed?.features ?? {}).flatMap(([ref, values]) => {
    const entry = entryForRef(catalog, ref);
    return entry
      ? [{ base: entry.base, values: (values ?? {}) as Record<string, OptionValue> }]
      : [];
  });
}

export function generateDevcontainer(root: string, catalog: Catalog, selected: Selected[]) {
  const skeleton = readJsonc<Record<string, unknown>>(templatePath(root, SKELETON_FILE));

  // Each selection, written at the entry's pinned ref.
  skeleton.features = Object.fromEntries(
    selected.flatMap((selection) => {
      const entry = catalog.find((candidate) => candidate.base === selection.base);
      return entry ? [[entry.ref, worthWriting(entry, selection.values)]] : [];
    })
  );

  fs.writeFileSync(devcontainerPath(root), JSON.stringify(skeleton, null, 4) + "\n", "utf8");
}
