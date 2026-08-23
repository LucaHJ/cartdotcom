import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const control = readFileSync(new URL("../scripts/phase6_dispatch_control.py", import.meta.url), "utf8");
const dispatcher = readFileSync(new URL("../scripts/phase6_dispatcher.py", import.meta.url), "utf8");
const authority = readFileSync(new URL("../scripts/phase6_authority.py", import.meta.url), "utf8");
const watchdog = readFileSync(new URL("../scripts/phase6_dispatcher_watchdog.sh", import.meta.url), "utf8");
const soak = readFileSync(new URL("../scripts/phase6_soak_monitor.py", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../phase5-runner/Dockerfile", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0006_phase6_processing_authority.sql", import.meta.url), "utf8");

test("Phase 6 control keeps credentials inside the control container", () => {
  assert.match(control, /REEL_PHASE5_ADMIN_TOKEN_FILE/);
  assert.match(control, /Phase 6 Worker control token file must be mode 0600/);
  assert.match(control, /phase6-local-worker-1/);
  assert.match(control, /local_job_ready/);
  assert.match(control, /insert_local_lease/);
  assert.match(control, /release_candidate/);
  assert.match(control, /claim-next/);
  assert.doesNotMatch(control, /print\(.*token|PGPASSWORD|docker\.sock|privileged/);
  assert.match(dockerfile, /phase6_dispatch_control\.py/);
});

test("Phase 6 host dispatcher is serial, credential-free and reuses exact orchestration", () => {
  assert.match(dispatcher, /fcntl\.LOCK_EX \| fcntl\.LOCK_NB/);
  assert.match(dispatcher, /phase5_one_job_orchestrator\.py/);
  assert.match(dispatcher, /claim-next/);
  assert.match(dispatcher, /--once/);
  assert.match(dispatcher, /--lease-owner/);
  assert.doesNotMatch(dispatcher, /read_text|Bearer |PGPASSWORD|sk-[A-Za-z0-9]/);
});

test("Phase 6 local authority migration preserves backlog-off state", () => {
  assert.match(migration, /processing_authority_events/);
  assert.match(migration, /cutover_watermark/);
  assert.match(migration, /generation/);
  assert.match(migration, /backlog remains disabled/);
});

test("Phase 6 authority wrapper provides one-command transition and rollback without reading secrets", () => {
  assert.match(authority, /rollback-cloud/);
  assert.match(authority, /authority-transition/);
  assert.match(authority, /authority-cloud/);
  assert.match(authority, /--volume/);
  assert.doesNotMatch(authority, /read_text|Bearer |PGPASSWORD|sk-[A-Za-z0-9]/);
});

test("Phase 6 dispatcher watchdog is reboot-safe and authority-aware", () => {
  assert.match(watchdog, /processing_authority/);
  assert.match(watchdog, /phase6-generation/);
  assert.match(watchdog, /authority.*!= "self_hosted"/s);
  assert.match(watchdog, /\/proc\/\$pid\/cmdline/);
  assert.match(watchdog, /flock -n/);
  assert.match(watchdog, /nohup python3/);
  assert.doesNotMatch(watchdog, /Bearer |PGPASSWORD|sk-[A-Za-z0-9]/);
});

test("Phase 6 soak monitor preserves the full gate and checks critical regressions", () => {
  assert.match(soak, /timedelta\(days=7\)/);
  assert.match(soak, /completed_jobs_since_watermark/);
  assert.match(soak, /duplicate_completion_jobs/);
  assert.match(soak, /publication_drift/);
  assert.match(soak, /stale_leases/);
  assert.match(soak, /container_health/);
  assert.match(soak, /backlog_enabled/);
  assert.match(soak, /concurrency_exceeded/);
  assert.doesNotMatch(soak, /Bearer |PGPASSWORD|sk-[A-Za-z0-9]/);
});
