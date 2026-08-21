import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PHASE4_MIRROR_TABLES,
  decodePhase4Cursor,
  encodePhase4Cursor,
  phase4DeltaQuery,
  phase4MirrorAllowsMethod,
  phase4MirrorAuthorized,
  phase4ObjectAccessQuery,
  phase4Tables,
  parsePhase4Limit,
  parsePhase4Watermark,
} from "../src/phase4-mirror.ts";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

test("Phase 4 mirror token is scoped separately from admin routes", () => {
  assert.match(source, /PHASE4_MIRROR_TOKEN\?: string/);
  assert.match(source, /requirePhase4Mirror/);
  assert.match(source, /phase4MirrorAuthorized\(bearer\(request\), env\.PHASE4_MIRROR_TOKEN\)/);
  assert.doesNotMatch(source, /phase4MirrorAuthorized\(bearer\(request\), env\.ADMIN_TOKEN\)/);

  const handleApiIndex = source.indexOf("async function handleApi");
  const phase4RouteIndex = source.indexOf('url.pathname.startsWith("/api/phase4/mirror/")', handleApiIndex);
  const adminGateIndex = source.indexOf("const unauthorized = requireAdmin(request, env);", handleApiIndex);
  assert.ok(phase4RouteIndex > handleApiIndex);
  assert.ok(phase4RouteIndex < adminGateIndex);
});

test("Phase 4 mirror auth and method policy fail closed", () => {
  assert.equal(phase4MirrorAuthorized("", "secret"), false);
  assert.equal(phase4MirrorAuthorized("wrong", "secret"), false);
  assert.equal(phase4MirrorAuthorized("secret", undefined), false);
  assert.equal(phase4MirrorAuthorized("secret", "secret"), true);
  assert.equal(phase4MirrorAllowsMethod("GET"), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
    assert.equal(phase4MirrorAllowsMethod(method), false);
  }
});

test("Phase 4 mirror table allowlist excludes secret and mutation surfaces", () => {
  assert.deepEqual(phase4Tables().sort(), [
    "artifacts",
    "dm_commands",
    "inbound_webhook_events",
    "instagram_carousel_resolutions",
    "job_events",
    "jobs",
    "notes",
    "outbound_events",
    "pending_dm_parts",
    "resources",
  ]);
  assert.equal(Object.hasOwn(PHASE4_MIRROR_TABLES, "runtime_secrets"), false);
  assert.equal(Object.hasOwn(PHASE4_MIRROR_TABLES, "settings"), false);
  assert.equal(PHASE4_MIRROR_TABLES.jobs.columns.includes("upload_token_hash"), false);
  assert.equal(PHASE4_MIRROR_TABLES.jobs.columns.includes("upload_token_expires_at"), false);
  assert.doesNotMatch(source, /PHASE4_MIRROR_TOKEN[\s\S]{0,200}(REEL_QUEUE|put\(|delete\(|UPDATE|INSERT|DELETE FROM|handleNormalizedIntake)/);
});

test("Phase 4 delta queries enforce watermark, cursor, pagination, and post-watermark job scope", () => {
  const watermark = parsePhase4Watermark("2026-08-21T06:05:00+10:00");
  assert.equal(watermark, "2026-08-20T20:05:00.000Z");
  assert.equal(parsePhase4Limit("9999"), 200);
  assert.equal(parsePhase4Limit("0"), 1);

  const cursor = decodePhase4Cursor(encodePhase4Cursor({ created_at: "2026-08-20T20:06:00.000Z", key: "abc" }), watermark);
  const query = phase4DeltaQuery("artifacts", watermark, cursor, 25);
  assert.match(query.sql, /created_at AS mirror_updated_at FROM artifacts WHERE created_at >= \?/);
  assert.match(query.sql, /job_id IN \(SELECT id FROM jobs WHERE created_at >= \?\)/);
  assert.match(query.sql, /ORDER BY mirror_updated_at ASC, CAST\(id AS TEXT\) ASC LIMIT \?/);
  assert.deepEqual(query.binds, [
    "2026-08-20T20:05:00.000Z",
    "2026-08-20T20:06:00.000Z",
    "2026-08-20T20:06:00.000Z",
    "abc",
    "2026-08-20T20:05:00.000Z",
    25,
  ]);

  const jobs = phase4DeltaQuery("jobs", watermark, decodePhase4Cursor(null, watermark), 10);
  assert.match(jobs.sql, /updated_at AS mirror_updated_at FROM jobs/);
  assert.match(jobs.sql, /created_at >= \?/);
  assert.equal(jobs.binds.at(-2), watermark);

  const resources = phase4DeltaQuery("resources", watermark, decodePhase4Cursor(null, watermark), 10);
  assert.match(resources.sql, /COALESCE\(\(SELECT updated_at FROM jobs WHERE jobs.id=resources.job_id\), created_at\) AS mirror_updated_at/);
});

test("Phase 4 object access is GET-only scoped to post-watermark D1 references", () => {
  const query = phase4ObjectAccessQuery("library/reels/example/index.html", "2026-08-20T20:05:00.000Z");
  assert.match(query.sql, /FROM artifacts WHERE object_key=\?/);
  assert.match(query.sql, /SELECT html_key AS object_key FROM jobs/);
  assert.match(query.sql, /SELECT guide_html_key AS object_key FROM resources/);
  assert.doesNotMatch(query.sql, /\bPUT\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b/i);
});
