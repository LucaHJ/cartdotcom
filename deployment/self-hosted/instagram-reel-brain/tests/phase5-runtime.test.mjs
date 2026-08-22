import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const compose = readFileSync(new URL("compose.yaml", root), "utf8");
const dockerfile = readFileSync(new URL("phase5-runner/Dockerfile", root), "utf8");
const probe = readFileSync(new URL("phase5-runner/phase5_runner_probe.py", root), "utf8");
const readme = readFileSync(new URL("phase5-runner/README.md", root), "utf8");
const packagedProcessor = readFileSync(new URL("phase5-runner/container/app.py", root));
const cloudProcessorUrl = new URL("../../instagram-reel-brain/container/app.py", root);
const cloudProcessor = existsSync(cloudProcessorUrl) ? readFileSync(cloudProcessorUrl) : null;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("Phase 5 runner image pins the existing processor runtime dependencies", () => {
  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  assert.match(dockerfile, /ARG CODEX_CLI_VERSION=0\.147\.0/);
  assert.match(dockerfile, /npm install --global "@openai\/codex@\$\{CODEX_CLI_VERSION\}"/);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends ca-certificates ffmpeg git python3 python3-pip/);
  assert.match(dockerfile, /COPY phase5-runner\/container\/requirements\.txt/);
  assert.match(dockerfile, /COPY phase5-runner\/container\/app\.py \/opt\/reel\/processor\/app\.py/);
  assert.match(dockerfile, /COPY scripts\/phase5_one_job_runner\.py/);
  assert.match(dockerfile, /USER node/);
  assert.doesNotMatch(dockerfile, /INSTAGRAM_|sk-[A-Za-z0-9]|Bearer [A-Za-z0-9_\-.]{16,}/);
});

test("Phase 5 runner packages the exact current cloud processor code", { skip: cloudProcessor === null ? "cloud processor sibling path is absent in isolated server copy" : false }, () => {
  assert.ok(cloudProcessor);
  assert.equal(sha256(packagedProcessor), sha256(cloudProcessor));
});

test("Phase 5 runner Compose service is profile-gated, isolated and read-only where practical", () => {
  assert.match(compose, /phase5-runner:/);
  assert.match(compose, /profiles: \["phase5-runner"\]/);
  assert.match(compose, /context: \./);
  assert.match(compose, /dockerfile: phase5-runner\/Dockerfile/);
  assert.match(compose, /restart: "no"/);
  assert.match(compose, /REEL_PHASE5_RUNNER_ENABLED: "\$\{REEL_PHASE5_RUNNER_ENABLED:-false\}"/);
  assert.match(compose, /CODEX_HOME: \/home\/node\/\.codex/);
  assert.match(compose, /CODEX_AUTH_SOURCE: \/codex-auth\/auth\.json/);
  assert.match(compose, /source: \/home\/lucaj\/\.codex\/auth\.json\s+target: \/codex-auth\/auth\.json\s+read_only: true/s);
  assert.match(compose, /target: \/work/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /reel-runtime/);
  assert.match(compose, /reel-egress/);
  assert.doesNotMatch(compose, /cartdotcom-edge|cartdotcom-data|INSTAGRAM_COOKIES|INSTAGRAM_ACCESS_TOKEN/);
});

test("Phase 5 runner probe exercises only inert, fixture, fail-closed and redacted auth paths", () => {
  assert.match(probe, /def fixture_media/);
  assert.match(probe, /CODEX_FAKE_RESPONSE/);
  assert.match(probe, /inspect_and_extract/);
  assert.match(probe, /def codex_smoke/);
  assert.match(probe, /diagnostic_sha256/);
  assert.match(probe, /def runner_fail_closed/);
  assert.match(probe, /failed_before_cloud_or_processor/);
  assert.match(probe, /instagram_secret_env_present/);
  assert.doesNotMatch(probe, /print\(.*auth|read_text\(.*auth_file|Bearer [A-Za-z0-9_\-.]{16,}|sk-[A-Za-z0-9]/);
});

test("Phase 5 runner documentation keeps the runtime inert by default", () => {
  assert.match(readme, /profile/);
  assert.match(readme, /restart` is disabled/);
  assert.match(readme, /read-only/);
  assert.match(readme, /must not be\s+used for backlog or general worker execution/);
});
