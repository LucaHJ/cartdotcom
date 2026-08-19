export const NEW_ARTICLE_PRIORITY = 100;
export const RESYNTHESIS_PRIORITY = 10;

export function retryDelaySeconds(attempts) {
  return Math.min(3600, 30 * (2 ** Math.max(0, attempts - 1)));
}

export async function claimJobs(client, { owner, limit = 1, leaseSeconds = 900 } = {}) {
  if (!owner) throw new Error("A lease owner is required.");
  const result = await client.query(
    `WITH candidates AS (
       SELECT id
       FROM local_job_queue
       WHERE (
         (status = 'pending' AND available_at <= CURRENT_TIMESTAMP)
         OR (status = 'running' AND lease_expires_at < CURRENT_TIMESTAMP)
       )
       AND attempts < max_attempts
       ORDER BY priority DESC, available_at ASC, created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE local_job_queue AS queue
     SET status = 'running',
         attempts = queue.attempts + 1,
         lease_owner = $2,
         lease_expires_at = CURRENT_TIMESTAMP + ($3 * interval '1 second'),
         updated_at = CURRENT_TIMESTAMP,
         last_error = NULL
     FROM candidates
     WHERE queue.id = candidates.id
     RETURNING queue.*`,
    [limit, owner, leaseSeconds],
  );
  return result.rows;
}

export async function extendLease(client, { id, owner, leaseSeconds = 900 }) {
  const result = await client.query(
    `UPDATE local_job_queue
     SET lease_expires_at = CURRENT_TIMESTAMP + ($3 * interval '1 second'), updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'running' AND lease_owner = $2
     RETURNING id`,
    [id, owner, leaseSeconds],
  );
  return result.rowCount === 1;
}

export async function releaseForRetry(client, { id, owner, error, attempts }) {
  const delay = retryDelaySeconds(attempts);
  const result = await client.query(
    `UPDATE local_job_queue
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         available_at = CURRENT_TIMESTAMP + ($4 * interval '1 second'),
         lease_owner = NULL,
         lease_expires_at = NULL,
         last_error = $3,
         finished_at = CASE WHEN attempts >= max_attempts THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'running' AND lease_owner = $2
     RETURNING status`,
    [id, owner, String(error).slice(0, 4000), delay],
  );
  return result.rows[0]?.status || null;
}
