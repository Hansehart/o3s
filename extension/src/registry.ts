import * as http from "http";
import * as https from "https";

/** The layer a collection artifact publishes its metadata under. */
export const COLLECTION_MEDIA_TYPE = "application/vnd.devcontainers.collection.layer.v1+json";

/** An option as its feature declares it: `enum` is a closed set, `proposals` a hint. */
export type FeatureOption =
  | { type: "boolean"; default?: boolean; description?: string }
  | { type: "string"; enum?: string[]; default?: string; description?: string }
  | { type: "string"; proposals?: string[]; default?: string; description?: string };

/** A feature as a collection publishes it, over the fields the sidebar reads. */
export interface PublishedFeature {
  id: string;
  version: string;
  name?: string;
  description?: string;
  documentationURL?: string;
  licenseURL?: string;
  options?: Record<string, FeatureOption>;
  customizations?: { vscode?: { extensions?: string[] } };
  dependsOn?: Record<string, unknown>;
  privileged?: boolean;
  capAdd?: string[];
  securityOpt?: string[];
  init?: boolean;
  deprecated?: boolean;
  legacyIds?: string[];
}

export interface CollectionRef {
  scheme: "http" | "https";
  registry: string;
  namespace: string;
  resource: string;
}

/** The path grammar the distribution spec allows, as the devcontainer CLI applies it. */
const PATH = /^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/;

/** Localhost speaks plain HTTP, which is what makes a local test registry possible. */
const schemeFor = (registry: string): CollectionRef["scheme"] =>
  new URL(`https://${registry}`).hostname === "localhost" ? "http" : "https";

/** Splits `<registry>/<namespace>` as the CLI's `getRef` does: first segment, then the rest. */
export function parseCollectionRef(input: string): CollectionRef {
  const ref = input.toLowerCase();
  if (ref.startsWith(".")) {
    throw new Error(`'${input}' is not a collection: a ref cannot start with a dot`);
  }

  const [registry, ...rest] = ref.split("/");
  const namespace = rest.join("/");
  if (!namespace) {
    throw new Error(`'${input}' names no namespace: expected <registry>/<namespace>`);
  }
  if (!PATH.test(namespace)) {
    throw new Error(`'${input}' has a namespace that is not a legal registry path`);
  }

  return { scheme: schemeFor(registry), registry, namespace, resource: `${registry}/${namespace}` };
}

/**
 * Drops a `:tag` or `@digest`, leaving the ref that identifies a feature across versions.
 * The last colon counts only when it follows the last slash, so a registry port survives.
 */
export function stripVersion(ref: string): string {
  const at = ref.lastIndexOf("@");
  if (at !== -1) {
    return ref.slice(0, at);
  }
  const colon = ref.lastIndexOf(":");
  return colon > ref.lastIndexOf("/") ? ref.slice(0, colon) : ref;
}

/** The major a published version pins to, which is the tag a devcontainer.json should carry. */
export function majorOf(version: string): string {
  const major = /^(\d+)(\.|$)/.exec(version)?.[1];
  if (!major) {
    throw new Error(`'${version}' has no leading major version to pin to`);
  }
  return major;
}

interface Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function get(url: string, headers: http.OutgoingHttpHeaders, timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = (url.startsWith("https:") ? https : http).get(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        })
      );
    });
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error(`${url} did not answer within ${timeoutMs}ms`))
    );
    request.on("error", reject);
  });
}

/** Follows a blob redirect to storage, forwarding only `accept` so the token stays here. */
async function getFollowing(
  url: string,
  headers: http.OutgoingHttpHeaders,
  timeoutMs: number
): Promise<Response> {
  let response = await get(url, headers, timeoutMs);
  // Each redirect in turn, up to a bound that keeps a redirect cycle finite.
  for (let hop = 0; hop < 5 && response.status >= 300 && response.status < 400; hop++) {
    const location = response.headers.location;
    if (!location) {
      break;
    }
    url = new URL(location, url).toString();
    response = await get(url, { accept: headers.accept }, timeoutMs);
  }
  return response;
}

/** Trades the challenge a registry answers with for a pull token on the collection. */
async function fetchToken(
  challenge: string,
  namespace: string,
  timeoutMs: number
): Promise<string | undefined> {
  const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
  if (!realm) {
    return undefined;
  }
  const url = new URL(realm);
  const service = /service="([^"]+)"/.exec(challenge)?.[1];
  if (service) {
    url.searchParams.set("service", service);
  }
  url.searchParams.set("scope", `repository:${namespace}:pull`);

  const response = await get(url.toString(), {}, timeoutMs);
  if (response.status !== 200) {
    throw new Error(`${realm} answered ${response.status} for a pull token`);
  }
  return JSON.parse(response.body).token;
}

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/**
 * Every feature the collection at `ref` publishes, over an anonymous pull. `features
 * publish` pushes one artifact per collection whose single layer holds the metadata.
 */
export async function fetchCollection(ref: string, timeoutMs = 15000): Promise<PublishedFeature[]> {
  const { scheme, registry, namespace } = parseCollectionRef(ref);
  const base = `${scheme}://${registry}/v2/${namespace}`;

  let manifest = await get(`${base}/manifests/latest`, { accept: MANIFEST_ACCEPT }, timeoutMs);
  let token: string | undefined;
  if (manifest.status === 401) {
    const challenge = manifest.headers["www-authenticate"];
    if (!challenge) {
      throw new Error(`${ref}: the registry refused the pull without saying how to authenticate`);
    }
    token = await fetchToken(challenge, namespace, timeoutMs);
    manifest = await get(
      `${base}/manifests/latest`,
      { accept: MANIFEST_ACCEPT, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      timeoutMs
    );
  }
  if (manifest.status !== 200) {
    throw new Error(`${ref}: the registry answered ${manifest.status} for its manifest`);
  }

  const layers: { mediaType?: string; digest?: string }[] = JSON.parse(manifest.body).layers ?? [];
  const digest = layers.find((layer) => layer.mediaType === COLLECTION_MEDIA_TYPE)?.digest;
  if (!digest) {
    // The collection layer is what marks this artifact as a feature collection.
    throw new Error(`${ref} publishes no devcontainer collection`);
  }

  const blob = await getFollowing(
    `${base}/blobs/${digest}`,
    { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    timeoutMs
  );
  if (blob.status !== 200) {
    throw new Error(`${ref}: the registry answered ${blob.status} for its collection`);
  }

  return JSON.parse(blob.body).features ?? [];
}
