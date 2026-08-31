import * as http from "http";
import { AddressInfo } from "net";
import { COLLECTION_MEDIA_TYPE, PublishedFeature } from "../../registry";

/** A feature as a collection publishes it, trimmed to what the suites assert on. */
export const FEATURES: PublishedFeature[] = [
  { id: "node", version: "1.0.1", name: "Node.js", description: "Installs Node.js." },
  { id: "uv", version: "1.1.5", name: "uv (Python)", description: "Installs uv." },
];

export const NAMESPACE = "acme/features";

export interface FakeRegistry {
  origin: string;
  /** Every path asked for, in order, which is what makes a duplicate fetch visible. */
  requests: string[];
  authorizations: (string | undefined)[];
  close: () => Promise<void>;
}

const MANIFEST = /^\/v2\/(.+)\/manifests\/latest$/;
const BLOB = /^\/v2\/(.+)\/blobs\/(.+)$/;

/** An OCI registry answering what a collection fetch asks: challenge, token, manifest, blob. */
export async function startRegistry(
  options: {
    namespaces?: string[];
    layerMediaType?: string;
    redirectBlob?: boolean;
    anonymous?: boolean;
  } = {}
): Promise<FakeRegistry> {
  const namespaces = options.namespaces ?? [NAMESPACE];
  const digest = "sha256:" + "a".repeat(64);
  const requests: string[] = [];
  const authorizations: (string | undefined)[] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push(url.pathname);
    authorizations.push(req.headers.authorization);

    const send = (status: number, body: unknown, headers: http.OutgoingHttpHeaders = {}) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(payload);
    };

    if (url.pathname === "/token") {
      send(200, { token: `token-for-${url.searchParams.get("scope")}` });
      return;
    }

    // Serving only the listed namespaces makes any other one 404 like an unknown collection.
    const manifest = MANIFEST.exec(url.pathname);
    if (manifest && namespaces.includes(manifest[1])) {
      if (!options.anonymous && !req.headers.authorization) {
        res.writeHead(401, {
          "www-authenticate": `Bearer realm="http://localhost:${port}/token",service="fake"`,
        });
        res.end();
        return;
      }
      send(200, {
        schemaVersion: 2,
        layers: [
          { mediaType: "application/vnd.oci.image.layer.v1.tar", digest: "sha256:other", size: 1 },
          { mediaType: options.layerMediaType ?? COLLECTION_MEDIA_TYPE, digest, size: 2 },
        ],
      });
      return;
    }

    const blob = BLOB.exec(url.pathname);
    if (blob && namespaces.includes(blob[1]) && blob[2] === digest) {
      if (options.redirectBlob) {
        res.writeHead(307, { location: `http://localhost:${port}/elsewhere` });
        res.end();
        return;
      }
      send(200, { sourceInformation: { source: "devcontainer-cli" }, features: FEATURES });
      return;
    }

    if (url.pathname === "/elsewhere") {
      send(200, { sourceInformation: { source: "devcontainer-cli" }, features: FEATURES });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    origin: `localhost:${port}`,
    requests,
    authorizations,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
