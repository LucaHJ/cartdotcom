import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalArtifactKey, artifactLibraryPath, mergeArtifactSources } from "../src/domain/artifacts.js";
import { assertPhase2FixtureAuthority, authorityFromEnv, AuthorityFenceError, PHASE2_PROHIBITED_FLAGS } from "../src/domain/authority.js";
import { carouselManifest, validateCarouselManifest } from "../src/domain/carousel.js";
import {
  canonicalizeInstagramUrl,
  classifyInstagramMediaPayload,
  instagramDedupeKey,
  pendingPartIsTest,
  queueDelaySecondsForAdjacentInstruction,
  rankComments,
  shouldCreateLiveInstructionTarget,
  shouldStoreLiveInstructionCandidate,
} from "../src/domain/instagram.js";

test("Phase 2 authority fence keeps production authority cloud-owned and execution flags disabled", () => {
  const state = authorityFromEnv({
    REEL_PHASE: "phase2-local-fixtures",
    REEL_PROCESSING_AUTHORITY: "cloud",
    REEL_DISPATCH_ENABLED: "false",
    REEL_CODEX_ENABLED: "false",
    REEL_OUTBOUND_ENABLED: "false",
    REEL_BACKLOG_ENABLED: "false",
  });
  assert.doesNotThrow(() => assertPhase2FixtureAuthority(state, "fixture-test"));

  const enabled = authorityFromEnv({ REEL_PROCESSING_AUTHORITY: "cloud", REEL_CODEX_ENABLED: "true" });
  assert.throws(() => assertPhase2FixtureAuthority(enabled, "codex"), AuthorityFenceError);

  const local = authorityFromEnv({ REEL_PROCESSING_AUTHORITY: "self_hosted" });
  assert.throws(() => assertPhase2FixtureAuthority(local, "dispatch"), AuthorityFenceError);
});

test("Phase 2 authority fence rejects every prohibited execution and mutation flag individually", () => {
  const envNames = {
    intake: "REEL_INTAKE_ENABLED",
    dispatch: "REEL_DISPATCH_ENABLED",
    worker: "REEL_WORKER_ENABLED",
    codex: "REEL_CODEX_ENABLED",
    outbound: "REEL_OUTBOUND_ENABLED",
    mutations: "REEL_MUTATIONS_ENABLED",
    backlog: "REEL_BACKLOG_ENABLED",
    publisher: "REEL_PUBLISHER_ENABLED",
    archiver: "REEL_ARCHIVER_ENABLED",
    authRotator: "REEL_AUTH_ROTATOR_ENABLED",
  };
  assert.deepEqual([...PHASE2_PROHIBITED_FLAGS].sort(), Object.keys(envNames).sort());
  for (const [flag, envName] of Object.entries(envNames)) {
    const state = authorityFromEnv({ REEL_PROCESSING_AUTHORITY: "cloud", [envName]: "true" });
    assert.throws(
      () => assertPhase2FixtureAuthority(state, flag),
      (error) => error instanceof AuthorityFenceError && error.detail.flag === flag,
    );
  }
});

test("Instagram domain logic canonicalises, deduplicates, ranks comments, and preserves adjacent-instruction semantics", () => {
  assert.equal(canonicalizeInstagramUrl("https://instagram.com/reel/ABC123/?utm_source=x"), "https://www.instagram.com/reel/ABC123/");
  assert.equal(instagramDedupeKey("https://www.instagram.com/p/XYZ789/"), "instagram:XYZ789");
  assert.equal(queueDelaySecondsForAdjacentInstruction("live"), 12);
  assert.equal(queueDelaySecondsForAdjacentInstruction("test_only"), 0);
  assert.equal(pendingPartIsTest({ mode: "test_only" }), true);
  assert.equal(shouldCreateLiveInstructionTarget({ mode: "live", hasShare: true, instructions: "" }), true);
  assert.equal(shouldStoreLiveInstructionCandidate({ mode: "live", hasShare: false, emptyMessage: false, commandIntent: "unknown" }), true);
  assert.equal(shouldStoreLiveInstructionCandidate({ mode: "live", hasShare: false, emptyMessage: false, commandIntent: "note" }), false);
  assert.deepEqual(rankComments([{ text: "a", like_count: 1 }, { text: "b", like_count: 10 }], 1).map((row) => row.text), ["b"]);
});

test("Instagram media payload classifier recognises native object shares without treating ordinary text as a share", () => {
  assert.equal(classifyInstagramMediaPayload({ text: "status" }).hasShare, false);
  const classified = classifyInstagramMediaPayload({ attachment: { type: "ig_post", url: "https://instagram.com/p/CAROUSEL/" } });
  assert.equal(classified.hasShare, true);
  assert.equal(classified.mediaType, "post");
  assert.deepEqual(classified.urls, ["https://instagram.com/p/CAROUSEL/"]);
});

test("Artifact domain creates one canonical page path and merges multiple Reel sources", () => {
  assert.equal(canonicalArtifactKey({ artifactType: "book", name: "Meditations" }), "book:meditations");
  assert.equal(artifactLibraryPath({ artifactType: "quote", name: "Watering your own grass" }), "quotes/watering-your-own-grass.html");
  assert.equal(
    mergeArtifactSources([{ job_id: "job-1", title: "A" }], { job_id: "job-1", title: "A duplicate" }).length,
    1,
  );
});

test("Carousel fixture creates an ordered all-slide manifest", () => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/synthetic/carousel.json", import.meta.url), "utf8"));
  const manifest = carouselManifest(fixture);
  assert.equal(manifest.slide_count, 2);
  assert.equal(manifest.slides[0].position, 1);
  assert.equal(manifest.slides[0].url, "slides/1.jpg");
  assert.equal(validateCarouselManifest(manifest), true);
});
