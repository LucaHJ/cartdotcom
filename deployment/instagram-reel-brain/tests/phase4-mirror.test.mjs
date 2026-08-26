import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  PHASE4_NORMAL_MIN_WATERMARK,
  PHASE4_REPLAY_WATERMARK,
  PHASE4_MIRROR_TABLES,
  decodePhase4Cursor,
  encodePhase4Cursor,
  phase4DeltaQuery,
  phase4MirrorAllowsMethod,
  phase4MirrorAuthorized,
  phase4MirrorScopeForToken,
  phase4NextCursor,
  phase4ObjectAccessQuery,
  phase4Tables,
  phase4WatermarkAllowed,
  parsePhase4Limit,
  parsePhase4Watermark,
} from "../src/phase4-mirror.ts";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

test("Phase 4 mirror token is scoped separately from admin routes", () => {
  assert.match(source, /PHASE4_MIRROR_TOKEN\?: string/);
  assert.match(source, /PHASE4_REPLAY_TOKEN\?: string/);
  assert.match(source, /requirePhase4Mirror/);
  assert.match(source, /phase4MirrorScopeForToken\(bearer\(request\), env\.PHASE4_MIRROR_TOKEN, env\.PHASE4_REPLAY_TOKEN\)/);
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

  const liveScope = phase4MirrorScopeForToken("live-token", "live-token", "replay-token");
  assert.deepEqual(liveScope, { kind: "live", minWatermark: PHASE4_NORMAL_MIN_WATERMARK });
  assert.equal(phase4WatermarkAllowed(liveScope, PHASE4_NORMAL_MIN_WATERMARK), true);
  assert.equal(phase4WatermarkAllowed(liveScope, "2026-08-21T01:42:45.999Z"), false);

  const replayScope = phase4MirrorScopeForToken("replay-token", "live-token", "replay-token");
  assert.equal(replayScope.kind, "historical_replay");
  assert.equal(phase4WatermarkAllowed(replayScope, PHASE4_REPLAY_WATERMARK), true);
  assert.equal(phase4WatermarkAllowed(replayScope, PHASE4_NORMAL_MIN_WATERMARK), false);
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
    "retrieval_documents",
    "retrieval_terms",
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
  assert.match(query.sql, /strftime\('%Y-%m-%dT%H:%M:%fZ', datetime\(created_at\)\) AS mirror_updated_at, CAST\(id AS TEXT\) AS mirror_key FROM artifacts WHERE datetime\(created_at\) >= datetime\(\?\)/);
  assert.match(query.sql, /job_id IN \(SELECT id FROM jobs WHERE datetime\(created_at\) >= datetime\(\?\)\)/);
  assert.match(query.sql, /ORDER BY datetime\(created_at\) ASC, CAST\(id AS TEXT\) ASC LIMIT \?/);
  assert.deepEqual(query.binds, [
    "2026-08-20T20:05:00.000Z",
    "2026-08-20T20:06:00.000Z",
    "2026-08-20T20:06:00.000Z",
    "abc",
    "2026-08-20T20:05:00.000Z",
    25,
  ]);

  const jobs = phase4DeltaQuery("jobs", watermark, decodePhase4Cursor(null, watermark), 10);
  assert.match(jobs.sql, /strftime\('%Y-%m-%dT%H:%M:%fZ', datetime\(updated_at\)\) AS mirror_updated_at, CAST\(id AS TEXT\) AS mirror_key FROM jobs/);
  assert.match(jobs.sql, /datetime\(created_at\) >= datetime\(\?\)/);
  assert.equal(jobs.binds.at(-2), watermark);

  const resources = phase4DeltaQuery("resources", watermark, decodePhase4Cursor(null, watermark), 10);
  assert.match(resources.sql, /strftime\('%Y-%m-%dT%H:%M:%fZ', datetime\(COALESCE\(\(SELECT updated_at FROM jobs WHERE jobs.id=resources.job_id\), created_at\)\)\) AS mirror_updated_at/);

  const terms = phase4DeltaQuery("retrieval_terms", watermark, decodePhase4Cursor(null, watermark), 10);
  assert.match(terms.sql, /CAST\(job_id \|\| ':' \|\| term AS TEXT\) AS mirror_key/);
  assert.match(terms.sql, /WHERE indexed_at >= datetime\(\?\)/);
  assert.match(terms.sql, /ORDER BY indexed_at ASC/);
  assert.doesNotMatch(terms.sql, /WHERE datetime\(indexed_at\)/);
  assert.match(terms.sql, /job_id IN \(SELECT id FROM jobs WHERE datetime\(created_at\) >= datetime\(\?\)\)/);

  const oldPending = phase4DeltaQuery("pending_dm_parts", watermark, decodePhase4Cursor(null, watermark), 10);
  assert.match(oldPending.sql, /datetime\(COALESCE\(consumed_at, created_at\)\) >= datetime\(\?\)/);
  assert.match(oldPending.sql, /datetime\(created_at\) >= datetime\(\?\)/);

  const oldCommand = phase4DeltaQuery("dm_commands", watermark, decodePhase4Cursor(null, watermark), 10);
  assert.match(oldCommand.sql, /datetime\(COALESCE\(completed_at, created_at\)\) >= datetime\(\?\)/);
  assert.match(oldCommand.sql, /datetime\(created_at\) >= datetime\(\?\)/);
});

