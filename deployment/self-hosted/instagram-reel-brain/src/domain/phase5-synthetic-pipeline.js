import { PHASE5_SYNTHETIC_STAGES } from "./phase5-pilot.js";

function artifactKey(jobId, name) {
  return `phase5/synthetic/${jobId}/${name}`;
}

async function writeArtifact(repo, objectStore, jobId, name, body, contentType) {
  const key = artifactKey(jobId, name);
  const written = await objectStore.put(key, body, { contentType });
  await repo.recordArtifactWrite({
    jobId,
    key: written.key,
    checksum: written.checksum,
    byteLength: written.byteLength,
    contentType: written.contentType,
  });
  return written;
}

export async function runSyntheticPhase5Pipeline({
  repo,
  objectStore,
  pilotKey,
  jobId,
  leaseOwner = "phase5-synthetic-worker",
}) {
  if (!repo || !objectStore) throw new TypeError("Synthetic Phase 5 pipeline requires repo and objectStore");

  await repo.markPhase5PilotProcessing({ pilotKey, jobId, leaseOwner });
  await repo.markStage(jobId, "phase5_synthetic_media", "running", "Synthetic media path started");
  const video = await writeArtifact(repo, objectStore, jobId, "original-video.mp4", Buffer.from("synthetic phase5 video"), "video/mp4");
  await repo.insertPhase5PilotEvent(pilotKey, jobId, PHASE5_SYNTHETIC_STAGES[0], "complete", { object_key: video.key });

  await repo.markStage(jobId, "phase5_synthetic_transcription", "running", "Synthetic transcript path started");
  const transcript = await writeArtifact(repo, objectStore, jobId, "transcript.vtt", "WEBVTT\n\n00:00.000 --> 00:02.000\nSynthetic Reel transcript.\n", "text/vtt; charset=utf-8");
  await repo.insertPhase5PilotEvent(pilotKey, jobId, PHASE5_SYNTHETIC_STAGES[1], "complete", { object_key: transcript.key });

  const synthesis = {
    schema_version: "phase5-synthetic-1",
    job_id: jobId,
    title: "Synthetic Phase 5 local pilot Reel",
    summary: "Fixture-only synthesis used to validate the local controlled-compute path.",
    resources: [],
    token_accounting: {
      input: 1200,
      cachedInput: 300,
      output: 450,
      reasoningOutput: 120,
      total: 1650,
    },
  };
  const synthesisJson = await writeArtifact(repo, objectStore, jobId, "synthesis.json", JSON.stringify(synthesis, null, 2), "application/json; charset=utf-8");
  await repo.insertPhase5PilotEvent(pilotKey, jobId, PHASE5_SYNTHETIC_STAGES[2], "complete", { object_key: synthesisJson.key });
  await repo.insertPhase5PilotEvent(pilotKey, jobId, PHASE5_SYNTHETIC_STAGES[3], "complete", synthesis.token_accounting);

  const html = await writeArtifact(
    repo,
    objectStore,
    jobId,
    "index.html",
    `<!doctype html><html><body><h1>${synthesis.title}</h1><p>${synthesis.summary}</p></body></html>`,
    "text/html; charset=utf-8",
  );
  await repo.insertPhase5PilotEvent(pilotKey, jobId, PHASE5_SYNTHETIC_STAGES[4], "ready", { reaction_targeting: "synthetic_only" });
  await repo.insertPhase5PilotEvent(pilotKey, jobId, PHASE5_SYNTHETIC_STAGES[5], "complete", { object_key: html.key });

  const playback = await writeArtifact(repo, objectStore, jobId, "private-playback.json", JSON.stringify({ job_id: jobId, video_key: video.key }), "application/json; charset=utf-8");
  const mirrorReceipt = await writeArtifact(repo, objectStore, jobId, "r2-mirror-receipt.json", JSON.stringify({ job_id: jobId, synthetic_only: true }), "application/json; charset=utf-8");
  await repo.insertPhase5PilotEvent(pilotKey, jobId, PHASE5_SYNTHETIC_STAGES[6], "complete", { object_key: playback.key });
  await repo.insertPhase5PilotEvent(pilotKey, jobId, PHASE5_SYNTHETIC_STAGES[7], "complete", { object_key: mirrorReceipt.key });

  await repo.completeJob(jobId, {
    processingSeconds: 1,
    tokens: {
      input: synthesis.token_accounting.input,
      cachedInput: synthesis.token_accounting.cachedInput,
      output: synthesis.token_accounting.output,
      reasoningOutput: synthesis.token_accounting.reasoningOutput,
      total: synthesis.token_accounting.total,
    },
    htmlKey: html.key,
    libraryPath: `phase5/synthetic/${jobId}/index.html`,
    synthesisJsonKey: synthesisJson.key,
    detail: "Synthetic Phase 5 local pilot completed without external effects",
  });
  await repo.completePhase5PilotLease({
    pilotKey,
    jobId,
    leaseOwner,
    detail: {
      synthetic_only: true,
      html_key: html.key,
      synthesis_json_key: synthesisJson.key,
      token_total: synthesis.token_accounting.total,
    },
  });

  return {
    ok: true,
    synthetic_only: true,
    jobId,
    pilotKey,
    stages: [...PHASE5_SYNTHETIC_STAGES],
    artifacts: [video, transcript, synthesisJson, html, playback, mirrorReceipt],
    tokens: synthesis.token_accounting,
  };
}
