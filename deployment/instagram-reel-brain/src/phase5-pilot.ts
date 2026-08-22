export const PHASE5_FENCE_CONFIRMATION = "FENCE EXACT PHASE 5 LOCAL PILOT JOB";
export const PHASE5_ROLLBACK_CONFIRMATION = "ROLL BACK PHASE 5 LOCAL PILOT JOB";
export const PHASE5_ARM_CONFIRMATION = "ARM NEXT PHASE 5 REEL PILOT SHARE";
export const PHASE5_CANCEL_ARM_CONFIRMATION = "CANCEL PHASE 5 REEL PILOT ARM";
export const PHASE5_MIN_EXPLICIT_JOB_CREATED_AT = "2026-08-21T15:01:28.000Z";

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
