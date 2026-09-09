import assert from "node:assert/strict";
import test from "node:test";
import { phase7WakeNeeded } from "../src/phase7-wake.ts";

test("Phase 7 wake excludes read-only POST compatibility routes", () => {
  for (const path of [
    "/integration/reel-library/status",
    "/integration/reel-library/jobs/job-1/video",
    "/integration/reel-library/jobs/job-1/audio",
    "/integration/reel-library/jobs/job-1/carousel",
    "/integration/reel-library/jobs/job-1/thumbnail",
  ]) assert.equal(phase7WakeNeeded("POST", path, 200), false, path);
});

test("Phase 7 wake retains real mutation and intake routes", () => {
  for (const path of [
    "/instagram/webhook",
    "/internal/jobs/job-1/stage",
    "/internal/jobs/job-1/artifacts/frame",
    "/api/admin/phase6/claim",
  ]) assert.equal(phase7WakeNeeded("POST", path, 202), true, path);
});

test("Phase 7 wake rejects reads and failed mutations", () => {
  assert.equal(phase7WakeNeeded("GET", "/internal/jobs/job-1/stage", 200), false);
  assert.equal(phase7WakeNeeded("POST", "/internal/jobs/job-1/stage", 503), false);
});
