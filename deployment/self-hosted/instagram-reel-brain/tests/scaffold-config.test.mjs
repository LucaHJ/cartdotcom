import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const compose = readFileSync(new URL("compose.yaml", root), "utf8");
const envExample = readFileSync(new URL(".env.example", root), "utf8");
const migration = readFileSync(new URL("migrations/0001_phase1_inert_schema.sql", root), "utf8");

test("compose declares only isolated reel networks", () => {
  assert.match(compose, /cartdotcom-reel-runtime/);
  assert.match(compose, /cartdotcom-reel-egress/);
  assert.doesNotMatch(compose, /cartdotcom-edge/);
  assert.doesNotMatch(compose, /cartdotcom-data/);
  assert.doesNotMatch(compose, /ports:/);
});

test("compose keeps every operational flag disabled", () => {
  for (const key of [
    "REEL_INTAKE_ENABLED",
    "REEL_DISPATCH_ENABLED",
    "REEL_WORKER_ENABLED",
    "REEL_CODEX_ENABLED",
    "REEL_OUTBOUND_ENABLED",
    "REEL_MUTATIONS_ENABLED",
    "REEL_BACKLOG_ENABLED",
    "REEL_PUBLISHER_ENABLED",
    "REEL_ARCHIVER_ENABLED",
    "REEL_AUTH_ROTATOR_ENABLED"
  ]) {
    assert.match(compose, new RegExp(`${key}: "\\$\\{${key}:-false\\}"`));
    assert.match(envExample, new RegExp(`${key}=false`));
  }
  assert.match(compose, /REEL_WORKER_CONCURRENCY: "\$\{REEL_WORKER_CONCURRENCY:-1\}"/);
  assert.match(envExample, /REEL_WORKER_CONCURRENCY=1/);
});

test("compose resource ceilings remain under phase one limits", () => {
  const memoryMiB = [...compose.matchAll(/mem_limit: (\d+)([mg])/g)].reduce((sum, match) => {
    const value = Number(match[1]);
    return sum + (match[2] === "g" ? value * 1024 : value);
  }, 0);
  const cpus = [...compose.matchAll(/cpus: ([0-9.]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);

  assert.ok(memoryMiB <= 2560, `memory limit ${memoryMiB} MiB exceeds 2560 MiB`);
  assert.ok(cpus <= 2, `cpu limit ${cpus} exceeds 2`);
});

test("all services have pid and no-new-privileges constraints", () => {
  const serviceCount = (compose.match(/REEL_SERVICE_NAME:/g) || []).length;
  assert.equal(serviceCount, 6);
  assert.equal((compose.match(/pids_limit: 128/g) || []).length, 1);
  assert.match(compose, /no-new-privileges:true/);
});

test("phase one database migration creates only inert authority state", () => {
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS reel_brain/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS reel_brain\.processing_authority/);
  assert.match(migration, /'cloud'/);
  assert.match(migration, /false,\s*false,\s*false,\s*false/s);
  assert.doesNotMatch(migration, /COPY\s/i);
});
