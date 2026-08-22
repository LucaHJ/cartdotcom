export const PHASE5_FENCE_CONFIRMATION = "FENCE EXACT PHASE 5 LOCAL PILOT JOB";
export const PHASE5_ROLLBACK_CONFIRMATION = "ROLL BACK PHASE 5 LOCAL PILOT JOB";
export const PHASE5_ARM_CONFIRMATION = "ARM NEXT PHASE 5 REEL PILOT SHARE";
export const PHASE5_CANCEL_ARM_CONFIRMATION = "CANCEL PHASE 5 REEL PILOT ARM";
export const PHASE5_RENEW_CONFIRMATION = "RENEW EXACT PHASE 5 LOCAL PILOT LEASE";
export const PHASE5_START_CONFIRMATION = "START EXACT PHASE 5 LOCAL PILOT JOB";
export const PHASE5_FINALIZE_CONFIRMATION = "FINALIZE EXACT PHASE 5 LOCAL PILOT JOB";
export const PHASE5_ABORT_CONFIRMATION = "ABORT EXACT PHASE 5 LOCAL PILOT JOB";
export const PHASE5_MIN_EXPLICIT_JOB_CREATED_AT = "2026-08-21T15:01:28.000Z";
export const PHASE5_EXECUTION_EXPIRY_SAFETY_MARGIN_MS = 30_000;
export const PHASE5_MIN_SAFE_PROCESSING_WINDOW_MS = 5 * 60_000;

export const PHASE5_ACTIVE_FENCE_STATUSES = Object.freeze(["armed", "local_claimed", "local_processing"] as const);
export const PHASE5_TERMINAL_FENCE_STATUSES = Object.freeze(["local_complete", "rolled_back", "expired"] as const);
export const PHASE5_PREINTAKE_ARM_STATUSES = Object.freeze(["armed", "captured", "cancelled", "expired", "rolled_back"] as const);

export type Phase5ActiveFenceStatus = typeof PHASE5_ACTIVE_FENCE_STATUSES[number];
export type Phase5FenceStatus = Phase5ActiveFenceStatus | typeof PHASE5_TERMINAL_FENCE_STATUSES[number];

export type Phase5FenceRow = {
  pilot_key: string;
  job_id: string;
  source_message_id: string | null;
  status: Phase5FenceStatus;
  expires_at: string;
  local_lease_owner?: string | null;
  local_lease_expires_at?: string | null;
};

export type Phase5FenceRequest = {
  pilot_key?: string;
  job_id?: string;
  source_message_id?: string;
  confirmation?: string;
  expires_minutes?: number;
};

export type Phase5RollbackRequest = {
  pilot_key?: string;
  job_id?: string;
  confirmation?: string;
  reason?: string;
};

export type Phase5RenewRequest = {
  pilot_key?: string;
  job_id?: string;
  source_message_id?: string;
  lease_owner?: string;
  confirmation?: string;
  expires_minutes?: number;
  reason?: string;
};

export type Phase5ControlRequest = {
  pilot_key?: string;
  job_id?: string;
  source_message_id?: string;
  lease_owner?: string;
  idempotency_key?: string;
  callback_token_hash?: string;
  confirmation?: string;
  token_minutes?: number;
  reason?: string;
};

export type Phase5PreintakeArmStatus = typeof PHASE5_PREINTAKE_ARM_STATUSES[number];

export type Phase5PreintakeArmRow = {
  arm_key: string;
  sender_id: string;
  media_type: "reel";
  status: Phase5PreintakeArmStatus;
  armed_at: string;
  expires_at: string;
  source_message_id?: string | null;
  job_id?: string | null;
};

export type Phase5PreintakeArmRequest = {
  arm_key?: string;
  sender_id?: string;
  confirmation?: string;
  expires_minutes?: number;
};

export type Phase5PreintakeCancelRequest = {
  arm_key?: string;
  confirmation?: string;
  reason?: string;
};

export function isPhase5ActiveFenceStatus(status: string | null | undefined): status is Phase5ActiveFenceStatus {
  return PHASE5_ACTIVE_FENCE_STATUSES.includes(status as Phase5ActiveFenceStatus);
}

