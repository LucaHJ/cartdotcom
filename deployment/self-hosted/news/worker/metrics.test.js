import test from "node:test";
import assert from "node:assert/strict";
import { refreshSourceHourlyMetric, utcHourStart } from "./metrics.js";

test("source metrics use the article discovery UTC hour", () => {
  assert.equal(utcHourStart("2026-08-20T03:47:51.123Z").toISOString(), "2026-08-20T03:00:00.000Z");
});

test("source metrics reject an invalid discovery timestamp", () => {
  assert.throws(() => utcHourStart("not-a-date"), /valid discovery time/);
});

test("source metric refresh counts articles once and actionable predictions", async () => {
  let statement;
  const client = {
    async query(sql, parameters) {
      statement = { sql, parameters };
    },
  };
  await refreshSourceHourlyMetric(client, "2026-08-20T03:47:51.123Z");
  assert.match(statement.sql, /count\(DISTINCT articles\.id\)/);
  assert.match(statement.sql, /count\(predictions\.id\)/);
  assert.equal(statement.parameters[0].toISOString(), "2026-08-20T03:00:00.000Z");
});
