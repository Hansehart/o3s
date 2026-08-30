import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { parse as parseJsonc } from "jsonc-parser";

export interface CatalogEntry {
  label: string;
  description: string;
  options: unknown;
}

export type Catalog = Record<string, CatalogEntry>;

/** The generated file, and the templates it is built from - the layout, stated once. */
export const devcontainerPath = (root: string): string =>
  path.join(root, ".devcontainer", "devcontainer.json");

export const templatePath = (root: string, name: string): string =>
  path.join(root, ".devcontainer", "templates", name);

export function projectRoot(): string | undefined {
  return vscode.workspace.workspaceFolders
    ?.map((folder) => folder.uri.fsPath)
    .find((folderPath) => fs.existsSync(path.join(folderPath, ".o3s")));
}

function readJsonc(filePath: string): any {
  return parseJsonc(fs.readFileSync(filePath, "utf8"));
}

export function loadCatalog(root: string): Catalog {
  return readJsonc(templatePath(root, "features.json"));
}

export function loadCurrentSelection(root: string, catalog: Catalog): string[] {
  const current = devcontainerPath(root);
  if (!fs.existsSync(current)) {
    return [];
  }
  return Object.keys(readJsonc(current)?.features ?? {}).filter((id) => id in catalog);
}

export function generateDevcontainer(root: string, catalog: Catalog, selected: string[]) {
  const skeleton = readJsonc(templatePath(root, "devcontainer.json"));

  skeleton.features = Object.fromEntries(
    selected.filter((id) => id in catalog).map((id) => [id, catalog[id].options])
  );

  fs.writeFileSync(devcontainerPath(root), JSON.stringify(skeleton, null, 4) + "\n", "utf8");
}
