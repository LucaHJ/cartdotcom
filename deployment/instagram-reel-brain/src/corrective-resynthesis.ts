export const CORRECTIVE_RESYNTHESIS_CONFIRMATION = "CORRECTIVE_RESYNTHESISE_ONE";

export type CorrectiveJob = {
  id: string;
  status: string;
  stage: string;
  instructions: string | null;
  pilot_run_id?: string | null;
  source_message_id?: string | null;
};

export type CorrectiveReset = {
  job: CorrectiveJob;
  instructions: string;
  marker: string;
  commandSummary: Record<string, unknown>;
  eventDetail: string;
};

export type CorrectiveStore = {
  readJob(jobId: string): Promise<CorrectiveJob | null>;
  hasAuditEvent(jobId: string, marker: string): Promise<boolean>;
  applyReset(reset: CorrectiveReset): Promise<{ applied: boolean }>;
  queueJob(jobId: string): Promise<void>;
  markQueueFailure(jobId: string, detail: string): Promise<void>;
};

export type D1ChangeResult = { meta?: { changes?: number } };

export function d1Changes(result: D1ChangeResult | null | undefined): number {
  const changes = Number(result?.meta?.changes ?? 0);
  return Number.isFinite(changes) ? changes : 0;
}

export function correctiveClaimApplied(result: D1ChangeResult | null | undefined): boolean {
  return d1Changes(result) === 1;
}

export async function correctivelyResynthesiseOne(
  store: CorrectiveStore,
  input: {
    jobId: string;
    confirm: string | undefined;
    correctiveKey: string;
    instructions: string;
    reason?: string;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const correctiveKey = String(input.correctiveKey || "").trim().slice(0, 160);
  const instructions = String(input.instructions || "").trim().slice(0, 3000);
  const reason = String(input.reason || "operator_requested_corrective_resynthesis").trim().slice(0, 500);
  if (input.confirm !== CORRECTIVE_RESYNTHESIS_CONFIRMATION) {
    return { status: 400, body: { error: `confirm_corrective must equal ${CORRECTIVE_RESYNTHESIS_CONFIRMATION}` } };
  }
  if (!correctiveKey || !instructions) {
    return { status: 400, body: { error: "corrective_key and instructions are required" } };
  }

  const job = await store.readJob(input.jobId);
  if (!job) return { status: 404, body: { error: "Job not found" } };
  if (job.pilot_run_id) {
    return { status: 409, body: { error: "Corrective one-job resynthesis rejects pilot/backlog jobs" } };
  }
  if (job.status !== "complete") {
    return { status: 409, body: { error: `Job ${job.id} is ${job.status}; only completed jobs may be correctively resynthesised` } };
  }

  const marker = `corrective-resynthesis:${correctiveKey}`;
  if (await store.hasAuditEvent(job.id, marker)) {
    return { status: 200, body: { ok: true, idempotent: true, queued: false, job_id: job.id, corrective_key: correctiveKey } };
  }

  const reset: CorrectiveReset = {
    job,
    instructions,
    marker,
    commandSummary: { ok: true, corrective_resynthesis: true, job_id: job.id, corrective_key: correctiveKey, reason },
    eventDetail: JSON.stringify({
      marker,
      reason,
      previous_status: job.status,
      previous_stage: job.stage,
      previous_instructions: job.instructions || null,
      next_instructions: instructions,
    }).slice(0, 1500),
  };
  const applied = await store.applyReset(reset);
  if (!applied.applied) {
    return { status: 409, body: { error: "Corrective claim lost; job is no longer a completed non-pilot job", job_id: job.id } };
  }
  try {
    await store.queueJob(job.id);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 400) : "Queue send failed";
    await store.markQueueFailure(job.id, detail);
    return { status: 502, body: { ok: false, queued: false, job_id: job.id, error: detail, recoverable: true } };
  }
  return { status: 202, body: { ok: true, queued: true, job_id: job.id, corrective_key: correctiveKey } };
}
