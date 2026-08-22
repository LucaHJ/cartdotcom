export const PHASE5_LOCAL_PILOT_CONFIRMATION = "LEASE EXACT PHASE 5 LOCAL PILOT JOB";
export const PHASE5_LOCAL_ROLLBACK_CONFIRMATION = "ROLL BACK PHASE 5 LOCAL PILOT JOB";
export const PHASE5_LOCAL_RENEW_CONFIRMATION = "RENEW EXACT PHASE 5 LOCAL PILOT LEASE";
export const PHASE5_ACTIVE_LOCAL_STATUSES = Object.freeze(["armed", "leased", "processing"]);
export const PHASE5_TERMINAL_LOCAL_STATUSES = Object.freeze(["completed", "rolled_back", "expired"]);
export const PHASE5_SYNTHETIC_STAGES = Object.freeze([
  "media",
  "transcription",
  "codex_schema",
  "token_accounting",
  "reaction",
  "publication",
  "private_playback",
  "r2_mirror",
]);

export function isPhase5ActiveLocalStatus(status) {
  return PHASE5_ACTIVE_LOCAL_STATUSES.includes(status);
}

export function assertPhase5PilotJobIdentity(input) {
  const pilotKey = String(input?.pilotKey || "").trim();
  const jobId = String(input?.jobId || "").trim();
  const sourceMessageId = String(input?.sourceMessageId || "").trim();
  const cloudFenceKey = String(input?.cloudFenceKey || pilotKey).trim();
  if (!/^[a-z0-9][a-z0-9_.:-]{4,100}$/i.test(pilotKey)) throw new Error("A stable Phase 5 pilot key is required");
  if (!/^[a-z0-9][a-z0-9_.:-]{4,120}$/i.test(jobId)) throw new Error("An exact durable Phase 5 job id is required");
  if (!sourceMessageId || sourceMessageId.length > 500) throw new Error("An exact source message id is required");
  if (!cloudFenceKey || cloudFenceKey.length > 120) throw new Error("A cloud fence key is required");
  return { pilotKey, jobId, sourceMessageId, cloudFenceKey };
}

export function phase5LeaseExpiry({ now = Date.now(), minutes = 30 } = {}) {
  const bounded = Math.max(5, Math.min(Number(minutes || 30), 120));
  return new Date(now + bounded * 60_000).toISOString();
}

export function phase5LeaseRenewalSeconds({ seconds, minutes } = {}) {
  const requestedSeconds = Number(seconds || 0) || (Number(minutes || 0) || 180) * 60;
  return Math.max(300, Math.min(requestedSeconds, 21_600));
}

export function validatePhase5LeaseRequest(input) {
  if (input?.confirmation !== PHASE5_LOCAL_PILOT_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_LOCAL_PILOT_CONFIRMATION}`);
  }
  return {
    ...assertPhase5PilotJobIdentity(input),
    expiresAt: phase5LeaseExpiry({ minutes: input?.expiresMinutes }),
    audit: input?.audit && typeof input.audit === "object" ? input.audit : {},
  };
}

export function validatePhase5LocalRollback(input) {
  if (input?.confirmation !== PHASE5_LOCAL_ROLLBACK_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_LOCAL_ROLLBACK_CONFIRMATION}`);
  }
  return {
    ...assertPhase5PilotJobIdentity(input),
    reason: String(input?.reason || "operator_requested_phase5_local_rollback").trim().slice(0, 500),
  };
}

export function validatePhase5LocalRenewal(input) {
  if (input?.confirmation !== PHASE5_LOCAL_RENEW_CONFIRMATION) {
    throw new Error(`confirmation must equal ${PHASE5_LOCAL_RENEW_CONFIRMATION}`);
  }
  const leaseOwner = String(input?.leaseOwner || "").trim();
  if (!/^[a-z0-9][a-z0-9_.:-]{2,120}$/i.test(leaseOwner)) throw new Error("An exact leaseOwner is required");
  return {
    ...assertPhase5PilotJobIdentity(input),
    leaseOwner,
    leaseSeconds: phase5LeaseRenewalSeconds({ seconds: input?.leaseSeconds, minutes: input?.expiresMinutes }),
    reason: String(input?.reason || "phase5_exact_job_lease_renewal").trim().slice(0, 500),
  };
}
