import * as fs from "fs";
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";
import { FeatureOption, PublishedFeature, majorOf, parseCollectionRef } from "./registry";
import { SOURCES_FILE, readJsonc, templatePath } from "./devcontainerGenerator";

export type OptionValue = string | boolean;

/** What `templates/features.json` states: the collections to read and the values o3s insists on. */
export interface Sources {
  collections: string[];
  overrides: Record<string, Record<string, OptionValue>>;
}

/** One feature as the sidebar renders it, with every field taken from the registry. */
export interface CatalogEntry {
  /** The feature ref without a version, which is how an override and a selection key it. */
  base: string;
  /** The ref a generated devcontainer.json carries, pinned to the published major. */
  ref: string;
  collection: string;
  label: string;
  description: string;
  version: string;
  documentationURL?: string;
  licenseURL?: string;
  deprecated: boolean;
  /** What the feature does to the container's isolation. */
  security: string[];
  extensions: string[];
  dependsOn: string[];
  legacyIds: string[];
  options: Record<string, FeatureOption>;
  /** The published defaults, which decide what is worth writing out. */
  defaults: Record<string, OptionValue>;
  /** The published defaults under the o3s overrides: what a control is seeded and reset to. */
  values: Record<string, OptionValue>;
}

export type Catalog = CatalogEntry[];

const asSources = (parsed: Partial<Sources> | undefined): Sources => ({
  collections: parsed?.collections ?? [],
  overrides: parsed?.overrides ?? {},
});

export function loadSources(root: string): Sources {
  return asSources(readJsonc<Partial<Sources> | undefined>(templatePath(root, SOURCES_FILE)));
}

/** Appends a collection as a surgical edit, keeping the file's comments and formatting. */
export function addCollection(root: string, ref: string): void {
  const { resource } = parseCollectionRef(ref);
  const file = templatePath(root, SOURCES_FILE);

  // Read once, so the list that is checked is the one the edit is applied to.
  const contents = fs.readFileSync(file, "utf8");
  const { collections } = asSources(parseJsonc(contents));
  if (collections.includes(resource)) {
    return;
  }

  const edits = modify(contents, ["collections", collections.length], resource, {
    formattingOptions: { insertSpaces: true, tabSize: 4 },
  });
  fs.writeFileSync(file, applyEdits(contents, edits), "utf8");
}

/** The value each option falls back to when a generated devcontainer.json states nothing. */
const defaultsOf = (options: Record<string, FeatureOption>): Record<string, OptionValue> =>
  Object.fromEntries(
    Object.entries(options)
      .filter(([, option]) => option.default !== undefined)
      .map(([name, option]) => [name, option.default as OptionValue])
  );

/** The ways a feature widens the container's isolation, each named as the sidebar shows it. */
function securityNotesOf(feature: PublishedFeature): string[] {
  return [
    ...(feature.privileged ? ["runs privileged"] : []),
    ...(feature.capAdd ?? []).map((capability) => `adds ${capability}`),
    ...(feature.securityOpt ?? []).map((option) => `sets ${option}`),
  ];
}

function toEntry(
  collection: string,
  feature: PublishedFeature,
  overrides: Record<string, OptionValue>,
  warn: (message: string) => void
): CatalogEntry | undefined {
  const base = `${collection}/${feature.id}`;

  let major: string;
  try {
    major = majorOf(feature.version);
  } catch {
    // An entry needs a published major, since that is the tag a devcontainer.json pins to.
    warn(`${base} publishes version '${feature.version}', which names no major to pin to`);
    return undefined;
  }

  const options = feature.options ?? {};
  const applicable: Record<string, OptionValue> = {};
  // Each override, kept where the feature publishes a matching option and reported otherwise.
  for (const [name, value] of Object.entries(overrides)) {
    if (name in options) {
      applicable[name] = value;
    } else {
      warn(`${base} publishes no option '${name}', so that override applies to nothing`);
    }
  }

  const defaults = defaultsOf(options);
  return {
    base,
    ref: `${base}:${major}`,
    collection,
    label: feature.name ?? feature.id,
    description: feature.description ?? "",
    version: feature.version,
    documentationURL: feature.documentationURL,
    licenseURL: feature.licenseURL,
    deprecated: feature.deprecated === true,
    security: securityNotesOf(feature),
    extensions: feature.customizations?.vscode?.extensions ?? [],
    dependsOn: Object.keys(feature.dependsOn ?? {}),
    legacyIds: feature.legacyIds ?? [],
    options,
    defaults,
    values: { ...defaults, ...applicable },
  };
}

/** Merges the published features into the sidebar's list, in the order the sources name them. */
export function buildCatalog(
  sources: Sources,
  fetched: Map<string, PublishedFeature[]>,
  warn: (message: string) => void = () => {}
): Catalog {
  // Each collection that resolved, contributing the features it published.
  const entries = sources.collections.flatMap((collection) =>
    (fetched.get(collection) ?? []).flatMap((feature) => {
      const entry = toEntry(
        collection,
        feature,
        sources.overrides[`${collection}/${feature.id}`] ?? {},
        warn
      );
      return entry ? [entry] : [];
    })
  );

  // A stable partition rather than a sort, so each collection keeps its published order.
  return [...entries.filter((e) => !e.deprecated), ...entries.filter((e) => e.deprecated)];
}