export function phase5FenceExpired(fence: Pick<Phase5FenceRow, "expires_at">, now = Date.now()): boolean {
  const expiresAt = Date.parse(fence.expires_at);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export function phase5FenceActive(fence: Phase5FenceRow | null | undefined, now = Date.now()): fence is Phase5FenceRow {
  return Boolean(fence && isPhase5ActiveFenceStatus(fence.status) && !phase5FenceExpired(fence, now));
}

export function normalisePhase5PilotKey(value: unknown): string {
  const key = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_.:-]{4,100}$/i.test(key)) {
    throw new Error("A stable phase5 pilot_key is required");
  }
  return key;
}

export function normalisePhase5JobId(value: unknown): string {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_.:-]{4,120}$/i.test(id)) {
    throw new Error("An exact durable job_id is required");
  }
  return id;
}

export function normalisePhase5SourceMessageId(value: unknown): string {
  const id = String(value || "").trim();
  if (!id || id.length > 500) throw new Error("An exact source_message_id is required");
  return id;
}

export function normalisePhase5SenderId(value: unknown): string {
  const id = String(value || "").trim();
  if (!/^\d{5,40}$/.test(id)) throw new Error("An exact allowlisted sender_id is required");
  return id;
}

export function phase5FenceExpiry(input: Phase5FenceRequest, now = Date.now()): string {
  const minutes = Math.max(5, Math.min(Number(input.expires_minutes || 30) || 30, 120));
  return new Date(now + minutes * 60_000).toISOString();
}

export function phase5ArmExpiry(input: Phase5PreintakeArmRequest, now = Date.now()): string {
  const minutes = Math.max(1, Math.min(Number(input.expires_minutes || 15) || 15, 15));
  return new Date(now + minutes * 60_000).toISOString();
}

export function phase5RenewalExpiry(input: Phase5RenewRequest, now = Date.now()): string {
  const minutes = Math.max(5, Math.min(Number(input.expires_minutes || 180) || 180, 360));
  return new Date(now + minutes * 60_000).toISOString();
}

export function phase5CallbackExpiry(input: Phase5ControlRequest, now = Date.now()): string {
  const minutes = Math.max(5, Math.min(Number(input.token_minutes || 240) || 240, 360));
  return new Date(now + minutes * 60_000).toISOString();
}

export function normalisePhase5LeaseOwner(value: unknown): string {
  const leaseOwner = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_.:-]{2,120}$/i.test(leaseOwner)) throw new Error("An exact lease_owner is required");
  return leaseOwner;
}

export function normalisePhase5IdempotencyKey(value: unknown): string {
  const key = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_.:-]{6,160}$/i.test(key)) throw new Error("A stable idempotency_key is required");
  return key;
}

export function normalisePhase5CallbackTokenHash(value: unknown): string {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("A SHA-256 callback_token_hash is required");
  return hash;
}

export function normaliseOptionalPhase5CallbackTokenHash(value: unknown): string | null {
  const hash = String(value || "").trim();
  if (!hash) return null;
  return normalisePhase5CallbackTokenHash(hash);
}

function validatePhase5ControlIdentity(input: Phase5ControlRequest): {
  pilotKey: string;
  jobId: string;
  sourceMessageId: string;
  leaseOwner: string;
  idempotencyKey: string;
} {
  return {
    pilotKey: normalisePhase5PilotKey(input.pilot_key),
    jobId: normalisePhase5JobId(input.job_id),
    sourceMessageId: normalisePhase5SourceMessageId(input.source_message_id),
    leaseOwner: normalisePhase5LeaseOwner(input.lease_owner),
    idempotencyKey: normalisePhase5IdempotencyKey(input.idempotency_key),
  };
}

