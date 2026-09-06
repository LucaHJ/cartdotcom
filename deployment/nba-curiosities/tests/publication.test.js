import test from "node:test";
import assert from "node:assert/strict";
import { publish, digest, validateBundle } from "../publication.js";
const bundle = (at = "2026-09-06T00:00:00Z") => ({
  snapshot: {
    version: 1,
    generatedAt: "fixed",
    source: { sha256: "a" },
    columns: ["player"],
    players: [["1", "Example"]],
    rows: [[0]],
  },
  catalogue: {
    version: 2,
    generatedAt: "fixed",
    snapshotSha256: "a",
    analysedAt: at,
    findings: [{ id: "story", players: [0], query: { rings: [{}] } }],
  },
});
async function request(value, token = "test-only", checksum) {
  const body = JSON.stringify(value);
  return new Request("https://cartdotcom.com/backend/nba/_publish", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Content-SHA256": checksum || (await digest(body)),
    },
    body,
  });
}
function store(initial) {
  const values = new Map(initial ? [["latest", JSON.stringify(initial)]] : []);
  return {
    values,
    env: {
      NBA_PUBLISH_TOKEN: "test-only",
      NBA_PUBLICATIONS: {
        get: async (k) => values.get(k) || null,
        put: async (k, v) => values.set(k, v),
      },
    },
  };
}
test("publication token is independent of a backend login", async () => {
  const { env, values } = store();
  assert.equal(
    (await publish(await request(bundle(), "wrong"), env)).status,
    401,
  );
  assert.equal(values.size, 0);
});
test("bad checksums and mixed versions never replace live data", async () => {
  const { env, values } = store();
  assert.equal(
    (await publish(await request(bundle(), "test-only", "bad"), env)).status,
    400,
  );
  const mixed = bundle();
  mixed.catalogue.snapshotSha256 = "other";
  assert.throws(() => validateBundle(mixed));
  assert.equal((await publish(await request(mixed), env)).status, 400);
  assert.equal(values.size, 0);
});
test("a generation is stored as one complete pair with a previous fallback", async () => {
  const old = bundle("2026-09-05T00:00:00Z"),
    { env, values } = store(old);
  assert.equal((await publish(await request(bundle()), env)).status, 200);
  assert.deepEqual(JSON.parse(values.get("latest")), bundle());
  assert.deepEqual(JSON.parse(values.get("previous")), old);
});
test("an old replay cannot replace a newer generation", async () => {
  const { env, values } = store(bundle());
  assert.equal(
    (await publish(await request(bundle("2026-09-05T00:00:00Z")), env)).status,
    409,
  );
  assert.equal(values.size, 1);
});
