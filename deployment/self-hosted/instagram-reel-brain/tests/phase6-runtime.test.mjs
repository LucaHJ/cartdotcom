import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const control = readFileSync(new URL("../scripts/phase6_dispatch_control.py", import.meta.url), "utf8");
const dispatcher = readFileSync(new URL("../scripts/phase6_dispatcher.py", import.meta.url), "utf8");
const authority = readFileSync(new URL("../scripts/phase6_authority.py", import.meta.url), "utf8");
const watchdog = readFileSync(new URL("../scripts/phase6_dispatcher_watchdog.sh", import.meta.url), "utf8");
const mirrorWatchdog = readFileSync(new URL("../scripts/phase4_mirror_watchdog.sh", import.meta.url), "utf8");
const soak = readFileSync(new URL("../scripts/phase6_soak_monitor.py", import.meta.url), "utf8");
const performance = readFileSync(new URL("../scripts/phase6_performance_report.py", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../phase5-runner/Dockerfile", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0006_phase6_processing_authority.sql", import.meta.url), "utf8");
const concurrencyMigration = readFileSync(new URL("../migrations/0007_phase6_concurrency_two.sql", import.meta.url), "utf8");
const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
const processor = readFileSync(new URL("../phase5-runner/container/app.py", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../../instagram-reel-brain/src/index.ts", import.meta.url), "utf8");

test("Phase 6 control keeps credentials inside the control container", () => {
  assert.match(control, /REEL_PHASE5_ADMIN_TOKEN_FILE/);
  assert.match(control, /Phase 6 Worker control token file must be mode 0600/);
  assert.match(control, /phase6-local-worker-1/);
  assert.match(control, /local_job_ready/);
  assert.match(control, /insert_local_lease/);
  assert.match(control, /release_candidate/);
  assert.match(control, /allowed_error_statuses=\(409,\)/);
  assert.match(control, /recoverable_active/);
  assert.match(control, /inserted == 1 and events == 1/);
  assert.match(control, /claim-next/);
  assert.match(control, /retry-job/);
  assert.match(control, /fail-job/);
  assert.match(control, /phase5_pilot_leases\.status='rolled_back'/);
  assert.doesNotMatch(control, /print\(.*token|PGPASSWORD|docker\.sock|privileged/);
  assert.match(dockerfile, /phase6_dispatch_control\.py/);
});

test("Phase 6 host dispatcher provides two isolated credential-free slots", () => {
  assert.match(dispatcher, /fcntl\.LOCK_EX \| fcntl\.LOCK_NB/);
  assert.match(dispatcher, /phase5_one_job_orchestrator\.py/);
  assert.match(dispatcher, /claim-next/);
  assert.match(dispatcher, /--once/);
  assert.match(dispatcher, /--lease-owner/);
  assert.match(dispatcher, /--abort-on-compute-failure/);
  assert.match(dispatcher, /aborted_after_compute_failure/);
  assert.match(dispatcher, /terminal_failure_after_prepublication_abort/);
  assert.match(dispatcher, /--attempt-key/);
  assert.match(dispatcher, /candidate\.get\('attempts'\)/);
  assert.match(dispatcher, /pass_fds=\(lock_fd,\)/);
  assert.match(dispatcher, /prefetch-next/);
  assert.match(dispatcher, /job_stage.*synthesizing/s);
  assert.match(dispatcher, /phase6-performance\.jsonl/);
  assert.match(dispatcher, /MAX_CONCURRENCY = 2/);
  assert.match(dispatcher, /phase6-dispatcher-slot-\{args\.slot\}\.lock/);
  assert.match(dispatcher, /phase6-prefetch\.lock/);
  assert.match(dispatcher, /queue_wait_seconds/);
  assert.match(dispatcher, /control_handover_seconds/);
  assert.doesNotMatch(dispatcher, /admin_token_host_file\).*read_text|Bearer |PGPASSWORD|sk-[A-Za-z0-9]/s);
});

test("Phase 6 local lease capacity is race-safe and owner-scoped", () => {
  assert.match(control, /MAX_CONCURRENCY = 2/);
  assert.match(control, /pg_advisory_xact_lock/);
  assert.match(control, /count\(\*\).*status IN \('leased','processing'\)/s);
  assert.match(concurrencyMigration, /DROP INDEX IF EXISTS reel_brain\.phase5_pilot_leases_one_active_idx/);
  assert.match(concurrencyMigration, /phase6_pilot_leases_active_owner_idx/);
});

test("Phase 6 prefetch overlaps only read-only Reel acquisition with synthesis", () => {
  assert.match(worker, /handlePhase6PrefetchNext/);
  assert.match(worker, /handlePhase6Retry/);
  assert.match(worker, /handlePhase6TerminalFailure/);
  assert.match(worker, /phase6_terminal_failure/);
  assert.match(worker, /f\.status='armed'/);
  assert.match(worker, /j\.status='queued'/);
  assert.match(worker, /j\.source_url LIKE '%\/reel\/%'/);
  assert.match(worker, /active\.job_stage !== "synthesizing"/);
  assert.match(processor, /PREFETCH_MANIFEST_VERSION/);
  assert.match(processor, /file_sha256/);
  assert.match(processor, /load_prefetched_media/);
  assert.match(processor, /prefetch_hit/);
  assert.match(compose, /phase5-compute:[\s\S]*?cpus: 0\.50/);
  assert.match(compose, /phase6-prefetch:[\s\S]*?cpus: 0\.25/);
  const cpuLimits = [...compose.matchAll(/cpus:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  assert.ok(cpuLimits.reduce((sum, value) => sum + value, 0) <= 2, "declared Reel CPU limits must stay within two cores");
  assert.doesNotMatch(compose.match(/phase6-prefetch:[\s\S]*?(?=\nnetworks:)/)?.[0] || "", /codex-auth|control-secrets|platform-data/);
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
  assert.match(watchdog, /CONCURRENCY=2/);
  assert.match(watchdog, /phase6-dispatcher-\$slot\.pid/);
  assert.match(watchdog, /--slot "\$slot"/);
  assert.doesNotMatch(watchdog, /Bearer |PGPASSWORD|sk-[A-Za-z0-9]/);
});

test("Phase 6 handover uses bounded low-latency mirror and dispatcher polling", () => {
  assert.match(mirrorWatchdog, /MIRROR_POLL_SECONDS=15/);
  assert.match(mirrorWatchdog, /--interval-seconds "\$MIRROR_POLL_SECONDS"/);
  assert.match(dispatcher, /--poll-seconds", type=int, default=10/);
  assert.doesNotMatch(mirrorWatchdog, /--interval-seconds 300/);
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
  assert.match(soak, /CURRENT_CONCURRENCY = 2/);
  assert.match(performance, /"download_seconds": "download_seconds"/);
  assert.match(performance, /"control_handover_seconds": "control_handover_seconds"/);
  assert.match(performance, /peak_overlap/);
  assert.doesNotMatch(soak, /Bearer |PGPASSWORD|sk-[A-Za-z0-9]/);
});
