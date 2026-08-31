import * as vscode from "vscode";
import { parseCollectionRef, stripVersion } from "./registry";
import { devcontainerPath, readJsonc } from "./devcontainerFile";
import * as fs from "fs";

/** Where the browsable providers are kept: the user's settings. */
export const PROVIDERS_SECTION = "o3s";
export const PROVIDERS_SETTING = "featureProviders";

/** The providers the user has asked for, defaulted by `package.json`. */
export function configuredProviders(): string[] {
  return (
    vscode.workspace
      .getConfiguration(PROVIDERS_SECTION)
      .get<string[]>(PROVIDERS_SETTING) ?? []
  );
}

/** The collection a feature ref belongs to, or nothing when the ref names no collection. */
function collectionOf(ref: string): string | undefined {
  const segments = stripVersion(ref).split("/");
  // The last segment is the feature's own id; what precedes it is the collection.
  const collection = segments.slice(0, -1).join("/");
  try {
    return parseCollectionRef(collection).resource;
  } catch {
    // A provider is named by a ref carrying both a registry and a namespace.
    return undefined;
  }
}

/** The providers this checkout draws on, read from the file, so a repo names its own sources. */
export function providersInUse(root: string): string[] {
  const file = devcontainerPath(root);
  if (!fs.existsSync(file)) {
    return [];
  }
  const features = readJsonc<{ features?: Record<string, unknown> } | undefined>(file)?.features;
  return [
    ...new Set(
      Object.keys(features ?? {}).flatMap((ref) => {
        const collection = collectionOf(ref);
        return collection ? [collection] : [];
      })
    ),
  ];
}

/** Every provider to offer, the configured ones first so the order stays the user's. */
export function allProviders(root: string): string[] {
  return [...new Set([...configuredProviders(), ...providersInUse(root)])];
}

/** Adds a provider to the settings, once the ref parses as a collection. */
export async function addProvider(ref: string): Promise<void> {
  const { resource } = parseCollectionRef(ref);
  const configured = configuredProviders();
  if (configured.includes(resource)) {
    return;
  }
  await vscode.workspace
    .getConfiguration(PROVIDERS_SECTION)
    .update(PROVIDERS_SETTING, [...configured, resource], vscode.ConfigurationTarget.Global);
}
