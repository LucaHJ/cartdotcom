export const PHASE6_TRANSITION_CONFIRMATION = "SET PHASE 6 AUTHORITY TRANSITION";
export const PHASE6_LOCAL_CONFIRMATION = "SET PHASE 6 AUTHORITY SELF HOSTED";
export const PHASE6_CLOUD_CONFIRMATION = "ROLL BACK PHASE 6 AUTHORITY TO CLOUD";
export const PHASE6_CLAIM_CONFIRMATION = "CLAIM EXACT PHASE 6 JOB";
export const PHASE6_RELEASE_CONFIRMATION = "RELEASE EXACT PHASE 6 JOB";

export type Phase6AuthorityMode = "cloud" | "transition" | "self_hosted";

export type Phase6AuthoritySnapshot = {
  mode: Phase6AuthorityMode;
  generation: number;
  dispatch_enabled: number | boolean;
  codex_enabled: number | boolean;
  outbound_enabled: number | boolean;
  backlog_enabled: number | boolean;
  cutover_watermark: string | null;
};

type AuthorityRequest = {
  expected_generation?: number;
  confirmation?: string;
  reason?: string;
};

type ExactClaimRequest = AuthorityRequest & {
  pilot_key?: string;
  job_id?: string;
  source_message_id?: string;
  lease_owner?: string;
  lease_minutes?: number;
};

function required(value: unknown, name: string, max = 500): string {
  const text = String(value || "").trim();
  if (!text || text.length > max) throw new Error(`${name} is required`);
  return text;
}

function generation(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("expected_generation must be a non-negative integer");
  return parsed;
}

export function validatePhase6AuthorityRequest(input: AuthorityRequest, confirmation: string) {
  if (input.confirmation !== confirmation) throw new Error(`confirmation must equal ${confirmation}`);
  return {
    expectedGeneration: generation(input.expected_generation),
    reason: String(input.reason || "phase6_operator_authority_change").trim().slice(0, 500),
  };
}

export function validatePhase6ClaimRequest(input: ExactClaimRequest, confirmation: string) {
  const authority = validatePhase6AuthorityRequest(input, confirmation);
  return {
    ...authority,
    pilotKey: required(input.pilot_key, "pilot_key", 160),
    jobId: required(input.job_id, "job_id", 160),
    sourceMessageId: required(input.source_message_id, "source_message_id"),
    leaseOwner: required(input.lease_owner, "lease_owner", 160),
    leaseMinutes: Math.max(5, Math.min(360, Number(input.lease_minutes || 60))),
  };
}

export function phase6AuthorityAllowsCloudClaims(snapshot: Phase6AuthoritySnapshot): boolean {
  return snapshot.mode === "cloud";
}

export function phase6AuthorityAllowsLocalClaims(snapshot: Phase6AuthoritySnapshot): boolean {
  return snapshot.mode === "self_hosted"
    && Boolean(snapshot.dispatch_enabled)
    && Boolean(snapshot.codex_enabled)
    && Boolean(snapshot.outbound_enabled)
    && !Boolean(snapshot.backlog_enabled)
    && Boolean(snapshot.cutover_watermark);
}

export function phase6ShouldFenceNewJob(snapshot: Phase6AuthoritySnapshot, createdAt: string): boolean {
  if (!snapshot.cutover_watermark || !["transition", "self_hosted"].includes(snapshot.mode)) return false;
  const created = Date.parse(createdAt);
  const watermark = Date.parse(snapshot.cutover_watermark);
  return Number.isFinite(created) && Number.isFinite(watermark) && created >= watermark;
}

export function phase6PilotKey(generationValue: number, jobId: string): string {
  return `phase6:${generationValue}:${jobId}`;
}