export function validatePhase5FenceRequest(input: Phase5FenceRequest): {
  pilotKey: string;
  jobId: string;
  sourceMessageId: string;
  expiresAt: string;
} {
  if (input.confirmation !== PHASE5_FENCE_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_FENCE_CONFIRMATION}`);
  }
  return {
    pilotKey: normalisePhase5PilotKey(input.pilot_key),
    jobId: normalisePhase5JobId(input.job_id),
    sourceMessageId: normalisePhase5SourceMessageId(input.source_message_id),
    expiresAt: phase5FenceExpiry(input),
  };
}

export function validatePhase5RollbackRequest(input: Phase5RollbackRequest): {
  pilotKey: string;
  jobId: string;
  reason: string;
} {
  if (input.confirmation !== PHASE5_ROLLBACK_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_ROLLBACK_CONFIRMATION}`);
  }
  return {
    pilotKey: normalisePhase5PilotKey(input.pilot_key),
    jobId: normalisePhase5JobId(input.job_id),
    reason: String(input.reason || "operator_requested_phase5_rollback").trim().slice(0, 500),
  };
}

export function validatePhase5RenewRequest(input: Phase5RenewRequest, now = Date.now()): {
  pilotKey: string;
  jobId: string;
  sourceMessageId: string;
  leaseOwner: string;
  expiresAt: string;
  reason: string;
} {
  if (input.confirmation !== PHASE5_RENEW_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_RENEW_CONFIRMATION}`);
  }
  return {
    pilotKey: normalisePhase5PilotKey(input.pilot_key),
    jobId: normalisePhase5JobId(input.job_id),
    sourceMessageId: normalisePhase5SourceMessageId(input.source_message_id),
    leaseOwner: normalisePhase5LeaseOwner(input.lease_owner),
    expiresAt: phase5RenewalExpiry(input, now),
    reason: String(input.reason || "phase5_exact_job_lease_renewal").trim().slice(0, 500),
  };
}

export function validatePhase5StartRequest(input: Phase5ControlRequest, now = Date.now()): {
  pilotKey: string;
  jobId: string;
  sourceMessageId: string;
  leaseOwner: string;
  idempotencyKey: string;
  callbackTokenHash: string | null;
  tokenExpiresAt: string;
  marker: string;
  reason: string;
} {
  if (input.confirmation !== PHASE5_START_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_START_CONFIRMATION}`);
  }
  const identity = validatePhase5ControlIdentity(input);
  return {
    ...identity,
    callbackTokenHash: normaliseOptionalPhase5CallbackTokenHash(input.callback_token_hash),
    tokenExpiresAt: phase5CallbackExpiry(input, now),
    marker: `phase5-control:${identity.pilotKey}:start:${identity.idempotencyKey}`,
    reason: String(input.reason || "phase5_exact_job_local_start").trim().slice(0, 500),
  };
}

export type Phase5ControlSnapshot = {
  status: string | null;
  expires_at?: string | null;
  job_status: string | null;
  job_stage?: string | null;
  local_lease_owner?: string | null;
  local_lease_expires_at?: string | null;
  upload_token_hash?: string | null;
  upload_token_expires_at?: string | null;
  html_key?: string | null;
  library_path?: string | null;
  completed_at?: string | null;
  publication_artifacts?: number | null;
  completion_events?: number | null;
  marker_events?: number | null;
};

export type Phase5StartRecoveryStatus =
  | "guarded_start"
  | "resume_running"
  | "renew_processing_lease"
  | "processor_already_complete"
  | "repair_queued_start"
  | "fail_closed";

export type Phase5StartRecoveryDecision = {
  status: Phase5StartRecoveryStatus;
  ok: boolean;
  httpStatus: number;
  error?: string;
  recoveryStatus: string;
  effectiveTokenExpiresAt?: string;
  requiresCallbackToken?: boolean;
  repairAudit?: boolean;
  idempotent?: boolean;
  renewProcessingLease?: boolean;
  prepublicationAbortRequired?: boolean;
  processorAlreadyComplete?: boolean;
  finalized?: boolean;
};

export type Phase5FinalizeRecoveryStatus =
  | "guarded_finalize"
  | "repair_finalize_audit"
  | "idempotent_finalized"
  | "fail_closed";

