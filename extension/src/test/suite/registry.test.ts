import * as assert from "assert";
import * as http from "http";
import { AddressInfo } from "net";
import {
  COLLECTION_MEDIA_TYPE,
  PublishedFeature,
  fetchCollection,
  majorOf,
  parseCollectionRef,
  stripVersion,
} from "../../registry";

suite("registry: ref parsing", () => {
  test("splits a collection ref into registry and namespace", () => {
    const ref = parseCollectionRef("ghcr.io/hansehart/devcontainer-features");
    assert.strictEqual(ref.registry, "ghcr.io");
    assert.strictEqual(ref.namespace, "hansehart/devcontainer-features");
    assert.strictEqual(ref.scheme, "https");
    assert.strictEqual(ref.resource, "ghcr.io/hansehart/devcontainer-features");
  });

  test("keeps every middle segment in the namespace", () => {
    assert.strictEqual(parseCollectionRef("example.com/a/b/c").namespace, "a/b/c");
  });

  test("downcases the whole ref, as the spec requires", () => {
    const ref = parseCollectionRef("GHCR.IO/Hansehart/DevContainer-Features");
    assert.strictEqual(ref.resource, "ghcr.io/hansehart/devcontainer-features");
  });

  test("localhost speaks http, so a test registry needs no certificate", () => {
    assert.strictEqual(parseCollectionRef("localhost:5000/ns/coll").scheme, "http");
    assert.strictEqual(parseCollectionRef("localhost:5000/ns/coll").registry, "localhost:5000");
  });

  test("a registry with no namespace is rejected", () => {
    assert.throws(() => parseCollectionRef("ghcr.io"), /namespace/i);
  });

  test("a leading dot and an illegal character are rejected", () => {
    assert.throws(() => parseCollectionRef(".ghcr.io/ns/coll"));
    assert.throws(() => parseCollectionRef("ghcr.io/ns/co ll"));
  });
});

suite("registry: version helpers", () => {
  test("stripVersion drops a tag", () => {
    assert.strictEqual(stripVersion("ghcr.io/a/b/c:2"), "ghcr.io/a/b/c");
  });

  test("stripVersion drops a digest", () => {
    assert.strictEqual(stripVersion("ghcr.io/a/b/c@sha256:abc123"), "ghcr.io/a/b/c");
  });

  test("stripVersion leaves an untagged ref alone", () => {
    assert.strictEqual(stripVersion("ghcr.io/a/b/c"), "ghcr.io/a/b/c");
  });

  test("stripVersion does not mistake a registry port for a tag", () => {
    assert.strictEqual(stripVersion("localhost:5000/a/b/c"), "localhost:5000/a/b/c");
    assert.strictEqual(stripVersion("localhost:5000/a/b/c:1"), "localhost:5000/a/b/c");
  });

  test("majorOf takes the leading component", () => {
    assert.strictEqual(majorOf("2.0.0"), "2");
    assert.strictEqual(majorOf("1.1.3"), "1");
    assert.strictEqual(majorOf("10.2.1"), "10");
    assert.strictEqual(majorOf("2"), "2");
  });

  test("majorOf rejects a version it cannot read", () => {
    assert.throws(() => majorOf(""));
    assert.throws(() => majorOf("latest"));
  });
});

/** A feature as a collection publishes it, trimmed to what these tests assert on. */
const FEATURES: PublishedFeature[] = [
  { id: "node", version: "1.0.1", name: "Node.js", description: "Installs Node.js." },
  { id: "uv", version: "1.1.5", name: "uv (Python)", description: "Installs uv." },
];

const NAMESPACE = "acme/features";

interface FakeRegistry {
  origin: string;
  requests: string[];
  authorizations: (string | undefined)[];
  close: () => Promise<void>;
}

/**
 * An OCI registry that answers the three requests a collection fetch makes: a
 * challenge, a token, then the manifest and its blob. `blobHandler` stands in for
 * the last hop so a test can redirect it or drop the layer.
 */
async function startRegistry(options: {
  layerMediaType?: string;
  redirectBlob?: boolean;
  anonymous?: boolean;
} = {}): Promise<FakeRegistry> {
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

    if (url.pathname === `/v2/${NAMESPACE}/manifests/latest`) {
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
          {
            mediaType: options.layerMediaType ?? COLLECTION_MEDIA_TYPE,
            digest,
            size: 2,
          },
        ],
      });
      return;
    }

    if (url.pathname === `/v2/${NAMESPACE}/blobs/${digest}`) {
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

suite("registry: fetchCollection", () => {
  let registry: FakeRegistry | undefined;

  teardown(async () => {
    await registry?.close();
    registry = undefined;
  });

  test("answers the auth challenge and returns the published features", async () => {
    registry = await startRegistry();
    const features = await fetchCollection(`${registry.origin}/${NAMESPACE}`);
    assert.deepStrictEqual(
      features.map((f) => f.id),
      ["node", "uv"]
    );
    assert.strictEqual(features[0].name, "Node.js");
  });

  test("takes the realm and scope from the challenge, then presents the token", async () => {
    registry = await startRegistry();
    await fetchCollection(`${registry.origin}/${NAMESPACE}`);
    assert.deepStrictEqual(registry.requests, [
      `/v2/${NAMESPACE}/manifests/latest`,
      "/token",
      `/v2/${NAMESPACE}/manifests/latest`,
      `/v2/${NAMESPACE}/blobs/sha256:${"a".repeat(64)}`,
    ]);
    assert.strictEqual(
      registry.authorizations[2],
      `Bearer token-for-repository:${NAMESPACE}:pull`
    );
  });

  test("a registry that does not challenge is fetched anonymously", async () => {
    registry = await startRegistry({ anonymous: true });
    const features = await fetchCollection(`${registry.origin}/${NAMESPACE}`);
    assert.strictEqual(features.length, 2);
    assert.ok(!registry.requests.includes("/token"), "no token is fetched when none is asked for");
  });

  test("follows the redirect a blob download answers with", async () => {
    registry = await startRegistry({ redirectBlob: true });
    const features = await fetchCollection(`${registry.origin}/${NAMESPACE}`);
    assert.strictEqual(features.length, 2);
  });

  test("a manifest carrying no collection layer is an error, not an empty catalog", async () => {
    registry = await startRegistry({ layerMediaType: "application/vnd.oci.image.layer.v1.tar" });
    await assert.rejects(
      fetchCollection(`${registry.origin}/${NAMESPACE}`),
      /collection/i,
      "an empty result would silently generate a featureless devcontainer.json"
    );
  });

  test("an unknown collection reports the status rather than hanging", async () => {
    registry = await startRegistry();
    await assert.rejects(fetchCollection(`${registry.origin}/acme/missing`), /404/);
  });
});
