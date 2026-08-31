import * as assert from "assert";
import { fetchCollection, majorOf, parseCollectionRef, stripVersion } from "../../registry";
import { FakeRegistry, NAMESPACE, startRegistry } from "./fakeRegistry";

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