export type Phase5FinalizeRecoveryDecision = {
  status: Phase5FinalizeRecoveryStatus;
  ok: boolean;
  httpStatus: number;
  error?: string;
  recoveryStatus: string;
  repairAudit?: boolean;
  idempotent?: boolean;
};

export type Phase5AbortRecoveryStatus =
  | "guarded_abort"
  | "requeue_audit_missing"
  | "idempotent_aborted"
  | "fail_closed";

export type Phase5AbortRecoveryDecision = {
  status: Phase5AbortRecoveryStatus;
  ok: boolean;
  httpStatus: number;
  error?: string;
  recoveryStatus: string;
  idempotent?: boolean;
};

export function phase5SnapshotHasPublication(row: Phase5ControlSnapshot): boolean {
  return Boolean(
    row.html_key
    || row.library_path
    || row.completed_at
    || Number(row.publication_artifacts || 0) > 0
    || Number(row.completion_events || 0) > 0
  );
}

function phase5TimestampStillValid(value: string | null | undefined, now: number): boolean {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) && parsed > now;
}

function phase5TimestampAtOrBefore(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftParsed = Date.parse(left || "");
  const rightParsed = Date.parse(right || "");
  return Number.isFinite(leftParsed) && Number.isFinite(rightParsed) && leftParsed <= rightParsed;
}

function phase5ExecutionExpiryFailure(recoveryStatus: string, error: string): Phase5StartRecoveryDecision {
  return {
    status: "fail_closed",
    ok: false,
    httpStatus: 409,
    recoveryStatus,
    prepublicationAbortRequired: true,
    error,
  };
}

export function phase5EffectiveExecutionExpiry(
  row: Pick<Phase5ControlSnapshot, "expires_at">,
  input: { tokenExpiresAt?: string | null; now?: number },
): { ok: true; effectiveTokenExpiresAt: string } | { ok: false; decision: Phase5StartRecoveryDecision } {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const fenceExpiresAt = Date.parse(row.expires_at || "");
  if (!Number.isFinite(fenceExpiresAt) || fenceExpiresAt <= now) {
    return {
      ok: false,
      decision: phase5ExecutionExpiryFailure(
        "fence_expired_abort_required",
        "Phase 5 start refused because the overall fence has expired",
      ),
    };
  }
  const requestedTokenExpiresAt = Date.parse(input.tokenExpiresAt || "");
  if (!Number.isFinite(requestedTokenExpiresAt)) {
    return {
      ok: false,
      decision: {
        status: "fail_closed",
        ok: false,
        httpStatus: 400,
        recoveryStatus: "execution_expiry_invalid",
        prepublicationAbortRequired: true,
        error: "Phase 5 start requires a valid callback execution expiry",
      },
    };
  }
  const maxExecutionExpiresAt = fenceExpiresAt - PHASE5_EXECUTION_EXPIRY_SAFETY_MARGIN_MS;
  const effectiveExpiresAt = Math.min(requestedTokenExpiresAt, maxExecutionExpiresAt);
  if (effectiveExpiresAt - now < PHASE5_MIN_SAFE_PROCESSING_WINDOW_MS) {
    return {
      ok: false,
      decision: phase5ExecutionExpiryFailure(
        "insufficient_fence_window_abort_required",
        "Phase 5 start refused because the overall fence does not leave the minimum safe processing window",
      ),
    };
  }
  return { ok: true, effectiveTokenExpiresAt: new Date(effectiveExpiresAt).toISOString() };
}

