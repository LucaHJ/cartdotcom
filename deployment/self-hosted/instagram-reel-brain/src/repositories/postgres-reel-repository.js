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
}
