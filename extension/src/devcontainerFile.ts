import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";
import { stripVersion } from "./registry";
import type { Catalog, CatalogEntry, OptionValue } from "./catalog";

/** A feature the user has switched on, with the option values chosen for it. */
export interface Selected {
  base: string;
  values: Record<string, OptionValue>;
}

/** The one file the sidebar reads and writes, and the source of truth for what is installed. */
export const DEVCONTAINER_FILE = "devcontainer.json";

export const devcontainerPath = (root: string): string =>
  path.join(root, ".devcontainer", DEVCONTAINER_FILE);

/** What an inserted entry is formatted with, matching the indentation the file carries. */
const FORMATTING = { formattingOptions: { insertSpaces: true, tabSize: 4 } };

/** A checkout the sidebar can work in: one carrying the file it edits. */
export const isProjectRoot = (folderPath: string): boolean =>
  fs.existsSync(devcontainerPath(folderPath));

export function projectRoot(): string | undefined {
  return vscode.workspace.workspaceFolders
    ?.map((folder) => folder.uri.fsPath)
    .find(isProjectRoot);
}

/** Reads a JSONC file as `T`, throwing on a malformed one for the caller to report. */
export function readJsonc<T>(filePath: string): T {
  return parseJsonc(fs.readFileSync(filePath, "utf8")) as T;
}

/** The `features` the file states, read through its comments. */
function writtenFeatures(root: string): Record<string, unknown> {
  const file = devcontainerPath(root);
  if (!fs.existsSync(file)) {
    return {};
  }
  return readJsonc<{ features?: Record<string, unknown> } | undefined>(file)?.features ?? {};
}

/** Matches a written ref to its entry across a moved major and a rename, keeping the selection. */
function entryForRef(catalog: Catalog, ref: string): CatalogEntry | undefined {
  const base = stripVersion(ref);
  return (
    catalog.find((entry) => entry.base === base) ??
    catalog.find((entry) => entry.legacyIds.some((id) => `${entry.collection}/${id}` === base))
  );
}

/** The values that differ from the feature's published defaults, which follow the feature. */
function worthWriting(entry: CatalogEntry, values: Record<string, OptionValue>) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([name, value]) => name in entry.options && value !== entry.defaults[name]
    )
  );
}

export function loadCurrentSelection(root: string, catalog: Catalog): Selected[] {
  // Each written feature, carried over when the catalog still recognises its ref.
  return Object.entries(writtenFeatures(root)).flatMap(([ref, values]) => {
    const entry = entryForRef(catalog, ref);
    return entry
      ? [{ base: entry.base, values: (values ?? {}) as Record<string, OptionValue> }]
      : [];
  });
}

/** Puts the selection into devcontainer.json as edits, so the rest of the file survives. */
export function writeSelection(root: string, catalog: Catalog, selected: Selected[]): void {
  const file = devcontainerPath(root);

  // Each selection at the ref its entry pins to, which is what the file should end up stating.
  const wanted = new Map<string, Record<string, OptionValue>>();
  for (const selection of selected) {
    const entry = catalog.find((candidate) => candidate.base === selection.base);
    if (entry) {
      wanted.set(entry.ref, worthWriting(entry, selection.values));
    }
  }

  // A recognised ref follows the selection off; the file keeps every other one it states.
  const removed = Object.keys(writtenFeatures(root)).filter(
    (ref) => !wanted.has(ref) && entryForRef(catalog, ref) !== undefined
  );

  const edits: [string, Record<string, OptionValue> | undefined][] = [
    ...removed.map((ref): [string, undefined] => [ref, undefined]),
    ...wanted,
  ];

  // One edit at a time, each computed against the text the last one produced.
  let text = fs.readFileSync(file, "utf8");
  for (const [ref, values] of edits) {
    text = applyEdits(text, modify(text, ["features", ref], values, FORMATTING));
  }
  fs.writeFileSync(file, text, "utf8");
}