export function phase5StartRecoveryDecision(
  row: Phase5ControlSnapshot,
  input: { leaseOwner: string; callbackTokenHash?: string | null; tokenExpiresAt?: string | null; now?: number },
): Phase5StartRecoveryDecision {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const markerCount = Number(row.marker_events || 0);
  if (row.local_lease_owner !== input.leaseOwner) {
    return {
      status: "fail_closed",
      ok: false,
      httpStatus: 409,
      recoveryStatus: "lease_owner_mismatch",
      error: "Phase 5 start requires the exact lease owner",
    };
  }

  if (row.status === "local_claimed") {
    if (row.job_status !== "queued") {
      return {
        status: "fail_closed",
        ok: false,
        httpStatus: 409,
        recoveryStatus: "job_not_queued",
        error: "Phase 5 start requires the job to remain queued",
      };
    }
    if (phase5SnapshotHasPublication(row)) {
      return {
        status: "fail_closed",
        ok: false,
        httpStatus: 409,
        recoveryStatus: "publication_exists",
        error: "Phase 5 start refused because completion/publication evidence exists",
      };
    }
    const executionExpiry = phase5EffectiveExecutionExpiry(row, input);
    if (!executionExpiry.ok) return executionExpiry.decision;
    if (!input.callbackTokenHash) {
      return {
        status: "fail_closed",
        ok: false,
        httpStatus: 400,
        recoveryStatus: "callback_hash_required",
        requiresCallbackToken: true,
        error: "A SHA-256 callback_token_hash is required before starting a queued job",
      };
    }
    return {
      status: "guarded_start",
      ok: true,
      httpStatus: 200,
      recoveryStatus: "guarded_start",
      effectiveTokenExpiresAt: executionExpiry.effectiveTokenExpiresAt,
    };
  }

  if (row.status === "local_processing") {
    if (row.job_status === "complete") {
      return {
        status: "processor_already_complete",
        ok: true,
        httpStatus: 200,
        recoveryStatus: markerCount > 0 ? "processor_already_complete" : "processor_already_complete_repair_audit",
        repairAudit: markerCount === 0,
        processorAlreadyComplete: true,
        idempotent: true,
      };
    }

    if (row.job_status === "running") {
      if (phase5SnapshotHasPublication(row)) {
        return {
          status: "fail_closed",
          ok: false,
          httpStatus: 409,
          recoveryStatus: "running_with_publication",
          error: "Phase 5 running resume refused because completion/publication evidence exists",
        };
      }
      const executionExpiry = phase5EffectiveExecutionExpiry(row, input);
      if (!executionExpiry.ok) return executionExpiry.decision;
      if (!input.callbackTokenHash) {
        return {
          status: "fail_closed",
          ok: false,
          httpStatus: 400,
          recoveryStatus: "callback_hash_required",
          requiresCallbackToken: true,
          error: "A SHA-256 callback_token_hash is required to resume a running local job",
        };
      }
      if (row.upload_token_hash !== input.callbackTokenHash) {
        return {
          status: "fail_closed",
          ok: false,
          httpStatus: 409,
          recoveryStatus: "callback_hash_mismatch",
          error: "Phase 5 start resume refused because the callback token hash does not match",
        };
      }
      const callbackLeaseValid = phase5TimestampStillValid(row.upload_token_expires_at, now);
      const localLeaseValid = phase5TimestampStillValid(row.local_lease_expires_at, now);
      const callbackWithinFence = phase5TimestampAtOrBefore(row.upload_token_expires_at, row.expires_at);
      const localLeaseWithinFence = phase5TimestampAtOrBefore(row.local_lease_expires_at, row.expires_at);
      const matchingExecutionExpiries = row.upload_token_expires_at === row.local_lease_expires_at;
      if (!callbackLeaseValid || !localLeaseValid || !callbackWithinFence || !localLeaseWithinFence || !matchingExecutionExpiries) {
        return {
          status: "renew_processing_lease",
          ok: true,
          httpStatus: 200,
          recoveryStatus: markerCount > 0 ? "renew_processing_lease" : "renew_processing_lease_repair_audit",
          effectiveTokenExpiresAt: executionExpiry.effectiveTokenExpiresAt,
          repairAudit: markerCount === 0,
          idempotent: true,
          renewProcessingLease: true,
        };
      }
      return {
        status: "resume_running",
        ok: true,
        httpStatus: 200,
        recoveryStatus: markerCount > 0 ? "resume_running" : "resume_running_repair_audit",
        effectiveTokenExpiresAt: executionExpiry.effectiveTokenExpiresAt,
        repairAudit: markerCount === 0,
        idempotent: true,
      };
    }

    if (row.job_status === "queued") {
      if (phase5SnapshotHasPublication(row)) {
        return {
          status: "fail_closed",
          ok: false,
          httpStatus: 409,
          recoveryStatus: "queued_with_publication",
          error: "Phase 5 start repair refused because completion/publication evidence exists",
        };
      }
      const executionExpiry = phase5EffectiveExecutionExpiry(row, input);
      if (!executionExpiry.ok) return executionExpiry.decision;
      if (!input.callbackTokenHash) {
        return {
          status: "fail_closed",
          ok: false,
          httpStatus: 400,
          recoveryStatus: "callback_hash_required",
          requiresCallbackToken: true,
          error: "A SHA-256 callback_token_hash is required to repair a partial local start",
        };
      }
      return {
        status: "repair_queued_start",
        ok: true,
        httpStatus: 200,
        recoveryStatus: "repair_queued_start",
        effectiveTokenExpiresAt: executionExpiry.effectiveTokenExpiresAt,
      };
    }

    return {
      status: "fail_closed",
      ok: false,
      httpStatus: 409,
      recoveryStatus: "unsupported_local_processing_job_state",
      error: "Phase 5 start found an unsupported local_processing job state",
    };
  }

  if (row.status === "local_complete" && row.job_status === "complete") {
    return {
      status: "processor_already_complete",
      ok: true,
      httpStatus: 200,
      recoveryStatus: "cloud_already_finalized",
      processorAlreadyComplete: true,
      finalized: true,
      idempotent: true,
    };
  }

  return {
    status: "fail_closed",
    ok: false,
    httpStatus: 409,
    recoveryStatus: "unsupported_fence_state",
    error: "Phase 5 start requires local_claimed, local_processing, or already-complete exact state",
  };
}

