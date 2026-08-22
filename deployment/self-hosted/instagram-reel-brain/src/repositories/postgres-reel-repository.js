import { AsyncLocalStorage } from "node:async_hooks";
import { instagramDedupeKey } from "../domain/instagram.js";

const transactionContext = new AsyncLocalStorage();
const clientTransactionLocks = new WeakMap();

class AsyncMutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  async runExclusive(callback) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback();
    } finally {
      release();
    }
  }
}

function transactionLockFor(client) {
  let lock = clientTransactionLocks.get(client);
  if (!lock) {
    lock = new AsyncMutex();
    clientTransactionLocks.set(client, lock);
  }
  return lock;
}

export class RepositoryConflictError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "RepositoryConflictError";
    this.code = "repository_conflict";
    this.detail = detail;
  }
}

export class PostgresReelRepository {
  constructor(client, { schema = "reel_brain" } = {}) {
    if (!client || typeof client.query !== "function") throw new TypeError("PostgresReelRepository requires a query client");
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error(`Invalid schema name ${schema}`);
    this.client = client;
    this.schema = schema;
  }

  table(name) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Invalid table name ${name}`);
    return `${this.schema}.${name}`;
  }

  async #rawQuery(text, values = []) {
    return this.client.query(text, values);
  }

  async query(text, values = []) {
    const active = transactionContext.getStore();
    if (active?.client === this.client) {
      return this.#rawQuery(text, values);
    }
    const lock = transactionLockFor(this.client);
    return lock.runExclusive(() => this.#rawQuery(text, values));
  }

  async withTransaction(callback) {
    const active = transactionContext.getStore();
    if (active?.client === this.client) {
      return callback(this);
    }
    const lock = transactionLockFor(this.client);
    return lock.runExclusive(async () => {
      await this.#rawQuery("BEGIN");
      return transactionContext.run({ client: this.client }, async () => {
        try {
          const result = await callback(this);
          await this.#rawQuery("COMMIT");
          return result;
        } catch (error) {
          await this.#rawQuery("ROLLBACK").catch(() => undefined);
          throw error;
        }
      });
    });
  }

  async createJob(input) {
    const dedupeKey = input.dedupeKey || instagramDedupeKey(input.sourceUrl);
    if (!dedupeKey) throw new RepositoryConflictError("A canonical Instagram dedupe key is required before job insert");
    const result = await this.query(
      `INSERT INTO ${this.table("jobs")} (
        id, source_url, canonical_url, shortcode, dedupe_key, sender_id, source_message_id,
        source_media_json, instructions, status, stage, status_emoji
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued','queued',$10)
      ON CONFLICT (dedupe_key) WHERE status <> 'duplicate'
      DO NOTHING
      RETURNING *`,
      [
        input.id,
        input.sourceUrl,
        input.canonicalUrl || input.sourceUrl,
        input.shortcode || null,
        dedupeKey,
        input.senderId || null,
        input.sourceMessageId || null,
        input.sourceMediaJson ? JSON.stringify(input.sourceMediaJson) : null,
        input.instructions || null,
        input.statusEmoji || "⬇️",
      ],
    );
    return result.rows?.[0] || null;
  }

  async claimNextQueuedJob(workerId) {
    const result = await this.query(
      `WITH candidate AS (
        SELECT id FROM ${this.table("jobs")}
        WHERE status='queued' AND pilot_run_id IS NULL
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE ${this.table("jobs")} j
      SET status='running', stage='claimed', started_at=COALESCE(started_at, now()), updated_at=now(), worker_id=$1
      FROM candidate
      WHERE j.id=candidate.id
      RETURNING j.*`,
      [workerId],
    );
    return result.rows?.[0] || null;
  }

  async markStage(jobId, stage, status = "running", detail = null) {
    return this.withTransaction((repository) => repository.#markStageMutation(jobId, stage, status, detail));
  }

  async #markStageMutation(jobId, stage, status = "running", detail = null) {
    const result = await this.query(
      `UPDATE ${this.table("jobs")} SET stage=$2,status=$3,updated_at=now() WHERE id=$1 RETURNING id`,
      [jobId, stage, status],
    );
    if (!result.rows?.[0]) return null;
    await this.insertJobEvent(jobId, stage, status, null, detail);
    return result.rows[0];
  }

  async completeJob(jobId, output) {
    return this.withTransaction((repository) => repository.#completeJobMutation(jobId, output));
  }

  async #completeJobMutation(jobId, output) {
    const result = await this.query(
      `UPDATE ${this.table("jobs")}
       SET status='complete', stage='complete', completed_at=now(), processing_seconds=$2,
           codex_input_tokens=$3, codex_cached_input_tokens=$4, codex_output_tokens=$5,
           codex_reasoning_output_tokens=$6, codex_total_tokens=$7, html_key=$8,
           library_path=$9, synthesis_json_key=$10, updated_at=now()
       WHERE id=$1 AND status IN ('running','queued')
       RETURNING id`,
      [
        jobId,
        output.processingSeconds ?? null,
        output.tokens?.input ?? null,
        output.tokens?.cachedInput ?? null,
        output.tokens?.output ?? null,
        output.tokens?.reasoningOutput ?? null,
        output.tokens?.total ?? null,
        output.htmlKey || null,
        output.libraryPath || null,
        output.synthesisJsonKey || null,
      ],
    );
    if (!result.rows?.[0]) return null;
    await this.insertJobEvent(jobId, "complete", "complete", "✅", output.detail || null);
    return result.rows[0];
  }

  async failJob(jobId, code, message) {
    return this.withTransaction((repository) => repository.#failJobMutation(jobId, code, message));
  }

  async #failJobMutation(jobId, code, message) {
    const detail = String(message || "failed").slice(0, 500);
    const result = await this.query(
      `UPDATE ${this.table("jobs")}
       SET status='failed', stage=$2, error_code=$2, error_message=$3, updated_at=now()
       WHERE id=$1 AND status IN ('queued','running')
       RETURNING id`,
      [jobId, code, detail],
    );
    if (!result.rows?.[0]) return null;
    await this.insertJobEvent(jobId, code, "failed", "❓", detail);
    return result.rows[0];
  }

  async insertJobEvent(jobId, stage, status, emoji, detail) {
    await this.query(
      `INSERT INTO ${this.table("job_events")} (job_id, stage, status, emoji, detail)
       VALUES ($1,$2,$3,$4,$5)`,
      [jobId, stage, status, emoji, detail],
    );
  }

  async upsertResource(resource) {
    const result = await this.query(
      `INSERT INTO ${this.table("resources")} (
        id, job_id, name, slug, kind, canonical_url, summary, why_useful,
        guide_text, artifact_type, canonical_key, media_json, library_path
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (job_id, slug)
      DO UPDATE SET summary=excluded.summary, why_useful=excluded.why_useful,
        guide_text=excluded.guide_text, media_json=excluded.media_json, library_path=excluded.library_path
      RETURNING *`,
      [
        resource.id,
        resource.jobId,
        resource.name,
        resource.slug,
        resource.kind || "reference",
        resource.canonicalUrl || null,
        resource.summary || null,
        resource.whyUseful || null,
        resource.guideText || null,
        resource.artifactType || null,
        resource.canonicalKey || null,
        resource.mediaJson ? JSON.stringify(resource.mediaJson) : null,
        resource.libraryPath || null,
      ],
    );
    return result.rows?.[0] || null;
  }

  async recordArtifactWrite({ jobId, key, checksum, byteLength, contentType }) {
    await this.query(
      `INSERT INTO ${this.table("artifacts")} (job_id, object_key, checksum_sha256, byte_length, content_type)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (job_id, object_key)
       DO UPDATE SET checksum_sha256=excluded.checksum_sha256, byte_length=excluded.byte_length,
        content_type=excluded.content_type, updated_at=now()`,
      [jobId, key, checksum, byteLength, contentType || "application/octet-stream"],
    );
  }

  async createPhase5PilotLease(input) {
    return this.withTransaction(async () => {
      const result = await this.query(
        `INSERT INTO ${this.table("phase5_pilot_leases")} (
          pilot_key, exact_job_id, source_message_id, cloud_fence_key, status, expires_at, audit_json
        ) VALUES ($1,$2,$3,$4,'armed',$5,$6)
        ON CONFLICT (pilot_key)
        DO UPDATE SET updated_at=now()
        WHERE phase5_pilot_leases.exact_job_id=excluded.exact_job_id
          AND phase5_pilot_leases.source_message_id=excluded.source_message_id
          AND phase5_pilot_leases.status IN ('armed','leased','processing')
        RETURNING *`,
        [
          input.pilotKey,
          input.jobId,
          input.sourceMessageId,
          input.cloudFenceKey || input.pilotKey,
          input.expiresAt,
          JSON.stringify(input.audit || {}),
        ],
      );
      if (!result.rows?.[0]) return null;
      await this.insertPhase5PilotEvent(input.pilotKey, input.jobId, "armed", "armed", {
        cloud_fence_key: input.cloudFenceKey || input.pilotKey,
      });
      return result.rows[0];
    });
  }

  async claimPhase5PilotLease({ pilotKey, jobId, leaseOwner, leaseSeconds = 900 }) {
    return this.withTransaction(async () => {
      const result = await this.query(
        `UPDATE ${this.table("phase5_pilot_leases")}
         SET status='leased',
             lease_owner=$3,
             lease_acquired_at=COALESCE(lease_acquired_at, now()),
             lease_heartbeat_at=now(),
             lease_expires_at=now() + ($4 || ' seconds')::interval,
             attempt=attempt+1,
             updated_at=now()
         WHERE pilot_key=$1
           AND exact_job_id=$2
           AND status='armed'
           AND expires_at > now()
         RETURNING *`,
        [pilotKey, jobId, leaseOwner, String(Math.max(30, Math.min(Number(leaseSeconds || 900), 3600)))],
      );
      if (!result.rows?.[0]) return null;
      await this.insertPhase5PilotEvent(pilotKey, jobId, "leased", "leased", { lease_owner: leaseOwner });
      return result.rows[0];
    });
  }

  async heartbeatPhase5PilotLease({ pilotKey, jobId, leaseOwner, leaseSeconds = 900 }) {
    const result = await this.query(
      `UPDATE ${this.table("phase5_pilot_leases")}
       SET lease_heartbeat_at=now(),
           lease_expires_at=now() + ($4 || ' seconds')::interval,
           updated_at=now()
       WHERE pilot_key=$1 AND exact_job_id=$2 AND lease_owner=$3 AND status IN ('leased','processing')
       RETURNING *`,
      [pilotKey, jobId, leaseOwner, String(Math.max(30, Math.min(Number(leaseSeconds || 900), 3600)))],
    );
    return result.rows?.[0] || null;
  }

  async renewPhase5PilotLease({ pilotKey, jobId, sourceMessageId, leaseOwner, leaseSeconds = 10_800, reason }) {
    return this.withTransaction(async () => {
      const result = await this.query(
        `UPDATE ${this.table("phase5_pilot_leases")} l
         SET lease_heartbeat_at=now(),
             lease_expires_at=now() + ($5 || ' seconds')::interval,
             expires_at=now() + ($5 || ' seconds')::interval,
             updated_at=now()
         FROM ${this.table("jobs")} j
         WHERE l.exact_job_id=j.id
           AND l.pilot_key=$1
           AND l.exact_job_id=$2
           AND l.source_message_id=$3
           AND l.lease_owner=$4
           AND l.status='leased'
           AND l.lease_expires_at > now()
           AND j.status='queued'
           AND j.completed_at IS NULL
           AND j.html_key IS NULL
           AND j.library_path IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM ${this.table("artifacts")} a
             WHERE a.job_id=l.exact_job_id
               AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
           )
           AND NOT EXISTS (
             SELECT 1 FROM ${this.table("job_events")} e
             WHERE e.job_id=l.exact_job_id
               AND e.stage IN ('complete','published','phase5_local_complete')
           )
         RETURNING l.*`,
        [pilotKey, jobId, sourceMessageId, leaseOwner, String(Math.max(300, Math.min(Number(leaseSeconds || 10_800), 21_600)))],
      );
      if (!result.rows?.[0]) return null;
      await this.insertPhase5PilotEvent(pilotKey, jobId, "lease_renewed", "leased", {
        lease_owner: leaseOwner,
        lease_seconds: Math.max(300, Math.min(Number(leaseSeconds || 10_800), 21_600)),
        reason: reason || "phase5_exact_job_lease_renewal",
      });
      return result.rows[0];
    });
  }

  async markPhase5PilotProcessing({ pilotKey, jobId, leaseOwner }) {
    return this.withTransaction(async () => {
      const result = await this.query(
        `UPDATE ${this.table("phase5_pilot_leases")}
         SET status='processing',lease_heartbeat_at=now(),updated_at=now()
         WHERE pilot_key=$1 AND exact_job_id=$2 AND lease_owner=$3 AND status='leased'
         RETURNING *`,
        [pilotKey, jobId, leaseOwner],
      );
      if (!result.rows?.[0]) return null;
      await this.insertPhase5PilotEvent(pilotKey, jobId, "processing", "processing", { lease_owner: leaseOwner });
      return result.rows[0];
    });
  }

  async completePhase5PilotLease({ pilotKey, jobId, leaseOwner, detail = {} }) {
    return this.withTransaction(async () => {
      const result = await this.query(
        `UPDATE ${this.table("phase5_pilot_leases")}
         SET status='completed',completed_at=now(),updated_at=now()
         WHERE pilot_key=$1 AND exact_job_id=$2 AND lease_owner=$3 AND status IN ('leased','processing')
         RETURNING *`,
        [pilotKey, jobId, leaseOwner],
      );
      if (!result.rows?.[0]) return null;
      await this.insertPhase5PilotEvent(pilotKey, jobId, "completed", "completed", detail);
      return result.rows[0];
    });
  }

  async rollbackPhase5PilotLease({ pilotKey, jobId, reason }) {
    return this.withTransaction(async () => {
      const result = await this.query(
        `UPDATE ${this.table("phase5_pilot_leases")}
         SET status='rolled_back',rollback_at=now(),rollback_reason=$3,updated_at=now()
         WHERE pilot_key=$1 AND exact_job_id=$2 AND status IN ('armed','leased','processing')
         RETURNING *`,
        [pilotKey, jobId, reason || "operator_requested_phase5_local_rollback"],
      );
      if (!result.rows?.[0]) return null;
      await this.insertPhase5PilotEvent(pilotKey, jobId, "rolled_back", "rolled_back", { reason });
      return result.rows[0];
    });
  }

  async insertPhase5PilotEvent(pilotKey, jobId, stage, status, detail = {}) {
    await this.query(
      `INSERT INTO ${this.table("phase5_pilot_events")} (pilot_key, job_id, stage, status, detail)
       VALUES ($1,$2,$3,$4,$5)`,
      [pilotKey, jobId, stage, status, JSON.stringify(detail || {})],
    );
  }

  async getStatusSummary() {
    const result = await this.query(
      `SELECT status, COUNT(*)::int AS count,
        AVG(processing_seconds)::float AS average_processing_seconds,
        AVG(codex_total_tokens)::float AS average_codex_total_tokens
       FROM ${this.table("jobs")}
       GROUP BY status
       ORDER BY status`,
    );
    return result.rows || [];
  }

  async searchLibrary(query, { limit = 10 } = {}) {
    const pattern = `%${String(query || "").trim()}%`;
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
    const result = await this.query(
      `SELECT 'job' AS record_type, id, title AS name, author_username, library_path
       FROM ${this.table("jobs")}
       WHERE title ILIKE $1 OR description ILIKE $1 OR author_username ILIKE $1
       UNION ALL
       SELECT 'resource' AS record_type, id, name, NULL AS author_username, library_path
       FROM ${this.table("resources")}
       WHERE name ILIKE $1 OR summary ILIKE $1 OR guide_text ILIKE $1
       ORDER BY record_type, name
       LIMIT ${safeLimit}`,
      [pattern],
    );
    return result.rows || [];
  }

  async listNotes({ limit = 20 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    const result = await this.query(
      `SELECT id, sender_id, body, source_message_id, created_at
       FROM ${this.table("notes")}
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`,
    );
    return result.rows || [];
  }

  async getRetrievalMetadata(jobId) {
    const result = await this.query(
      `SELECT j.id, j.source_url, j.canonical_url, j.original_video_key, j.audio_key,
        j.html_key, j.library_path, j.transcript_key, j.synthesis_json_key,
        COUNT(DISTINCT r.id)::int AS resource_count,
        COUNT(DISTINCT a.id)::int AS artifact_count
       FROM ${this.table("jobs")} j
       LEFT JOIN ${this.table("resources")} r ON r.job_id=j.id
       LEFT JOIN ${this.table("artifacts")} a ON a.job_id=j.id
       WHERE j.id=$1
       GROUP BY j.id`,
      [jobId],
    );
    return result.rows?.[0] || null;
  }

  async listLibraryPaths({ limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const result = await this.query(
      `SELECT 'job' AS record_type, id, library_path, html_key AS object_key
       FROM ${this.table("jobs")}
       WHERE library_path IS NOT NULL
       UNION ALL
       SELECT 'resource' AS record_type, id, library_path, guide_html_key AS object_key
       FROM ${this.table("resources")}
       WHERE library_path IS NOT NULL
       ORDER BY record_type, library_path
       LIMIT ${safeLimit}`,
    );
    return result.rows || [];
  }
}
