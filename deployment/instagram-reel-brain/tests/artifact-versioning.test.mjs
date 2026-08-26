import assert from "node:assert/strict";
import test from "node:test";

import { completionSynthesisObjectKey } from "../src/domain.ts";

test("completion output uses a distinct immutable key beside an attempt synthesis", () => {
  assert.equal(
    completionSynthesisObjectKey({
      jobId: "job-1",
      shortcode: "ABC123",
      currentSynthesisKey: "reels/ABC123/job-1/synthesis/attempt-2/synthesis.json",
    }),
    "reels/ABC123/job-1/synthesis/attempt-2/result.json",
  );
});

test("completion output preserves the legacy key when no attempt artifact exists", () => {
  assert.equal(
    completionSynthesisObjectKey({ jobId: "job-1", shortcode: "ABC123", currentSynthesisKey: null }),
    "reels/ABC123/job-1/synthesis/result.json",
  );
});