test("Phase 4 cursor advances for every nonempty page including partial pages", () => {
  const cursor = phase4NextCursor("jobs", [{
    id: "job-1",
    created_at: "2026-08-20T20:05:00.000Z",
    updated_at: "2026-08-20T20:06:00.000Z",
    mirror_updated_at: "2026-08-20T20:06:00.000Z",
  }]);
  assert.equal(typeof cursor, "string");
  const decoded = decodePhase4Cursor(cursor, "2026-08-20T20:05:00.000Z");
  assert.deepEqual(decoded, { created_at: "2026-08-20T20:06:00.000Z", key: "job-1" });
  assert.equal(phase4NextCursor("jobs", []), null);
});

test("Phase 4 object access is GET-only scoped to post-watermark D1 references", () => {
  const query = phase4ObjectAccessQuery("library/reels/example/index.html", "2026-08-20T20:05:00.000Z");
  assert.match(query.sql, /FROM artifacts\s+WHERE object_key=\?/);
  assert.match(query.sql, /datetime\(created_at\) >= datetime\(\?\)/);
  assert.match(query.sql, /\? IN \(original_video_key, audio_key, markdown_key, transcript_key, synthesis_json_key, html_key\)/);
  assert.match(query.sql, /FROM resources\s+WHERE guide_html_key=\?/);
  assert.doesNotMatch(query.sql, /\bUNION\b/i);
  assert.doesNotMatch(query.sql, /\bPUT\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b/i);
});

function createPhase4Sqlite() {
  const db = new DatabaseSync(":memory:");
  for (const [table, spec] of Object.entries(PHASE4_MIRROR_TABLES)) {
    const columns = new Set(spec.columns);
    if (["job_events", "artifacts", "resources", "outbound_events"].includes(table)) columns.add("job_id");
    if (table === "jobs") {
      columns.add("original_video_key");
      columns.add("audio_key");
      columns.add("markdown_key");
      columns.add("transcript_key");
      columns.add("synthesis_json_key");
      columns.add("html_key");
      columns.add("status");
    }
    if (table === "artifacts") {
      columns.add("object_key");
      columns.add("created_at");
    }
    if (table === "resources") {
      columns.add("guide_html_key");
      columns.add("created_at");
    }
    db.exec(`CREATE TABLE ${table} (${[...columns].map((column) => `${column} TEXT`).join(", ")});`);
  }
  return db;
}

test("Phase 4 SQLite queries return same-day D1 space timestamps after ISO watermark", () => {
  const db = createPhase4Sqlite();
  db.exec(`
    INSERT INTO jobs(id, status, created_at, updated_at, shortcode) VALUES
      ('before', 'complete', '2026-08-21 01:42:45', '2026-08-21 01:42:45', 'before'),
      ('after-a', 'complete', '2026-08-21 02:33:57', '2026-08-21 02:37:16', 'after-a'),
      ('after-b', 'complete', '2026-08-21 02:38:29', '2026-08-21 02:42:04', 'after-b');
  `);
  const watermark = "2026-08-21T01:42:46.000Z";
  const query = phase4DeltaQuery("jobs", watermark, decodePhase4Cursor(null, watermark), 10, { kind: "live", minWatermark: PHASE4_NORMAL_MIN_WATERMARK });
  const rows = db.prepare(query.sql).all(...query.binds);
  assert.deepEqual(rows.map((row) => row.id), ["after-a", "after-b"]);
  assert.deepEqual(rows.map((row) => row.mirror_updated_at), ["2026-08-21T02:37:16.000Z", "2026-08-21T02:42:04.000Z"]);
});

