const DISABLED_DEFAULTS = Object.freeze({
  intake: false,
  dispatch: false,
  worker: false,
  codex: false,
  outbound: false,
  mutations: false,
  backlog: false,
  publisher: false,
  archiver: false,
  authRotator: false,
});

const FLAG_ENV = Object.freeze({
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
});

export class AuthorityFenceError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "AuthorityFenceError";
    this.code = "authority_fence";
    this.detail = detail;
  }
}

export function envFlag(value) {
  return String(value || "").toLowerCase() === "true";
}

export function authorityFromEnv(env = process.env) {
  const flags = {};
  for (const [key, envName] of Object.entries(FLAG_ENV)) {
    flags[key] = envFlag(env[envName]);
  }
  return {
    phase: env.REEL_PHASE || "phase2-local-fixtures",
    processingAuthority: env.REEL_PROCESSING_AUTHORITY || "cloud",
    workerConcurrency: Math.max(1, Number(env.REEL_WORKER_CONCURRENCY || 1) || 1),
    flags: { ...DISABLED_DEFAULTS, ...flags },
  };
}

export function assertCloudAuthority(state, operation) {
  if (state.processingAuthority !== "cloud") {
    throw new AuthorityFenceError("Self-hosted Reel authority must remain cloud-owned in Phase 2", {
      operation,
      processingAuthority: state.processingAuthority,
    });
  }
}

export function assertDisabled(state, flag, operation) {
  if (state.flags[flag]) {
    throw new AuthorityFenceError(`Phase 2 refuses enabled ${flag} operation`, { operation, flag });
  }
}

export function assertPhase2FixtureAuthority(state, operation) {
  assertCloudAuthority(state, operation);
  for (const flag of ["intake", "dispatch", "worker", "codex", "outbound", "backlog", "publisher", "authRotator"]) {
    assertDisabled(state, flag, operation);
  }
}

export function describeAuthority(state) {
  return {
    phase: state.phase,
    processing_authority: state.processingAuthority,
    enabled: { ...state.flags },
    worker_concurrency: state.workerConcurrency,
  };
}
