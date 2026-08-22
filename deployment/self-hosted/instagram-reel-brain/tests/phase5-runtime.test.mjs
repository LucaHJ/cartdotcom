import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const compose = readFileSync(new URL("compose.yaml", root), "utf8");
const dockerfile = readFileSync(new URL("phase5-runner/Dockerfile", root), "utf8");
const probe = readFileSync(new URL("phase5-runner/phase5_runner_probe.py", root), "utf8");
const readme = readFileSync(new URL("phase5-runner/README.md", root), "utf8");
const runner = readFileSync(new URL("scripts/phase5_one_job_runner.py", root), "utf8");
const stagedRunner = readFileSync(new URL("scripts/phase5_staged_runner.py", root), "utf8");
const orchestrator = readFileSync(new URL("scripts/phase5_one_job_orchestrator.py", root), "utf8");
const packagedProcessor = readFileSync(new URL("phase5-runner/container/app.py", root));
const requirements = readFileSync(new URL("phase5-runner/container/requirements.txt", root), "utf8");
const cloudProcessorUrl = new URL("../../instagram-reel-brain/container/app.py", root);
const cloudProcessor = existsSync(cloudProcessorUrl) ? readFileSync(cloudProcessorUrl) : null;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function serviceBlock(name) {
  const pattern = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|\\nnetworks:)`);
  const match = compose.match(pattern);
  assert.ok(match, `${name} service is present`);
  return match[1];
}

test("Phase 5 runner image pins the existing processor runtime dependencies", () => {
  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  assert.match(dockerfile, /ARG CODEX_CLI_VERSION=0\.147\.0/);
  assert.match(dockerfile, /npm install --global "@openai\/codex@\$\{CODEX_CLI_VERSION\}"/);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends ca-certificates ffmpeg git python3 python3-pip/);
  assert.match(requirements, /psycopg\[binary\]==3\.2\.9/);
  assert.match(dockerfile, /COPY phase5-runner\/container\/requirements\.txt/);
  assert.match(dockerfile, /COPY phase5-runner\/container\/app\.py \/opt\/reel\/processor\/app\.py/);
  assert.match(dockerfile, /COPY scripts\/phase5_one_job_runner\.py/);
  assert.match(dockerfile, /COPY scripts\/phase5_staged_runner\.py/);
  assert.match(dockerfile, /USER node/);
  assert.doesNotMatch(dockerfile, /INSTAGRAM_|sk-[A-Za-z0-9]|Bearer [A-Za-z0-9_\-.]{16,}/);
  assert.doesNotMatch(dockerfile, /openssh-client|docker\.io|docker-ce|postgresql-client/);
});

test("Phase 5 runner packages the exact current cloud processor code", { skip: cloudProcessor === null ? "cloud processor sibling path is absent in isolated server copy" : false }, () => {
  assert.ok(cloudProcessor);
  assert.equal(sha256(packagedProcessor), sha256(cloudProcessor));
});

test("Phase 5 Compose splits control secrets from the Codex/media compute boundary", () => {
  const control = serviceBlock("phase5-control");
  const compute = serviceBlock("phase5-compute");

  for (const block of [control, compute]) {
    assert.match(block, /profiles: \["phase5-runner"\]/);
    assert.match(block, /context: \./);
    assert.match(block, /dockerfile: phase5-runner\/Dockerfile/);
    assert.match(block, /restart: "no"/);
    assert.match(block, /REEL_PHASE5_RUNNER_ENABLED: "\$\{REEL_PHASE5_RUNNER_ENABLED:-false\}"/);
    assert.match(block, /target: \/work/);
    assert.match(block, /read_only: true/);
    assert.match(block, /no-new-privileges:true/);
  }

  assert.match(control, /REEL_SERVICE_NAME: phase5-control/);
  assert.match(control, /REEL_PHASE5_ROLE: control/);
  assert.match(control, /REEL_PHASE5_PG_MODE: native/);
  assert.match(control, /REEL_PHASE5_PG_PASSWORD_FILE: \/run\/control-secrets\/postgres_password/);
  assert.match(control, /REEL_PHASE5_ADMIN_TOKEN_FILE: \/run\/control-secrets\/phase5_admin_token/);
  assert.match(control, /REEL_PHASE5_PROCESSOR_PATH: ""/);
  assert.match(control, /CODEX_AUTH_SOURCE: ""/);
  assert.match(control, /CODEX_HOME: \/tmp\/no-codex-home/);
  assert.match(control, /source: \/srv\/platform\/secrets\/postgres_password\s+target: \/run\/control-secrets\/postgres_password\s+read_only: true/s);
  assert.match(control, /target: \/runs\/control/);
  assert.match(control, /target: \/runs\/compute\s+read_only: true/s);
  assert.match(control, /platform-data/);
  assert.doesNotMatch(control, /\/codex-auth\/auth\.json/);

  assert.match(compute, /REEL_SERVICE_NAME: phase5-compute/);
  assert.match(compute, /REEL_PHASE5_ROLE: compute/);
  assert.match(compute, /CODEX_HOME: \/home\/node\/\.codex/);
  assert.match(compute, /CODEX_AUTH_SOURCE: \/codex-auth\/auth\.json/);
  assert.match(compute, /source: \/home\/lucaj\/\.codex\/auth\.json\s+target: \/codex-auth\/auth\.json\s+read_only: true/s);
  assert.match(compute, /target: \/runs\/control\s+read_only: true/s);
  assert.match(compute, /target: \/runs\/compute/);
  assert.match(compute, /reel-egress/);
  assert.doesNotMatch(compute, /REEL_PHASE5_PG|REEL_PHASE5_ADMIN_TOKEN|postgres_password|phase5_admin_token|platform-data|cartdotcom-data/);

  assert.match(compose, /platform-data:\s+name: cartdotcom-data\s+external: true/s);
  assert.doesNotMatch(compose, /cartdotcom-edge|docker\.sock|privileged: true|INSTAGRAM_COOKIES|INSTAGRAM_ACCESS_TOKEN/);
});

test("Phase 5 runner probe exercises only inert, fixture, fail-closed and redacted auth paths", () => {
  assert.match(probe, /def fixture_media/);
  assert.match(probe, /CODEX_FAKE_RESPONSE/);
  assert.match(probe, /inspect_and_extract/);
  assert.match(probe, /def codex_smoke/);
  assert.match(probe, /diagnostic_sha256/);
  assert.match(probe, /def runner_fail_closed/);
  assert.match(probe, /def native_control_probe/);
  assert.match(probe, /def fake_worker_control_probe/);
  assert.match(probe, /def control_fail_closed_probe/);
  assert.match(probe, /def control_secret_canary_probe/);
  assert.match(probe, /def compute_secret_canary_probe/);
  assert.match(probe, /codex_subprocess_env/);
  assert.match(probe, /spawned_shell_cannot_stat_read_hash/);
  assert.match(probe, /failed_before_cloud_or_processor/);
  assert.match(probe, /processor_loaded/);
  assert.match(probe, /instagram_secret_env_present/);
  assert.doesNotMatch(probe, /print\(.*auth|read_text\(.*auth_file|Bearer [A-Za-z0-9_\-.]{16,}|sk-[A-Za-z0-9]/);
});

test("Phase 5 runner selects native PostgreSQL in the container and keeps SSH/Docker legacy explicit", () => {
  assert.match(runner, /--pg-mode/);
  assert.match(runner, /choices=\("auto", "native", "legacy-ssh"\)/);
  assert.match(runner, /def native_pg_connection/);
  assert.match(runner, /import psycopg/);
  assert.match(runner, /--pg-password-file/);
  assert.match(runner, /PostgreSQL password file/);
  assert.match(runner, /def legacy_ssh_psql_json/);
  assert.match(runner, /legacy PostgreSQL mode requires ssh/);
  assert.match(runner, /legacy local PostgreSQL mode requires docker/);
  assert.match(runner, /native PostgreSQL mode requires --pg-password-file/);
  assert.match(runner, /allow_admin_token_env/);
  assert.match(runner, /Worker admin token is required via --admin-token-file/);
  assert.doesNotMatch(runner, /print\(.*token|print\(.*password|PGPASSWORD|password=.*argv|sk-[A-Za-z0-9]|Bearer [A-Za-z0-9_\-.]{16,}/);
});

test("Phase 5 split runtime has a host orchestrator and staged control/compute commands", () => {
  assert.match(stagedRunner, /control-start/);
  assert.match(stagedRunner, /compute-run/);
  assert.match(stagedRunner, /control-finalize/);
  assert.match(stagedRunner, /control-abort/);
  assert.match(stagedRunner, /CHECKPOINT_VERSION = 2/);
  assert.match(stagedRunner, /COMPUTE_RESULT_VERSION = 1/);
  assert.match(stagedRunner, /STAGE_ORDER/);
  assert.match(stagedRunner, /hmac-sha256-v1/);
  assert.match(stagedRunner, /control checkpoint signature mismatch/);
  assert.match(stagedRunner, /compute result control-state digest mismatch/);
  assert.match(stagedRunner, /compute role may not write control state/);
  assert.match(stagedRunner, /stage regression refused/);
  assert.match(stagedRunner, /phase5-control role cannot load|control role may not load/);
  assert.match(stagedRunner, /compute environment contains control-plane variables/);
  assert.match(stagedRunner, /pre-publication abort refused after processor completion/);
  assert.match(stagedRunner, /callback authority is expired or below the minimum safe processing window/);
  assert.match(stagedRunner, /processor result job_id mismatch/);
  assert.match(stagedRunner, /os\.chmod\(path\.parent, 0o700\)/);
  assert.match(stagedRunner, /os\.chmod\(path, 0o600\)/);
  assert.doesNotMatch(stagedRunner, /docker\.sock|privileged|PGPASSWORD|sk-[A-Za-z0-9]|Bearer [A-Za-z0-9_\-.]{16,}/);

  assert.match(orchestrator, /phase5-control/);
  assert.match(orchestrator, /phase5-compute/);
  assert.match(orchestrator, /--entrypoint", "python3"/);
  assert.match(orchestrator, /docker_network_gateway/);
  assert.match(orchestrator, /cartdotcom-reel-egress/);
  assert.match(orchestrator, /control-start/);
  assert.match(orchestrator, /compute-run/);
  assert.match(orchestrator, /control-finalize/);
  assert.match(orchestrator, /control-abort/);
  assert.match(orchestrator, /synthetic-case/);
  assert.match(orchestrator, /after-processor-before-checkpoint/);
  assert.match(orchestrator, /after-cloud-finalize-before-local-complete/);
  assert.match(orchestrator, /short-authority/);
  assert.match(orchestrator, /tampered-checkpoint/);
  assert.match(orchestrator, /tampered-result/);
  assert.match(orchestrator, /compute-control-readonly/);
  assert.doesNotMatch(orchestrator, /read_checkpoint_stage|stage_at_least/);
  assert.match(orchestrator, /"--volume", f"\{token_host_file\}:\{CONTAINER_TOKEN_PATH\}:ro"/);
  assert.doesNotMatch(orchestrator, /--add-host|docker\.sock|privileged|PGPASSWORD|sk-[A-Za-z0-9]|Bearer [A-Za-z0-9_\-.]{16,}/);
});

test("Phase 5 processor sanitizes the Codex subprocess environment", () => {
  const processorText = packagedProcessor.toString("utf8");
  assert.match(processorText, /def codex_subprocess_env/);
  assert.match(processorText, /allowed_keys = \(/);
  assert.match(processorText, /env=codex_subprocess_env\(codex_home\)/);
  assert.doesNotMatch(processorText, /env=\{\*\*os\.environ, "CODEX_HOME"/);
  assert.doesNotMatch(processorText, /REEL_PHASE5_PG_PASSWORD_FILE.*codex_subprocess_env/s);
  assert.doesNotMatch(processorText, /REEL_PHASE5_ADMIN_TOKEN_FILE.*codex_subprocess_env/s);
});

test("Phase 5 runner documentation keeps the runtime inert by default", () => {
  assert.match(readme, /profile/);
  assert.match(readme, /restart` is disabled/);
  assert.match(readme, /read-only/);
  assert.match(readme, /must not be used\s+for backlog or general worker execution/);
  assert.match(readme, /native PostgreSQL/);
  assert.match(readme, /phase5-control/);
  assert.match(readme, /phase5-compute/);
  assert.match(readme, /phase5_admin_token/);
  assert.match(readme, /phase5_one_job_orchestrator\.py/);
  assert.match(readme, /control-start/);
  assert.match(readme, /compute-run/);
  assert.match(readme, /control-finalize/);
  assert.doesNotMatch(readme, /requires a host-side exact, confirmed one-shot\s+wrapper that invokes control/);
});