test("Phase 4 SQLite pagination remains complete and idempotent with normalized timestamps", () => {
  const db = createPhase4Sqlite();
  db.exec(`
    INSERT INTO jobs(id, status, created_at, updated_at, shortcode) VALUES
      ('a', 'complete', '2026-08-21 02:00:00', '2026-08-21 02:10:00', 'a'),
      ('b', 'complete', '2026-08-21 02:00:01', '2026-08-21 02:10:00', 'b');
  `);
  const watermark = "2026-08-21T01:42:46.000Z";
  const firstQuery = phase4DeltaQuery("jobs", watermark, decodePhase4Cursor(null, watermark), 1);
  const first = db.prepare(firstQuery.sql).all(...firstQuery.binds);
  assert.deepEqual(first.map((row) => row.id), ["a"]);
  const cursor = phase4NextCursor("jobs", first);
  const secondQuery = phase4DeltaQuery("jobs", watermark, decodePhase4Cursor(cursor, watermark), 1);
  const second = db.prepare(secondQuery.sql).all(...secondQuery.binds);
  assert.deepEqual(second.map((row) => row.id), ["b"]);
  const repeat = db.prepare(secondQuery.sql).all(...secondQuery.binds);
  assert.deepEqual(repeat.map((row) => row.id), ["b"]);
});

test("Phase 4 object authorization uses normalized D1 timestamps", () => {
  const db = createPhase4Sqlite();
  db.exec(`
    INSERT INTO jobs(id, status, created_at, updated_at, html_key) VALUES
      ('job-after', 'complete', '2026-08-21 02:33:57', '2026-08-21 02:37:16', 'library/reels/job-after/index.html');
    INSERT INTO artifacts(id, job_id, kind, object_key, content_type, byte_size, sha256, created_at) VALUES
      ('artifact-after', 'job-after', 'html', 'library/reels/job-after/index.html', 'text/html', '1', 'sha', '2026-08-21 02:37:16');
  `);
  const query = phase4ObjectAccessQuery("library/reels/job-after/index.html", "2026-08-21T01:42:46.000Z");
  const rows = db.prepare(query.sql).all(...query.binds);
  assert.equal(rows.some((row) => row.object_key === "library/reels/job-after/index.html"), true);
});

test("Phase 4 replay scope is bounded to exactly completed historical job-linked rows", () => {
  const db = createPhase4Sqlite();
  db.exec(`
    INSERT INTO jobs(id, status, created_at, updated_at, shortcode) VALUES
      ('before-replay', 'complete', '2026-08-19 04:19:56', '2026-08-19 04:20:00', 'before-replay'),
      ('historical-complete', 'complete', '2026-08-19 04:19:57', '2026-08-19 04:21:00', 'historical-complete'),
      ('historical-failed', 'failed', '2026-08-19 05:30:00', '2026-08-19 05:31:00', 'historical-failed'),
      ('live-complete', 'complete', '2026-08-21 02:33:57', '2026-08-21 02:37:16', 'live-complete');
    INSERT INTO artifacts(id, job_id, kind, object_key, content_type, byte_size, sha256, created_at) VALUES
      ('artifact-before', 'before-replay', 'html', 'before.html', 'text/html', '1', 'sha', '2026-08-19 04:20:00'),
      ('artifact-historical', 'historical-complete', 'html', 'historical.html', 'text/html', '1', 'sha', '2026-08-19 05:20:00'),
      ('artifact-live', 'live-complete', 'html', 'live.html', 'text/html', '1', 'sha', '2026-08-21 02:37:16');
  `);
  const replayScope = phase4MirrorScopeForToken("replay-token", "live-token", "replay-token");
  const jobs = db.prepare(phase4DeltaQuery("jobs", PHASE4_REPLAY_WATERMARK, decodePhase4Cursor(null, PHASE4_REPLAY_WATERMARK), 10, replayScope).sql)
    .all(...phase4DeltaQuery("jobs", PHASE4_REPLAY_WATERMARK, decodePhase4Cursor(null, PHASE4_REPLAY_WATERMARK), 10, replayScope).binds);
  assert.deepEqual(jobs.map((row) => row.id), ["historical-complete"]);
  const artifactsQuery = phase4DeltaQuery("artifacts", PHASE4_REPLAY_WATERMARK, decodePhase4Cursor(null, PHASE4_REPLAY_WATERMARK), 10, replayScope);
  const artifacts = db.prepare(artifactsQuery.sql).all(...artifactsQuery.binds);
  assert.deepEqual(artifacts.map((row) => row.id), ["artifact-historical"]);
});
