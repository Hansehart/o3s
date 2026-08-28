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

export function projectRoot(): string | undefined {
  return vscode.workspace.workspaceFolders
    ?.map((folder) => folder.uri.fsPath)
    .find((folderPath) => fs.existsSync(path.join(folderPath, ".o3s")));
}

function readJsonc(filePath: string): any {
  return parseJsonc(fs.readFileSync(filePath, "utf8"));
}

export function loadCatalog(root: string): Catalog {
  const catalogPath = path.join(root, ".devcontainer", "templates", "features.json");
  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

export function loadCurrentSelection(root: string, catalog: Catalog): string[] {
  const devcontainerPath = path.join(root, ".devcontainer", "devcontainer.json");
  if (!fs.existsSync(devcontainerPath)) {
    return [];
  }
  const current = readJsonc(devcontainerPath);
  const currentFeatures = Object.keys(current?.features ?? {});
  return currentFeatures.filter((id) => id in catalog);
}

export function generateDevcontainer(root: string, selected: string[]) {
  const skeletonPath = path.join(root, ".devcontainer", "templates", "devcontainer.json");
  const catalog = loadCatalog(root);
  const skeleton = readJsonc(skeletonPath);

  skeleton.features = Object.fromEntries(
    selected.filter((id) => id in catalog).map((id) => [id, catalog[id].options])
  );

  const outPath = path.join(root, ".devcontainer", "devcontainer.json");
  fs.writeFileSync(outPath, JSON.stringify(skeleton, null, 4) + "\n", "utf8");
}