export function phase5FinalizeRecoveryDecision(
  row: Phase5ControlSnapshot,
  input: { leaseOwner: string },
): Phase5FinalizeRecoveryDecision {
  const markerCount = Number(row.marker_events || 0);
  if (row.local_lease_owner !== input.leaseOwner) {
    return {
      status: "fail_closed",
      ok: false,
      httpStatus: 409,
      recoveryStatus: "lease_owner_mismatch",
      error: "Phase 5 finalize requires the exact lease owner",
    };
  }

  if (row.status === "local_complete" && row.job_status === "complete") {
    if (markerCount > 0) {
      return {
        status: "idempotent_finalized",
        ok: true,
        httpStatus: 200,
        recoveryStatus: "idempotent_finalized",
        idempotent: true,
      };
    }
    return {
      status: "repair_finalize_audit",
      ok: true,
      httpStatus: 200,
      recoveryStatus: "repair_finalize_audit",
      repairAudit: true,
      idempotent: true,
    };
  }

  if (row.status === "local_processing" && row.job_status === "complete") {
    return {
      status: "guarded_finalize",
      ok: true,
      httpStatus: 200,
      recoveryStatus: "guarded_finalize",
    };
  }

  return {
    status: "fail_closed",
    ok: false,
    httpStatus: 409,
    recoveryStatus: "not_ready_to_finalize",
    error: "Phase 5 finalize requires local_processing fence owned by the runner and a complete job",
  };
}

