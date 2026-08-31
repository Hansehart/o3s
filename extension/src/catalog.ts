import { FeatureOption, PublishedFeature, majorOf } from "./registry";

export type OptionValue = string | boolean;

/** One feature as the sidebar renders it, with every field taken from the registry. */
export interface CatalogEntry {
  /** The feature ref without a version, which is how a selection keys it. */
  base: string;
  /** The ref devcontainer.json carries, pinned to the published major. */
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
  /**
   * The published defaults. The only seed there is: what a control starts at when the file
   * states nothing, what it resets to, and what a value is compared against before being
   * written. One layer, so what the sidebar shows and what the file holds cannot drift.
   */
  defaults: Record<string, OptionValue>;
}

export type Catalog = CatalogEntry[];

/** The value each option falls back to when devcontainer.json states nothing for it. */
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
  warn: (message: string) => void
): CatalogEntry | undefined {
  const base = `${collection}/${feature.id}`;

  let major: string;
  try {
    major = majorOf(feature.version);
  } catch {
    // An entry needs a published major, since that is the tag devcontainer.json pins to.
    warn(`${base} publishes version '${feature.version}', which names no major to pin to`);
    return undefined;
  }

  const options = feature.options ?? {};
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
    defaults: defaultsOf(options),
  };
}

/** Merges the published features into the sidebar's list, in the order the providers are named. */
export function buildCatalog(
  collections: string[],
  fetched: Map<string, PublishedFeature[]>,
  warn: (message: string) => void = () => {}
): Catalog {
  // Each collection that resolved, contributing the features it published.
  const entries = collections.flatMap((collection) =>
    (fetched.get(collection) ?? []).flatMap((feature) => {
      const entry = toEntry(collection, feature, warn);
      return entry ? [entry] : [];
    })
  );

  // A stable partition rather than a sort, so each collection keeps its published order.
  return [...entries.filter((e) => !e.deprecated), ...entries.filter((e) => e.deprecated)];
}