export function phase5AbortRecoveryDecision(
  row: Phase5ControlSnapshot,
  input: { leaseOwner: string },
): Phase5AbortRecoveryDecision {
  if (phase5SnapshotHasPublication(row) || row.job_status === "complete") {
    return {
      status: "fail_closed",
      ok: false,
      httpStatus: 409,
      recoveryStatus: "publication_exists",
      error: "Phase 5 abort refused because completion/publication evidence exists",
    };
  }

  if (row.status === "rolled_back" && row.job_status === "queued") {
    if (Number(row.marker_events || 0) > 0) {
      return {
        status: "idempotent_aborted",
        ok: true,
        httpStatus: 200,
        recoveryStatus: "idempotent_aborted",
        idempotent: true,
      };
    }
    return {
      status: "requeue_audit_missing",
      ok: true,
      httpStatus: 200,
      recoveryStatus: "requeue_audit_missing",
    };
  }

  if (!isPhase5ActiveFenceStatus(row.status || "") || row.local_lease_owner !== input.leaseOwner) {
    return {
      status: "fail_closed",
      ok: false,
      httpStatus: 409,
      recoveryStatus: "active_fence_owner_mismatch",
      error: "Phase 5 abort requires the exact active fence and lease owner",
    };
  }

  if (!["queued", "running", "failed"].includes(String(row.job_status || ""))) {
    return {
      status: "fail_closed",
      ok: false,
      httpStatus: 409,
      recoveryStatus: "job_not_abortable",
      error: "Phase 5 abort requires a queued, running, or failed pre-publication job",
    };
  }

  return {
    status: "guarded_abort",
    ok: true,
    httpStatus: 200,
    recoveryStatus: "guarded_abort",
  };
}

export function validatePhase5FinalizeRequest(input: Phase5ControlRequest): {
  pilotKey: string;
  jobId: string;
  sourceMessageId: string;
  leaseOwner: string;
  idempotencyKey: string;
  marker: string;
  reason: string;
} {
  if (input.confirmation !== PHASE5_FINALIZE_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_FINALIZE_CONFIRMATION}`);
  }
  const identity = validatePhase5ControlIdentity(input);
  return {
    ...identity,
    marker: `phase5-control:${identity.pilotKey}:finalize:${identity.idempotencyKey}`,
    reason: String(input.reason || "phase5_exact_job_local_finalize").trim().slice(0, 500),
  };
}

export function validatePhase5AbortRequest(input: Phase5ControlRequest): {
  pilotKey: string;
  jobId: string;
  sourceMessageId: string;
  leaseOwner: string;
  idempotencyKey: string;
  marker: string;
  reason: string;
} {
  if (input.confirmation !== PHASE5_ABORT_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_ABORT_CONFIRMATION}`);
  }
  const identity = validatePhase5ControlIdentity(input);
  return {
    ...identity,
    marker: `phase5-control:${identity.pilotKey}:abort:${identity.idempotencyKey}`,
    reason: String(input.reason || "phase5_exact_job_local_abort").trim().slice(0, 500),
  };
}

export function validatePhase5PreintakeArmRequest(input: Phase5PreintakeArmRequest, now = Date.now()): {
  armKey: string;
  senderId: string;
  armedAt: string;
  expiresAt: string;
} {
  if (input.confirmation !== PHASE5_ARM_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_ARM_CONFIRMATION}`);
  }
  return {
    armKey: normalisePhase5PilotKey(input.arm_key),
    senderId: normalisePhase5SenderId(input.sender_id),
    armedAt: new Date(now).toISOString(),
    expiresAt: phase5ArmExpiry(input, now),
  };
}

export function validatePhase5PreintakeCancelRequest(input: Phase5PreintakeCancelRequest): {
  armKey: string;
  reason: string;
} {
  if (input.confirmation !== PHASE5_CANCEL_ARM_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_CANCEL_ARM_CONFIRMATION}`);
  }
  return {
    armKey: normalisePhase5PilotKey(input.arm_key),
    reason: String(input.reason || "operator_cancelled_phase5_preintake_arm").trim().slice(0, 500),
  };
}

export function phase5ArmCanCaptureShare(
  arm: Pick<Phase5PreintakeArmRow, "sender_id" | "media_type" | "status" | "armed_at" | "expires_at"> | null | undefined,
  share: { senderId?: string | null; mediaType?: string | null; now?: number } = {},
): boolean {
  if (!arm || arm.status !== "armed" || arm.media_type !== "reel") return false;
  if (String(share.senderId || "") !== arm.sender_id) return false;
  if (share.mediaType !== "reel") return false;
  const now = share.now ?? Date.now();
  const armedAt = Date.parse(arm.armed_at);
  const expiresAt = Date.parse(arm.expires_at);
  return Number.isFinite(armedAt) && Number.isFinite(expiresAt) && armedAt <= now && expiresAt > now;
}
